---
name: zotero-research
description: Indexes the task-specific Zotero research skills and preserves the retired combined workflow for review. Use only when manually inspecting the Zotero research skill architecture; normal research requests should load the matching task skill directly.
disable-model-invocation: true
---

# Zotero Research Skill Index

The former combined router is retired. Model-facing research now uses one task-specific skill whose description matches the user's request.

## Task Skills

- Create a scoped list of papers satisfying a condition: [Zotero paper discovery](../zotero-paper-discovery/SKILL.md).
- Compare, rank, or identify the largest or smallest result: [Zotero result comparison](../zotero-result-comparison/SKILL.md).
- Read a named paper or answer a bounded question about exact items: [Zotero source reading](../zotero-source-reading/SKILL.md).
- Find or count bibliography entries: [Zotero bibliography search](../zotero-bibliography-search/SKILL.md).
- Examine citation neighbors, inbound edges, or bibliographic coupling: [Zotero citation analysis](../zotero-citation-analysis/SKILL.md).
- Run an explicitly requested automated claim audit: [Zotero evidence audit](../zotero-evidence-audit/SKILL.md).
- Read every paper or every item in a frozen scope: [Zotero extract](../zotero-extract/SKILL.md).
- Manage Zotero records, collections, attachments, or annotations: [Zotero library](../zotero-library/SKILL.md).
- Operate OCR, parsing, embeddings, indexes, or service recovery: [Zotero pipeline](../zotero-pipeline/SKILL.md).

Load [citation integrity](../citation-integrity/SKILL.md) whenever reporting source-grounded findings, estimates, mechanisms, or comparisons.

## Shared References

These references remain available to the task-specific skills:

- For exact source fields, collection pagination, and metadata filters, load [search and retrieval](references/search-retrieval.md).
- For passage expansion, sidecar continuation, table lookup, and PDF-page location, load [deep-dive reading](references/deep-dive-reading.md).
- For bibliography and graph scope details, load [bibliography and graphs](references/bibliography-graphs.md).
- For the automated claim-audit payload and errors, load [claim audit](references/claim-audit.md).
- To inspect the complete pre-refactor instructions, load [legacy workflows](references/legacy-workflows.md).
