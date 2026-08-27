# TurboVault MCP Server & Substrate Guide

**Load this file when** routing TurboVault MCP operations, handling git-substrate mutations, managing timestamps, or delegating discovery searches.

## 1. Tool Routing Table

All vault operations at `~/Dropbox/Sam-Obsidian-Vault/` **must** use TurboVault MCP tools. Never run raw shell commands against vault files.

| Operation | MCP Tool Name | Purpose |
|---|---|---|
| Read note | `read_note` (`turbovault_read_note`) | Fetch note markdown by relative path |
| Write / Overwrite | `write_note` (`turbovault_write_note`) | Create or overwrite note |
| Structured edit | `edit_note` (`turbovault_edit_note`) | Apply SEARCH/REPLACE diff blocks |
| Move / rename note | `move_note` (`turbovault_move_note`) | Move note and update backlinks |
| Move binary assets | `move_file` (`turbovault_move_file`) | Move images, PDFs, attachments |
| Atomic multi-file edits | `batch_execute` (`turbovault_batch_execute`) | Transactional multi-note operations |
| Update frontmatter / tags | `update_frontmatter`, `manage_tags` | Structured YAML mutations |
| Discovery / Search | `search`, `advanced_search` | Keyword and regex searches |
| Frontmatter SQL Search | `query_frontmatter_sql` | Fast SQL metadata and tag queries |
| Graph & Link Analysis | `get_backlinks`, `get_related_notes` | Graph topology and link queries |
| Health & Verification | `get_vault_context`, `quick_health_check` | Check vault health and note stats |

*Commit Messages:* Every mutation (`write_note`, `edit_note`, `delete_note`, `move_note`, `update_frontmatter`, `batch_execute`) requires a non-empty `commit_message` describing the change.

## 2. Timestamps, Tags & Substrate Invariants

- **Timestamp Ownership:** The agent owns timestamps:
  - Note creation: set `created: YYYY-MM-DDTHH:MM:SS` (local time, no timezone).
  - Note edit: update `updated: YYYY-MM-DDTHH:MM:SS`.
- **Tag Invariants:** Tags must reside exclusively in frontmatter `tags:`. Never insert inline `#tags` into note text. All `00_` notes must include `moc`.
- **Git-Substrate Divergence Guard:** The git backend refuses mutations when working-tree state differs from HEAD. If external processes (Obsidian app, sync) leave uncommitted modifications, commit or reconcile working-tree state before retrying MCP calls.

## 3. Context Hygiene: Reads vs. Subagent Delegation

Split vault operations by purpose to prevent KV cache pollution:

1. **Discovery (Result Sets $\to$ Research Subagent):**
   - Delegate operations that return match lists or graph traversals (`search`, `advanced_search`, `semantic_search`, `get_backlinks`, `get_related_notes`, `query_frontmatter_sql`, `get_broken_links`) to `invoke_subagent` (`TypeName: "research"`).
2. **Working-Set Reads (Main Session Inline):**
   - Call `turbovault_read_note` directly in the main session when reading specific working files being actively analyzed, quoted, or edited.
