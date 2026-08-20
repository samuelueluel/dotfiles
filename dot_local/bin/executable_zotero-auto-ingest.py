#!/usr/bin/env python3
"""zotero-auto-ingest.py — Automated PDF Metadata Ingestion & Library Enrichment.

Takes raw, unindexed PDFs -> extracts DOI/arXiv/ISBN or resolves via OpenAlex/Crossref
-> creates a publication-grade Zotero record -> links the local PDF (0 cloud bytes)
-> generates a Better BibTeX citekey for LaTeX drafting.

Supports:
  1. Single PDF ingestion:
     zotero-auto-ingest.py <path_to_pdf> [--collection <KEY>] [--dry-run]
  2. Batch directory ingestion:
     zotero-auto-ingest.py <pdf_dir>/*.pdf [--collection <KEY>]
  3. Retroactive library enrichment (backfill missing metadata in existing items):
     zotero-auto-ingest.py --enrich-existing [--collection <KEY>] [--dry-run]
"""

import argparse
import difflib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional

import pymupdf  # PyMuPDF
import requests
from pyzotero import zotero

UNIT_PATH = Path.home() / ".config" / "systemd" / "user" / "zotero-mcp.service"
USER_AGENT = "zotero-auto-ingest/1.0 (mailto:samuel@example.com)"

DOI_RE = re.compile(r"\b(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)\b")
ARXIV_RE = re.compile(r"\b(?:arXiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)\b", re.IGNORECASE)
ISBN_RE = re.compile(r"\b(?:ISBN(?:-1[03])?:?\s*)?((?:97[89][-\s]?)?[0-9]{1,5}[-\s]?[0-9]+[-\s]?[0-9]+[-\s]?[0-9X])\b")


def get_zotero_credentials() -> tuple[str, str]:
    """Read API Key and Library ID from zotero-mcp systemd unit."""
    api_key = os.environ.get("ZOTERO_API_KEY", "")
    lib_id = os.environ.get("ZOTERO_LIBRARY_ID", "")

    if not (api_key and lib_id) and UNIT_PATH.exists():
        text = UNIT_PATH.read_text(encoding="utf-8")
        m_k = re.search(r'ZOTERO_API_KEY=([^\s"\n]+)', text)
        m_l = re.search(r'ZOTERO_LIBRARY_ID=([^\s"\n]+)', text)
        if m_k:
            api_key = m_k.group(1)
        if m_l:
            lib_id = m_l.group(1)

    if not (api_key and lib_id):
        raise RuntimeError(f"Could not read Zotero API credentials from {UNIT_PATH}")
    return api_key, lib_id


def extract_identifiers_from_pdf(pdf_path: Path) -> dict[str, str]:
    """Scan first 2 pages of PDF for DOI, arXiv, ISBN, and title candidate."""
    results = {"doi": "", "arxiv": "", "isbn": "", "title_candidate": ""}
    if not pdf_path.exists():
        return results

    try:
        doc = pymupdf.open(pdf_path)
        pages_to_check = min(len(doc), 2)
        text_pages = [doc[i].get_text("text") for i in range(pages_to_check)]
        full_text = "\n".join(text_pages)

        # 1. DOI Regex
        dois = DOI_RE.findall(full_text)
        for d in dois:
            clean = d.rstrip(".,;:)").strip()
            # Filter out obvious false positives
            if "/" in clean and len(clean) > 8:
                results["doi"] = clean
                break

        # 2. arXiv Regex
        if not results["doi"]:
            arx = ARXIV_RE.findall(full_text)
            if arx:
                results["arxiv"] = arx[0]

        # 3. Title Candidate (top lines of page 1)
        lines = [
            l.strip()
            for l in text_pages[0].splitlines()
            if len(l.strip()) > 8
            and not l.strip().startswith(("http", "doi", "ISSN", "Vol", "Page"))
        ]
        if lines:
            results["title_candidate"] = " ".join(lines[:3])

    except Exception as e:
        print(f"  [!] PDF read warning for {pdf_path.name}: {e}", file=sys.stderr)

    return results


def query_crossref_doi(doi: str) -> Optional[dict[str, Any]]:
    """Query official publisher metadata from Crossref REST API."""
    url = f"https://api.crossref.org/works/{doi}"
    try:
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=8)
        if r.status_code == 200:
            msg = r.json().get("message", {})
            return format_crossref_item(msg, doi)
    except Exception:
        pass
    return None


