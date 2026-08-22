---
name: citation-integrity
description: "Enforce citation-integrity discipline for ANY claim grounded in Samuel's local Zotero RAG stack — every answer that asserts what a source says, a finding, number, definition, mechanism, or comparison — in casual chat as much as in manuscript drafts. Passage claims cite a retrieved passage (author, year, passage N/M, page) with numbers verified against passage text; structural claims cite the deterministic citation-graph tools (get_collection_hubs, get_paper_lineage, find_connected_papers); confidence gated on the Rerank score for passage claims; cross-paper comparisons stay isolated per paper; \"no evidence found\" is a complete answer. Metadata-only lookups (title, author, year, item key, tags, collection, attachment status) are API facts: accurate or verified, no brace token, but never fabricated."
---

# Citation-Integrity Discipline

Grounding discipline for research answers built on the local Zotero RAG stack.
Purpose: convert retrieval quality into manuscript-grade reliability. The 2026
literature puts LLM citation accuracy at ~74% (CiteFix, ACL 2025; FACTUM) —
this skill is the contract that keeps the agent's claims traceable to evidence
it actually retrieved.

## Scope — applies to ALL Zotero-grounded claims

- Every assertion about library **content** — findings, estimates, definitions,
  mechanisms, "what X says", comparisons — carries the citation contract, in
  casual chat as much as in manuscript drafts. There is no "casual" exemption.
- **Metadata facts** (title, author, year, item key, tags, collection
  membership, attachment status, existence) come straight from the Zotero API /
  local DB. They are API facts: state them accurately or verify them; no brace
  token is needed, but the honesty rule (rule 6) always applies — never
  fabricate a title, year, key, or collection.
- "Use multisource" (the multisource skill) changes presentation structure
  only; it never relaxes this discipline.

The stack has **two retrieval layers**, each with its own citation contract:

- **Passage RAG** (`semantic_search`): hybrid dense + BM25 with cross-encoder
  reranking over MinerU sidecar chunks. Produces *passage claims*.
- **Deterministic citation graph** (`get_collection_hubs`, `get_paper_lineage`,
  `find_connected_papers`): ground-truth directed edges extracted from Zotero
  metadata + `[REF]` sections — zero LLM entity extraction (this is *not*
  GraphRAG; edges are deterministic, so the integrity risk is completeness and
  matching quality, not hallucination). Produces *structural claims*.

Complementary skills: `zotero` (tool usage, library ops), `obsidian` (vault).

## The rules (in order of precedence)

1. **Grounding — passage claims.** Every substantive finding, number, or
   mechanism must cite the passage it came from in a brace token:
   `{Author (Year), passage N/M, p. X if available, Rerank <score>}` — e.g.
   `{Stacy 2018, passage 27/40, Rerank +3.22}`. "From memory"
   citations are prohibited, even for famous results. The DCR prefix imprints
   `[Paper: <title> (<author> <year>) | Section: <breadcrumb>]` on every chunk,
   so Author (Year) is chunk-native — not enrichment-dependent. If enrichment
   fails (Zotero desktop/API down) and a chunk lacks author/year, grep the
   sidecar (see `zotero` skill, `references/deep-dive-reading.md`) before
   citing, or say attribution is unavailable.

