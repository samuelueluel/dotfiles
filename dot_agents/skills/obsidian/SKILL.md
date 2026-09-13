---
name: obsidian
description: Manages notes, documents, folder organization, and TurboVault-backed lexical, dense, and hybrid retrieval in Samuel's Obsidian vault at ~/Dropbox/Sam-Obsidian-Vault/ using the Hybrid Johnny.Decimal / PARA framework. Use it when Samuel mentions Obsidian, the vault, TurboVault, a vault path, "remember" or "save", or asks to search semantically, reindex embeddings, inspect embedding status, or configure hybrid retrieval.
---

# Obsidian Vault Management

## Request-Routing Playbook

```text
REQUEST
├─ Known path or active note? ──────→ READ: turbovault_read_note
├─ Topic or description, no path? ─→ RESOLVE: turbovault_query_frontmatter_sql
│                                      └─ unresolved → bounded content search
├─ Exact words, identifiers, filenames, or citations? ─→ DISCOVERY: turbovault_search / turbovault_advanced_search
├─ Conceptual or paraphrase-heavy question? ───────────→ HYBRID: status → turbovault_hybrid_search
│  ├─ Dense-only requested ────────────────────────────→ DENSE: turbovault_embedding_search
│  └─ Index missing or stale ──────────────────────────→ STATUS: turbovault_embedding_index_status → offer reindex
├─ Embedding status, setup, or maintenance? ───────────→ MAINTENANCE: turbovault_embedding_index_status / turbovault_reindex_embeddings
├─ Broad content discovery? ──────────────────────────→ DISCOVERY: search / advanced_search / semantic_search
├─ Backlinks or graph traversal? ──────────────────────→ GRAPH: backlinks / forward_links / related_notes
├─ New note? ──────────────────────────────────────────→ CREATE: choose location → format → write_note
├─ Edit existing note? ────────────────────────────────→ EDIT: read/hash → SEARCH/REPLACE → edit_note
├─ Move or rename? ────────────────────────────────────→ MOVE: move_note or move_file
└─ “Remember/save this”? ──────────────────────────────→ MEMORY: append-or-create in 02_Memories/
```

The tree is the sole intent router. Execution location follows the general delegation rules rather than the selected route.

## Non-Negotiable Rules

- **Vault boundary:** Use only TurboVault MCP for operations inside `~/Dropbox/Sam-Obsidian-Vault/`. Never use raw filesystem or shell tools on vault notes.
- **Mutation safety:** Read current content and hash before editing or overwriting. Every mutation requires a descriptive `commit_message`.
- **Search preservation:** Keep `turbovault_search`, `turbovault_advanced_search`, `semantic_search`, SQL, graph, and write tools available. Dense retrieval adds a route; it does not replace exact or deterministic search.
- **Dense lifecycle:** Treat embeddings as optional derived state. Check `turbovault_embedding_index_status` before relying on dense results, and never run a full reindex after every note read or write.
- **Embedding privacy:** Keep API keys in the TurboVault process environment, never in notes or committed configuration. Warn that the configured endpoint receives note chunks and queries.
- **Titles and prefixes:** The filename is the note title; never repeat it as an H1. Start the body at H1 with the first content section. Preserve existing plugin-generated heading numbers and all user-applied sorting prefixes (`00_`, `01_`, `z_`); create new headings without numbers.
- **Vault formatting:** Never use Markdown `**bold**` in notes. Use `~={green}text=~` for active labels or terms (1–2 per paragraph) and `~={magenta}text=~` only for genuine hazards. Indent nested lists by four spaces and alternate list types between levels.
- **Prose and tone:** Write for fast human scanning and reliable agent parsing. Use plain, direct English with high information density and natural professional flow. Never use LLM filler, throat-clearing, or buzzwords (such as "crucial", "delve", "testament", "vital", "it is important to note"). For prose guidance, load [prose style guide](references/prose-style-guide.md).
- **Frontmatter:** Every note requires YAML frontmatter. Set `created: YYYY-MM-DDTHH:MM:SS` on creation and update `updated:` on edits, using local time without a timezone. Require a 1–2 sentence `description:` in `10_Projects/`, `20_Library/`, and `02_Memories/`.
- **Tags:** Keep flat lowercase tags in frontmatter only; never use inline `#tags`. Prefer `pin`, `to-read`, `to-do`, `moc`, `python`, `stata`, `latex`, `linux`, `probability`, `econometrics`, `economics`, and `math`. Every `00_` hub note requires `moc`.