def format_crossref_item(msg: dict, doi: str) -> dict[str, Any]:
    """Convert Crossref work JSON to a clean Zotero item dictionary."""
    titles = msg.get("title", [])
    title = titles[0] if titles else "Untitled"

    # Creators
    creators = []
    for a in msg.get("author", []):
        family = a.get("family", "").strip()
        given = a.get("given", "").strip()
        if family:
            creators.append({
                "creatorType": "author",
                "lastName": family,
                "firstName": given,
            })

    # Publication date
    date_parts = msg.get("published", {}).get("date-parts", [[]])[0]
    date_str = "-".join(str(p) for p in date_parts) if date_parts else ""

    # Container / Journal
    container = msg.get("container-title", [""])[0]
    volume = msg.get("volume", "")
    issue = msg.get("issue", "")
    page = msg.get("page", "")

    # Item Type mapping
    c_type = msg.get("type", "")
    item_type = "journalArticle"
    if "book" in c_type or "monograph" in c_type:
        item_type = "book"
    elif "chapter" in c_type:
        item_type = "bookSection"
    elif "posted-content" in c_type or "preprint" in c_type:
        item_type = "preprint"

    item = {
        "itemType": item_type,
        "title": title,
        "creators": creators,
        "date": date_str,
        "DOI": doi,
        "abstractNote": msg.get("abstract", "") or "",
        "extra": f"Citation Key: \nDOI: {doi}",
    }

    if item_type == "journalArticle":
        item["publicationTitle"] = container
        item["volume"] = volume
        item["issue"] = issue
        item["pages"] = page
    elif item_type == "book":
        item["publisher"] = msg.get("publisher", "")
    elif item_type == "preprint":
        item["repository"] = container or msg.get("publisher", "")

    return item


def search_openalex_title(title_candidate: str) -> Optional[dict[str, Any]]:
    """Fuzzy search OpenAlex when no DOI is printed."""
    if not title_candidate or len(title_candidate) < 10:
        return None

    # Clean query string
    clean_q = re.sub(r"[^\w\s]", " ", title_candidate[:120]).strip()
    url = f"https://api.openalex.org/works?search={clean_q}&per-page=3"
    try:
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=8)
        if r.status_code == 200:
            results = r.json().get("results", [])
            for w in results:
                oa_title = w.get("title") or ""
                ratio = difflib.SequenceMatcher(None, title_candidate.lower(), oa_title.lower()).ratio()
                if ratio > 0.65 or oa_title.lower() in title_candidate.lower():
                    doi = (w.get("doi") or "").replace("https://doi.org/", "").strip()
                    if doi:
                        # Crossref has richer structure for this DOI
                        cr_meta = query_crossref_doi(doi)
                        if cr_meta:
                            return cr_meta
                    return format_openalex_item(w)
    except Exception:
        pass
    return None


def format_openalex_item(w: dict) -> dict[str, Any]:
    """Convert OpenAlex work JSON to a clean Zotero item dictionary."""
    title = w.get("title") or "Untitled"
    creators = []
    for a in w.get("authorships", []):
        name = a.get("author", {}).get("display_name", "").strip()
        if name:
            parts = name.rsplit(" ", 1)
            first = parts[0] if len(parts) > 1 else ""
            last = parts[1] if len(parts) > 1 else parts[0]
            creators.append({
                "creatorType": "author",
                "lastName": last,
                "firstName": first,
            })

    doi = (w.get("doi") or "").replace("https://doi.org/", "").strip()
    year = str(w.get("publication_year") or "")
    source_name = w.get("primary_location", {}).get("source", {}).get("display_name", "") or ""

    item_type = "preprint" if "working" in source_name.lower() or "nber" in source_name.lower() else "journalArticle"

    return {
        "itemType": item_type,
        "title": title,
        "creators": creators,
        "date": year,
        "DOI": doi,
        "publicationTitle": source_name if item_type == "journalArticle" else "",
        "repository": source_name if item_type == "preprint" else "",
        "extra": f"Citation Key: \nDOI: {doi}",
    }


def link_local_pdf(zot: zotero.Zotero, item_key: str, pdf_path: Path, title: str = "") -> bool:
    """Create a linked_file attachment in Zotero pointing to the local PDF (0 cloud bytes)."""
    abs_path = str(pdf_path.resolve())
    display_title = title or pdf_path.name

    att = [{
        "itemType": "attachment",
        "linkMode": "linked_file",
        "contentType": "application/pdf",
        "path": "file://" + abs_path,
        "title": display_title,
    }]
    try:
        r = zot.create_items(att, parentid=item_key)
        keys = [v.get("key") for v in (r.get("successful") or {}).values()]
        return bool(keys)
    except Exception as e:
        print(f"  [!] Failed to link PDF {pdf_path.name}: {e}", file=sys.stderr)
        return False


