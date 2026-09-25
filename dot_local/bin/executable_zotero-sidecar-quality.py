#!/usr/bin/env python3
"""CLI shim for the managed Zotero sidecar-quality checker."""
from __future__ import annotations

import importlib.util
from pathlib import Path


def load_main():
    candidates = (
        Path("/usr/share/turquoise/zotero-mcp-sidecar-quality.py"),
        Path.home() / "turquoise/files/system/usr/share/turquoise/zotero-mcp-sidecar-quality.py",
    )
    for source in candidates:
        if not source.is_file():
            continue
        spec = importlib.util.spec_from_file_location("zotero_sidecar_quality_source", source)
        if spec is None or spec.loader is None:
            continue
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.main
    # Fall back to the installed managed overlay when the source checkout is
    # unavailable (e.g. on a machine that installed the package patch only).
    from zotero_mcp.sidecar_quality import main
    return main


if __name__ == "__main__":
    raise SystemExit(load_main()())
