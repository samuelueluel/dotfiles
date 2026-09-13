# Verification Workflow & Gating Rules

**Load this file when** verifying empirical numbers, evaluating reranker scores, handling figure schemas, isolating cross-paper claims, or reporting failure states.

## Passage-Score Confidence Gate

The local `bge-reranker-v2-m3` endpoint returns raw cross-encoder scores:

| Raw `Rerank` Score | Retrieval Gate | Permitted Usage |
|---|---|---|
| `> 0` | Eligible candidate | Inspect passage text, attribution, and qualifications before using it. Not a truth or entailment score. |
| `-2` to `0` | Weak match | Diagnostic/discovery only; cannot support a substantive claim. Use a stronger hit or direct source read. |
| `-4` to `-2` | Marginal / Noisy | Exclude from substantive claims. |
| `≤ -4` | Irrelevant | Discard. |

- **Score Interpretation:** Raw reranker scores are query-dependent relevance signals, not calibrated confidence in a claim. A higher recheck score is not independent corroboration. A contents list or truncated sentence can score positively without supporting the proposed claim.
- **Dense Relevance Warning:** `Relevance = 1 - dense distance` is an uncalibrated similarity measure and cannot substitute for `Rerank`.
- **Missing Score:** If `Rerank` is absent from semantic output, treat as an instrumentation failure. Repair the service or fall back to a direct source read (`zotero_read_pdf_pages` / `zotero_get_item_fulltext`). Never fabricate scores.

## Number Verification Checklist

Before reporting any coefficient, standard error, sample size, percentage, or currency figure:

1. **Exact Match:** Locate the exact value verbatim in the retrieved passage or direct page.
2. **Context Check:** Confirm units, sign, specification, comparison group, outcome variable, and time horizon.
3. **Attribution Check:** Ensure the number belongs to the cited paper itself, not an in-text review of another study.
4. **Context Escalation:** If a semantic snippet is truncated around a key table or note, verify the relevant page with `zotero_read_pdf_pages`; if page extraction is unavailable or malformed, use a targeted extraction from the known item's MinerU sidecar (keep provenance truthful internally; cite it by line range, never as a page read).
5. **Page-boundary sentences:** Read the continuation when needed for meaning. Only for an explicitly requested automated audit, use separate exact page-fragment references if a spanning quote fails containment. Ordinary reading does not require audit payloads.
6. **Failure Fallback:** If the exact number cannot be verified, drop it or explicitly label it `UNVERIFIED`.

*Precedence Rule:* Verified source text always overrides model memory.

## Cross-Paper Isolation & Superlative Claims

When making comparative statements (e.g., “Paper A finds X, whereas Paper B finds Y”):
- Retrieve and verify claim X independently from Paper A.
- Retrieve and verify claim Y independently from Paper B.
- Attach separate canonical tokens to each distinct clause.
- Never use one source's passage or graph metric to support another paper's finding.

For “largest,” “smallest,” or “strongest,” use the [Zotero research ranking workflow](../../zotero-research/SKILL.md). Keep the comparison metric explicit, resolve plausible challengers from bounded discovery, and verify the decisive result and its necessary context once. Do not add a separate audit pass or metadata calls solely to fill internal labels.

## Figure & Table Schema Handling

A `[Figure Schema]` block serves as a discovery beacon, not standalone evidence.
- The displayed `Rerank` score reflects the raw cross-encoder evaluation.
- Verify empirical claims against figure captions, surrounding prose, HTML table cells, or `zotero_read_pdf_pages` output.
- Never infer quantitative estimates from schema YAML alone.

## Retrieval Efficiency Checks

Before expanding a Zotero RAG query, ask:
- What does the current evidence support?
- What unresolved issue could materially change or qualify the answer?
- What is the cheapest reliable retrieval that resolves that issue?
- Is a page read sufficient instead of an outline or full-text read?
- If page extraction is malformed, would a precise known-item sidecar window resolve it?
- Am I fetching metadata only for final cited sources?
- If MCP output is oversized, can I narrow the request or use the sanctioned known-item fallback rather than parse a temporary transport file?
- After the retrieval, did the answer change? Repeated uninformative follow-ups are a strong signal to stop. For an explicitly requested automated audit, the Zotero repair budget applies; ordinary RAG uses the search stopping rule.
- Does the final prose preserve important conditions and avoid stronger wording than the sources, including in headings and connective sentences?

## Canonical Failure Statements

When evidence is incomplete, weak, or absent, use explicit standard phrasing:
- *"No supporting evidence found in the retrieved passages."*
- *"The best semantic match has weak negative reranker evidence (`Rerank: -0.85`)."*
- *"The bibliography occurrence is unresolved, so no verified entity identity exists."*
- *"The number was not located in the retrieved source text and is unverified."*
- *"The citation graph may be incomplete due to missing sidecars; audit coverage before asserting structural claims."*
