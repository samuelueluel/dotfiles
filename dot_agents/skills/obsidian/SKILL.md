---
name: obsidian
description: Manages notes, retrieval, and source-grounded answers in Samuel's Obsidian vault at ~/Dropbox/Sam-Obsidian-Vault/ using TurboVault and the Hybrid Johnny.Decimal / PARA framework. Use when Samuel mentions Obsidian, the vault, TurboVault, a vault path, "remember" or "save", asks a question based on vault notes, or requests embedding maintenance.
---

# Obsidian Vault Management

## Request-Routing Playbook

```text
REQUEST
├─ Known path or active note? ───────────────────────→ READ: turbovault_read_note
├─ Topic or description, no path? ───────────────────→ RESOLVE: turbovault_query_frontmatter_sql
│                                                       └─ unresolved → bounded content search
├─ Exact words, identifiers, filenames, citations? ──→ LEXICAL: turbovault_search / turbovault_advanced_search
├─ Conceptual or natural-language question? ────────→ NEURAL RAG: turbovault_semantic_search
│                                                       └─ results stale or missing → turbovault_embedding_index_status / reindex
├─ Embedding status, setup, or maintenance? ─────────→ MAINTENANCE: turbovault_embedding_index_status / turbovault_reindex_embeddings
├─ Backlinks or graph traversal? ────────────────────→ GRAPH: backlinks / forward_links / related_notes
├─ New note? ────────────────────────────────────────→ CREATE: choose location → format → write_note
├─ Edit existing note? ──────────────────────────────→ EDIT: read/hash → SEARCH/REPLACE → edit_note
├─ Move or rename? ──────────────────────────────────→ MOVE: move_note or move_file
└─ “Remember/save this”? ────────────────────────────→ MEMORY: append-or-create in 02_Memories/
```

The tree is the sole intent router. Execution location follows the general delegation rules rather than the selected route. Every read or search route that produces a vault-grounded answer also follows the Evidence Contract below.

## Non-Negotiable Rules

- **Vault boundary:** Use only TurboVault MCP for operations inside `~/Dropbox/Sam-Obsidian-Vault/`. Never use raw filesystem or shell tools on vault notes.
- **Mutation safety:** Read current content and hash before editing or overwriting. Every mutation requires a descriptive `commit_message`.
- **Search preservation:** Keep `turbovault_search`, `turbovault_advanced_search`, `turbovault_semantic_search`, `turbovault_read_passage`, SQL, graph, and write tools available. `turbovault_semantic_search` unifies BM25 sparse search, Qwen3 dense embeddings, and BGE cross-encoder reranking; `turbovault_search` provides pure exact lexical search.
- **Dense lifecycle:** Treat embeddings as derived state. Reindexing runs in the background and reuses unchanged vectors. Call `turbovault_semantic_search` directly for queries; check `turbovault_embedding_index_status` during maintenance or if a warning reports a failed refresh, and never reindex on routine note reads.
- **Embedding privacy:** Keep API keys in the TurboVault process environment, never in notes or committed configuration. Warn that the configured endpoint receives note chunks and queries.
- **Titles and prefixes:** The filename is the note title; never repeat it as an H1. Start the body at H1 with the first content section. Preserve existing plugin-generated heading numbers and all user-applied sorting prefixes (`00_`, `01_`, `z_`); create new headings without numbers.
- **Vault formatting:** Never use Markdown `**bold**` in notes. Use `~={green}text=~` for active labels or terms (1–2 per paragraph) and `~={magenta}text=~` only for genuine hazards. Indent nested lists by four spaces and alternate list types between levels.
- **Prose and tone:** Write for fast human scanning and reliable agent parsing. Use plain, direct English with high information density and natural professional flow. Never use LLM filler, throat-clearing, or buzzwords (such as "crucial", "delve", "testament", "vital", "it is important to note"). For prose guidance, load [prose style guide](references/prose-style-guide.md).
- **Frontmatter:** Every note requires YAML frontmatter. Set `created: YYYY-MM-DDTHH:MM:SS` on creation and update `updated:` on edits, using local time without a timezone. Require a 1–2 sentence `description:` in `10_Projects/`, `20_Library/`, and `02_Memories/`.
- **Tags:** Keep flat lowercase tags in frontmatter only; never use inline `#tags`. Prefer `pin`, `to-read`, `to-do`, `moc`, `python`, `stata`, `latex`, `linux`, `probability`, `econometrics`, `economics`, and `math`. Every `00_` hub note requires `moc`.

