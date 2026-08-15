#!/usr/bin/env python3
"""zotero-vlm-enrich.py — Structural VLM Figure Schema Extraction (RAG Extension 2).

Scans MinerU sidecars for image references, sends each qualifying figure to the
local Qwen2.5-VL-72B endpoint (:8084) with a strict structural-taxonomy prompt,
and injects a ``[Figure Schema]`` YAML block below the image line so the
embedder (:8082) and the BM25 index make the visual evidence discoverable.

Index-beacon role only: the schema makes figures findable by search; exact
numbers still come from tables/text via the agent's tools. The VLM is
explicitly forbidden from estimating point estimates, SEs, CIs, or interpreting
qualitative findings (zero quantitative hallucination).

Pipeline (offline batch, host):
    serve-vlm                                  # ramalama :8084, ~58 GB Q6_K
    zotero-vlm-enrich.py --all                 # backfill; ~18 s/figure
    stop-vlm                                   # release RAM
    zotero-mcp-server update-db --fulltext     # re-embed changed sidecars

Idempotent: skips images that already carry a [Figure Schema] block below them.
Dimension filter: skips width<300 or height<300 or aspect<0.2 or >5.0
(publisher logos, journal headers, CC-BY icons, line dividers).

Usage:
    zotero-vlm-enrich.py --all                  backfill every sidecar (default)
    zotero-vlm-enrich.py --key 2BLBX32Z         single item
    zotero-vlm-enrich.py --dry-run              report what would be processed
"""
import argparse
import base64
import glob
import json
import os
import re
import struct
import sys
from pathlib import Path

import requests

SIDECAR_DIR = Path.home() / ".config" / "zotero-mcp" / "mineru-sidecars"
WORK_DIR = Path.home() / ".cache" / "zotero-mcp" / "mineru-work"
VLM_URL = "http://127.0.0.1:8084/v1/chat/completions"
VLM_MODEL = "Qwen2.5-VL-72B-Instruct"
TIMEOUT_S = 180  # ~18 s/figure typical; generous headroom for cold first call

IMG_RE = re.compile(r"!\[[^\]]*\]\((images/[^)\s]+)\)")

SYSTEM_PROMPT = """You are an expert figure reader for empirical economics papers.
Given a figure image from a research paper, describe ONLY its structural taxonomy —
what it plots and how it is constructed — with strict factual discipline.

Report these fields when present:
- Type: the figure kind (e.g. event study plot, coefficient plot, scatter plot,
  map, histogram, time-series plot, bar chart, density plot)
- Y-Axis: label and units as printed on the figure
- X-Axis: label and units as printed on the figure
- Panels: Panel A / Panel B structure if present (name each panel)
- Legend / Series: what series/legend entries exist, and any reference line
  (e.g. zero baseline, 95% CI)
- Linked Notes: any equation number or text reference visible in the image

You MUST NOT estimate, guess, or interpret point estimates, coefficients,
standard errors, confidence intervals, or statistical/econometric findings.
You MUST NOT comment on significance, causality, or trends. A number visibly
printed on the figure may be recorded as a label; never as an interpretation.
If a field is not present, omit it rather than inventing one.

Output a concise YAML bullet block, one dash per field, exactly like:
[Figure Schema]
- Type: Event study plot (dynamic coefficients with 95% CI)
- Y-Axis: Log(Assessed Property Value), 2010 USD
- X-Axis: Years relative to policy adoption (t = -5 to +5)
- Panels: Panel A: Residential; Panel B: Commercial
- Legend / Series: Point estimates, 95% CI, zero baseline
- Linked Notes: Equation (4), county-clustered SEs
"""


def sidecar_refs(text: str) -> list[tuple[str, int]]:
    """All (image_path, line_no) image references in a sidecar."""
    out = []
    for i, line in enumerate(text.splitlines()):
        for m in IMG_RE.finditer(line):
            out.append((m.group(1), i))
    return out


def resolve_image(key: str, img_path: str) -> Path | None:
    """Resolve ``images/<name>`` against the item's MinerU work dir layout."""
    name = img_path.rsplit("/", 1)[-1]
    base = WORK_DIR / key / "out"
    for pattern in (f"*/txt/images/{name}", f"*/images/{name}", f"*/out/images/{name}"):
        hits = sorted(glob.glob(str(base / pattern)))
        if hits:
            return Path(hits[0])
    return None


def _image_size(p: Path) -> tuple[int, int] | None:
    """Dependency-free width/height sniffing for PNG/JPEG (MinerU crops)."""
    try:
        with open(p, "rb") as f:
            head = f.read(32)
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", head[16:24])
        if head[:2] == b"\xff\xd8":  # JPEG: walk markers to SOFn
            with open(p, "rb") as f:
                f.seek(2)
                while True:
                    b = f.read(1)
                    while b and b != b"\xff":
                        b = f.read(1)
                    marker = f.read(1)
                    if not marker:
                        return None
                    if marker[0] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                                     0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                        data = f.read(7)
                        if len(data) == 7:
                            return struct.unpack(">HH", data[3:7])[::-1]
                        return None
                    if 0xD0 <= marker[0] <= 0xD7:
                        continue  # RSTn: no length
                    ln = struct.unpack(">H", f.read(2))[0]
                    f.seek(ln - 2, 1)
    except Exception:
        return None
    return None