## Retrieval Workflow

1. **Known path:** Read it directly in the main session using `turbovault_read_note`.
2. **Unknown path:** Start with a quick metadata lookup:
   ```sql
   SELECT path, description FROM files
   WHERE path LIKE '%<term>%' OR description LIKE '%<term>%'
   LIMIT 5;
   ```
   Read the resolved path directly. If metadata does not find it, use a narrow content search rather than guessing.
3. **Choose the retrieval route:** Use `turbovault_search` or `turbovault_advanced_search` for exact terms, identifiers, filenames, equations, citations, or filters. Use `turbovault_hybrid_search` for conceptual questions and paraphrases. Use `turbovault_embedding_search` only when dense-only retrieval is requested or useful for diagnosis. Use the existing `semantic_search` when whole-note TF-IDF similarity is specifically wanted.
4. **Check dense readiness:** Before dense or hybrid retrieval, call `turbovault_embedding_index_status`. If `exists` is false or `stale` is true, do not present dense results as available. If the endpoint is configured and the user wants semantic retrieval, offer `turbovault_reindex_embeddings`; otherwise answer with lexical search and state the limitation.
5. **Read sources after discovery:** Dense and hybrid results identify candidate chunks. Read the returned note paths with `turbovault_read_note` before making claims that require full-note context.
6. **Searching and graph lookups:** Keep small, focused searches in the main session. Use an `Explore` subagent only for a genuinely broad search that would clutter the chat context. In CPTR/headless mode, never use subagents; keep permitted discovery inline with narrow queries and bounded results.

## Dense Index Lifecycle

- **Initial setup:** Configure the embedding endpoint in the TurboVault server environment, call `turbovault_embedding_index_status`, then call `turbovault_reindex_embeddings` once.
- **Normal use:** Call `turbovault_hybrid_search` for conceptual retrieval. Do not reindex on every query.
- **After changes:** Vault mutations mark the derived index stale. Batch note changes, then reindex when semantic retrieval is needed. Reindex after changing the endpoint, model, vector dimension, chunking settings, or after a large external vault update.
- **Failure behavior:** If the endpoint is unavailable or the index is stale, use lexical search. Dense tools fail closed; they do not silently downgrade and should not be described as having returned dense evidence.
- **Source boundary:** The index lives outside the vault. Read source notes after retrieval, and never place generated vectors or API keys in vault notes.

## Editing & Creating Notes

1. For filing, moving, or folder decisions, check [Hybrid PARA structure](references/hybrid-para-structure.md).
2. For writing notes or editing text, check [formatting and syntax](references/formatting-and-syntax.md), include the required frontmatter, and use TurboVault tools.
3. Follow the [prose style guide](references/prose-style-guide.md) for clear language, active voice, and high information density.
4. Use SEARCH/REPLACE blocks for edits. Preserve unrelated content, existing heading numbers, and folder prefixes.
5. A note mutation marks the dense index stale automatically; do not run a full reindex after every write.
6. If a write fails because the underlying git repository has diverged, read [TurboVault substrate guidance](references/turbovault-guide.md) before retrying.

## Saving Memories (`02_Memories/`)

When Samuel says "remember this" or "save this", run a quick metadata query to check for an existing note on that topic. Add to the existing note if appropriate; otherwise create `02_Memories/<Topic-Slug>.md`. Treat memory notes as historical records or scratchpads whose factual claims may need checking.

## Progressive Disclosure & Reference Routing

- If writing note content, headings, colors, lists, wikilinks, callouts, frontmatter, descriptions, or tags, load [formatting and syntax](references/formatting-and-syntax.md).
- If drafting or editing note text, choosing words, avoiding LLM buzzwords, or balancing information density, load [prose style guide](references/prose-style-guide.md).
- If filing, organizing, naming, archiving, or picking a folder, load [Hybrid PARA structure](references/hybrid-para-structure.md).
- If a vault mutation reports git-substrate divergence, or a discovery task may be broad enough to need an Explore agent, load [TurboVault substrate guidance](references/turbovault-guide.md).
