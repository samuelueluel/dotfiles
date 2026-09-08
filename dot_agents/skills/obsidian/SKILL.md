---
name: obsidian
description: Manage notes, documents, and folder organization in Samuel's Obsidian vault at ~/Dropbox/Sam-Obsidian-Vault/ using TurboVault MCP and the Hybrid Johnny.Decimal / PARA framework. Use when Samuel names Obsidian, the vault, or TurboVault, provides a vault path, says "remember this" or "save this", or asks to file, create, edit, move, or organize vault notes.
---

# Obsidian Vault Management

## Non-Negotiable Rules

- **Vault boundary:** Use only TurboVault MCP for operations inside `~/Dropbox/Sam-Obsidian-Vault/`. Never use raw filesystem or shell tools on vault notes.
- **Mutation safety:** Read current content and hash before editing or overwriting. Every mutation requires a descriptive `commit_message`.
- **Titles and prefixes:** The filename is the note title; never repeat it as an H1. Start the body at H1 with the first content section. Preserve existing plugin-generated heading numbers and all user-applied sorting prefixes (`00_`, `01_`, `z_`); create new headings without numbers.
- **Vault formatting:** Never use Markdown `**bold**` in notes. Use `~={green}text=~` for active labels or terms (1–2 per paragraph) and `~={magenta}text=~` only for genuine hazards. Indent nested lists by four spaces and alternate list types between levels.
- **Prose and tone:** Write for fast human scanning and reliable agent parsing. Use plain, direct English with high information density and natural professional flow. Never use LLM filler, throat-clearing, or buzzwords (such as "crucial", "delve", "testament", "vital", "it is important to note"). See [prose style guide](references/prose-style-guide.md).
- **Frontmatter:** Every note requires YAML frontmatter. Set `created: YYYY-MM-DDTHH:MM:SS` on creation and update `updated:` on edits, using local time without a timezone. Require a 1–2 sentence `description:` in `10_Projects/`, `20_Library/`, and `02_Memories/`.
- **Tags:** Keep flat lowercase tags in frontmatter only; never use inline `#tags`. Prefer `pin`, `to-read`, `to-do`, `moc`, `python`, `stata`, `latex`, `linux`, `probability`, `econometrics`, `economics`, and `math`. Every `00_` hub note requires `moc`.
- **CPTR/headless:** Read-only TurboVault operations are permitted, but blocked mutations were not saved and must never be reported as successful.

## Request-Routing Playbook

```text
REQUEST
├─ Known path or active note? ──────→ READ: turbovault_read_note
├─ Topic or description, no path? ─→ RESOLVE: query_frontmatter_sql
│                                      └─ unresolved → bounded content search
├─ Broad content discovery? ───────→ DISCOVERY: search / advanced_search / semantic_search
├─ Backlinks or graph traversal? ──→ GRAPH: backlinks / forward_links / related_notes
├─ New note? ──────────────────────→ CREATE: choose location → format → write_note
├─ Edit existing note? ────────────→ EDIT: read/hash → SEARCH/REPLACE → edit_note
├─ Move or rename? ────────────────→ MOVE: move_note or move_file
└─ “Remember/save this”? ──────────→ MEMORY: append-or-create in 02_Memories/
```

The tree is the sole intent router. Execution location follows the general delegation rules rather than the selected route.

## Retrieval Workflow

1. **Known path:** Read it directly in the main session using `turbovault_read_note`.
2. **Unknown path:** Start with a quick metadata lookup:
   ```sql
   SELECT path, description FROM files
   WHERE path LIKE '%<term>%' OR description LIKE '%<term>%'
   LIMIT 5;
   ```
   Read the resolved path directly. If metadata does not find it, use a narrow content search rather than guessing.
3. **Searching and Graph Lookups:** Keep small, focused searches in the main session. Use an `Explore` subagent only for a genuinely broad search that would clutter the chat context. In CPTR/headless mode, never use subagents; keep searches inline and narrow.

## Editing & Creating Notes

1. For filing, moving, or folder decisions, check [Hybrid PARA structure](references/hybrid-para-structure.md).
2. For writing notes or editing text, check [formatting and syntax](references/formatting-and-syntax.md), include the required frontmatter, and use TurboVault tools.
3. Follow the [prose style guide](references/prose-style-guide.md) for clear language, active voice, and high information density.
4. Use SEARCH/REPLACE blocks for edits. Preserve unrelated content, existing heading numbers, and folder prefixes.
5. If a write fails because the underlying git repository has diverged, read [TurboVault substrate guidance](references/turbovault-guide.md) before retrying.

## Saving Memories (`02_Memories/`)

When Samuel says "remember this" or "save this", run a quick metadata query to check for an existing note on that topic. Add to the existing note if appropriate; otherwise create `02_Memories/<Topic-Slug>.md`. Treat memory notes as historical records or scratchpads whose factual claims may need checking.

## Reference Guides

- If writing note content, headings, colors, lists, wikilinks, callouts, frontmatter, descriptions, or tags: read [formatting and syntax](references/formatting-and-syntax.md).
- If drafting or editing note text, choosing words, avoiding LLM buzzwords, or balancing information density: read [prose style guide](references/prose-style-guide.md).
- If filing, organizing, naming, archiving, or picking a folder: read [Hybrid PARA structure](references/hybrid-para-structure.md).
- If handling git repository errors or deciding whether a search needs an Explore subagent: read [TurboVault substrate guidance](references/turbovault-guide.md).
