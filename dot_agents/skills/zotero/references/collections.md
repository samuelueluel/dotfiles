# Zotero Collection Scopes & Keys

**Load this file when** scoping searches to specific collections or looking up collection keys without dynamic discovery calls.

## Core Collection Keys

| Collection | Key | Description |
|---|---|---|
| Detroit-Paper | `TRGBCDX5` | Empirical project literature |
| Mathematics | `C8JGJRG7` | Math & statistics course materials/books |
| Methods | `2QWMWY2P` | Econometrics, causal inference & PhD methods |
| Programming | `YKQ7724G` | Stata/Python/R technical docs & manuals |
| Theory | `YKHC4X8Y` | Economic theory literature |

## Dynamic Discovery & Verification

- `zotero_read_zotero_collections`: Resource tool (no parameters); returns names, keys, and item counts for the active library.
- `zotero_zotero_search_collections(query)`: Case-insensitive substring search across all collection names.

## Scope Semantics

- Setting `collection=<KEY | NAME>` on `zotero_zotero_semantic_search` dynamically resolves SQLite membership to include the target collection **and all its child subcollections** at query time.
- Moving items between collections in the Zotero GUI takes effect immediately in semantic search without requiring re-indexing.
