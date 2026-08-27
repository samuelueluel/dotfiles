# Verification Workflow & Gating Rules

**Load this file when** verifying empirical numbers, evaluating reranker scores, handling figure schemas, isolating cross-paper claims, or reporting failure states.

## Passage-Score Confidence Gate

The local `bge-reranker-v2-m3` endpoint returns raw cross-encoder scores:

| Raw `Rerank` Score | Confidence Level | Permitted Usage |
|---|---|---|
| `> 0` | Confident match | May support substantive claims after verifying passage text. |
| `-2` to `0` | Weak match | Flag explicitly; prefer stronger semantic hits or direct source reads. |
| `-4` to `-2` | Marginal / Noisy | Exclude from substantive claims. |
| `≤ -4` | Irrelevant | Discard. |

- **Dense Relevance Warning:** `Relevance = 1 - dense distance` is an uncalibrated similarity measure and cannot substitute for `Rerank`.
- **Missing Score:** If `Rerank` is absent from semantic output, treat as an instrumentation failure. Repair the service or fall back to a direct source read (`read_pdf_pages` / `get_item_fulltext`). Never fabricate scores.

## Number Verification Checklist

Before reporting any coefficient, standard error, sample size, percentage, or currency figure:

1. **Exact Match:** Locate the exact value verbatim in the retrieved passage or direct page.
2. **Context Check:** Confirm units, sign, specification, comparison group, outcome variable, and time horizon.
3. **Attribution Check:** Ensure the number belongs to the cited paper itself, not an in-text review of another study.
4. **Context Escalation:** If a semantic snippet is truncated around a key table or note, read the direct PDF page.
5. **Failure Fallback:** If the exact number cannot be verified, drop it or explicitly label it `UNVERIFIED`.

*Precedence Rule:* Verified source text always overrides model memory.

## Cross-Paper Isolation

When making comparative statements (e.g., "Paper A finds X, whereas Paper B finds Y"):
- Retrieve and verify claim X independently from Paper A.
- Retrieve and verify claim Y independently from Paper B.
- Attach separate canonical tokens to each distinct clause.
- Never use one source's passage or graph metric to support another paper's finding.

## Figure & Table Schema Handling

A `[Figure Schema]` block serves as a discovery beacon, not standalone evidence.
- The displayed `Rerank` score reflects the raw cross-encoder evaluation.
- Verify empirical claims against figure captions, surrounding prose, HTML table cells, or direct PDF pages.
- Never infer quantitative estimates from schema YAML alone.

## Canonical Failure Statements

When evidence is incomplete, weak, or absent, use explicit standard phrasing:
- *"No evidence found in the indexed library."*
- *"The best semantic match has weak negative reranker evidence (`Rerank: -0.85`)."*
- *"The bibliography occurrence is unresolved, so no verified entity identity exists."*
- *"The number was not located in the retrieved source text and is unverified."*
- *"The citation graph may be incomplete due to missing sidecars; audit coverage before asserting structural claims."*
