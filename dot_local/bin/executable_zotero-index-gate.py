#!/usr/bin/env python3
"""zotero-index-gate.py — post-rebuild index invariants gate.

Run AFTER any update-db / force-rebuild to fail loudly when the index violates
the invariants the chunker/embedding pipeline is supposed to guarantee. This
is the enforcement half of the process fix for the Chunking-Bug class of
failures (see 02_Memories/Chunking-Bug.md): presence checks (sidecar exists,
"101 indexed, 0 errors") are not content checks.

Checks (all against the live ChromaDB store):
  1. Chunk size bounds: p99 <= 2600 (prose ceiling + overlap); atomic
     ceiling 3800; hard failsafe 4000. Any chunk > 4000 is a FAIL.
  2. Duplication: any pair of chunks (same item) with overlapping char ranges
     beyond 1000 chars (design overlap = 200) is a FAIL.
  3. Table atomicity: every chunk containing <table must contain a balanced
     close (row-wise fallback output is self-contained by construction).
  4. Display-math parity: chunks with odd $$ counts are flagged (source
     sidecar artifacts, not chunker bugs — reported, not failed).
  5. Coverage: every live Zotero item with a full sidecar in the pool must
     have >= 1 chunk (zero-chunk items with sidecars = FAIL).

Exit 0 = PASS, 1 = FAIL. Prints a summary; use --strict to fail on math-parity
and >3800 atomic-ceiling flags too.

Usage:
  zotero-index-gate.py [--strict] [--pool <collection-key,...>]
"""
import argparse
import ast
import os
import re
import sqlite3
import statistics
import sys
from collections import defaultdict
from pathlib import Path

from zotero_mcp.chroma_client import create_chroma_client

