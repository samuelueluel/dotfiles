# Known Zotero Collections (name → key)

**Load this file when** scoping searches to specific collections or looking up collection keys without discovery calls.

| Collection | Key | Parent |
|---|---|---|
| Detroit-Paper | `TRGBCDX5` | — |
| Mathematics | `C8JGJRG7` | — |
| Methods | `2QWMWY2P` | — |
| Programming | `YKQ7724G` | — |
| Theory | `YKHC4X8Y` | — |

## Refreshing this table

- `zotero_read_zotero_collections` (resource tool, **no params**) returns the live map — name, key, item count — in one call. Use it to verify or rebuild this table.
- After creating, renaming, or deleting collections in Zotero: refresh and update this table.
- Collection keys are stable per library until deleted and recreated.

## Scope semantics

- `collection=<KEY | NAME>` on `zotero_zotero_semantic_search` scopes to the collection **and its subcollections** via real-time SQLite item-key resolution (zero manual sync needed when moving papers in GUI).
- `zotero_zotero_search_collections(query)` matches case-insensitive substring on collection names. Use for unlisted names.