def passes_dimension_filter(p: Path) -> tuple[bool, str]:
    """True when the image is a real figure (not a logo/icon/divider)."""
    size = _image_size(p)
    if size is None:
        return False, "unreadable"
    w, h = size
    if w < 300 or h < 300:
        return False, f"{w}x{h} too small"
    aspect = w / h
    if aspect < 0.2 or aspect > 5.0:
        return False, f"aspect {aspect:.2f} outside [0.2, 5.0]"
    return True, f"{w}x{h}"


def already_schema(text: str, line_no: int) -> bool:
    """True when a [Figure Schema] block already sits below the image line."""
    lines = text.splitlines()
    for j in range(line_no + 1, min(line_no + 9, len(lines))):
        if "[Figure Schema]" in lines[j]:
            return True
        # stop at the next image ref or a blank line (schema sits directly below)
        if not lines[j].strip():
            return False
        if IMG_RE.search(lines[j]):
            return False
    return False


def ask_vlm(img_b64: str, mime: str) -> str | None:
    """POST the figure to the VLM; return the raw assistant text or None."""
    payload = {
        "model": VLM_MODEL,
        "temperature": 0.0,
        "max_tokens": 300,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}},
                    {"type": "text", "text": "Describe the structural taxonomy of this figure."},
                ],
            },
        ],
    }
    r = requests.post(VLM_URL, json=payload, timeout=TIMEOUT_S)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def clean_schema(raw: str) -> str:
    """Normalize the VLM answer into the injected [Figure Schema] block."""
    s = raw.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-z]*\n?", "", s)
        s = re.sub(r"\n?```$", "", s)
    s = s.strip()
    if s.startswith("[Figure Schema]"):
        s = s[len("[Figure Schema]"):].strip()
    s = s.lstrip("\n-").strip()
    if not s:
        return ""
    lines = [ln for ln in s.splitlines() if ln.strip()]
    return "[Figure Schema]\n" + "\n".join("- " + ln[2:].strip() if ln.startswith("- ") else "- " + ln.strip() for ln in lines)


def process_sidecar(key: str, dry_run: bool) -> dict:
    """Enrich one sidecar. Returns per-item counters."""
    st = {"figures": 0, "schema": 0, "dim_filter": 0, "missing_img": 0, "already": 0, "vlm_err": 0}
    sp = SIDECAR_DIR / f"{key}.md"
    if not sp.exists():
        st["missing_img"] += 1
        return st
    text = sp.read_text(encoding="utf-8")
    refs = sidecar_refs(text)
    st["figures"] = len(refs)
    if dry_run:
        return st

    lines = text.splitlines(keepends=True)
    insertions = []  # (line_no, block)
    for img_path, line_no in refs:
        if already_schema(text, line_no):
            st["already"] += 1
            continue
        img = resolve_image(key, img_path)
        if img is None:
            st["missing_img"] += 1
            continue
        ok, why = passes_dimension_filter(img)
        if not ok:
            st["dim_filter"] += 1
            continue
        mime = "image/png" if img.suffix.lower() in (".png",) else "image/jpeg"
        try:
            b64 = base64.b64encode(img.read_bytes()).decode()
            raw = ask_vlm(b64, mime)
        except requests.RequestException as e:
            print(f"  {key} {img_path}: VLM error ({e})", file=sys.stderr)
            st["vlm_err"] += 1
            continue
        block = clean_schema(raw)
        if not block:
            print(f"  {key} {img_path}: empty VLM response", file=sys.stderr)
            st["vlm_err"] += 1
            continue
        insertions.append((line_no, block))
        st["schema"] += 1
        print(f"  {key} {img_path}: schema added")

    if insertions:
        # Apply bottom-up so earlier line numbers stay valid.
        for line_no, block in sorted(insertions, reverse=True):
            lines.insert(line_no + 1, block + "\n")
        sp.write_text("".join(lines), encoding="utf-8")
    return st


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--key", metavar="KEY", help="process a single item key")
    g.add_argument("--all", action="store_true", help="backfill every sidecar (default)")
    ap.add_argument("--dry-run", action="store_true", help="report only, no API calls")
    args = ap.parse_args()

    if not args.dry_run:
        try:
            requests.get("http://127.0.0.1:8084/v1/models", timeout=5)
        except requests.RequestException:
            print("VLM endpoint not reachable on :8084 — run `serve-vlm` first "
                  "(first serve downloads ~58 GB).", file=sys.stderr)
            return 1

    keys = [args.key] if args.key else sorted(p.stem for p in SIDECAR_DIR.glob("*.md"))
    total = {"sidecars": 0, "figures": 0, "schema": 0, "dim_filter": 0,
             "missing_img": 0, "already": 0, "vlm_err": 0}
    for key in keys:
        st = process_sidecar(key, args.dry_run)
        total["sidecars"] += 1
        for k in ("figures", "schema", "dim_filter", "missing_img", "already", "vlm_err"):
            total[k] += st[k]
        print(f"[{key}] figures={st['figures']} schema={st['schema']} "
              f"already={st['already']} dim_filter={st['dim_filter']} "
              f"missing={st['missing_img']} vlm_err={st['vlm_err']}")

    print("\n=== SUMMARY ===")
    for k, v in total.items():
        print(f"  {k}: {v}")
    if not args.dry_run and total["schema"]:
        print("\nNext: re-embed changed sidecars (embedder :8082 must be up):")
        print("  zotero-mcp-server update-db --fulltext")
    return 0


if __name__ == "__main__":
    sys.exit(main())