## Retrieval Workflow

1. **Known path:** Read it directly in the main session using `turbovault_read_note`.
2. **Unknown path (metadata lookup):** Start with `turbovault_query_frontmatter_sql({ sql: "..." })` (parameter key is `sql`, not `query`):
   ```sql
   SELECT path, description FROM files
   WHERE path LIKE '%<term>%' OR COALESCE(description, '') LIKE '%<term>%'
   LIMIT 5;
   ```
   (Wrap nullable columns in `COALESCE`—GlueSQL fails on `Null LIKE Str`). Read the resolved path directly. If metadata does not find it, proceed to content search.
3. **Choose the retrieval route:**
   - **Exact lexical search:** Use `turbovault_search` or `turbovault_advanced_search` for literal strings, exact identifiers, known filenames, equations, citations, or field filters.
   - **Conceptual & natural-language queries:** Use `turbovault_semantic_search` for natural-language questions ("what is my dad's birthday?", "how is X set up?"), thematic overviews, and paraphrases. It unifies BM25 sparse search, Qwen3 dense vectors, and BGE cross-encoder reranking in a single call.
4. **Fallback & dense readiness:** TurboVault automatically falls back to sparse BM25 if the embedding (:8082) or reranker (:8083) sidecar is offline. When that happens the response carries an explicit `warnings` entry naming the cause, plus `meta.retrieval` with the same detail per channel — relay those to Samuel rather than inferring degradation from null scores. Only call `turbovault_embedding_index_status` when a warning says a refresh failed, or during maintenance.
5. **Read sources after discovery:** Neural RAG returns candidate chunks with provenance (`path#chunk_id`) and, when indexed, `chunk_hash`. If a hit needs more context, call `turbovault_read_passage` with `path`, `chunk_id`, and `expected_hash=chunk_hash` for bounded same-section neighbors. It reads stored index text without new ranking. Then use `turbovault_read_note` for current Markdown context before consequential claims. Sparse-only hits may have no chunk ID; read their note directly.
6. **Searching and graph lookups:** Keep small, focused searches in the main session. Use an `Explore` subagent only for a genuinely broad search that would clutter the chat context. In CPTR/headless mode, never use subagents; keep permitted discovery inline with narrow queries and bounded results.

## Evidence Contract for Vault Answers

Vault notes are Samuel's working records, not independent proof of current laws, prices, hours, or software state. This contract governs answers drawn from notes; the vault formatting rules above govern text written into notes.

### Check the source

- Treat search hits, titles, descriptions, backlinks, and similarity scores as discovery, not proof of a substantive claim. Read the note or an exact indexed passage before attributing a claim to it. A heading or clipped preview cannot support details it does not show.
- `read_passage` reopens an exact stored anchor and optional same-section neighbors. Each chunk has its own ID and heading; neighbors inherit no score. Respect `truncated` and any stale-index warning. The passage hash verifies indexed text, not the note's current content.
- For consequential claims, use `turbovault_read_note` to check the current Markdown note's relevant section, exceptions, and whether it describes a proposal or completed work. Check for later notes that supersede it when chronology matters. A PDF or DOCX result is extracted text, not a visually verified page; do not claim to have inspected layout, images, or omitted pages.
- Say what the note records, not what is verified now. If Samuel needs current prices, hours, eligibility, deadlines, legal rules, or software state, check an authoritative current source or qualify the claim as "the note lists ...". Do not treat a failed search as proof that no note exists.
- Never use one note's link to support a claim found only in another. If notes disagree, identify each note's account instead of silently combining them. Qualify unsupported claims, mark them `UNVERIFIED`, or omit them.

