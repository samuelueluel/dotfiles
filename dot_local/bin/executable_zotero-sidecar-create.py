#!/usr/bin/env python3
"""zotero-sidecar-create.py — GPU MinerU sidecar creation (parse ONLY, no embed).

Separates "create sidecar" from "embed". Runs magic-pdf (ROCm GPU path) on each
item's PDF and writes the MinerU sidecar to
~/.config/zotero-mcp/mineru-sidecars/<key>.md. Does NOT chunk/embed/index —
run `zotero-sidecar.sh embed <COLLECTION_KEY>` afterward.

Usage:
  zotero-sidecar-create.py [--force] <COLLECTION_KEY>   # all items in a collection (and subcollections)
  zotero-sidecar-create.py [--force] <KEY> [KEY ...]    # explicit item keys (any collection)

  --force   Re-create: delete an existing sidecar before parsing (for a corrupt/
            stale sidecar). Without it, items that already have a sidecar are skipped.

Skips items that already have a sidecar (unless --force). Idempotent. Logs to
~/.cache/zotero-mcp/logs/sidecar-create.log.

NOTE: this is the raw GPU MinerU path with no GTT balloon guard. The VLM-baseline
false-positive is not an issue here (that was the watchdog's fixed threshold), but
a genuinely ballooning PDF (e.g. the known Gregory case) can thrash the system —
if a specific PDF hangs/balloons, CPU-rescue it with zotero-cpu-rescue.py instead.
"""
import json
import shutil
import sys
import time
from pathlib import Path

from zotero_mcp import mineru
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
    if not args:
        print("usage: zotero-sidecar-create.py [--force] <COLLECTION_KEY> | <KEY> [KEY ...]")
        sys.exit(1)

    cfg = mineru.load_mineru_config()  # default = GPU (ROCm) bin + magic-pdf-gpu.json
    log(f"ocr-flag patch: {ensure_ocr_flag_patch(cfg['bin'])}")
    raw = json.loads(CFG_PATH.read_text(encoding="utf-8"))
    db_path = raw.get("semantic_search", {}).get("zotero_db_path")

    with LocalZoteroReader(db_path=db_path) as reader:
        # A single 8-char alnum arg is a collection key IF it resolves to one;
        # otherwise it's an item key.
        if len(args) == 1 and len(args[0]) == 8 and args[0].isalnum():
            if reader.resolve_collection_keys(args[0]):
                coll = args[0]
                item_coll = reader.get_item_collections()
                keys = sorted(k for k, cols in item_coll.items() if coll in cols)
                log(f"collection {coll}: {len(keys)} items")
            else:
                keys = args
        else:
            keys = args

        for key in keys:
            if not force and mineru.read_sidecar(cfg, key) is not None:
                log(f"skip {key}: sidecar already exists (use --force to re-create)")
                continue
            pdf = None
            for att in reader.get_attachment_paths(key):
                rp = att.get("resolved_path")
                if rp and str(rp).lower().endswith(".pdf") and Path(rp).exists():
                    pdf = Path(rp)
                    break
            if pdf is None:
                log(f"FAIL {key}: no resolvable PDF")
                continue
            # --force: drop the stale sidecar so the fresh parse is byte-clean.
            if force:
                side = mineru.sidecar_path(cfg, key)
                if side.exists():
                    side.unlink()
                    log(f"force: removed existing sidecar {side}")
            # Clear any partial output so the fresh parse is byte-clean.
            out_dir = Path(cfg["work_dir"]) / key / "out"
            if out_dir.exists():
                shutil.rmtree(out_dir)
            log(f"start {key}: {pdf.name} ({pdf.stat().st_size / 1e6:.0f} MB)")
            ok = mineru.run_mineru(cfg, pdf, key)
            if ok:
                side = mineru.sidecar_path(cfg, key)
                log(f"DONE {key}: sidecar {side} ({side.stat().st_size / 1024:.0f} KB)")
            else:
                log(f"FAIL {key}: magic-pdf failed (see {cfg['work_dir']}/{key}/run.log)")
    log("create complete")


if __name__ == "__main__":
    main()
