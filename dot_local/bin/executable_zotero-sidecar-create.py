#!/usr/bin/env python3
"""zotero-sidecar-create.py — GPU MinerU sidecar creation (parse ONLY, no embed).

Separates "create sidecar" from "embed". Runs magic-pdf (ROCm GPU path) on each
item's PDF and writes the MinerU sidecar to
~/.config/zotero-mcp/mineru-sidecars/<key>.md. Does NOT chunk/embed/index —
run `zotero-sidecar.sh embed <COLLECTION_KEY>` afterward.

Usage:
  zotero-sidecar-create.py [--force] [--attachment-key ATTACH_KEY] <COLLECTION_KEY>
  zotero-sidecar-create.py [--force] [--attachment-key ATTACH_KEY] <KEY> [KEY ...]

  --force            Re-create an existing sidecar. The old sidecar remains in
                     place unless the new parse succeeds.
  --attachment-key   Pin the exact PDF attachment when the item has multiple PDFs.

Skips items that already have a sidecar (unless --force). Idempotent. Logs to
~/.cache/zotero-mcp/logs/sidecar-create.log.

NOTE: this is the raw GPU MinerU path with no GTT balloon guard. The VLM-baseline
false-positive is not an issue here (that was the watchdog's fixed threshold), but
a genuinely ballooning PDF (e.g. the known Gregory case) can thrash the system —
if a specific PDF hangs/balloons, CPU-rescue it with zotero-cpu-rescue.py instead.
"""
import json
import sys
import time
from pathlib import Path

from zotero_mcp import mineru, sidecar_quality
from zotero_mcp.local_db import LocalZoteroReader

HOME = Path.home()
CFG_PATH = HOME / ".config" / "zotero-mcp" / "config.json"
LOG = HOME / ".cache" / "zotero-mcp" / "logs" / "sidecar-create.log"


def log(msg: str) -> None:
    line = f"{time.strftime('%F %T')} {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def ensure_ocr_flag_patch(bin_path: str) -> str:
    """MinerU 1.3.12 hardcodes ocr=True in BatchAnalyze.__call__
    (magic_pdf/model/batch_analyze.py), forcing the OCR-det pass on every parse
    even with `-m txt` / ocr-config.enable: false. OCR-det (paddleocr2pytorch)
    then grinds on CPU (~4-9 s/it, single core, GPU idle, cold temps) — the
    GTT-balloon watch exists precisely because parses should hammer the GPU.
    Patch: thread the parse-method flag through (txt -> ocr=False, so
    born-digital PDFs skip OCR entirely; `-m ocr` still enables it for scans).
    Idempotent: recognizes the patched expression; backs up before applying.
    """
    venv = Path(bin_path).resolve().parent.parent
    for site in venv.glob("lib/python*/site-packages"):
        target = site / "magic_pdf" / "model" / "batch_analyze.py"
        if not target.exists():
            continue
        src = target.read_text(encoding="utf-8")
        if "images_with_extra_info[0][1] if images_with_extra_info" in src:
            return "already-patched"
        old = "            ocr=True,"
        new = (
            "            ocr=images_with_extra_info[0][1] if images_with_extra_info else True,"
            "  # [ocr-flag patch]"
        )
        if old not in src:
            # MinerU 3.x reworked OCR gating (no hardcode) — patch N/A.
            return "not-applicable"
        backup = target.with_name(f"batch_analyze.py.bak-{time.strftime('%Y%m%d')}")
        if not backup.exists():
            backup.write_text(src, encoding="utf-8")
        target.write_text(src.replace(old, new), encoding="utf-8")
        return "patched"
    return "no-batch_analyze.py"


def main() -> None:
    args = sys.argv[1:]
    force = "--force" in args
    args = [a for a in args if a != "--force"]
    attachment_key = None
    if "--attachment-key" in args:
        idx = args.index("--attachment-key")
        if idx + 1 >= len(args):
            print("--attachment-key requires a Zotero attachment key")
            sys.exit(1)
        attachment_key = args[idx + 1]
        del args[idx:idx + 2]
    if not args:
        print("usage: zotero-sidecar-create.py [--force] <COLLECTION_KEY> | <KEY> [KEY ...]")
        sys.exit(1)

    cfg = mineru.load_mineru_config()  # default = GPU (ROCm) bin + magic-pdf-gpu.json
    log(f"ocr-flag patch: {ensure_ocr_flag_patch(cfg['bin'])}")
    raw = json.loads(CFG_PATH.read_text(encoding="utf-8"))
    db_path = raw.get("semantic_search", {}).get("zotero_db_path")

    failures = 0
    with LocalZoteroReader(db_path=db_path) as reader:
        # A single 8-char alnum arg is a collection key IF it resolves to one;
        # otherwise it's an item key.
        if len(args) == 1 and len(args[0]) == 8 and args[0].isalnum():
            if reader.resolve_collection_keys(args[0]):
                coll = args[0]
                keys = sorted(reader.resolve_collection_item_keys(coll))
                if not keys:
                    log(f"FAIL collection {coll}: no parent items; refusing an unscoped parse")
                    sys.exit(2)
                log(f"collection {coll}: {len(keys)} items")
            else:
                keys = args
        else:
            keys = args

        if attachment_key and (len(keys) != 1 or keys[0] != args[0]):
            log("FAIL: --attachment-key is supported for one explicit item key only")
            sys.exit(1)
        for key in keys:
            if not force and mineru.read_sidecar(cfg, key) is not None:
                log(f"skip {key}: sidecar already exists (use --force to re-create)")
                continue
            pdfs = []
            for att in reader.get_attachment_paths(key):
                rp = att.get("resolved_path")
                is_pdf = str(att.get("content_type") or "").lower() == "application/pdf" or str(rp or "").lower().endswith(".pdf")
                if not is_pdf or not rp or not Path(rp).is_file():
                    continue
                if attachment_key and str(att.get("key") or "") != attachment_key:
                    continue
                pdfs.append((str(att.get("key") or ""), Path(rp)))
            if len(pdfs) != 1:
                failures += 1
                log(f"FAIL {key}: found {len(pdfs)} resolvable matching PDFs; pin --attachment-key when ambiguous")
                continue
            selected_attachment, pdf = pdfs[0]
            log(f"start {key}: {pdf.name} ({pdf.stat().st_size / 1e6:.0f} MB), attachment {selected_attachment}")
            ok = mineru.run_mineru(cfg, pdf, key, attachment_key=selected_attachment)
            if ok:
                side = mineru.sidecar_path(cfg, key)
                log(f"PARSED {key}: sidecar {side} ({side.stat().st_size / 1024:.0f} KB); raw parse retained under {cfg['work_dir']}/{key}/runs")
                try:
                    report = sidecar_quality.build_quality_report(key, cfg, reader, attachment_key=selected_attachment)
                    report_path = sidecar_quality.write_quality_report(report, cfg)
                    if report["status"] != "eligible":
                        failures += 1
                        codes = sorted({f["code"] for f in report["findings"] if f["severity"] == "critical"})
                        log(f"BLOCKED {key}: automated quality check {report['status']} ({', '.join(codes)}); {report_path}")
                    else:
                        log(f"CHECKED {key}: eligible; {report_path}")
                except Exception as exc:
                    failures += 1
                    log(f"FAIL {key}: quality check raised {type(exc).__name__}: {exc}; do not embed")
            else:
                failures += 1
                log(f"FAIL {key}: MinerU failed (see {cfg['work_dir']}/{key}/run.log)")
    log(f"create complete: failures={failures}")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
