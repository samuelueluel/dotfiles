---
name: multisource
description: Synthesizes answers across multiple Zotero sources into a unified synthesis and per-source evidence blocks. Use only when explicitly invoked via "use multisource" or "/skill:multisource".
disable-model-invocation: true
---

# Multisource Synthesis

Manual utility skill. Use **only** when Samuel explicitly asks (`"use multisource"` or `/skill:multisource`). Never apply by default for simple single-source questions.

## Request-Routing & Synthesis Playbook

```text
MULTISOURCE PIPELINE
│
├─ 1. Broad Retrieval ────────→ zotero_semantic_search (limit ~10 hits)
│                                └─ Group by itemKey; pick best passage per paper (Rerank > 0)
├─ 2. Tier 1: Unified Synthesis → 1–2 paragraphs answering the prompt directly
│                                └─ Cite claims using citation-integrity footnotes
├─ 3. Tier 2: Source Evidence ──→ 3–6 distinct sources when available
└─ 4. Conflict / Divergence ────→ Explicitly point out differing assumptions or models
```

## Output Structure: One Answer, Two Tiers

Never answer the question multiple times. Structure your response in two clear sections:

### Tier 1 — Unified Synthesis (1–2 Paragraphs)
- **Direct Answer:** Answer the question directly by combining the evidence across all retrieved papers.
- **Agreements and Differences:** Highlight where authors agree, where their assumptions differ, and how their methods compare.
- **Source Order:** If ordering sources, read `02_Memories/Zotero-RAG-Source-Preferences.md` using `turbovault_read_note` (never use raw file tools on vault notes).
- **Citations:** Cite every substantive claim using `citation-integrity` footnotes.

### Tier 2 — Individual Source Evidence (3–6 Distinct Sources)
Group results by paper (`item_key`), keeping only the best passage per paper. If fewer than three qualify, show all that qualify; never pad with weak or irrelevant papers. For each source, include:
1. **Metadata Line:** `Author (Year) — Title [Key: <KEY>]`
2. **Matched Evidence:** A concise quote or paraphrase with a corresponding `citation-integrity` footnote.
3. **Unique Contribution:** One line stating its role (e.g., *formal theoretical proof*, *applied empirical estimate*, *institutional background*).
4. **Confidence:** Report the raw `Rerank` score; point out if a score is weak.

### Disagreements & Differences
If papers conflict or use different assumptions or empirical specifications, state the disagreement clearly and quote each paper with its own footnote. Never smooth over real academic disagreements.

## Grounding & Source Selection

- **Strict Citations:** Follow `~/.agents/skills/citation-integrity/SKILL.md` for footnote formatting, number verification, `Rerank > 0` gating, and keeping sources separate.
- **Show Different Perspectives:** Include an alternative viewpoint or competing model when valid evidence exists in the library. If none exists, say so directly. Never invent an alternative view.

## Search & Assembly Steps

1. **Broad Semantic Search:** Run `zotero_semantic_search` (limit ~10; scoped to a collection if requested).
2. **Group by Paper:** Group passages by item key and select the single best passage for each work.
3. **Read Missing Details:** If numbers, tables, or definitions are cut off in passages, check sidecars or run `zotero_read_pdf_pages` before writing the synthesis.
4. **Write the Response:** Tier 1 synthesis → Tier 2 source evidence → differences block.

## What to Avoid

- ❌ **Dumping Raw Snippets:** Never print raw, unorganized search hits or multiple chunks from the same paper.
- ❌ **Multiple Answers:** Never write separate complete answers for each paper. Synthesize first, list evidence second.
- ❌ **Favoring Long Books Over Papers:** Do not pick a source just because it generated more text chunks. Look at `Rerank` scores and direct relevance.
- ❌ **Hiding Disagreements:** Never ignore a conflicting paper just to make the answer seem simpler.
