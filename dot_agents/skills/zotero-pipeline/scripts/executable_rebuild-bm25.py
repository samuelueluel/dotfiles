#!/usr/bin/env python3
"""Rebuild Zotero's sparse BM25 index from non-bibliography Chroma chunks."""

from pathlib import Path

from zotero_mcp.chroma_client import create_chroma_client
from zotero_mcp.semantic_search import is_bibliography_chunk
from zotero_mcp.sparse_index import BM25Index


def main() -> None:
    config_dir = Path.home() / ".config" / "zotero-mcp"
    chroma = create_chroma_client(str(config_dir / "config.json"))
    index = BM25Index(str(config_dir / "bm25_index.json"))
    documents: list[tuple[str, str]] = []

    for identifiers, texts, _metadata in chroma.iter_documents():
        for identifier, text in zip(identifiers, texts):
            if text and not is_bibliography_chunk(text):
                documents.append((identifier, text))

    index.build(documents)
    index.save()
    print(f"Rebuilt BM25 index from {len(documents)} chunks.")


if __name__ == "__main__":
    main()
