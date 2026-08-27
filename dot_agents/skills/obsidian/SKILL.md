---
name: obsidian
description: Manage notes, documents, and folder organization in Samuel's Obsidian vault at ~/Dropbox/Sam-Obsidian-Vault/ using TurboVault MCP and the Hybrid Johnny.Decimal / PARA framework. Use when creating, reading, editing, moving, or organizing vault notes, filing literature, capturing memories, or structuring directories.
---

# Obsidian Vault Management

## Core Operating Rules & Invariants

- **TurboVault MCP Only:** All vault operations at `~/Dropbox/Sam-Obsidian-Vault/` **must** use `turbovault` MCP tools with descriptive `commit_message` parameters. **Never use raw shell commands (`cat`, `grep`, `sed`, `find`, `ls`) on vault notes.**
- **Context Hygiene & Subagent Delegation:**
  - **Discovery (Search / Backlinks / SQL / Graph):** Delegate result-set operations (`turbovault_search`, `turbovault_query_frontmatter_sql`, `get_backlinks`, etc.) to `invoke_subagent` (`TypeName: "research"`) to protect main KV cache.
  - **Working-Set Reads:** `turbovault_read_note` on known paths stays **inline in the main session**.
- **Note Naming:** `Title-Case-With-Hyphens.md` (no spaces/symbols). Literature: `Author-Year-Slug.md`. Logs/Memories: `Topic-Slug.md` or `YYYY-MM-DD-slug.md`.
- **Headings & Numbering:** Filename serves as note title. Start note body directly at `H1` (`#`). **Never alter or remove existing heading numbers** (managed by Obsidian Number Headings plugin); write plain text for new headings.
- **Closed Color Palette (No Markdown Bolding):** Never use `**bold**`. Use `~={green}text=~` for active labels/terms (1–2 per paragraph) and `~={magenta}text=~` for genuine hazards/warnings.
- **Frontmatter & Timestamps:** Always include YAML frontmatter. Set `created` on note creation, refresh `updated` on edit (`YYYY-MM-DDTHH:MM:SS`). Add a 1–2 sentence `description:` for `10_Projects/`, `20_Library/`, and `02_Memories/`.
- **Flat Tags (Frontmatter Only):** Use canonical flat lowercase tags (`pin`, `to-read`, `to-do`, `moc`, `python`, `stata`, `latex`, `linux`, `probability`, `econometrics`, `economics`, `math`). Never insert inline `#tags`. All `00_` hub notes require `moc`.
- **Preserve User Prefixes:** Samuel manually assigns prefixes (e.g., `00_`, `01_`, `z_`) to control sorting. **Never strip, rename, or alter user-applied prefixes.**

## Agent Memories Protocol (`02_Memories/`)

- **Trigger:** When Samuel says *"remember this"* or *"save this"*.
- **Action:** Write to `02_Memories/<Topic-Slug>.md`. If a note on that topic already exists, append to it rather than creating a duplicate.
- **Status:** Historical capture / scratchwork; verify against current system state and do not treat as immutable ground truth.

## Progressive Disclosure & Reference Routing

- **MCP Tools, Mutations & Delegation:** Tool routing table, git divergence handling, and subagent search delegation $\to$ [references/turbovault-guide.md](references/turbovault-guide.md).
- **Taxonomy, Folders & Lifecycle:** Tier-1 folder matrix, subfolder conventions, project-to-archive movement $\to$ [references/hybrid-para-structure.md](references/hybrid-para-structure.md).
- **Formatting, Syntax & Schemas:** Color palette, list indentation, wikilinks, callouts, description field rules, and canonical tag baseline $\to$ [references/formatting-and-syntax.md](references/formatting-and-syntax.md).
