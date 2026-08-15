# Known Zotero Collections (name → key)

Fast path for scoping searches. When the user names a collection or project, use its key from this table directly — no discovery call needed.

| Collection | Key | Parent |
|---|---|---|
| Detroit-Paper | `TRGBCDX5` | — |
| Methods | `2QWMWY2P` | — |
| Programming | `YKQ7724G` | — |
| Test-collection | `7UU8LJJ5` | — |

No subcollections as of last refresh.

## Refreshing this table

- `zotero_read_zotero_collections` (resource tool, **no params**) returns the live map — name, key, item count — in one call. Use it to verify or rebuild this file.
- After creating/renaming/deleting collections in Zotero: refresh, then update this file in the same session.
- Collection keys are stable per library until a collection is deleted and recreated — a stale key silently returns wrong/empty scopes, so re-verify after any reorganization.

## Scope semantics

- `collection=<KEY>` on `zotero_zotero_semantic_search` scopes to the collection **and its subcollections** — "Scope to Methods" includes `Methods/<anything>`.
- `zotero_zotero_search_collections(query)` matches case-insensitive substring, ANDs multi-word queries, and checks only the collection's own name — fallible for nested or shared names. Prefer this table over it for known names; use it only for names not listed here.
