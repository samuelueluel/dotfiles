---
name: obsidian
description: Manage notes, documents, and folder organization in Samuel's Obsidian vault at ~/Dropbox/Sam-Obsidian-Vault/ using TurboVault MCP and the Hybrid Johnny.Decimal / PARA framework. Use when creating, reading, editing, moving, or organizing vault notes, filing literature, capturing memories, or structuring directories.
---

# Obsidian Vault

## Quick start

When creating or updating notes in `~/Dropbox/Sam-Obsidian-Vault/`:
* **Tooling:** Always use `turbovault_*` MCP tools with descriptive `commit_message` parameters.
* **Naming:** `Title-Case-With-Hyphens.md` (no spaces/symbols). Literature: `Author-Year-Slug.md`. Memories/Logs: `Topic-Slug.md` or `YYYY-MM-DD-slug.md`.
* **Title:** Filename serves as note title. Start note body directly at `H1` (`#`).
* **Description:** 1–2 sentence frontmatter `description:` for `10_Projects/`, `20_Library/`, and `02_Memories/` (omit for `00_`, `01_`, `30_`).
* **Emphasis:** No standard bolding (`**bold**`). Use `~={green}active/labels=~` and `~={magenta}warnings=~`.

---

## Workflows

### 1. Determining Target Folder (Hybrid PARA)
1. **Identify note purpose:**
   * `00_Inbox/`: Transient / raw captures to triage later.
   * `01_Todo/`: Short-term actionable tasks (`Todo.md`, `Buy.md`, `Remember.md`).
   * `02_Memories/`: Agnostic agent memories, system setups, benchmarks, and workflows.
   * `10_Projects/<Project-Name>/`: Active, deadline-driven work (`Paper-Detroit`, `Custom-Image`). Moves to `90_Archive/` on completion.
   * `20_Library/<Topic>/`: Permanent reference material, academic literature (`Modern-DiD-Lit`, `New-Econometric-Lit`), theory.
   * `30_Personal/<Area>/`: Indefinite life domains (`Personal-Admin`, `Personal-Interests`, `Family`).
   * `90_Archive/`: Completed projects, retired configs, past applications.
   * `98_Bases/` & `99_System/`: Dataview bases, templates, binary attachments (`Z_Attachments/`).
2. **Subfolder Naming:** Use clean semantic `Title-Case-With-Hyphens` for agent-created subfolders.
3. **Manual Prefix Exception:** Samuel personally manages prefixes (e.g., `00_`, `01_`, `z_`) to force sorting. Never strip, rename, or alter user-applied prefixes.

### 2. Note Creation & Mutation Checklist
- [ ] Determine correct folder bucket before creating note.
- [ ] Use `turbovault_write_note` (or `turbovault_batch_execute`) with non-empty `commit_message`.
- [ ] Set frontmatter `created` timestamp on create; refresh `updated` timestamp on edit (`YYYY-MM-DDTHH:MM:SS`).
- [ ] Add 1–2 sentence `description:` for `10_Projects/`, `20_Library/`, and `02_Memories/` (omit for `00_`, `01_`, `30_`).
- [ ] Assign relevant frontmatter `tags:` from canonical baseline when appropriate (`pin`, `to-read`, `to-do`, `moc`, `python`, `stata`, `latex`, `linux`, `probability`, `econometrics`, `economics`, `math`). All `00_` notes require `moc`. Tags are optional if none apply cleanly. No inline `#tags`.
- [ ] Keep headings plain text for compatibility with the Obsidian Number Headings plugin; never alter existing heading numbers.
- [ ] Strictly use closed color palette: `~={green}text=~` (labels/emphasis) and `~={magenta}text=~` (hazards). No standard bolding (`**bold**`).

### 3. Agent Memories Protocol
* **Capture:** When Samuel says *"remember this"* or *"save this"*, write to `02_Memories/<Topic-Slug>.md`. If a note on that topic exists, append to it rather than creating a duplicate.
* **Epistemic Status:** Notes in `02_Memories/` are historical scratchwork and captures; verify against current system state and do not treat as immutable ground truth.

---

## Advanced features

* **Taxonomy, Lifecycle & Folder Matrix:** If you need detailed folder placement rules, project-to-archive transition workflows, or naming rules, see [references/hybrid-para-structure.md](references/hybrid-para-structure.md).
* **Formatting, Headings & Syntax:** If writing complex content, configuring callouts, nesting lists, or styling note bodies, see [references/formatting-and-syntax.md](references/formatting-and-syntax.md).
* **TurboVault MCP Tools & Context Hygiene:** For tool routing, git-substrate divergence recovery, or subagent discovery delegation rules, see [references/turbovault-guide.md](references/turbovault-guide.md).