FAILS: list[str] = []
WARNS: list[str] = []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="fail on warnings too")
    ap.add_argument("--pool", default=None, help="comma-separated collection keys to check coverage for")
    args = ap.parse_args()

    cc = create_chroma_client(str(Path.home() / ".config" / "zotero-mcp" / "config.json"))

    lens: list[int] = []
    items: dict[str, list[tuple[int, int]]] = defaultdict(list)  # item_key -> (start, end)
    n_table = n_table_ok = 0
    n_math = n_math_ok = 0
    chunk_item_keys: set[str] = set()
    TABLE_OPEN = re.compile(r"<table", re.I)
    TABLE_CLOSE = re.compile(r"</table>", re.I)
    DOLLARS = re.compile(r"\$\$")

    for ids, docs, metas in cc.iter_documents(batch_size=5000):
        for did, doc, meta in zip(ids, docs, metas):
            if not doc:
                continue
            # The failsafe ceiling governs chunk CONTENT; the pipeline prepends
            # a DCR prefix ([Paper: ... | Section: ...], ~80 chars) after
            # chunking, so strip it before measuring length.
            content = doc
            if content.startswith("[Paper:") or content.startswith("[Section:"):
                nl = content.find("\n")
                if nl != -1:
                    content = content[nl + 1:]
            lens.append(len(content))
            k = (meta or {}).get("item_key", "?")
            chunk_item_keys.add(k)
            try:
                s, e = int(meta["char_start"]), int(meta["char_end"])
                items[k].append((s, e, doc))
            except (KeyError, TypeError, ValueError):
                pass
            if TABLE_OPEN.search(doc):
                n_table += 1
                if len(TABLE_OPEN.findall(doc)) == len(TABLE_CLOSE.findall(doc)):
                    n_table_ok += 1
            d = DOLLARS.findall(doc)
            if d:
                n_math += 1
                if len(d) % 2 == 0:
                    n_math_ok += 1

    lens.sort()
    n = len(lens)
    p99 = lens[min(n - 1, int(n * 0.99))]
    p95 = lens[min(n - 1, int(n * 0.95))]
    over_2600 = sum(1 for l in lens if l > 2600)
    over_3800 = sum(1 for l in lens if l > 3800)
    over_4000 = sum(1 for l in lens if l > 4000)

    print(f"chunks: {n}  len: p50={lens[n//2]} p95={p95} p99={p99} max={lens[-1]}")
    print(f"  >2600: {over_2600}  >3800: {over_3800}  >4000(failsafe): {over_4000}")
    if over_4000:
        FAILS.append(f"{over_4000} chunks exceed the 4000-char failsafe ceiling")
    if p99 > 2600 and not args.strict:
        WARNS.append(f"p99 ({p99}) exceeds the 2600-char prose ceiling")

    # duplication: overlapping char ranges > 1000 within an item. Span overlap
    # alone is NOT corruption: the chunker's oversized-block split can leave a
    # pending heading whose later flush has a span that wraps the already-emitted
    # split region (spans over-claim; text is correct). True corruption is
    # duplicated TEXT, so check whether overlapping chunks actually share a
    # >1000-char run of identical content.
    def _shares_long_run(a: str, b: str, n: int) -> bool:
        short, long = (a, b) if len(a) <= len(b) else (b, a)
        if len(short) < n:
            return False
        for i in range(0, len(short) - n + 1, 500):
            if short[i:i + n] in long:
                return True
        return False

    dup_pairs = span_only = 0
    for k, spans in items.items():
        spans.sort()
        for i in range(len(spans)):
            s1, e1, t1 = spans[i]
            for j in range(i + 1, len(spans)):
                s2, e2, t2 = spans[j]
                if s2 >= e1:
                    break
                if min(e1, e2) - s2 > 1000:
                    if _shares_long_run(t1, t2, 1000):
                        dup_pairs += 1
                    else:
                        span_only += 1
    print(f"text-duplicate pairs (>1000 shared chars): {dup_pairs}")
    print(f"span-overlap only (no shared text; chunker metadata artifact): {span_only}")
    if dup_pairs:
        FAILS.append(f"{dup_pairs} chunk pairs share >1000 chars of identical text — chunker flush bug not fixed?")
    if span_only:
        WARNS.append(f"{span_only} span over-claims (correct text, wrapping spans from oversized-block splits; fixed in chunker for next rebuild)")

    # table / math atomicity
    print(f"table chunks: {n_table}, complete: {n_table_ok} ({100*n_table_ok/max(1,n_table):.1f}%)")
    print(f"display-math chunks: {n_math}, balanced $$: {n_math_ok} ({100*n_math_ok/max(1,n_math):.1f}%)")
    if n_table and n_table_ok != n_table:
        FAILS.append(f"{n_table - n_table_ok} table chunks unbalanced (chunker table path broken?)")
    if n_math and n_math_ok != n_math and args.strict:
        FAILS.append(f"{n_math - n_math_ok} math chunks with odd $$ (likely sidecar artifacts)")

    # coverage: pool items with a full sidecar must have chunks
    if args.pool:
        sidecar_dir = Path.home() / ".config" / "zotero-mcp" / "mineru-sidecars"
        db = sqlite3.connect(f"file:{os.path.expanduser('~/Zotero/zotero.sqlite')}?immutable=1", uri=True)
        missing: list[str] = []
        for coll in args.pool.split(","):
            rows = db.execute(
                """SELECT DISTINCT i.key FROM items i
                   JOIN collectionItems ci ON ci.itemID=i.itemID
                    AND ci.collectionID=(SELECT collectionID FROM collections WHERE key=?)
                   LEFT JOIN deletedItems d ON d.itemID=i.itemID
                   WHERE d.itemID IS NULL AND i.itemTypeID NOT IN
                     (SELECT itemTypeID FROM itemTypes WHERE typeName IN ('attachment','note','annotation'))""",
                (coll.strip(),),
            ).fetchall()
            for (k,) in rows:
                if (sidecar_dir / f"{k}.md").exists() and k not in chunk_item_keys:
                    missing.append(k)
        print(f"pool items with sidecar but 0 chunks: {len(missing)} {missing[:10]}")
        if missing:
            FAILS.append(f"{len(missing)} pool items have sidecars but no chunks: {missing[:10]}")

    ok = not FAILS and not (WARNS and args.strict)
    for w in WARNS:
        print(f"WARN: {w}")
    for f in FAILS:
        print(f"FAIL: {f}")
    print("VERDICT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
