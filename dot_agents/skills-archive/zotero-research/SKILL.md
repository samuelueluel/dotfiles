---
name: zotero-research
description: Indexes the task-specific Zotero research skills and preserves the retired combined workflow for review. Use only when manually inspecting the Zotero research skill architecture; normal research requests should load the matching task skill directly.
disable-model-invocation: true
---

# Zotero Research Skill Index

The former combined router is retired. Model-facing research now uses one task-specific skill whose description matches the user's request.

## Task Skills

- Create a scoped list of papers satisfying a condition: [Zotero paper discovery](../../skills/zotero-paper-discovery/SKILL.md).
- Compare, rank, or identify the largest or smallest result: [Zotero result comparison](../../skills/zotero-result-comparison/SKILL.md).
- Read a named paper or answer a bounded question about exact items: [Zotero source reading](../../skills/zotero-source-reading/SKILL.md).
- Find or count bibliography entries: [Zotero bibliography search](../../skills/zotero-bibliography-search/SKILL.md).
- Examine citation neighbors, inbound edges, or bibliographic coupling: [Zotero citation analysis](../../skills/zotero-citation-analysis/SKILL.md).
- Apply automatic final mechanical claim auditing through [citation integrity](../../skills/citation-integrity/SKILL.md).
- Read every paper or every item in a frozen scope: [Zotero extract](../../skills/zotero-extract/SKILL.md).
- Manage Zotero records, collections, attachments, or annotations: [Zotero library](../../skills/zotero-library/SKILL.md).
- Operate OCR, parsing, embeddings, indexes, or service recovery: [Zotero pipeline](../../skills/zotero-pipeline/SKILL.md).

Load [citation integrity](../../skills/citation-integrity/SKILL.md) whenever reporting source-grounded findings, estimates, mechanisms, or comparisons.

## Shared References

These references remain available to the task-specific skills:

- For exact source fields, collection pagination, and metadata filters, load [search and retrieval](../../references/zotero/search-retrieval.md).
- For passage expansion, sidecar continuation, table lookup, and PDF-page location, load [deep-dive reading](../../references/zotero/deep-dive-reading.md).
- For bibliography and graph scope details, load [bibliography and graphs](../../references/zotero/bibliography-graphs.md).
- For the current claim-audit payload and errors, load [claim audit](../../skills/citation-integrity/references/claim-audit.md).
- To inspect the complete pre-refactor instructions, load [legacy workflows](references/legacy-workflows.md).
