---
name: citation-integrity
description: "Enforce citation-integrity discipline for research answers built on Samuel's local Zotero RAG stack: every claim cites a retrieved passage (author, year, passage, page), numbers are verified against passage text (never from memory), confidence is gated on the Rerank score, cross-paper comparisons stay isolated per paper, and \"no evidence found\" is a complete answer. Use when answering research questions from the library, citing findings or estimates, comparing coefficients across papers, verifying a number or claim against the corpus, or composing anything that could end up in a manuscript."
---

# Citation-Integrity Discipline

Grounding discipline for research answers built on the local Zotero RAG stack.
Purpose: convert retrieval quality into manuscript-grade reliability. The 2026
literature puts LLM citation accuracy at ~74% (CiteFix, ACL 2025; FACTUM) —
this skill is the contract that keeps the agent's claims traceable to passages
it actually retrieved. Use whenever a research task produces claims, numbers,
or comparisons that could end up in a manuscript.

Complementary skills: `zotero` (tool usage, library ops), `obsidian` (vault).

## The rules (in order of precedence)

1. **Grounding** — every substantive claim must cite the passage it came from:
   `Author (Year), passage N/M (page p. X if available)`. "From memory"
   citations are prohibited, even for famous results. If the memory is right,
   retrieve and cite it; if retrieval fails, say so.

2. **Number verification** — before citing ANY number (coefficient, elasticity,
   percentage, dollar figure), confirm it appears in the retrieved passage text
   verbatim or in provably equivalent form. If it is not in the passage, fetch
   the full text (`zotero_zotero_get_item_fulltext`) and locate it. If it
   cannot be located: drop the claim or mark it `UNVERIFIED`.
   When the retrieved number disagrees with what you "know", the passage wins.

3. **Confidence gating** — use the search scores:
   - `Rerank` (raw cross-encoder score): **positive = confident**; −2..−3 =
     weak; ≲ −4 = junk (calibrated on bge-reranker-v2-m3 via llama.cpp).
     Claims grounded in a negative-rerank passage must be flagged
     `weak evidence` or excluded.
   - `Relevance` (1 − dense distance) alone is NOT sufficient — a BM25-rescued
     chunk can carry a real rescue score while still being a marginal match;
     the Rerank score is the calibrated judge.
   - Figure-probe schema chunks carry a `figure_boost` on figure queries — their
     rerank score is inflated; treat schema YAML as a *discovery beacon*, and
     verify any claim against the caption/prose in the same chunk, never the
     schema alone.

4. **Cross-paper isolation** — when synthesizing across papers ("Stacy finds
   6.7%, Sandler finds …"), each number must trace to its OWN paper's passage.
   Never combine passages from different papers into one citation, and never
   let one paper's number ride on another's citation.

5. **Honesty** — "no evidence found in the library" is a complete, acceptable
   answer. Never fabricate a passage reference, page number, or chunk index.
   If the top hit is weak (negative Rerank, or relevance ≈ 0), say the match
   is weak rather than presenting it as found.

## Workflow

1. `zotero_zotero_semantic_search` (scope with `collection` when the project
   is collection-based; default `limit` 5-8 for coverage).
2. Read the `Matched Passage` of the top hits; use `Rerank` + `Relevance` to
   pick the evidence base.
3. If the snippet is insufficient for the claim (esp. numbers): 
   `zotero_zotero_get_item_fulltext` on that item, or `read_pdf_pages` /
   `get_pdf_outline` to find the page.
4. Compose the answer with inline citations `Author (Year), passage N, p. X`.
5. If asked to compare numbers across studies, re-check each against its own
   passage before writing.

Worked examples (number verification, weak evidence, cross-paper isolation,
no-evidence case, anti-patterns): [EXAMPLES.md](EXAMPLES.md).

## Score cheat-sheet (bge-reranker-v2-m3 via llama.cpp)

| Rerank score | Meaning | Use |
|---|---|---|
| > 0 | confident match | safe to cite |
| −2..0 | weak match | cite with care / flag |
| −2..−4 | marginal | likely noise |
| ≲ −4 | junk | drop (floor in config: `semantic_search.hybrid.rerank_floor`) |

## Notes

- The plumbing is already in the stack: every hit carries `chunk_index`,
  `n_chunks`, `page`, char offsets, DCR paper/section prefix, and now the raw
  rerank score. This skill is the behavior contract that uses it.
- Never relax rule 2 for convenience — a wrong coefficient in a manuscript is
  the costliest failure this stack can produce.
