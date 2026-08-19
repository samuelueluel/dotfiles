#!/usr/bin/env python3
"""zotero-vlm-enrich.py — Structural VLM Figure Schema Extraction (RAG Extension 2).

Scans MinerU sidecars for figure image references, sends each figure to the
local VLM (:8084), and injects a ``[Figure Schema]`` YAML block below the image
line so the chunker treats figure structure as retrievable text.

Idempotent: skips images that already carry a [Figure Schema] block below them.

Caption stamping (NEW): every schema block also receives a ``- Caption:`` line
with the figure's number/letter/title, extracted LOCALLY from the sidecar text
(caption lines like "Fig. 1." / "Figure 4:" / "FIGURE 1.1." adjacent to the
image). The caption is ground-truth text, so it is never delegated to the VLM
(the VLM prompt remains strictly structural; the script owns the Caption field).

Usage:
  zotero-vlm-enrich.py [--key KEY | --all] [--dry-run] [--captions-only | --relocate]

  --captions-only   No VLM calls at all: only stamp missing captions onto
                    existing [Figure Schema] blocks (local text scan). Use for
                    sidecars already enriched before caption stamping existed.
                    Re-running is safe (idempotent).

  --relocate        One-time repair (no VLM): lift drifted [Figure Schema]
                    blocks back to directly below their images and stamp the
                    adjacent caption. Only runs when the per-file schema count
                    exactly matches the reproducible expected count (images
                    that pass the dimension filter); otherwise it falls back
                    to adjacent-only caption stamping and reports the file.
                    Produces the same layout the patched VLM path would.
                    Idempotent: already-relocated blocks are a no-op.
"""
import argparse
import base64
import glob
import re
import struct
import sys
from pathlib import Path

import requests

SIDECAR_DIR = Path.home() / ".config" / "zotero-mcp" / "mineru-sidecars"
WORK_DIR = Path.home() / ".cache" / "zotero-mcp" / "mineru-work"
VLM_URL = "http://127.0.0.1:8084/v1/chat/completions"
VLM_MODEL = "Qwen3-VL-30B-A3B-Instruct"  # unsloth UD-Q8_K_XL (~36 GB, MoE ~3B active)
TIMEOUT_S = 180  # ~2-4 s/figure typical with the MoE; generous headroom for cold first call

IMG_RE = re.compile(r"!\[[^\]]*\]\((images/[^)\s]+)\)")

# Caption lines: "Fig. 1. ...", "Figure 4: ...", "FIGURE 1.1. ...", "Fig. A1-Cont'd"
# (number may be arabic, roman, or appendix-lettered; separator may be
# ".", ":", em-dash, hyphen, or plain space).
CAPTION_RE = re.compile(
    r"^\s*(?:fig|Fig|figure|Figure|FIGURE)\.?\s*"
    r"([A-Z]?[0-9IVXLCDM]+(?:\.[0-9]+)*[a-z]?)"
    r"([:.\u2014\u2013-]|\s+)(.*)$"
)

# Lines that *start* with "Figure N" but are in-text references ("Figure 4
# shows that ...") rather than captions. If the word right after the number is
# one of these verbs, treat the line as prose and skip it.
_CAPTION_PROSE_VERBS = frozenset({
    "provides", "shows", "illustrates", "presents", "displays", "reports",
    "plots", "depicts", "gives", "offers", "summarizes", "indicates",
    "reveals", "demonstrates", "describes", "compares", "documents",
    "highlights", "examines", "investigates", "uses", "applies", "lists",
    "details", "outlines", "presents.", "shows.", "provides.",
})

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

NOTE: the figure number/title/caption is stamped separately by the caller from
the document text — never try to read or guess the figure number from the
image itself, and do not emit a Caption field.

