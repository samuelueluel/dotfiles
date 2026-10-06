"""doc-read: ingest a local file (PDF, image, office document, text) for an agent to read.

Main command
  ingest <file> [--many] [--redo]    choose and run the best reading method, write best.md,
                                     render the pages that must be looked at

Follow-up commands
  status <workdir>                   print the ingest report again
  render <workdir> --pages SPEC      render pages (or a crop) to PNG for visual inspection
  ocr    <workdir> --pages SPEC      OCR extra pages, then rebuild best.md
  text   <workdir> [--pages SPEC] [--layer best|native|ocr]
                                     write a reading file for a page range or a single layer
  list                               list work directories
  clean  <workdir>                   delete one work directory

Work directories live in ~/.cache/doc-read/<stem>-<sha8>/. The original file is never
modified. OCR uses Surya OCR 2 against a llama-server on loopback; nothing leaves the
machine during preprocessing.
"""
from __future__ import annotations

import argparse
import collections
import contextlib
import hashlib
import html
import io
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

import pymupdf
import requests

WORK_ROOT = Path(os.environ.get("DOC_READ_ROOT", Path.home() / ".cache/doc-read"))
SURYA_CLI = Path(os.environ.get("DOC_READ_SURYA_CLI", Path.home() / "surya-spike-venv/bin/surya_ocr"))
SURYA_GGUF_REPO = Path.home() / ".cache/huggingface/hub/models--datalab-to--surya-ocr-2-gguf"
GPU_IMAGE = "localhost/llama-rocm-10.0-strix-llama:latest"
# A Zotero batch may already serve Surya here; reuse it and never stop it.
SHARED_SURYA_URL = "http://127.0.0.1:18090/v1"
OWN_SURYA_PORT = 18091
OWN_SURYA_CONTAINER = "doc-read-surya"
ZOTERO_VLM_CONTAINER = "zotero-vlm-rocm"
SURYA_PARALLEL = 8

#: Documents up to this many pages are OCR'd on every page; longer ones only on
#: pages that need OCR or have structure (tables, math, columns, figures).
OCR_ALL_MAX_PAGES = 80
#: More OCR pages than this needs --many (Samuel's go-ahead).
OCR_CONFIRM_PAGES = 150
#: Pages per surya_ocr call; results are saved after each chunk so a stopped run resumes.
OCR_CHUNK_PAGES = 24
SECONDS_PER_PAGE = (10, 45)

OCR_DPI = 192
OCR_MAX_SIDE = 3000
VIEW_DPI = 150
#: Cloud vision models downscale anything larger (Claude: 1568 px long side), so render
#: full pages at that size and give tables and figures their own full-resolution crops.
VIEW_MAX_SIDE = 1568
CROP_LABELS = {"Table", "Form", "Figure", "Picture", "Diagram", "Chart", "Image", "Handwriting", "Signature"}
CROP_MIN_PX = 120
#: Documents up to this many pages are viewed in full: the model's reading of every page
#: is an independent second reading of the OCR and text layer.
VIEW_ALL_MAX_PAGES = 15
MIN_MEDIA_SIDE = 200  # skip icons and rules embedded in office files

PANDOC_EXT = {".docx", ".odt", ".epub", ".rtf", ".pptx", ".xlsx", ".html", ".htm"}
TEXT_EXT = {".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml", ".tex", ".log"}
LEGACY_EXT = {".doc", ".xls", ".ppt", ".pages", ".numbers", ".key"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".bmp", ".gif", ".heic", ".avif"}

NUM_RE = re.compile(r"(?<![\d.])[-−–]?\d[\d,]*(?:\.\d+)?")
WORD_RE = re.compile(r"[^\W\d_]{4,}")
MATH_FONT_RE = re.compile(r"CMMI|CMSY|CMEX|MSBM|MSAM|Math|STIX|MTMI|MTSY|Symbol", re.I)
MATH_CHARS = set("∑∫∂≤≥≈≠±×÷√∞αβγδεζηθκλμνξπρστφχψωΓΔΘΛΞΠΣΦΨΩ∈∉⊂⊆∀∃→⇒⇔∇")
FIGURE_LABELS = {"Picture", "Figure", "Diagram", "Chart", "Image"}
VISUAL_LABELS = FIGURE_LABELS | {"Handwriting", "Signature", "Form"}


# ------------------------------------------------------------------ helpers

class Stop(Exception):
    """Fatal condition with an exit code; raised so server cleanup still runs."""

    def __init__(self, msg: str, code: int = 2):
        super().__init__(msg)
        self.code = code


def die(msg: str, code: int = 2) -> None:
    raise Stop(msg, code)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def mime_of(path: Path) -> str:
    out = subprocess.run(["file", "--brief", "--mime-type", str(path)], capture_output=True, text=True)
    return out.stdout.strip()


def parse_pages(spec: str | None, n: int) -> list[int]:
    """'1,3-5,10-' -> sorted 1-based pages within 1..n."""
    if not spec or spec == "all":
        return list(range(1, n + 1))
    pages: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            pages.update(range(int(a) if a else 1, (int(b) if b else n) + 1))
        else:
            pages.add(int(part))
    bad = [p for p in pages if p < 1 or p > n]
    if bad:
        die(f"pages out of range 1..{n}: {sorted(bad)[:10]}")
    return sorted(pages)


def ranges(pages) -> str:
    pages = sorted(pages)
    if not pages:
        return "-"
    out, start, prev = [], pages[0], pages[0]
    for p in pages[1:] + [None]:
        if p is not None and p == prev + 1:
            prev = p
            continue
        out.append(f"{start}" if start == prev else f"{start}-{prev}")
        if p is not None:
            start = prev = p
    return ",".join(out)


