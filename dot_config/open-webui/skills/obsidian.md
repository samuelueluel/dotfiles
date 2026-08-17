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
- `02_Memories/`: Domain-agnostic persistent memory store for LLM agents and system discoveries
- `10_Projects/`: Active projects (one subfolder per project) — moves to `90_Archive/` upon completion
- `20_Library/`: Reference, academic literature (`Modern-DiD-Lit`, `New-Econometric-Lit`), topic notes
- `30_Personal/`: Personal notes (`Personal-Admin`, `Personal-Interests`, `Family`)
- `90_Archive/`: Completed projects, retired configs, past applications
- `98_Bases/`: Dataview bases · `99_System/`: Templates, system config, attachments (`Z_Attachments/`) · `.trash/`: deleted notes — **never** recreate files here

Subfolders use clean semantic `Title-Case-With-Hyphens` by default. Samuel personally manages numeric/alphanumeric prefixes (`00_`, `01_`, `z_`) for pinning—never strip, alter, or rename user prefixes.
**Never** create new top-level folders without asking Samuel.

## Formatting & Styling Rules

- **Headings:** New headings — plain titles, never numbered by hand; the Number Headings plugin numbers them automatically. **Existing notes:** NEVER strip, remove, or alter existing heading numbers (e.g. `# 1.`, `## 2.1.`) — the plugin wrote them into the file; removing them corrupts the note's outline.
- **Color syntax** (instead of `**bold**`), exactly two colors, fixed meanings:
  - `~={green}text=~` — emphasis: definitions, key terms, inline highlights, organizational labels
  - `~={magenta}text=~` — warnings and dangers only (e.g. breaking commands)
  - The palette is closed: green and magenta only — never `orange`, `red`, `blue`, `pink`, even though renderable. Highlight the key phrase, never a whole sentence; at most one or two spans per paragraph; tables stay plain. Note the trailing `=~`. When editing notes with legacy colors, normalize in place: `orange` → `green`; status flags (off/unconfirmed/retired) → plain text or green; keep magenta only for true warnings.
- **Lists:** Prefer bullets (`-`). Use numbered lists only when sequence strictly matters. Indent nested lists with a tab; alternate list type at each nesting level (bullet → numbered → bullet) to visually distinguish levels.
- **Links, Embeds & Callouts:**
  - Internal: `[[wikilink]]` or `[[wikilink|alias]]`
  - Embeds: `![[filename.pdf]]` — collapsed embed:
    ```markdown
    > [!info]- Title
    > ![[file.pdf]]
    ```
  - External links must use `http://` or `https://` explicitly
  - Callouts: `> [!note] Label` (types: note, info, warning, success, question, example, quote; add `-` to collapse by default)

## Obsidian MCP Tools (`obsidian_*`)

All vault operations route through the `obsidian_*` MCP tools (the turbovault pair: `obsidian-ro` read-only, `obsidian-full` for writes). **Never** use shell commands (`find`, `grep`, `cat`, `sed`, `ls`) against the vault.

- **Search Notes:** `obsidian_search` (full-text) or `obsidian_search_by_frontmatter`
- **Read Note:** `obsidian_read_note`
- **Write / Create Note:** `obsidian_write_note` — requires a non-empty `commit_message`; overwriting an existing note requires `expected_hash` from a prior read, or `force: true`
- **Edit Note:** `obsidian_edit_note` — SEARCH/REPLACE diff blocks, not JSON: `<<<<<<< SEARCH` + old text + `=======` + new text + `>>>>>>> REPLACE` (one block per change)
- **Delete / Move:** `obsidian_delete_note` (requires `confirm_path`), `obsidian_move_note` — write ops, available on `obsidian-full`
- **Frontmatter & Tags:** `obsidian_update_frontmatter`, `obsidian_manage_tags`
- **Backlinks & Health:** `obsidian_get_backlinks`, `obsidian_quick_health_check`

Operational rules:
- **Timestamps:** set `created` on create and refresh `updated` on every edit, in exactly `%Y-%m-%dT%H:%M:%S` (zero-padded local time, no milliseconds or timezone) via frontmatter.
- **Tags:** assign frontmatter `tags:` exclusively from canonical flat baseline: `pin`, `to-read`, `to-do`, `moc`, `python`, `stata`, `latex`, `linux`, `probability`, `econometrics`, `economics`, `math`. All `00_` notes require `moc`. Never use inline `#tags` in prose.
- **Git divergence guard:** a write can fail with "working-tree path differs from HEAD" (e.g. an external writer touched the note). Don't fight it — tell the user; commit or restore the change, then retry.
- If the `obsidian_*` tools are unavailable, stop and tell the user rather than touching vault files by other means.

## LLM Tone & Aesthetics
- Avoid generic LLM markers: no emdashes (`—`), no negative parallelisms ("not only X but Y"), no emojis.
- Write with analytical, quantitative precision suited for empirical economics research.
