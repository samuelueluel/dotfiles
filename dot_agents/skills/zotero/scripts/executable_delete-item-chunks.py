#!/usr/bin/env python3
"""Delete Chroma chunks for one exact Zotero parent item after confirmation."""

import argparse
import re
from pathlib import Path

from zotero_mcp.chroma_client import create_chroma_client

ITEM_KEY = re.compile(r"^[A-Z0-9]{8}$")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("item_key", help="Exact eight-character Zotero parent item key")
    parser.add_argument("--confirm-key", help="Repeat the exact item key to perform deletion")
    args = parser.parse_args()

    if not ITEM_KEY.fullmatch(args.item_key):
        raise SystemExit("Invalid Zotero item key; expected eight uppercase letters/digits.")
    if args.confirm_key != args.item_key:
        print(f"Dry run: would delete Chroma chunks for item {args.item_key}.")
        print(f"Rerun with --confirm-key {args.item_key} to proceed.")
        return

    config = Path.home() / ".config" / "zotero-mcp" / "config.json"
    chroma = create_chroma_client(str(config))
    chroma.delete_item_chunks(args.item_key)
    print(f"Deleted Chroma chunks for item {args.item_key}.")


if __name__ == "__main__":
    main()
