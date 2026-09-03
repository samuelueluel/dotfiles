---
name: obsidian
description: Manage notes, documents, and folder organization in Samuel's Obsidian vault at ~/Dropbox/Sam-Obsidian-Vault/ using TurboVault MCP and the Hybrid Johnny.Decimal / PARA framework. Use when creating, reading, editing, moving, or organizing vault notes, filing literature, capturing memories, or structuring directories.
---

# Obsidian Vault Management

## Request-Routing Playbook

Before making any vault tool call, interpret the request as one of the following routes:

```text
REQUEST
├─ Known path or active working note? ─→ DIRECT READ: turbovault_read_note (inline)
├─ Topic / concept / description? ─────→ FAST SQL RESOLUTION: query_frontmatter_sql on 'files'
│                                        └─ resolved path → turbovault_read_note (inline)
├─ Broad full-text discovery? ────────→ DISCOVERY: delegate to research subagent (Tantivy BM25)
├─ Backlinks / graph traversal? ──────→ GRAPH: delegate to research subagent (get_backlinks)
├─ New note creation? ────────────────→ CREATE: frontmatter schema → closed palette → write_note
├─ Note edit / refactor? ─────────────→ EDIT: read_note (hash check) → edit_note (SEARCH/REPLACE)
└─ Save memory / scratchwork? ────────→ MEMORY: 02_Memories/<Topic-Slug>.md (append if exists)
```

## Mode 1: Retrieval & Search Guidelines

1. **Working-Set Direct Reads (Inline):** Call `turbovault_read_note` directly in the main session when the path is known or specified by Samuel.
2. **Topic / Description Lookup (Zero-Pollution SQL Resolution):** When Samuel asks to read or find a note by topic, keyword, or concept without a full path, **never call full-text content search**. Instead, query frontmatter metadata:
   ```sql
   SELECT path, description FROM files WHERE path LIKE '%<term>%' OR description LIKE '%<term>%' LIMIT 5;
   ```
   Resolve the exact relative path from the returned matches, then call `turbovault_read_note` inline. This eliminates intermediate context pollution and avoids reading incorrect files.
3. **Broad Discovery & Graph Traversal (Subagent Delegation):** In regular Pi, genuinely broad searches (`search`, `advanced_search`, `get_backlinks`, `get_related_notes`, `get_broken_links`) **must be delegated to a read-only `Explore` subagent** to prevent dumping large JSON payloads into the main session KV cache. In CPTR/headless mode (`PI_CPTR_HEADLESS=1`), subagents are unavailable; perform permitted discovery inline with a narrow query and bounded result set, then summarize.

## Mode 2: Writing & Mutation Invariants

- **TurboVault MCP Only:** All operations at `~/Dropbox/Sam-Obsidian-Vault/` **must** use `turbovault` MCP tools (via `mcp` or `mcp__turbovault`) with descriptive `commit_message` parameters. **Never run raw shell commands (`cat`, `grep`, `sed`, `find`, `ls`) on vault notes.**
- **Read-Before-Write:** Always check current content and hash before editing (`edit_note`) or overwriting (`write_note`).
- **Closed Color Palette (No Markdown Bolding):** Never use `**bold**`. Use `~={green}text=~` for active labels/terms (1–2 per paragraph) and `~={magenta}text=~` for genuine hazards/warnings.
- **Headings & Title Rule:** Filename serves as note title. Never repeat the filename or note title as an H1 heading (Obsidian renders it automatically). Start the note body directly at H1 (`#`) with the first content section (e.g., `# Overview`), and sub-sections at H2 (`## Detail`). Never alter or manually type heading numbers (managed by Obsidian Number Headings plugin); write plain text for new headings.
- **Lists & Indentation:** Never use 2-space indents for nested lists. Always use a **double indent (4 spaces)** for nested child items. Alternate list types when nesting (bullet `-` -> numbered `1.`, or vice versa) so Obsidian renders distinct visual hierarchy.
- **Frontmatter & Timestamps:** Always include YAML frontmatter. Set `created: YYYY-MM-DDTHH:MM:SS` (local time, no timezone) on creation; update `updated: YYYY-MM-DDTHH:MM:SS` on edits. Add a 1–2 sentence `description:` for `10_Projects/`, `20_Library/`, and `02_Memories/`.
- **Flat Tags (Frontmatter Only):** Use canonical flat lowercase tags (`pin`, `to-read`, `to-do`, `moc`, `python`, `stata`, `latex`, `linux`, `probability`, `econometrics`, `economics`, `math`). Never insert inline `#tags`. All `00_` hub notes require `moc`.
- **Preserve User Prefixes:** Never strip, rename, or alter user-applied sorting prefixes (`00_`, `01_`, `z_`).

## CPTR / Headless Limitations

- CPTR can perform permitted read-only TurboVault reads and discovery inline, but it cannot mutate vault notes. If `write_note`, `edit_note`, `move_note`, or another mutation is blocked, report that the change was not saved; never claim success.

## Mode 3: Agent Memories Protocol (`02_Memories/`)

- **Trigger:** When Samuel says *"remember this"* or *"save this"*.
- **Action:** Write to `02_Memories/<Topic-Slug>.md`. If a note on that topic already exists, append to it rather than creating a duplicate.
- **Status & Distillation:** Historical capture / scratchwork. When a lasting concept or procedural technique emerges, promote it to a permanent note in `10_Projects/` or a Skill reference in `~/.agents/skills/`.

## Progressive Disclosure & Reference Routing

- **MCP Tools, Mutations & Delegation:** Tool routing table, git divergence handling, and subagent search delegation $\to$ [references/turbovault-guide.md](references/turbovault-guide.md).
- **Taxonomy, Folders & Lifecycle:** Tier-1 folder matrix, subfolder conventions, project-to-archive movement $\to$ [references/hybrid-para-structure.md](references/hybrid-para-structure.md).
- **Formatting, Syntax & Schemas:** Color palette, list indentation, wikilinks, callouts, description field rules, and canonical tag baseline $\to$ [references/formatting-and-syntax.md](references/formatting-and-syntax.md).