Output a concise YAML bullet block, one dash per field, exactly like:
[Figure Schema]
- Type: Event study plot (dynamic coefficients with 95% CI)
- Y-Axis: Log(Assessed Property Value), 2010 USD
- X-Axis: Years relative to policy adoption (t = -5 to +5)
- Panels: Panel A: Residential; Panel B: Commercial
- Legend / Series: Point estimates, 95% CI, zero baseline
- Linked Notes: Equation (4), county-clustered SEs
"""


def sidecar_refs(text: str) -> list[str]:
    """All image paths in a sidecar, in document order."""
    return [m.group(1) for m in IMG_RE.finditer(text)]


_resolve_cache: dict = {}
_images_dir_cache: dict = {}


def _images_dir(key: str) -> Path | None:
    """The MinerU images directory for an item (indexed once per key)."""
    if key in _images_dir_cache:
        return _images_dir_cache[key]
    base = WORK_DIR / key / "out"
    result = None
    for pattern in ("*/txt/images", "*/images", "*/out/images"):
        hits = sorted(glob.glob(str(base / pattern)))
        if hits:
            result = Path(hits[0])
            break
    _images_dir_cache[key] = result
    return result


def resolve_image(key: str, img_path: str) -> Path | None:
    """Resolve ``images/<name>`` against the item's MinerU work dir layout.
    (Cached + directory-indexed: maintenance passes call this for every
    figure, and per-image globbing over crop-heavy dirs is slow.)"""
    ck = (key, img_path)
    if ck in _resolve_cache:
        return _resolve_cache[ck]
    name = img_path.rsplit("/", 1)[-1]
    d = _images_dir(key)
    result = (d / name) if d is not None and (d / name).exists() else None
    _resolve_cache[ck] = result
    return result


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


def find_image_line(lines: list[str], img_path: str) -> int | None:
    """Current 0-based line number of the image ref in ``lines``."""
    for i, ln in enumerate(lines):
        if img_path in ln and IMG_RE.search(ln):
            return i
    return None


def image_line_index(lines: list[str]) -> dict[str, int]:
    """Map each image path to its current line number (one pass)."""
    out = {}
    for i, ln in enumerate(lines):
        m = IMG_RE.search(ln)
        if m:
            out[m.group(1)] = i
    return out


def find_schema_block(lines: list[str], line_no: int) -> tuple[int, int] | None:
    """Extent (start, end-exclusive) of the [Figure Schema] block below the
    image at ``line_no``, or None when no schema sits within 9 lines."""
    for j in range(line_no + 1, min(line_no + 9, len(lines))):
        if "[Figure Schema]" in lines[j]:
            start = j
            k = start + 1
            while k < len(lines) and lines[k].strip().startswith("- "):
                k += 1
            return (start, k)
        if not lines[j].strip():
            return None
        if IMG_RE.search(lines[j]):
            return None
    return None


def looks_like_caption(line: str) -> str | None:
    """Return the trimmed caption line when ``line`` is a figure caption line,
    else None. Rejects in-text references like "Figure 4 shows that ..."."""
    m = CAPTION_RE.match(line)
    if not m:
        return None
    rest = m.group(3).strip()
    first_word = rest.split()[0].strip(".,;:") if rest else ""
    if first_word.lower() in _CAPTION_PROSE_VERBS:
        return None
    return line.strip()


def _is_barrier(lines: list[str], j: int) -> bool:
    s = lines[j].strip()
    if not s:
        return False
    if IMG_RE.search(lines[j]):
        return True
    if s.startswith("#"):
        return True
    return False


def extract_caption(lines: list[str], line_no: int) -> str | None:
    """Find the caption line for the figure at ``line_no``.

    Scans forward (image -> schema block -> caption) up to 18 lines, stopping
    at the next image or a heading; falls back to a short backward scan. A
    caption whose lead is bare ("Figure 1:") has its title joined from the
    next line.
    """
    n = len(lines)
    for j in range(line_no + 1, min(line_no + 18, n)):
        if _is_barrier(lines, j):
            break
        cap = looks_like_caption(lines[j])
        if cap:
            m = CAPTION_RE.match(lines[j])
            if m and not m.group(3).strip():
                for k in range(j + 1, min(j + 3, n)):
                    nxt = lines[k].strip()
                    if not nxt:
                        continue
                    if IMG_RE.search(lines[k]) or nxt.startswith("#") or nxt.startswith("[Figure Schema]"):
                        break
                    if looks_like_caption(nxt) is not None:
                        break
                    return f"{cap} {nxt[:300]}"
            return cap
    for j in range(line_no - 1, max(line_no - 10, -1), -1):
        if _is_barrier(lines, j):
            break
        cap = looks_like_caption(lines[j])
        if cap and len(cap) < 200:
            return cap
    return None


def insert_caption(block: str, caption: str) -> str:
    """Stamp ``- Caption: ...`` into a schema block (idempotent).

    Inserted right after the ``- Type:`` line to keep the field order stable
    across VLM-produced and backfilled blocks.
    """
    if not caption or "- Caption:" in block:
        return block
    lines = block.splitlines()
    for i, ln in enumerate(lines):
        if ln.startswith("- Type:"):
            lines.insert(i + 1, f"- Caption: {caption}")
            return "\n".join(lines)
    return lines[0] + "\n" + f"- Caption: {caption}\n" + "\n".join(lines[1:])


def already_schema(text: str, line_no: int) -> bool:
    """True when a [Figure Schema] block already sits below the image line."""
    return find_schema_block(text.splitlines(), line_no) is not None


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


def stamp_captions_in_file(key: str, dry_run: bool, st: dict) -> None:
    """Local-only pass: stamp missing captions onto existing schema blocks.

    Shared with the VLM path via insert_caption/extract_caption, so backfilled
    blocks are byte-identical to what the patched VLM path would produce.
    """
    sp = SIDECAR_DIR / f"{key}.md"
    if not sp.exists():
        return
    text = sp.read_text(encoding="utf-8")
    refs = sidecar_refs(text)
    lines = text.splitlines(keepends=True)
    idx = image_line_index(lines)
    for img_path in refs:
        line_no = idx.get(img_path)
        if line_no is None:
            continue
        span = find_schema_block(lines, line_no)
        if span is None:
            continue
        st["already"] += 1
        block = "".join(lines[span[0]:span[1]])
        if "- Caption:" in block:
            st["caption_skip"] += 1
            continue
        caption = extract_caption(lines, line_no)
        if caption is None:
            st["caption_none"] += 1
            continue
        if dry_run:
            st["caption"] += 1
            continue
        new_block = insert_caption(block, caption)
        # Re-read + re-resolve (a write shifts later line numbers).
        text = sp.read_text(encoding="utf-8")
        lines = text.splitlines(keepends=True)
        idx = image_line_index(lines)
        line_no = idx.get(img_path)
        span = find_schema_block(lines, line_no) if line_no is not None else None
        if line_no is None or span is None:
            continue
        lines[span[0]:span[1]] = [new_block]
        sp.write_text("".join(lines), encoding="utf-8")
        st["caption"] += 1
        print(f"  {key} {img_path}: caption stamped")


def schema_extents(lines: list[str]) -> list[tuple[int, int, str]]:
    """All [Figure Schema] blocks in document order: (start, end, text)."""
    out = []
    i = 0
    while i < len(lines):
        if "[Figure Schema]" in lines[i]:
            j = i + 1
            while j < len(lines) and lines[j].strip().startswith("- "):
                j += 1
            out.append((i, j, "".join(lines[i:j])))
            i = j
        else:
            i += 1
    return out


def relocate_schemas(key: str, dry_run: bool) -> dict:
    """One-time repair: move drifted schema blocks below their images and
    stamp adjacent captions.

    The original enrichment inserted each schema at the ORIGINAL image line
    while the file grew, so later figures' schemas drifted progressively
    backward (a staircase). The drift is deterministic: schema N corresponds to
    the N-th schema-eligible image (resolvable + passes the dimension filter),
    which is reproducible. When the schema count exactly matches the expected
    count, relocate; otherwise fall back to adjacent-only caption stamping and
    report the mismatch (never guess an association).
    """
    st = {"figures": 0, "schemas": 0, "expected": 0, "verdict": "",
          "moved": 0, "caption": 0, "caption_none": 0, "already": 0,
          "caption_skip": 0}
    sp = SIDECAR_DIR / f"{key}.md"
    if not sp.exists():
        return st
    text = sp.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    idx = image_line_index(lines)
    ordered = sorted(idx.items(), key=lambda kv: kv[1])
    st["figures"] = len(ordered)
    extents = schema_extents(lines)
    st["schemas"] = len(extents)

    # Double-run artifacts: byte-identical duplicate blocks are provably safe
    # to drop (same text — no information lost). Prefer keeping a copy that
    # already carries a Caption, else the first occurrence.
    seen: dict[str, tuple[int, int, str]] = {}
    deduped = []
    for b in extents:
        key_txt = b[2]
        if key_txt in seen:
            cur_keep = seen[key_txt]
            if "- Caption:" in b[2] and "- Caption:" not in cur_keep[2]:
                seen[key_txt] = b
            continue
        seen[key_txt] = b
        deduped.append(b)
    if len(deduped) != len(extents):
        dropped_dup = len(extents) - len(deduped)
        extents = deduped
        st["schemas"] = len(extents)
        print(f"  {key}: dropped {dropped_dup} byte-identical duplicate schema(s)")
    expected = []
    for img, _ln in ordered:
        p = resolve_image(key, img)
        if p is None:
            continue
        ok, _why = passes_dimension_filter(p)
        if ok:
            expected.append(img)
    st["expected"] = len(expected)

    if st["schemas"] != len(expected):
        st["verdict"] = f"MISMATCH (schemas {st['schemas']} != expected {len(expected)})"
        stamp_captions_in_file(key, dry_run, st)  # adjacent-only safety
        return st

    st["verdict"] = "RELOCATE"
    if dry_run:
        st["moved"] = st["schemas"]
        for img in expected:
            ln = idx[img]
            if extract_caption(lines, ln) is not None:
                st["caption"] += 1
            else:
                st["caption_none"] += 1
        return st

    # Phase A — remove all schema blocks (reverse order keeps positions valid)
    cur = list(lines)
    for start, end, _b in reversed(extents):
        del cur[start:end]

    # Phase B — insert each block directly below its image (reverse image
    # order keeps earlier positions stable). Block order == eligible-image
    # order (both document order; counts validated above).
    cur_idx = image_line_index(cur)
    cur_ordered = sorted(cur_idx.items(), key=lambda kv: kv[1])
    eligible = [(img, ln) for img, ln in cur_ordered if img in set(expected)]
    pairs = list(zip(eligible, [b for _s, _e, b in extents]))
    for (img, ln), block in reversed(pairs):
        cur.insert(ln + 1, block + "\n")
    st["moved"] = len(pairs)

    # Phase C — stamp adjacent captions (one pass, apply reverse)
    lines2 = cur
    idx2 = image_line_index(lines2)
    edits = []
    for img in expected:
        ln = idx2.get(img)
        if ln is None:
            continue
        span = find_schema_block(lines2, ln)
        if span is None:
            continue
        block = "".join(lines2[span[0]:span[1]])
        if "- Caption:" in block:
            continue
        cap = extract_caption(lines2, ln)
        if cap is None:
            st["caption_none"] += 1
            continue
        edits.append((span[0], span[1], insert_caption(block, cap)))
        st["caption"] += 1
    for start, end, nb in reversed(edits):
        lines2[start:end] = [nb]
    sp.write_text("".join(lines2), encoding="utf-8")
    print(f"  {key}: relocated {st['moved']} schemas, stamped {st['caption']} captions")
    return st



def process_sidecar(key: str, dry_run: bool, captions_only: bool) -> dict:
    """Enrich one sidecar. Returns per-item counters."""
    st = {"figures": 0, "schema": 0, "dim_filter": 0, "missing_img": 0,
          "already": 0, "vlm_err": 0, "caption": 0, "caption_skip": 0,
          "caption_none": 0}
    sp = SIDECAR_DIR / f"{key}.md"
    if not sp.exists():
        st["missing_img"] += 1
        return st
    text = sp.read_text(encoding="utf-8")
    refs = sidecar_refs(text)
    st["figures"] = len(refs)
    if captions_only:
        stamp_captions_in_file(key, dry_run, st)
        return st
    if dry_run:
        return st

    for img_path in refs:
        # Re-read + re-resolve per image: each write shifts later line numbers.
        text = sp.read_text(encoding="utf-8")
        lines = text.splitlines(keepends=True)
        idx = image_line_index(lines)
        line_no = idx.get(img_path)
        if line_no is None:
            continue
        span = find_schema_block(lines, line_no)
        if span is not None:
            st["already"] += 1
            block = "".join(lines[span[0]:span[1]])
            if "- Caption:" not in block:
                caption = extract_caption(lines, line_no)
                if caption is not None:
                    new_block = insert_caption(block, caption)
                    lines[span[0]:span[1]] = [new_block]
                    sp.write_text("".join(lines), encoding="utf-8")
                    st["caption"] += 1
                    print(f"  {key} {img_path}: caption stamped (self-heal)")
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
        # Stamp the locally-extracted caption before writing, so VLM-produced
        # and backfilled blocks carry the identical Caption field.
        text = sp.read_text(encoding="utf-8")
        lines = text.splitlines(keepends=True)
        idx = image_line_index(lines)
        line_no = idx.get(img_path)
        if line_no is None:
            continue
        caption = extract_caption(lines, line_no)
        block = insert_caption(block, caption)
        # Write per figure (not batched): a partial run persists progress and
        # idempotency resumes where it stopped — critical for the ~6h backfill.
        lines.insert(line_no + 1, block + "\n")
        sp.write_text("".join(lines), encoding="utf-8")
        st["schema"] += 1
        print(f"  {key} {img_path}: schema added")
    return st


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--key", metavar="KEY", help="process a single item key")
    g.add_argument("--all", action="store_true", help="backfill every sidecar (default)")
    m = ap.add_mutually_exclusive_group()
    m.add_argument("--captions-only", action="store_true",
                    help="no VLM calls: stamp missing captions onto existing schema blocks")
    m.add_argument("--relocate", action="store_true",
                    help="one-time repair: move drifted schema blocks below their images "
                         "and stamp adjacent captions (no VLM calls)")
    ap.add_argument("--dry-run", action="store_true", help="report only, no writes/API calls")
    args = ap.parse_args()

    if not (args.captions_only or args.relocate or args.dry_run):
        try:
            requests.get("http://127.0.0.1:8084/v1/models", timeout=5)
        except requests.RequestException:
            print("VLM endpoint not reachable on :8084 — run `serve-vlm` first "
                  "(first serve downloads ~36 GB).", file=sys.stderr)
            return 1

    keys = [args.key] if args.key else sorted(p.stem for p in SIDECAR_DIR.glob("*.md"))
    total = {"sidecars": 0, "figures": 0, "schema": 0, "dim_filter": 0,
             "missing_img": 0, "already": 0, "vlm_err": 0, "caption": 0,
             "caption_skip": 0, "caption_none": 0, "moved": 0}
    for key in keys:
        if args.relocate:
            st = relocate_schemas(key, args.dry_run)
        else:
            st = process_sidecar(key, args.dry_run, args.captions_only)
        total["sidecars"] += 1
        for k in ("figures", "schema", "dim_filter", "missing_img", "already",
                  "vlm_err", "caption", "caption_skip", "caption_none", "moved"):
            total[k] += st.get(k, 0)
        if args.relocate and st.get("verdict") and st["verdict"] != "RELOCATE":
            print(f"[{key}] {st['verdict']}")
        elif not args.relocate:
            print(f"[{key}] figures={st['figures']} schema={st['schema']} "
                  f"already={st['already']} dim_filter={st['dim_filter']} "
                  f"missing={st['missing_img']} vlm_err={st['vlm_err']} "
                  f"caption={st['caption']} cap_skip={st['caption_skip']} cap_none={st['caption_none']}")

    print("\n=== SUMMARY ===")
    for k, v in total.items():
        print(f"  {k}: {v}")
    if not (args.captions_only or args.relocate) and not args.dry_run and total["schema"]:
        print("\nNext: re-embed changed sidecars (embedder :8082 must be up):")
        print("  zotero-mcp-server update-db --fulltext")
    return 0


if __name__ == "__main__":
    sys.exit(main())
