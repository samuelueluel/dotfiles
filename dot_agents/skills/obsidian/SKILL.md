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

1. **Known path:** Read it directly in the main session.
2. **Unknown path:** Start with a cheap metadata lookup, normally:
   ```sql
   SELECT path, description FROM files
   WHERE path LIKE '%<term>%' OR description LIKE '%<term>%'
   LIMIT 5;
   ```
   Read the resolved path directly. If metadata does not resolve the request, use a bounded content search rather than guessing.
3. **Discovery and graph work:** Keep small bounded searches inline. Use an `Explore` agent only for a genuinely broad unknown result set when the general delegation gate is satisfied. In CPTR/headless mode, keep permitted discovery inline and bounded.

## Mutation Workflow

1. For filing, moving, or lifecycle decisions, load [Hybrid PARA structure](references/hybrid-para-structure.md).
2. For note creation or prose edits, load [formatting and syntax](references/formatting-and-syntax.md), apply the required frontmatter, and use TurboVault mutation tools.
3. Use structured SEARCH/REPLACE for edits. Preserve unrelated content, existing heading numbers, and user prefixes.
4. If the git substrate rejects a mutation because the working tree diverged, load [TurboVault substrate guidance](references/turbovault-guide.md) before retrying.

## Agent Memories (`02_Memories/`)

When Samuel says “remember this” or “save this,” run one cheap metadata query for an existing topic-matching note. Append when appropriate; otherwise create `02_Memories/<Topic-Slug>.md`. Treat memory notes as historical captures or scratchwork whose current factual claims may need verification.

## Progressive Disclosure and Reference Routing

- If writing note content or handling headings, colors, lists, wikilinks, callouts, frontmatter, descriptions, or tags, load [formatting and syntax](references/formatting-and-syntax.md).
- If filing, organizing, naming, archiving, or choosing a folder, load [Hybrid PARA structure](references/hybrid-para-structure.md).
- If handling git-substrate divergence or deciding whether broad discovery belongs inline or in Explore, load [TurboVault substrate guidance](references/turbovault-guide.md).
