---
name: multisource
description: "Manual utility skill: when Samuel asks a question answerable from many Zotero sources and says 'use multisource' (or /skill:multisource), produce ONE answer with silo'd per-source sections — a unified synthesis on top (consensus + disagreements, preference-map ordering), then one short block per distinct source quoting its matched passage with brace citations per the citation-integrity skill. Do NOT apply by default; only on explicit invocation. Do NOT answer the same question multiple times."
---

# Multisource Synthesis

Manual utility skill — invoked ONLY when Samuel explicitly says "use multisource"
or "/skill:multisource". Never auto-apply: a simple lookup ("what does Hansen say
about GMM?") gets a single-source answer, not a synthesis.

Purpose: when one question has many relevant hits across the library (e.g.
"what is a conditional expectation in measure theory terms?"), turn the hit list
into a readable, citable, per-source map — not a chunk dump, and not N separate
answers.

## Output structure (the contract)

**Answer ONCE, two tiers.** Never answer the same question multiple times.

### Tier 1 — Unified synthesis (1–2 paragraphs)
- Answer the question directly, weaving sources together.
- Surface: consensus (what all sources agree on), divergence (where they differ),
  and framing differences (applied vs rigorous vs foundational — e.g. Hansen
  avoids measure theory while White/van der Vaart define it formally).
- Order by the preference map (see below): preferred source(s) first.
- Every substantive claim inline-cited per citation-integrity:
  `{Author (Year), passage N/M, p. X, Rerank <score>}`.

### Tier 2 — Per-source silos (one short block per distinct source)
For each distinct source in the top-K (default up to 6; collapse duplicate keys
and repeated hits of the same item):
- **Source metadata**: author, title, year, item key (compact, one line).
- **Its matched passage**: tight quote or paraphrase with `passage N/M` (+ page
  if available) — numbers verified against the passage text (citation-integrity
  rule 3).
- **What it uniquely contributes** to the answer (one line): e.g. "definition",
  "intuition", "properties/tower law", "foundational prerequisite",
  "applied regression framing", "deliberately avoids formalism".
- Confidence: state Rerank sign; flag weak/negative rerank evidence as such.

### Comparison notes (if sources disagree)
Call disagreements out explicitly, never paper over them. Quote each side with
its own citation (cross-paper isolation per citation-integrity rule 5).

## Grounding rules (delegate to citation-integrity)

- Read `~/.agents/skills/citation-integrity/SKILL.md` and follow it exactly for:
  brace citation shape, number verification, Rerank confidence gating,
  cross-paper isolation, "no evidence found is a complete answer".
- This skill adds STRUCTURE, not citation rules. Do not restate citation rules
  here; the discipline lives in citation-integrity.

## Source ordering

- Consult `02_Memories/Zotero-RAG-Source-Preferences.md` (the preference map:
  topic → preferred item keys). Surface preferred source(s) first in Tier 1.
- Echo-chamber guard: always include at least one alternative/framing source,
  especially when the preferred source's treatment is one-sided. The point is
  the comparison, not confirmation.

## Search behavior

1. Broad `zotero_zotero_semantic_search` (limit ~10), scoped to the relevant
   collection when the question is collection-based.
2. Group hits by distinct item key. Pull each source's best-matched passage.
3. If a passage is insufficient (esp. for definitions/numbers), grep the
   sidecar or `zotero_zotero_get_item_fulltext` for the precise statement.
4. Compose Tier 1 → Tier 2 → comparison notes.

## Anti-patterns

- ❌ Dumping 10 raw chunks — always group per source.
- ❌ Answering the question N times (once per source) — one answer, two tiers.
- ❌ Claiming a source says X when its passage doesn't support it.
- ❌ Letting a big book's mass crowd out a better-matched short source — the
  rerank score and preference map decide ordering, not chunk count.
- ❌ Omitting a divergent source because it complicates the story — divergence
  is the deliverable.