2. **Grounding — structural claims.** Claims about the literature *structure*
   ("X is the anchor of this collection", "Y builds on Z", "A and B are related
   work") come from the citation-graph tools. Cite the tool and its returned
   measure in the same brace shape: `{get_collection_hubs → hub #1, 47 inward
   citations}`, or `{get_paper_lineage → depth-1 ancestor of X}`. Never dress a
   graph fact as a passage quote, and never present a graph count (hub rank,
   inward-citation total, shared-citation count) as an empirical estimate.

3. **Number verification** — before citing ANY empirical number (coefficient,
   elasticity, percentage, dollar figure), confirm it appears in the retrieved
   passage text verbatim or in provably equivalent form. If it is not in the
   passage, fetch the full text (`zotero_zotero_get_item_fulltext`) or grep the
   sidecar and locate it. If it cannot be located: drop the claim or mark it
   `UNVERIFIED`. When the retrieved number disagrees with what you "know", the
   passage wins. Graph counts (inward citations, hub rank, shared citations)
   are verified against the graph tool's own output — re-running the tool is
   the verification; they are not verified against a passage.

4. **Confidence gating** — use the search scores:
   - `Rerank` (raw cross-encoder score): **positive = confident**; −2..−3 =
     weak; ≲ −4 = junk (calibrated on bge-reranker-v2-m3 via llama.cpp).
     Claims grounded in a negative-rerank passage must be flagged
     `weak evidence` or excluded.
   - `Relevance` (1 − dense distance) alone is NOT sufficient — a BM25-rescued
     chunk can carry a real rescue score while still being a marginal match;
     the Rerank score is the calibrated judge.
   - Graph claims carry no Rerank score: their confidence is graph
     *completeness* (sidecar freshness, metadata-matching quality, `[REF]`
     coverage). Flag a stale-index caveat instead of inventing a score.
   - Figure-probe schema chunks carry a `figure_boost` on figure queries — their
     rerank score is inflated; treat schema YAML as a *discovery beacon*, and
     verify any claim against the caption/prose in the same chunk, never the
     schema alone.

5. **Cross-paper isolation** — when synthesizing across papers ("Stacy finds
   6.7%, Sandler finds …"), each number must trace to its OWN paper's passage.
   Never combine passages from different papers into one citation, and never
   let one paper's number ride on another's citation. Applies to graph claims
   too: a hub rank or edge count belongs to the single paper the graph tool
   returned it for.

6. **Honesty** — "no evidence found in the library" is a complete, acceptable
   answer. Never fabricate a passage reference, page number, chunk index, graph
   edge, hub rank, or citation count. If the top hit is weak (negative Rerank,
   or relevance ≈ 0), say the match is weak rather than presenting it as found.
   If a graph tool returns empty or errors, say so.

## Workflow

1. **Route by question shape** (see `zotero` skill, `references/search-retrieval.md`):
   - Structure questions ("what's foundational here?", "what does X build on?",
     "related work?") → graph tools (`get_collection_hubs`,
     `get_paper_lineage`, `find_connected_papers`).
   - Evidence/number questions → `zotero_zotero_semantic_search` (scope with
     `collection` when the project is collection-based; default `limit` 5-8).
   - Broad literature synthesis → **two-stage**: graph first to identify anchor
     papers, then targeted `semantic_search` on those exact keys for empirical
     claims. Cite each stage in its own form (structural vs. passage).
2. Read the `Matched Passage` of the top hits; use `Rerank` + `Relevance` to
   pick the evidence base.
3. If the snippet is insufficient for the claim (esp. numbers):
   `zotero_zotero_get_item_fulltext` on that item, or `read_pdf_pages` /
   `get_pdf_outline` to find the page, or grep the sidecar.
4. Compose the answer with brace citations: `{Author (Year), passage N, p. X}`
   for passage claims and `{tool → measure}` for structural claims.
5. If asked to compare numbers across studies, re-check each against its own
   passage before writing.

## Score cheat-sheet (bge-reranker-v2-m3 via llama.cpp)

| Rerank score | Meaning | Use |
|---|---|---|
| > 0 | confident match | safe to cite |
| −2..0 | weak match | cite with care / flag |
| −2..−4 | marginal | likely noise |
| ≲ −4 | junk | drop (floor in config: `semantic_search.hybrid.rerank_floor`) |

## Notes

- The plumbing is already in the stack: every hit carries `chunk_index`,
  `n_chunks`, `page`, char offsets, and the raw rerank score; the DCR prefix
  imprints title + author/year + section breadcrumb on every chunk. Graph tools
  return edges with measures (inward citations, depth, shared citations). This
  skill is the behavior contract that uses them. The `{...}` brace token is the
  canonical citation shape — keep it machine-parseable: comma-separated fields,
  no prose around it.
- Never relax rule 3 for convenience — a wrong coefficient in a manuscript is
  the costliest failure this stack can produce.