def process_single_pdf(
    pdf_path: Path,
    zot: zotero.Zotero,
    collection_key: str = "",
    dry_run: bool = False,
) -> Optional[str]:
    """Ingest a single PDF end-to-end: scan -> query API -> create item -> link PDF."""
    print(f"\nProcessing: {pdf_path.name}")
    ident = extract_identifiers_from_pdf(pdf_path)

    metadata = None
    source_used = ""

    # 1. DOI Resolution
    if ident["doi"]:
        print(f"  -> Found DOI: {ident['doi']}")
        metadata = query_crossref_doi(ident["doi"])
        if metadata:
            source_used = f"Crossref DOI ({ident['doi']})"

    # 2. OpenAlex Title Resolution
    if not metadata and ident["title_candidate"]:
        print(f"  -> Searching title candidate: {ident['title_candidate'][:60]}...")
        metadata = search_openalex_title(ident["title_candidate"])
        if metadata:
            source_used = "OpenAlex Title Search"

    if not metadata:
        # Fallback: create basic item from filename/title
        print("  -> [!] No external record found. Creating baseline record.")
        title = ident["title_candidate"] or pdf_path.stem.replace("_", " ").replace("-", " ").title()
        metadata = {
            "itemType": "preprint",
            "title": title,
            "creators": [],
            "extra": f"Citation Key: \nSource: Local Ingest",
        }
        source_used = "Local PDF Header"

    print(f"  -> Matched Metadata [{source_used}]:")
    print(f"     Title:   {metadata['title']}")
    au_str = "; ".join(f"{c['lastName']}, {c['firstName']}" for c in metadata.get("creators", []))
    print(f"     Authors: {au_str or 'Unknown'}")
    print(f"     Date:    {metadata.get('date', 'n.d.')}")
    if metadata.get("DOI"):
        print(f"     DOI:     {metadata['DOI']}")

    if dry_run:
        print("  -> [DRY RUN] Would create item and link attachment.")
        return None

    # Apply collection key if provided
    if collection_key:
        metadata["collections"] = [collection_key]

    # Create item in Zotero
    res = zot.create_items([metadata])
    item_key = None
    if res.get("successful"):
        item_key = list(res["successful"].values())[0]["key"]
        print(f"  -> Created Zotero Item: {item_key}")

        # Link PDF
        linked = link_local_pdf(zot, item_key, pdf_path, title=metadata["title"])
        if linked:
            print(f"  -> Linked local PDF attachment (0 cloud bytes) ✓")
        return item_key
    else:
        print(f"  [!] Failed to create item in Zotero: {res.get('failed')}", file=sys.stderr)
        return None


def enrich_existing_library(zot: zotero.Zotero, collection_key: str = "", dry_run: bool = False):
    """Scan existing items in Zotero and enrich items with missing metadata/DOIs."""
    print("\nScanning existing Zotero library for metadata enrichment...")
    items = zot.everything(zot.items(itemType="-attachment", collection_or_key=collection_key or None))
    print(f"Found {len(items)} top-level items.")

    enriched_count = 0
    for it in items:
        data = it.get("data", {})
        key = it.get("key")
        title = data.get("title", "")
        doi = data.get("DOI", "")

        # Check if item needs enrichment (missing DOI, or very short title)
        if not doi or title.endswith(".pdf") or len(data.get("creators", [])) == 0:
            print(f"\nCandidate for enrichment: [{key}] {title[:50]}")
            # Try to resolve via OpenAlex
            meta = search_openalex_title(title)
            if meta and meta.get("DOI") and meta["DOI"] != doi:
                print(f"  -> Found updated DOI: {meta['DOI']} ({meta['title'][:40]})")
                if not dry_run:
                    data["DOI"] = meta["DOI"]
                    if not data.get("publicationTitle") and meta.get("publicationTitle"):
                        data["publicationTitle"] = meta["publicationTitle"]
                    if not data.get("creators") and meta.get("creators"):
                        data["creators"] = meta["creators"]
                    zot.update_item(it)
                    enriched_count += 1
                    print("  -> Updated Zotero item ✓")

    print(f"\nEnrichment complete. {enriched_count} items updated.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="*", help="PDF file paths or glob patterns to ingest")
    parser.add_argument("--collection", "-c", metavar="KEY", default="", help="Zotero collection key to add items to")
    parser.add_argument("--enrich-existing", action="store_true", help="Audit and enrich existing items in Zotero library")
    parser.add_argument("--dry-run", action="store_true", help="Preview metadata extraction without writing to Zotero")
    args = parser.parse_args()

    api_key, lib_id = get_zotero_credentials()
    zot = zotero.Zotero(lib_id, "user", api_key)

    if args.enrich_existing:
        enrich_existing_library(zot, collection_key=args.collection, dry_run=args.dry_run)
        return 0

    if not args.paths:
        parser.print_help()
        return 1

    pdf_files = []
    for p_str in args.paths:
        p = Path(p_str)
        if p.is_file() and p.suffix.lower() == ".pdf":
            pdf_files.append(p)
        elif p.is_dir():
            pdf_files.extend(list(p.glob("*.pdf")) + list(p.glob("*.PDF")))

    if not pdf_files:
        print("No valid PDF files found matching input paths.", file=sys.stderr)
        return 1

    print(f"Found {len(pdf_files)} PDF file(s) for ingestion.")
    created_keys = []
    for pdf_path in pdf_files:
        k = process_single_pdf(pdf_path, zot, collection_key=args.collection, dry_run=args.dry_run)
        if k:
            created_keys.append(k)

    print(f"\n=== SUMMARY ===")
    print(f"Successfully processed {len(created_keys)} / {len(pdf_files)} items.")
    if created_keys:
        print("\nNext step (Sidecar & Vector Ingest):")
        keys_str = " ".join(created_keys[:5])
        print(f"  zotero-sidecar.sh create {keys_str} && zotero-sidecar.sh enrich {keys_str} && zotero-sidecar.sh embed {keys_str}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
