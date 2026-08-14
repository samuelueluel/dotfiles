---
name: obsidian
description: Manage Samuel's Obsidian vault notes in Open WebUI — searching, reading, writing, and formatting notes in ~/Dropbox/Sam-Obsidian-Vault/ via obsidian_* MCP tools. Use when creating notes, editing documentation, or maintaining vault structure in Open WebUI.
---

# Obsidian Vault Management (Open WebUI)

## Quick Start & Naming Conventions

- **Vault Location:** `~/Dropbox/Sam-Obsidian-Vault/`
- **Filename:** `Title-Case-With-Hyphens.md` (e.g., `Local-LLMs.md`). Academic pattern: `Author-Year.md` or `Author-Year-Slug.md` (e.g., `Baker-2025-DiD.md`). Brief — folder provides context. No spaces or special characters.
- **Title:** The filename acts as the title. **Do not** repeat it as a heading. Start the note body directly at `H1` (`#`).

## Folder Architecture

Use top-level folders appropriately:
- `00_Inbox/`: Fleeting / unprocessed notes
- `01_Todo/`: Active tasks
- `10_Projects/`: Projects (one subfolder per project)
- `20_Library/`: Reference, literature, topic notes
- `30_Personal/`: Personal notes (family, interests, etc.)

Subfolders use hyphens and Title Case (e.g., `30_Personal/20_Personal-Interests`). Acronyms uppercase (`Local-LLMs`).
**Never** create new top-level folders without asking Samuel.

## Formatting & Styling Rules

- **Headings:** Use plain heading names. **Never** prefix headings with numbers, letters, or outline markers (e.g. `1`, `1.1`, `A.`). The Number Headings plugin handles numbering automatically.
- **Color Syntax:** Avoid `**bold**` where color syntax fits better:
  - `~={green}text=~` (emphasis — definitions, key terms, inline highlights, organizational labels)
  - `~={magenta}text=~` (warnings and dangers only — e.g. breaking commands)
  Note the trailing `=~`. Highlight connected segments of sentences rather than whole paragraphs.
- **Lists:** Prefer bullets (`-`). Use numbered lists only when sequence strictly matters. Indent nested lists with a tab.
- **Links & Callouts:**
  - Internal: `[[wikilink]]` or `[[wikilink|alias]]`
  - Callouts: `> [!note] Label` (types: note, info, warning, success, question, example, quote; add `-` to collapse by default).

## Obsidian MCP Tools (`obsidian_*`)

All vault operations in Open WebUI route through the `obsidian` MCP tools:
- **Search Notes:** `obsidian_search` (full-text) or `obsidian_search_by_frontmatter`
- **Read Note:** `obsidian_read_note`
- **Write / Create Note:** `obsidian_write_note` (requires `commit_message`)
- **Edit Note:** `obsidian_edit_note` (uses SEARCH/REPLACE diff blocks)
- **Frontmatter & Tags:** `obsidian_update_frontmatter`, `obsidian_manage_tags`
- **Backlinks & Health:** `obsidian_get_backlinks`, `obsidian_quick_health_check`

## LLM Tone & Aesthetics
- Avoid generic LLM markers: no emdashes (`—`), no negative parallelisms ("not only X but Y"), no emojis.
- Write with analytical, quantitative precision suited for empirical economics research.
