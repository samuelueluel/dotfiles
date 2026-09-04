---
name: multisource
description: Synthesizes answers across multiple Zotero sources into a unified synthesis and per-source evidence blocks. Use only when explicitly invoked via "use multisource" or "/skill:multisource".
disable-model-invocation: true
---

# Multisource Synthesis

Manual utility skill. Invoked **only** on explicit request (`"use multisource"` or `/skill:multisource`). Never apply by default for simple single-source queries.

## Request-Routing & Synthesis Playbook

```text
MULTISOURCE PIPELINE
│
├─ 1. Broad Retrieval ────────→ zotero_semantic_search (limit ~10 hits)
│                                └─ Group by itemKey; pick best chunk per work (Rerank > 0)
├─ 2. Tier 1: Unified Synthesis → 1–2 paragraphs answering prompt directly
│                                └─ Inline full canonical tokens per citation-integrity
├─ 3. Tier 2: Evidence Silos ───→ 3–6 distinct sources when available
└─ 4. Conflict / Divergence ────→ Explicitly isolate competing assumptions or specs
```

## Output Contract: One Answer, Two Tiers

Never answer the question multiple times. Structure the response strictly in two tiers:

### Tier 1 — Unified Synthesis (1–2 Paragraphs)
- **Direct Synthesis:** Answer the question directly by synthesizing across retrieved sources.
- **Consensus & Divergence:** Highlight points of agreement, differences in formal rigor (e.g., applied vs. measure-theoretic), and competing assumptions.
- **Ordering:** Read `02_Memories/Zotero-RAG-Source-Preferences.md` via `turbovault_read_note` before ordering Tier 1 sources; do not use raw filesystem access.
- **Citations:** Inline-cite all substantive claims using canonical brace tokens per `citation-integrity`.

### Tier 2 — Per-Source Evidence Silos (3–6 Distinct Sources When Available)
Group hits by distinct item key (collapsing duplicate chunks per paper). Use all qualifying sources when fewer than three qualify; never pad with weak or irrelevant works. For each distinct source, provide:
1. **Metadata Line:** `Author (Year) — Title [Key: <KEY>]`
2. **Matched Evidence:** Concise quote or paraphrase with `{Author Year, item KEY, passage N/M, p. X, Rerank +S; itemType/source_group; canonical tags if present}`.
3. **Unique Contribution:** One line stating its role (e.g., *formal definition*, *empirical intuition*, *tower property proof*, *applied estimator*).
4. **Confidence:** Explicitly report raw `Rerank` score; flag negative/weak scores.

### Divergence & Disagreements Block
If sources conflict or present differing specifications/assumptions, explicitly isolate competing claims and quote each source with its own token. Never smooth over legitimate academic disagreement.

## Grounding & Source Selection

- **Citation Discipline:** Strictly follow `~/.agents/skills/citation-integrity/SKILL.md` for token formats, number verification, `Rerank` gating, and cross-paper isolation.
- **Echo-Chamber Guard:** Include at least one alternative framing or perspective when relevant evidence is available; otherwise state that no credible alternative was found. Never invent or pad an alternative.

## Search & Assembly Workflow

1. **Broad Semantic Search:** Execute `zotero_semantic_search` (limit ~10; scoped to `collection=<KEY>` if applicable).
2. **Group & Deduplicate:** Group passages by distinct item key; select the single best-matching passage per work.
3. **Direct Escalation:** If definitions or numbers are truncated in snippets, grep sidecars or run `zotero_get_item_fulltext` before synthesizing.
4. **Assemble Output:** Produce Tier 1 synthesis → Tier 2 source silos → divergence notes.

## Anti-Patterns

- ❌ **Raw Chunk Dumps:** Never output unorganized search hits or multiple chunks from the same paper.
- ❌ **Multiple Answers:** Never write separate complete answers for each source; synthesize first, silo evidence second.
- ❌ **Chunk-Volume Bias:** Do not prioritize large textbooks over concise papers based solely on chunk volume; rely on `Rerank` scores and preference maps.
- ❌ **Suppressed Divergence:** Never omit a conflicting source to simplify the narrative.
