#!/usr/bin/env python3
"""CPU-venv rescue for MinerU poison items.

The GPU (ROCm) magic-pdf path deterministically balloons amdgpu GTT on a
known set of PDFs (see New-RAG-Setup.md "GPU GTT balloon bug"); the CPU venv
parses the same PDFs cleanly (~3 GB RSS, no balloon). This script reuses the
production zotero_mcp.mineru.run_mineru() path with the CPU binary + CPU
config, so sidecars are byte-identical to the normal pipeline.

Usage: zotero-cpu-rescue.py [item_key ...]
       (default: the 8 known poison keys)
Runs each item serially; skips items that already have a sidecar.
Log: ~/.cache/zotero-mcp/logs/cpu-rescue.log
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
LOG = HOME / ".cache" / "zotero-mcp" / "logs" / "cpu-rescue.log"

POISON = [
    "347KLNEW",  # Gregory — documented poison
    "J3SP2CVL",
    "VM4MXRHA",  # Dontchev & Rockafellar (large)
    "67TWAWIE",
    "7RG5Q67L",
    "9JSTCS7B",
    "EKBPAUC8",
    "SFS88VUE",
]
TIMEOUT = 14400  # 4 h per item — big books exceed the 1 h default on CPU


def log(msg: str) -> None:
    line = f"{time.strftime('%F %T')} {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def main() -> None:
    keys = sys.argv[1:] or POISON
    cfg = mineru.load_mineru_config()
    cfg["bin"] = str(HOME / "mineru-venv/bin/magic-pdf")
    cfg["config_json"] = str(HOME / "magic-pdf.json")
    cfg["timeout_seconds"] = TIMEOUT
    raw = json.loads(CFG_PATH.read_text(encoding="utf-8"))
    db_path = raw.get("semantic_search", {}).get("zotero_db_path")

    log(f"rescue start: bin={cfg['bin']} config={cfg['config_json']} "
        f"db={db_path} timeout={TIMEOUT}s keys={keys}")

    with LocalZoteroReader(db_path=db_path) as reader:
        for key in keys:
            if mineru.read_sidecar(cfg, key) is not None:
                log(f"skip {key}: sidecar already exists")
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
            # Clear any partial GPU-attempt output so the fresh CPU parse is
            # byte-clean (magic-pdf writes <out>/<stem>/txt/<stem>.md).
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
    log("rescue complete")


if __name__ == "__main__":
    main()