def minutes(n_pages: int) -> str:
    lo, hi = (n_pages * s / 60 for s in SECONDS_PER_PAGE)
    return f"{max(lo, 1):.0f}–{max(hi, 1):.0f} min"


def workdir_arg(arg: str) -> Path:
    p = Path(arg).expanduser()
    if not p.is_absolute() and not p.exists():
        p = WORK_ROOT / arg
    if not (p / "manifest.json").exists():
        die(f"not a doc-read work directory: {p}")
    return p.resolve()


def load_manifest(wd: Path) -> dict:
    return json.loads((wd / "manifest.json").read_text(encoding="utf-8"))


def save_manifest(wd: Path, m: dict) -> None:
    tmp = wd / "manifest.json.tmp"
    tmp.write_text(json.dumps(m, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(wd / "manifest.json")


def page_file(wd: Path, page: int, layer: str) -> Path:
    ext = "txt" if layer == "native" else "md"
    return wd / "pages" / f"p{page:04d}.{layer}.{ext}"


# ------------------------------------------------------------------ PDF page analysis

def upright_rotation(d: dict) -> int:
    """Clockwise degrees that make the page's dominant text direction upright."""
    weight: collections.Counter = collections.Counter()
    for block in d.get("blocks", []):
        for line in block.get("lines", []):
            dx, dy = line.get("dir", (1, 0))
            n = sum(len(s.get("text", "").strip()) for s in line.get("spans", []))
            if abs(dx) >= abs(dy):
                weight[0 if dx > 0 else 180] += n
            else:
                weight[90 if dy < 0 else 270] += n
    if not weight:
        return 0
    rot, n = weight.most_common(1)[0]
    return rot if rot and n > 0.6 * sum(weight.values()) else 0


def scan_like(page) -> bool:
    area = page.rect.width * page.rect.height
    for info in page.get_image_info():
        x0, y0, x1, y1 = info["bbox"]
        if (x1 - x0) * (y1 - y0) > 0.7 * area:
            return True
    return False


def bad_char_count(text: str) -> int:
    n = 0
    for ch in text:
        o = ord(ch)
        if ch == "\ufffd" or (o < 32 and ch not in "\n\t\r") or 0xE000 <= o <= 0xF8FF:
            n += 1
    return n


def has_math(d: dict, text: str) -> bool:
    fonts = {s.get("font", "") for b in d.get("blocks", []) for ln in b.get("lines", []) for s in ln.get("spans", [])}
    math_spans = sum(1 for f in fonts if MATH_FONT_RE.search(f))
    return math_spans > 0 or sum(1 for c in text if c in MATH_CHARS) >= 8


def has_columns(page) -> bool:
    w = page.rect.width
    blocks = [b for b in page.get_text("blocks") if b[6] == 0 and len(b[4].strip()) > 40 and (b[2] - b[0]) < 0.5 * w]
    left = [b for b in blocks if b[2] < 0.55 * w]
    right = [b for b in blocks if b[0] > 0.45 * w]
    if len(left) < 2 or len(right) < 2:
        return False
    return any(lb[1] < rb[3] and rb[1] < lb[3] for lb in left for rb in right)


def has_table(page, digits: int) -> bool:
    if digits < 15:
        return False
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            tabs = page.find_tables()
    except Exception:  # noqa: BLE001
        return False
    return any(t.row_count >= 2 and t.col_count >= 2 for t in tabs.tables)


def analyse_pdf_page(page, number: int) -> tuple[dict, str]:
    text = page.get_text("text", sort=True)
    try:
        d = page.get_text("dict")
    except Exception:  # noqa: BLE001
        d = {}
    chars = sum(1 for c in text if not c.isspace())
    bad = bad_char_count(text)
    digits = sum(1 for c in text if c.isdigit())
    scan = scan_like(page)
    images = len(page.get_image_info())
    rot = upright_rotation(d) if chars else 0
    flags = []
    if chars < 20:
        flags.append("no_text")
    elif chars < 200 and (scan or images):
        flags.append("low_text")
    if scan and chars >= 20:
        flags.append("scan_text_layer")
    if chars and bad / max(chars, 1) > 0.02:
        flags.append("garbled")
    if rot:
        flags.append(f"rotated{rot}")
    if images and not scan:
        flags.append("images")
    if digits > 150 or (chars > 100 and digits / chars > 0.25):
        flags.append("numeric_dense")
    if not scan and chars >= 20:
        if has_table(page, digits):
            flags.append("table")
        if has_math(d, text):
            flags.append("math")
        if not rot and has_columns(page):
            flags.append("columns")
    needs_ocr = any(f in flags for f in ("no_text", "low_text", "scan_text_layer", "garbled"))
    structured = any(f.startswith("rotated") or f in ("images", "numeric_dense", "table", "math", "columns")
                     for f in flags)
    meta = {
        "page": number, "chars": chars, "bad_chars": bad, "digits": digits, "scan_like": scan,
        "images": images, "rotation": rot, "flags": flags, "needs_ocr": needs_ocr, "structured": structured,
    }
    return meta, text


# ------------------------------------------------------------------ prep (internal)

def classify(src: Path, mime: str) -> str:
    ext = src.suffix.lower()
    if mime == "application/pdf":
        return "pdf"
    if mime.startswith("image/") or ext in IMAGE_EXT:
        return "image"
    if ext in LEGACY_EXT or mime in {"application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"}:
        return "legacy"
    if ext in PANDOC_EXT:
        return "pandoc"
    if ext in TEXT_EXT or mime.startswith("text/"):
        return "text"
    return "unsupported"


def to_png(src: Path, out: Path) -> bool:
    proc = subprocess.run(["magick", f"{src}[0]", "-auto-orient", str(out)], capture_output=True, text=True)
    return proc.returncode == 0 and out.exists()


def image_size(path: Path) -> tuple[int, int]:
    out = subprocess.run(["magick", "identify", "-format", "%w %h\n", str(path)], capture_output=True, text=True)
    try:
        w, h = out.stdout.split("\n")[0].split()[:2]
        return int(w), int(h)
    except ValueError:
        return 0, 0


def prep(src: Path, redo: bool) -> Path:
    """Create (or reuse) the work directory and extract native content. No OCR."""
    if not src.is_file():
        die(f"no such file: {src}")
    digest = sha256_file(src)
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", src.stem)[:60] or "doc"
    wd = WORK_ROOT / f"{stem}-{digest[:8]}"
    if (wd / "manifest.json").exists() and not redo:
        return wd
    if wd.exists():
        shutil.rmtree(wd)
    (wd / "pages").mkdir(parents=True)
    mime = mime_of(src)
    kind = classify(src, mime)
    original = wd / f"original{src.suffix.lower()}"
    shutil.copy2(src, original)
    original.chmod(0o444)
    m = {"source": str(src), "original": original.name, "sha256": digest, "mime": mime, "kind": kind,
         "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "pages": [], "units": {}, "warnings": []}

    try:
        if kind == "pdf":
            try:
                doc = pymupdf.open(original)
            except Exception as e:  # noqa: BLE001
                die(f"cannot open PDF: {e}", 3)
            if doc.needs_pass:
                die("PDF is password-protected; ask Samuel for an unlocked copy.", 3)
            for i, page in enumerate(doc):
                meta, text = analyse_pdf_page(page, i + 1)
                page_file(wd, i + 1, "native").write_text(text, encoding="utf-8")
                m["pages"].append(meta)
            m["page_count"] = len(doc)

        elif kind == "image":
            img_dir = wd / "img"
            img_dir.mkdir()
            proc = subprocess.run(["magick", str(original), "-auto-orient", "+adjoin", "-scene", "1",
                                   str(img_dir / "p%04d.png")], capture_output=True, text=True)
            frames = sorted(img_dir.glob("p*.png"))
            if proc.returncode or not frames:
                die(f"ImageMagick could not read the image (HEIC/AVIF may be unsupported): "
                    f"{proc.stderr.strip()[-300:]}", 3)
            for i, _ in enumerate(frames):
                m["pages"].append({"page": i + 1, "chars": 0, "flags": ["image"], "needs_ocr": True, "structured": True})
            m["page_count"] = len(frames)

        elif kind == "pandoc":
            media = wd / "media"
            proc = subprocess.run(["pandoc", str(original), "-t", "gfm", "--wrap=none", f"--extract-media={media}",
                                   "-o", str(wd / "native.md")], capture_output=True, text=True)
            if proc.returncode:
                die(f"pandoc failed: {proc.stderr.strip()[-300:]}", 3)
            if proc.stderr.strip():
                m["warnings"].append("pandoc: " + proc.stderr.strip()[-300:])
            m["warnings"].append("Converted with pandoc: no page numbers; headers, footers, text boxes, comments "
                                 "and tracked changes may be missing.")
            # Embedded images become OCR units; icons and unreadable formats are skipped.
            units_dir = wd / "media-png"
            units_dir.mkdir()
            files = sorted(p for p in media.rglob("*") if p.is_file()) if media.exists() else []
            for k, f in enumerate(files, 1):
                png = units_dir / f"m{k:04d}.png"
                if not to_png(f, png):
                    m["warnings"].append(f"could not convert embedded image {f.relative_to(wd)}; not read")
                    continue
                w, h = image_size(png)
                if min(w, h) < MIN_MEDIA_SIDE:
                    png.unlink()
                    continue
                m["units"][png.stem] = {"source": str(f.relative_to(wd)), "png": str(png.relative_to(wd))}
            m["page_count"] = 1

        elif kind == "text":
            shutil.copyfile(original, wd / "native.md")
            m["page_count"] = 1

        else:
            die("legacy binary Office format; ask Samuel to save it as PDF or DOCX/XLSX" if kind == "legacy"
                else f"unsupported type {mime}", 3)
    except Stop:
        shutil.rmtree(wd, ignore_errors=True)
        raise

    save_manifest(wd, m)
    return wd


# ------------------------------------------------------------------ rendering

def render_page_png(wd: Path, m: dict, page: int, out: Path, dpi: int, max_side: int,
                    crop: tuple[float, float, float, float] | None = None) -> Path:
    if m["kind"] == "image":
        src = wd / "img" / f"p{page:04d}.png"
        cmd = ["magick", str(src)]
        if crop:
            x0, y0, x1, y1 = crop
            w, h = image_size(src)
            cmd += ["-crop", f"{int((x1 - x0) * w)}x{int((y1 - y0) * h)}+{int(x0 * w)}+{int(y0 * h)}", "+repage"]
        cmd += ["-resize", f"{max_side}x{max_side}>", str(out)]
        subprocess.run(cmd, check=True, capture_output=True)
        return out
    doc = pymupdf.open(wd / m["original"])
    pg = doc[page - 1]
    rect = pg.rect
    clip = None
    if crop:
        x0, y0, x1, y1 = crop
        clip = pymupdf.Rect(rect.x0 + x0 * rect.width, rect.y0 + y0 * rect.height,
                            rect.x0 + x1 * rect.width, rect.y0 + y1 * rect.height)
    area = clip or rect
    zoom = min(dpi / 72, max_side / max(area.width, area.height))
    matrix = pymupdf.Matrix(zoom, zoom)
    rot = m["pages"][page - 1].get("rotation", 0)
    if rot:
        matrix = matrix.prerotate(rot)
    pg.get_pixmap(matrix=matrix, clip=clip).save(out)
    return out


def view_path(wd: Path, m: dict, page: int) -> Path:
    out_dir = wd / "render"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"p{page:04d}-{VIEW_DPI}dpi.png"
    if not out.exists():
        render_page_png(wd, m, page, out, VIEW_DPI, VIEW_MAX_SIDE)
    return out


# ------------------------------------------------------------------ Surya OCR

def healthy(base_url: str) -> bool:
    try:
        return requests.get(base_url.rstrip("/") + "/models", timeout=3).ok
    except requests.RequestException:
        return False


def container_running(name: str) -> bool:
    out = subprocess.run(["podman", "ps", "--filter", f"name=^{name}$", "--format", "{{.Names}}"],
                         capture_output=True, text=True)
    return name in out.stdout.split()


def stop_own_surya() -> None:
    subprocess.run(["podman", "stop", "-t", "10", OWN_SURYA_CONTAINER], capture_output=True)
    subprocess.run(["podman", "rm", "-f", OWN_SURYA_CONTAINER], capture_output=True)


class SuryaServer:
    """Reuse the Zotero batch's server if it is up; otherwise run our own and always stop it."""

    def __enter__(self) -> str:
        self.own = False
        if healthy(SHARED_SURYA_URL):
            print(f"Reusing the running Surya server at {SHARED_SURYA_URL} (left running afterwards).", flush=True)
            return SHARED_SURYA_URL
        if container_running(ZOTERO_VLM_CONTAINER):
            die(f"{ZOTERO_VLM_CONTAINER} is running (a Zotero repair/enrichment stage holds the GPU); "
                "do not start Surya now. Tell Samuel.", 4)
        snaps = sorted((SURYA_GGUF_REPO / "snapshots").glob("*/surya-2.gguf"))
        if not snaps:
            die(f"Surya GGUF not found under {SURYA_GGUF_REPO}", 4)
        snap = snaps[-1].parent
        url = f"http://127.0.0.1:{OWN_SURYA_PORT}/v1"
        print("Starting local Surya OCR 2 server (doc-read-surya, loopback only)…", flush=True)
        stop_own_surya()
        self.own = True
        port = str(OWN_SURYA_PORT)
        proc = subprocess.run([
            "podman", "run", "-d", "--pull=never", "--name", OWN_SURYA_CONTAINER,
            "--device", "/dev/kfd", "--device", "/dev/dri", "--group-add", "keep-groups",
            "--security-opt", "label=disable", "--log-driver=journald", "--log-opt", f"tag={OWN_SURYA_CONTAINER}",
            "-p", f"127.0.0.1:{port}:{port}",
            "-v", f"{(snap / 'surya-2.gguf').resolve()}:/mnt/model.gguf:ro",
            "-v", f"{(snap / 'surya-2-mmproj.gguf').resolve()}:/mnt/mmproj.gguf:ro",
            GPU_IMAGE, "/usr/local/bin/llama-server", "--host", "0.0.0.0", "--port", port,
            "-m", "/mnt/model.gguf", "--mmproj", "/mnt/mmproj.gguf", "-ngl", "99",
            "--parallel", str(SURYA_PARALLEL), "--ctx-size", str(12288 * SURYA_PARALLEL),
            "--alias", "datalab-to/surya-ocr-2", "--jinja",
        ], capture_output=True, text=True)
        if proc.returncode:
            die(f"podman run {OWN_SURYA_CONTAINER} failed: {proc.stderr.strip()[-400:]}", 4)
        for _ in range(90):
            if healthy(url):
                return url
            if not container_running(OWN_SURYA_CONTAINER):
                break
            time.sleep(2)
        logs = subprocess.run(["podman", "logs", "--tail", "15", OWN_SURYA_CONTAINER], capture_output=True, text=True)
        die(f"Surya server did not become ready:\n{logs.stdout[-1200:]}{logs.stderr[-600:]}", 4)

    def __exit__(self, *exc) -> None:
        if self.own:
            stop_own_surya()
            print("Stopped doc-read-surya.", flush=True)


def run_surya(wd: Path, url: str, items: list[tuple[str, Path]], on_chunk) -> None:
    """OCR (stem, png) items in chunks; call on_chunk(results) after each so progress is saved."""
    if not SURYA_CLI.exists():
        die(f"surya_ocr CLI not found at {SURYA_CLI}", 4)
    env = dict(os.environ, SURYA_INFERENCE_BACKEND="llamacpp", SURYA_INFERENCE_URL=url,
               SURYA_INFERENCE_PARALLEL=str(SURYA_PARALLEL), SURYA_INFERENCE_AUTOSTART="false")
    chunks = [items[i:i + OCR_CHUNK_PAGES] for i in range(0, len(items), OCR_CHUNK_PAGES)]
    for k, chunk in enumerate(chunks, 1):
        in_dir, out_dir = wd / "ocr-img" / f"c{k:03d}", wd / "ocr-raw" / f"c{k:03d}"
        for d in (in_dir, out_dir):
            shutil.rmtree(d, ignore_errors=True)
        in_dir.mkdir(parents=True)
        for stem, png in chunk:
            shutil.copyfile(png, in_dir / f"{stem}.png")
        t0 = time.time()
        with (wd / "ocr.log").open("ab") as log:
            proc = subprocess.run([str(SURYA_CLI), str(in_dir), "--output_dir", str(out_dir)],
                                  stdout=log, stderr=subprocess.STDOUT, env=env)
        results = sorted(out_dir.glob("*/results.json"))
        if proc.returncode or not results:
            die(f"surya_ocr failed on chunk {k}/{len(chunks)} (rc={proc.returncode}); see {wd / 'ocr.log'}", 5)
        on_chunk(json.loads(results[-1].read_text(encoding="utf-8")))
        shutil.rmtree(in_dir, ignore_errors=True)
        print(f"  OCR chunk {k}/{len(chunks)}: {len(chunk)} page(s) in {time.time() - t0:.0f} s", flush=True)


def html_to_md(fragment: str) -> str:
    s = fragment
    s = re.sub(r'<math display="block">(.*?)</math>', lambda mm: f"\n$${mm.group(1)}$$\n", s, flags=re.S)
    s = re.sub(r"<math[^>]*>(.*?)</math>", lambda mm: f"${mm.group(1)}$", s, flags=re.S)
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<hr\s*/?>", "", s)
    s = re.sub(r"<h([1-6])[^>]*>", lambda mm: "#" * int(mm.group(1)) + " ", s)
    s = re.sub(r"</h[1-6]>", "\n", s)
    s = re.sub(r"<li[^>]*>", "- ", s)
    s = re.sub(r"</(p|li|div|ul|ol)>", "\n", s)
    s = re.sub(r"<sup>(.*?)</sup>", r"^\1", s, flags=re.S)
    s = re.sub(r"<sub>(.*?)</sub>", r"_\1", s, flags=re.S)
    s = re.sub(r"</?(b|strong)>", "**", s)
    s = re.sub(r"</?(i|em)>", "*", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return re.sub(r"\n{3,}", "\n\n", s).strip()


def blocks_to_md(blocks: list[dict], where: str) -> tuple[str, dict]:
    out, stats = [], collections.Counter()
    for b in sorted(blocks, key=lambda b: b.get("reading_order", 0)):
        label = b.get("label", "Text")
        stats[label] += 1
        frag = b.get("html", "") or ""
        if b.get("error"):
            stats["errors"] += 1
            out.append(f"[OCR ERROR in {label} block; view {where}]")
            continue
        if label in FIGURE_LABELS and not frag.strip():
            out.append(f"[{label}: not transcribed; view {where}]")
            continue
        if label in ("Table", "TableOfContents", "Form"):
            frag = re.sub(r"<math[^>]*>(.*?)</math>", lambda mm: f"${mm.group(1)}$", frag, flags=re.S)
            out.append(frag.strip())
            continue
        text = html_to_md(frag)
        if label in ("PageHeader", "PageFooter") and text:
            text = f"[{label}] {text}"
        if text:
            out.append(text)
    return "\n\n".join(out), dict(stats)


# ------------------------------------------------------------------ cross-checking

def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    return re.sub(r"(\w)-\n\s*(\w)", r"\1\2", text)


def numbers(text: str, min_digits: int = 2) -> collections.Counter:
    c: collections.Counter = collections.Counter()
    for tok in NUM_RE.findall(text):
        tok = tok.replace(",", "").replace("−", "-").replace("–", "-").lstrip("-")
        if len(tok.replace(".", "")) >= min_digits or ("." in tok and min_digits > 2):
            c[tok] += 1
    return c


def words(text: str) -> collections.Counter:
    return collections.Counter(w.lower() for w in WORD_RE.findall(text))


def compare_layers(native: str, ocr_md: str, min_digits: int = 2) -> dict:
    """Bag-of-tokens check: numbers either side, and printed words OCR dropped.

    min_digits=3 ignores footnote markers, which old scan OCR layers often miss.
    """
    native, ocr_md = _norm(native), _norm(ocr_md)
    a, b = numbers(native, min_digits), numbers(ocr_md, min_digits)
    total = max(sum(a.values()), sum(b.values()))
    num_diff = sum((a - b).values()) + sum((b - a).values())
    wa, wb = words(native), words(ocr_md)
    w_missing = sum((wa - wb).values())
    w_rate = w_missing / max(sum(wa.values()), 1)
    # Decimals are table values; a few dropped ones matter even when the page total is large.
    dec_diff = sum(v for k, v in ((a - b) + (b - a)).items() if "." in k)
    issues = []
    if (total and num_diff / (2 * total) > 0.02) or dec_diff >= 2:
        issues.append("numbers")
    if sum(wa.values()) >= 20 and w_rate > 0.04:
        issues.append("words")
    return {
        "agreement": "disagree" if issues else "agree", "issues": issues,
        "numbers_native": sum(a.values()), "numbers_ocr": sum(b.values()), "numbers_differ": num_diff, "decimals_differ": dec_diff,
        "numbers_only_in_ocr": sorted(b - a)[:8], "numbers_only_in_native": sorted(a - b)[:8],
        "words_missing_in_ocr": w_missing, "words_missing_examples": sorted(wa - wb)[:8],
    }


# ------------------------------------------------------------------ OCR orchestration

def ocr_pages(wd: Path, m: dict, pages: list[int], url: str) -> None:
    img_dir = wd / "ocr-src"
    img_dir.mkdir(exist_ok=True)
    items = []
    for p in pages:
        png = img_dir / f"p{p:04d}.png"
        render_page_png(wd, m, p, png, OCR_DPI, OCR_MAX_SIDE)
        items.append((f"p{p:04d}", png))

    def on_chunk(results: dict) -> None:
        for stem, entry in results.items():
            p = int(stem[1:])
            blocks = entry[0].get("blocks", []) if entry else []
            md, stats = blocks_to_md(blocks, f"page {p}")
            page_file(wd, p, "ocr").write_text(md, encoding="utf-8")
            meta = m["pages"][p - 1]
            info = {"engine": "surya-ocr-2", "blocks": stats, "errors": stats.get("errors", 0),
                    "chars": sum(1 for c in md if not c.isspace()),
                    "crops": save_crops(wd, img_dir / f"{stem}.png", p, blocks)}
            native_f = page_file(wd, p, "native")
            if m["kind"] == "pdf" and not meta["needs_ocr"]:
                info.update(compare_layers(native_f.read_text(encoding="utf-8"), md))
            elif "scan_text_layer" in meta["flags"]:
                # The scan's old OCR layer is an independent second reading; used only to flag pages.
                info["second_reading"] = compare_layers(native_f.read_text(encoding="utf-8"), md, min_digits=3)
            meta["ocr"] = info
        save_manifest(wd, m)

    run_surya(wd, url, items, on_chunk)


def save_crops(wd: Path, png: Path, page: int, blocks: list[dict]) -> list[dict]:
    """Cut tables, figures and forms out of the OCR render (192 dpi) for close viewing."""
    from PIL import Image  # Surya venv has Pillow

    out, k = [], 0
    crop_dir = wd / "crops"
    for old in crop_dir.glob(f"p{page:04d}-*.png"):
        old.unlink()
    targets = [b for b in blocks if b.get("label") in CROP_LABELS and b.get("bbox")]
    if not targets or not png.exists():
        return out
    crop_dir.mkdir(exist_ok=True)
    with Image.open(png) as im:
        w, h = im.size
        for b in sorted(targets, key=lambda b: b.get("reading_order", 0)):
            x0, y0, x1, y1 = b["bbox"]
            if min(x1 - x0, y1 - y0) < CROP_MIN_PX:
                continue
            pad = 0.01 * max(w, h)
            box = (max(0, int(x0 - pad)), max(0, int(y0 - pad)), min(w, int(x1 + pad)), min(h, int(y1 + pad)))
            k += 1
            path = crop_dir / f"p{page:04d}-{k:02d}-{b['label'].lower()}.png"
            im.crop(box).save(path)
            out.append({"label": b["label"], "path": str(path.relative_to(wd))})
    return out


def ocr_media(wd: Path, m: dict, stems: list[str], url: str) -> None:
    items = [(s, wd / m["units"][s]["png"]) for s in stems]

    def on_chunk(results: dict) -> None:
        for stem, entry in results.items():
            u = m["units"][stem]
            md, stats = blocks_to_md(entry[0].get("blocks", []) if entry else [], u["png"])
            (wd / "pages" / f"{stem}.ocr.md").write_text(md, encoding="utf-8")
            u["ocr"] = {"engine": "surya-ocr-2", "blocks": stats, "chars": sum(1 for c in md if not c.isspace())}
        save_manifest(wd, m)

    run_surya(wd, url, items, on_chunk)


def plan_ocr(m: dict) -> list[int]:
    if m["kind"] == "image":
        return [p["page"] for p in m["pages"]]
    if m["kind"] != "pdf":
        return []
    if m["page_count"] <= OCR_ALL_MAX_PAGES:
        return [p["page"] for p in m["pages"]]
    return [p["page"] for p in m["pages"] if p["needs_ocr"] or p["structured"]]


# ------------------------------------------------------------------ reading file

def page_layer(wd: Path, meta: dict) -> tuple[str, str]:
    """(header label, body) for one page of best.md."""
    p = meta["page"]
    ocr_f, nat_f = page_file(wd, p, "ocr"), page_file(wd, p, "native")
    ocr_info = meta.get("ocr")
    if meta["needs_ocr"]:
        if ocr_f.exists():
            return "OCR; scanned or no usable text layer", ocr_f.read_text(encoding="utf-8")
        body = nat_f.read_text(encoding="utf-8") if nat_f.exists() else ""
        return "TEXT LAYER ONLY, UNRELIABLE: OCR not run", body
    if ocr_f.exists() and ocr_info:
        ocr_md = ocr_f.read_text(encoding="utf-8")
        if ocr_info.get("agreement") == "disagree":
            native = nat_f.read_text(encoding="utf-8")
            what = " and ".join(ocr_info.get("issues", []))
            body = (f"{ocr_md}\n\n----- Text layer of page {p} (exact characters, layout lost) -----\n\n{native}")
            return f"OCR + TEXT LAYER: {what} differ; check the page image", body
        return "OCR; matches text layer", ocr_md
    return "text layer", nat_f.read_text(encoding="utf-8") if nat_f.exists() else ""


def build_reading_file(wd: Path, m: dict, pages: list[int] | None = None, layer: str = "best",
                       out: Path | None = None) -> Path:
    if m["kind"] in ("text", "pandoc"):
        parts = [(wd / "native.md").read_text(encoding="utf-8", errors="replace")]
        for stem, u in m.get("units", {}).items():
            f = wd / "pages" / f"{stem}.ocr.md"
            if f.exists():
                parts.append(f"\n\n===== Embedded image {u['source']} [OCR; view {u['png']}] =====\n\n"
                             f"{f.read_text(encoding='utf-8')}")
        out = out or wd / "best.md"
        out.write_text("".join(parts), encoding="utf-8")
        return out
    n = m["page_count"]
    pages = pages or list(range(1, n + 1))
    parts = []
    for p in pages:
        meta = m["pages"][p - 1]
        if layer == "best":
            label, body = page_layer(wd, meta)
        else:
            f = page_file(wd, p, layer)
            if not f.exists():
                continue
            label, body = layer, f.read_text(encoding="utf-8")
        parts.append(f"\n\n===== Page {p} of {n} [{label}] =====\n\n{body}")
    out = out or wd / ("best.md" if layer == "best" else f"{layer}.md")
    out.write_text("".join(parts).lstrip(), encoding="utf-8")
    return out


def look_pages(m: dict) -> dict[int, str]:
    """Pages the agent must view, with the reason."""
    if m["kind"] == "image":
        return {p["page"]: "image" for p in m["pages"]}
    if m["kind"] != "pdf":
        return {}
    look: dict[int, str] = {}
    short = m["page_count"] <= VIEW_ALL_MAX_PAGES
    for meta in m["pages"]:
        p, o, flags = meta["page"], meta.get("ocr") or {}, meta["flags"]
        labels = set(o.get("blocks", {}))
        reasons = []
        if "Table" in labels or "table" in flags or "numeric_dense" in flags:
            reasons.append("table/numbers")
        if o.get("agreement") == "disagree":
            reasons.append("layers differ")
        if o.get("errors"):
            reasons.append("OCR error")
        if labels & VISUAL_LABELS:
            reasons.append("figure/visual")
        elif not o and "images" in flags:
            reasons.append("images")
        if meta["needs_ocr"] and reasons and reasons[0] == "table/numbers":
            reasons[0] = "scanned table/numbers"
        if "numbers" in (o.get("second_reading") or {}).get("issues", []):
            reasons.append("Surya and the scan's old OCR disagree on numbers")
        if meta["needs_ocr"] and o and o.get("chars", 0) < 20:
            reasons.append("OCR found no text")
        if meta["needs_ocr"] and not o:
            reasons.append("no OCR")
        if reasons:
            look[p] = ", ".join(reasons)
        elif short:
            look[p] = "full read"
    return look


# ------------------------------------------------------------------ report

def report(wd: Path, m: dict, renders: dict[int, Path] | None = None) -> str:
    lines = [f"Source: {m['source']}", f"Work dir: {wd}",
             f"Kind: {m['kind']} ({m['mime']}), pages: {m.get('page_count', '?')}, sha256: {m['sha256'][:16]}…"]
    best = wd / "best.md"
    if best.exists():
        t = best.read_text(encoding="utf-8")
        lines.append(f"READ IN FULL: {best}  ({t.count(chr(10)) + 1:,} lines, {len(t):,} chars)")
    if m["kind"] == "pdf":
        pages = m["pages"]
        by_flag: dict[str, list[int]] = collections.defaultdict(list)
        for p in pages:
            for f in p["flags"]:
                by_flag[f].append(p["page"])
        if by_flag:
            lines.append("Page flags: " + "; ".join(f"{f} {ranges(v)}" for f, v in sorted(by_flag.items())))
        ocr_done = [p["page"] for p in pages if p.get("ocr")]
        lines.append(f"OCR (Surya): {ranges(ocr_done)}; text layer only: "
                     f"{ranges([p['page'] for p in pages if not p.get('ocr')])}")
        dis = [p["page"] for p in pages if (p.get("ocr") or {}).get("agreement") == "disagree"]
        if dis:
            lines.append(f"OCR and text layer differ (both included in best.md): {ranges(dis)}")
    elif m.get("units"):
        lines.append(f"Embedded images OCR'd: {len([u for u in m['units'].values() if u.get('ocr')])}")
    if m["kind"] == "pandoc":
        view = [f"  {u['source']}: {wd / u['png']}" for u in m.get("units", {}).values()]
    else:
        look = look_pages(m)
        view = []
        for p in sorted(look):
            if not renders or p not in renders:
                continue
            view.append(f"  p{p} ({look[p]}): {renders[p]}")
            for c in (m["pages"][p - 1].get("ocr") or {}).get("crops", []):
                view.append(f"      {c['label']} crop: {wd / c['path']}")
    if view:
        lines.append(f"VIEW THESE IMAGES ({len(view)}):")
        lines += view
    for w in m.get("warnings", []):
        lines.append(f"WARNING: {w}")
    text = "\n".join(lines)
    (wd / "report.txt").write_text(text + "\n", encoding="utf-8")
    return text


# ------------------------------------------------------------------ commands

def ingest(args) -> None:
    wd = prep(Path(args.file).expanduser().resolve(), args.redo)
    m = load_manifest(wd)
    todo_pages = [p for p in plan_ocr(m) if not m["pages"][p - 1].get("ocr")]
    todo_media = [s for s, u in m.get("units", {}).items() if not u.get("ocr")]
    n = len(todo_pages) + len(todo_media)
    if n > OCR_CONFIRM_PAGES and not args.many:
        print(report(wd, m))
        die(f"{n} pages need OCR (~{minutes(n)}). Ask Samuel, then rerun with --many.", 6)
    if n:
        print(f"OCR {n} page(s)/image(s) with Surya, est. {minutes(n)}…", flush=True)
        t0 = time.time()
        with SuryaServer() as url:
            if todo_pages:
                ocr_pages(wd, m, todo_pages, url)
            if todo_media:
                ocr_media(wd, m, todo_media, url)
        m.setdefault("ocr_runs", []).append({"pages": ranges(todo_pages), "media": len(todo_media),
                                             "seconds": round(time.time() - t0, 1)})
        missing = [p for p in todo_pages if not m["pages"][p - 1].get("ocr")]
        if missing:
            m["warnings"].append(f"Surya returned nothing for pages {ranges(missing)}")
        save_manifest(wd, m)
    build_reading_file(wd, m)
    renders = {p: view_path(wd, m, p) for p in look_pages(m)} if m["kind"] in ("pdf", "image") else {}
    print(report(wd, m, renders))


def status(args) -> None:
    wd = workdir_arg(args.workdir)
    m = load_manifest(wd)
    build_reading_file(wd, m)
    renders = {p: view_path(wd, m, p) for p in look_pages(m)} if m["kind"] in ("pdf", "image") else {}
    print(report(wd, m, renders))


def render(args) -> None:
    wd = workdir_arg(args.workdir)
    m = load_manifest(wd)
    if m["kind"] not in ("pdf", "image"):
        die("render works on PDFs and images; for office files view the media-png/ files instead")
    pages = parse_pages(args.pages, m["page_count"])
    if len(pages) > 30 and not args.many:
        die(f"{len(pages)} pages requested; render at most 30 at a time (or pass --many)")
    crop = None
    if args.crop:
        crop = tuple(float(x) for x in args.crop.split(","))
        if len(crop) != 4 or not (0 <= crop[0] < crop[2] <= 1 and 0 <= crop[1] < crop[3] <= 1):
            die("--crop takes x0,y0,x1,y1 as fractions of the page, e.g. 0,0.4,1,0.8")
    out_dir = wd / "render"
    out_dir.mkdir(exist_ok=True)
    tag = "" if not crop else "-crop-" + "-".join(f"{c:.2f}" for c in crop)
    for p in pages:
        out = out_dir / f"p{p:04d}{tag}-{args.dpi}dpi.png"
        render_page_png(wd, m, p, out, args.dpi, args.max_side, crop)
        print(out)


def ocr_cmd(args) -> None:
    wd = workdir_arg(args.workdir)
    m = load_manifest(wd)
    if m["kind"] not in ("pdf", "image"):
        die("extra OCR applies to PDFs and images")
    pages = parse_pages(args.pages, m["page_count"])
    if not args.redo:
        pages = [p for p in pages if not m["pages"][p - 1].get("ocr")]
    if not pages:
        print("Those pages are already OCR'd (use --redo to repeat).")
        return
    if len(pages) > OCR_CONFIRM_PAGES and not args.many:
        die(f"{len(pages)} pages (~{minutes(len(pages))}); ask Samuel, then pass --many", 6)
    with SuryaServer() as url:
        ocr_pages(wd, m, pages, url)
    build_reading_file(wd, m)
    renders = {p: view_path(wd, m, p) for p in look_pages(m)}
    print(report(wd, m, renders))


def text_cmd(args) -> None:
    wd = workdir_arg(args.workdir)
    m = load_manifest(wd)
    if m["kind"] not in ("pdf", "image"):
        out = build_reading_file(wd, m)
    else:
        if args.layer == "native" and m["kind"] == "image":
            die("images have no text layer")
        pages = parse_pages(args.pages, m["page_count"])
        name = f"{args.layer}-p{ranges(pages)}.md" if args.pages else None
        out = build_reading_file(wd, m, pages, args.layer, wd / name if name else None)
    t = out.read_text(encoding="utf-8")
    print(f"{out}  ({t.count(chr(10)) + 1:,} lines, {len(t):,} chars)")


def list_cmd(_args) -> None:
    if not WORK_ROOT.exists():
        print("(none)")
        return
    for d in sorted(WORK_ROOT.iterdir()):
        mf = d / "manifest.json"
        if mf.exists():
            m = json.loads(mf.read_text(encoding="utf-8"))
            print(f"{d.name}\t{m['kind']}\t{m.get('page_count', '?')}p\t{m['created']}\t{m['source']}")


def clean(args) -> None:
    wd = workdir_arg(args.workdir)
    if wd.parent != WORK_ROOT.resolve():
        die("refusing to delete outside the doc-read cache")
    shutil.rmtree(wd)
    print(f"Deleted {wd}")


def main() -> None:
    ap = argparse.ArgumentParser(prog="doc-read", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("ingest"); s.add_argument("file"); s.add_argument("--redo", action="store_true")
    s.add_argument("--many", action="store_true"); s.set_defaults(fn=ingest)
    s = sub.add_parser("status"); s.add_argument("workdir"); s.set_defaults(fn=status)
    s = sub.add_parser("render"); s.add_argument("workdir"); s.add_argument("--pages", required=True)
    s.add_argument("--dpi", type=int, default=VIEW_DPI); s.add_argument("--max-side", type=int, default=VIEW_MAX_SIDE)
    s.add_argument("--crop"); s.add_argument("--many", action="store_true"); s.set_defaults(fn=render)
    s = sub.add_parser("ocr"); s.add_argument("workdir"); s.add_argument("--pages", required=True)
    s.add_argument("--redo", action="store_true"); s.add_argument("--many", action="store_true"); s.set_defaults(fn=ocr_cmd)
    s = sub.add_parser("text"); s.add_argument("workdir"); s.add_argument("--pages")
    s.add_argument("--layer", choices=["best", "native", "ocr"], default="best"); s.set_defaults(fn=text_cmd)
    s = sub.add_parser("list"); s.set_defaults(fn=list_cmd)
    s = sub.add_parser("clean"); s.add_argument("workdir"); s.set_defaults(fn=clean)
    args = ap.parse_args()

    def _term(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, _term)
    try:
        args.fn(args)
    except Stop as e:
        print(f"doc-read: {e}", file=sys.stderr)
        sys.exit(e.code)
    except KeyboardInterrupt:
        print("doc-read: interrupted; rerun the same command to resume (finished OCR chunks are kept).",
              file=sys.stderr)
        sys.exit(130)


if __name__ == "__main__":
    main()
