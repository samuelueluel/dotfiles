# Citation-Integrity — Worked Examples

Load this file when you need to see the discipline applied end-to-end, or when a
synthesis/verification task is ambiguous about how strict to be.

## Example 1 — Verify a number claim (the core case)

**Task:** "What's Stacy's estimate of the effect of a demolition on violent crime?"

1. Search: `zotero_zotero_semantic_search("violent crime reduction per demolition Stacy estimates", collection="TRGBCDX5", limit=2)`
2. Top hit: WMIKGSQU (Stacy 2018), passage 27/40, Relevance 0.531, **Rerank +3.22**.
   Passage contains: *"For violent crime, one demolition reduces violent crime by 6.7 percent, or 2 crimes per year on average."*
3. Number check: "6.7 percent" appears **verbatim** in the passage → verified.
4. Confidence: Rerank +3.22 (positive) → safe to cite.
5. Answer with citation:

   > Stacy (2018) estimates one demolition reduces violent crime by **6.7%** (≈2 crimes/year per block group) — Stacy 2018, passage 27/40, Rerank +3.22.

Note: if the agent's memory had said "7.5%" (that's Stacy's *total* crime number, same passage), the number-verification rule forces the correct one — the passage wins.

## Example 2 — Weak evidence must be flagged

**Task:** "Does demolition affect property values around demolished homes in Detroit?"

- If the top hit has a **negative Rerank** (e.g. −2.5) or relevance ≈ 0, do NOT present it as established:
  - Weak: "Demolitions affect property values" citing a −2.5 passage.
  - Correct: "The library's strongest match is [paper], but the passage scores weakly (Rerank −2.5) — this needs `get_item_fulltext` confirmation or should be marked weak evidence."

## Example 3 — Cross-paper synthesis stays isolated

**Task:** "Compare Stacy and Larson's crime estimates."

- Stacy's number must trace to WMIKGSQU's passage; Larson's to GUITER7C's passage. Never write "Stacy finds 6.7% and Larson finds 6.7%" if the 6.7% only appears in Stacy's passage — verify each number against its own paper's passage before writing.

## Example 4 — No evidence is a complete answer

**Task:** "Sourdough bread recipe" (out-of-domain).

- Search returns "No semantically similar items found" → answer: "Nothing in the library matches; I can't ground an answer here." Do NOT improvise from memory and cite a paper anyway.

## Anti-patterns (what this skill forbids)

- Citing `(Stacy 2018)` without a passage/page reference.
- Quoting a number that is not in the retrieved passage (memory leakage).
- Presenting a BM25-rescued chunk at relevance ~0.3 as strong evidence without checking Rerank.
- Merging two papers' numbers under one citation.
- Fabricating a page or chunk index to make a citation look precise.
