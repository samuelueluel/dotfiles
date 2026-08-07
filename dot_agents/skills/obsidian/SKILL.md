---
name: obsidian
description: Manages reading, writing, creating, editing, listing, and modifying files and directories in Samuel&apos;s Obsidian vault at `~/Dropbox/Sam-Obsidian-Vault/`. Use when working with Obsidian, markdown vault notes, creating new notes, filing documents, or following vault formatting and naming conventions.
---

# Obsidian Vault

## Quick start

When creating or editing a note, follow these core conventions:
- **Location:** `~/Dropbox/Sam-Obsidian-Vault/`
- **Filename:** Title-Case-With-Hyphens.md (e.g., `Local-LLMs.md`). Brief — folder provides context. No spaces or special characters.
  - Academic pattern: `Author-Year.md` or `Author-Year-Slug.md` (e.g., `Baker-2025-DiD.md`)
- **Title:** The filename acts as the title. **Do not** repeat it as a heading. Start the note body directly at `H1` (`#`).

## Workflows

### 1. Determining Target Folder
1. Infer appropriate folder by conversation context.
2. If it is not clear, use top-level folders: 
   - `00_Inbox/`: Fleeting / unprocessed notes
   - `01_Todo/`: Active tasks
   - `10_Projects/`: Projects (one subfolder per project)
   - `20_Library/`: Reference, literature, topic notes
   - `30_Personal/`: Personal notes (family, interests, etc.)
3. Subfolders use hyphens and Title Case (e.g., `30_Personal/20_Personal-Interests`). Acronyms uppercase: `Local-LLMs`.
4. **Never** create new top-level folders without asking.

### 2. Note Conventions
- **Headings:** Use plain heading names — do not use formatting in headings. **Never** prefix headings with numbers, letters, or outline markers (e.g. `1`, `1.1`, `A.`). The Number Headings plugin handles numbering automatically. Replace placeholder titles with relevant titles.
- **Color syntax** for formatting, avoiding `**bold**`:
  - `~={green}text=~` (all emphasis — definitions, key terms, inline highlights, organizational labels)
  - `~={magenta}text=~` (warnings and dangers only — e.g. a command that can break something)
  Note the trailing `=~`. When possible it is better to highlight connected segments of sentences rather than whole sentences or paragraphs.
- **Lists:**
  - Prefer bullets (`-`) unless order or sequence is meaningful — use numbered lists only when numbering matters.
  - For nested lists, indent with a tab.
  - When nesting, alternate list type (bullet → numbered or numbered → bullet) to visually distinguish levels.

### 3. Adding Links, Embeds, and Callouts
- **Internal:** `[[wikilink]]` or `[[wikilink|alias]]`
- **Embeds:** `![[filename.pdf]]`
  - Collapsed embed: 
    ```markdown
    > [!info]- Title
    > ![[file.pdf]]
    ```
- **External:** Must use `http://` or `https://` explicitly.
- **Callouts:** 
  ```markdown
  > [!note] Label
  > Content
  ```
  - Common types: note, info, warning, success, question, example, quote. Add `-` to collapse by default.

### 4. TurboVault MCP Tools (Mandatory Vault Substrate)
You MUST ALWAYS connect to and use the `turbovault` MCP server for all vault operations. **DO NOT** execute raw shell commands (`find`, `grep`, `cat`, `ls`, `sed`, `awk`) against `~/Dropbox/Sam-Obsidian-Vault/`.

- **Calling turbovault tools:** every tool is exposed with a `turbovault_` prefix — call `turbovault_search`, `turbovault_read_note`, `turbovault_write_note`, etc. (bare names like `search` return "Tool not found"). Every write operation (`turbovault_write_note`, `turbovault_edit_note`, `turbovault_delete_note`, `turbovault_move_note`, `turbovault_update_frontmatter`, `turbovault_batch_execute`) requires a non-empty `commit_message` — always pass one. Overwriting an existing note requires `expected_hash` from a prior read, or `force: true`. `turbovault_edit_note` takes `edits` as diff-style SEARCH/REPLACE blocks, not JSON: `<<<<<<< SEARCH` + old text + `=======` + new text + `>>>>>>> REPLACE` (one block per change).

- **Lazy loading:** `turbovault` is lazy-loaded — its server starts on first use. A direct `mcp call` to any turbovault tool (or an explicit `mcp connect turbovault`) auto-spawns the server and activates the full toolset for the session. Whenever the user's request concerns the vault (reading, searching, writing, organizing, linking, tags, templates), start with a turbovault `mcp call` — no separate connect step is required.
- **Task → tool routing (use the `turbovault_` prefixed names):**
  - Read a note → `turbovault_read_note`
  - Search notes → `turbovault_search` (full-text) or `turbovault_advanced_search` (tags/frontmatter)
  - Write/update → `turbovault_write_note` (overwrite/append/prepend) or `turbovault_edit_note` (targeted SEARCH/REPLACE)
  - Multiple notes at once → `turbovault_batch_execute`
  - Move/rename → `turbovault_move_note`
  - Templates → `turbovault_list_templates`, `turbovault_create_from_template`
  - Frontmatter/tags → `turbovault_update_frontmatter`, `turbovault_manage_tags`
  - Links/graph → `turbovault_get_backlinks`, `turbovault_get_broken_links`, `turbovault_get_related_notes`
  - Vault overview → `turbovault_get_vault_context`, `turbovault_quick_health_check`
- **Fallback:** If `turbovault` cannot be connected or is unavailable, stop and tell the user rather than editing vault files directly.

## Advanced features

- **Folder Structure Reference:**
  - `98_Bases/`: Dataview bases
  - `99_System/`: Templates, system config, attachments
  - `.trash/`: Deleted notes — do not recreate files here
- **LLM Tone & Aesthetics:** Avoid LLM indicators: no emdashes, no negative parallelisms, no emojis.
- **Plugins:** obsidian-git, obsidian-icon-folder, obsidian-latex-suite, obsidian-minimal-settings, obsidian-style-settings, obsidian-vimrc-support, fast-text-color.