### Attribute claims in the answer

- Put a `[^oN]` footnote immediately after each material vault-grounded claim or a tightly related group from the same section. Change markers when the supporting note or section changes. Explain which note supplies which information, especially in comparisons.
- Finish with one `### Evidence` block containing only cited entries. Give the note title, the vault-relative path, and the section actually read. When `read_note` returns a `uri`, copy that URI into a Markdown link to the note. Keep a readable path and section as a fallback. For example, if the returned URI matches the example path:

  ```markdown
  The example note says to calibrate the blue widget before testing.[^o1]

  ### Evidence
  [^o1]: [Example-Note](obsidian://open?vault=personal&file=20_Library%2FExample-Note), § Widget setup; `20_Library/Example-Note.md`.
  ```

- Obsidian URIs are **note-level**, not heading links. Do not invent a `#heading` URI or a PDF/DOCX link, or promise that every chat client will open `obsidian://`. The link identifies where the claim came from; it does not establish that the claim is true or current.
- For a short inventory, a linked "Source note / section" column can replace footnotes per row. A metadata-only path list needs no evidence footnote if its scope is clear.
- If an answer also uses Zotero or web sources, apply each source's own evidence rules and combine all cited definitions in one final Evidence block (`[^oN]`, `[^cN]`, `[^wN]`). Never use Zotero claim-audit tools to certify vault claims. Do not present hashes or retrieval scores as corroboration.

## Dense Index Lifecycle

- **Initial setup:** Configure the embedding endpoint in the TurboVault server environment, call `turbovault_embedding_index_status`, then call `turbovault_reindex_embeddings` once.
- **Normal use:** Call `turbovault_semantic_search` for conceptual retrieval. It reports `sparse_score`, `dense_score`, `rrf_score`, and `rerank_score`. Do not reindex on every query.
- **Reading the response:** A healthy search carries no `warnings` and returns only the results. Any degraded search adds a `warnings` sentence stating which channel was missing and why, with the same detail in `meta.retrieval` (`dense_unavailable`, `sparse_unavailable`, `rerank_unavailable`, `index_stale`, `index_refreshed`, `refresh_failed`). Report those verbatim; do not paraphrase them into "search worked".
- **Incremental reindexing:** Updates compare note content hashes against `index.bin` and embed only new or modified chunks. `turbovault_reindex_embeddings` starts a background job; use `turbovault_embedding_index_status` to see progress or failures. If the start call times out, check status before retrying. Never launch overlapping builds. Full rebuilds occur after cache wipes, model changes, or chunker configuration updates.
- **After changes:** Vault mutations mark the derived index stale, and `turbovault_semantic_search` refreshes it automatically once it is more than six hours old. Do not run `turbovault_reindex_embeddings` by hand after edits; it is only needed after a model or chunker change, or if a warning reports a failed refresh.
- **Sidecar degradation:** If the embedding or reranker sidecar is offline, `turbovault_semantic_search` continues operating by falling back to sparse candidates rather than erroring out. Dense retrieval also requires the embedder for the *query*, so an offline embedder means sparse-only results regardless of index freshness. Always report the `warnings` entry that names the cause.
- **Source boundary:** The index lives outside the vault in `~/.cache/turbovault/embeddings/`. Read source notes after retrieval, and never place generated vectors or API keys in vault notes.

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
- If a vault mutation reports git-substrate divergence, a background index build fails or stops progressing, or a discovery task may be broad enough to need an Explore agent, load [TurboVault substrate guidance](references/turbovault-guide.md).
