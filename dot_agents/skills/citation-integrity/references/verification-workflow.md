# Verification Workflow

**Load this file when** checking empirical numbers, interpreting semantic scores, handling figures, comparing papers, or escalating from a search snippet to direct source text.

## Passage-score gate

The local `bge-reranker-v2-m3` endpoint returns a raw cross-encoder score:

| Raw Rerank | Interpretation | Use |
|---|---|---|
| `> 0` | confident match | may support a claim after reading the passage |
| `-2..0` | weak | flag explicitly; prefer a stronger or direct source |
| `-4..-2` | marginal/noisy | normally exclude |
| `≤ -4` | junk | drop |

`Relevance = 1 - dense distance` is not a substitute. BM25-only rescues can be useful despite modest dense relevance, but still require a satisfactory raw Rerank score.

If `Rerank` is absent, treat that as an instrumentation failure. Retry after service/patch repair; otherwise use a direct PDF/full-text read and the direct-source contract. Never synthesize a score.

## Number verification

Before writing a coefficient, elasticity, percentage, currency amount, standard error, sample size, or table value:

1. Confirm the exact value appears in the retrieved passage or direct page.
2. Confirm units, sign, comparison group, outcome, specification, and time horizon.
3. Confirm the text belongs to the paper being cited—not a bibliography entry or a discussion of another study.
4. If the snippet truncates the necessary context, read the relevant PDF page(s).
5. If it cannot be located, drop the value or mark it `UNVERIFIED`.

When a retrieved value conflicts with memory, the source text wins.

## Cross-paper isolation

For a comparison such as “Paper A finds X, while Paper B finds Y”:

- retrieve and verify X from Paper A;
- retrieve and verify Y from Paper B;
- attach a separate token to each clause;
- never let one source's passage, reference entry, or graph measure carry another source's claim.

Apply the same isolation to graph metrics and bibliography occurrences.

## Figure and table handling

A `[Figure Schema]` is a discovery beacon. It can help identify the relevant figure, axes, series, or table, but it is not sufficient evidence by itself.

- The displayed `Rerank` remains the raw cross-encoder score; any configured figure boost affects candidate ordering/floor admission, not the displayed confidence.
- Verify claims against the figure caption, surrounding prose, table cells, or direct PDF page.
- Never infer an estimate from schema YAML alone.

## Reference and graph escalation

- A raw reference occurrence answers “does this bibliography contain this rendered entry?”
- A resolved graph edge answers “did the deterministic resolver link these identities under this scope?”
- If reference search finds an unresolved entry, do not promote it to a graph claim.
- If an expanded graph returns a noisy external label, verify it with the raw reference and resolution confidence.
- Before calling an external node absent, search for local preprint/published variants.

## Failure states

Use explicit language:

- “No evidence found in the indexed library.”
- “The only match has weak negative rerank evidence.”
- “The bibliography occurrence is unresolved, so no clean target identity is established.”
- “The graph may be stale or incomplete; rebuild/audit is required before making this structural claim.”
- “The number was not located in the retrieved source text and is therefore unverified.”
