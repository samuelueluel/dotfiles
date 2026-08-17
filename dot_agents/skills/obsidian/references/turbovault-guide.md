# TurboVault MCP Server & Substrate Guide

Load this reference when interacting with the TurboVault MCP server, handling git-substrate mutations, managing timestamps, or delegating discovery vs inline reads.

---

## 1. Mandatory TurboVault Substrate

All operations on `~/Dropbox/Sam-Obsidian-Vault/` **MUST** use the `turbovault` MCP tools. **NEVER** execute raw shell commands (`find`, `grep`, `cat`, `ls`, `sed`, `awk`) directly against vault notes.

* **Tool Routing:**
  * Read a note -> `turbovault_read_note`
  * Write / append / prepend -> `turbovault_write_note` (or `turbovault_edit_note` for SEARCH/REPLACE diff blocks)
  * Move / rename notes -> `turbovault_move_note` (or `turbovault_move_file` for binary assets)
  * Multi-file atomic mutations -> `turbovault_batch_execute`
  * Frontmatter / tags -> `turbovault_update_frontmatter`, `turbovault_manage_tags`
  * Full-text search -> `turbovault_search` (discovery)
  * Frontmatter SQL search -> `turbovault_query_frontmatter_sql` (discovery)
  * Vault context / health -> `turbovault_get_vault_context`, `turbovault_quick_health_check`

* **Commit Messages:** Every write operation (`turbovault_write_note`, `turbovault_edit_note`, `turbovault_delete_note`, `turbovault_move_note`, `turbovault_update_frontmatter`, `turbovault_batch_execute`) requires a non-empty `commit_message`. Always provide a descriptive commit message.

---

## 2. Timestamps, Tags & Frontmatter Enforcement on Mutations

Every mutation executed via `turbovault_write_note`, `turbovault_edit_note`, `turbovault_update_frontmatter`, `turbovault_manage_tags`, or `turbovault_batch_execute` must strictly adhere to the vault's frontmatter schema:

* **Timestamp Ownership:** The AGENT owns timestamps.
  * When **creating** a note: set frontmatter `created` timestamp in `YYYY-MM-DDTHH:MM:SS` format (e.g. `2026-08-16T17:35:00`).
  * When **editing** a note: refresh frontmatter `updated` timestamp in `YYYY-MM-DDTHH:MM:SS` format.
* **Tag Enforcement:**
  * Tags must live **exclusively** in the frontmatter `tags:` array. Never insert inline `#tags` into note prose during write/edit operations.
  * Pick tags strictly from the canonical flat baseline (`pin`, `to-read`, `to-do`, `moc`, `python`, `stata`, `latex`, `linux`, `probability`, `econometrics`, `economics`, `math`).
  * Every `00_` Map of Content / Hub note must include `moc`.
* **Git-Substrate Divergence Guard:** The git backend refuses mutations when a file's working-tree state differs from HEAD. If external writers (Obsidian, sync) modify the file, commit or restore the working-tree change before retrying the MCP operation.

---

## 3. Context Hygiene: Reads vs. Delegation

Vault operations split by purpose, not tool identity:

1. **Discovery (Result Sets):**
   * Operations returning ranked match lists or graph traversals (`turbovault_search`, `turbovault_advanced_search`, `turbovault_semantic_search`, `turbovault_get_backlinks`, `turbovault_get_related_notes`, `turbovault_query_frontmatter_sql`, `turbovault_get_broken_links`) **MUST** be delegated to a subagent (`invoke_subagent` with `TypeName: "research"` or `Explore`).
   * Rationale: Large search results pollute the main session's KV cache.
2. **Working-Set Reads:**
   * `turbovault_read_note` on known paths stays **INLINE in the main session** when the content is actively discussed, quoted, or edited.
   * Disclose progressively: read the relevant note or index before fetching referenced nodes.
