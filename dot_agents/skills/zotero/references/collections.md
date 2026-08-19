# Known Zotero Collections (name → key)

**Load this file when** scoping searches to specific collections or looking up collection keys without discovery calls.

| Collection | Key | Parent |
|---|---|---|
| Detroit-Paper | `TRGBCDX5` | — |
| Methods | `2QWMWY2P` | — |
| Programming | `YKQ7724G` | — |
| Test-collection | `7UU8LJJ5` | — |

## Refreshing this table

- `zotero_read_zotero_collections` (resource tool, **no params**) returns the live map — name, key, item count — in one call. Use it to verify or rebuild this table.
- After creating, renaming, or deleting collections in Zotero: refresh and update this table.
- Collection keys are stable per library until deleted and recreated.

## Scope semantics

- `collection=<KEY>` on `zotero_zotero_semantic_search` scopes to the collection **and its subcollections** DB-side in ChromaDB.
- `zotero_zotero_search_collections(query)` matches case-insensitive substring on collection names. Use for unlisted names.
