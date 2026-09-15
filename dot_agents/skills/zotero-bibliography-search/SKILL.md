---
name: zotero-bibliography-search
description: Finds and counts raw bibliography occurrences within an explicit Zotero paper or collection scope while preserving citing-item identity and resolution limits. Use when Samuel asks which stored papers cite a work, how often a work appears in bibliographies, or requests bibliography-entry searches rather than substantive findings.
---

# Zotero Bibliography Search

## Non-Negotiable Rules

- Search the raw bibliography entries of the requested citing papers. Do not use semantic full-text hits as bibliography counts.
- Distinguish total occurrences from distinct citing papers.
- Preserve the requested citing scope, including direct collection membership versus subcollections.
- Treat resolved, external, unresolved, and ambiguous references as different identity states.
- A bibliography occurrence establishes a citation, not the cited work's findings.
- A capped response is not a verified total.
- Never download, add, parse, or embed a cited work merely because it appears in a bibliography.

## Workflow

### 1. Define citing scope and target

Record:

- The citing paper keys or collection key.
- Whether subcollections are included.
- The cited title, DOI, author/year, or other literal target.
- Whether Samuel wants occurrences, distinct citing papers, or both.

For a named cited library item, use `zotero_resolve_exact_source` when identity matters. Related matches are not substitutes.

### 2. Search raw entries

Use `zotero_search_bibliography_entries` with either:

- `item_key=<citing parent key>` for one paper, or
- `collection_key=<collection key>` for direct collection members.

The bibliography collection filter includes direct members only. If Samuel's scope includes subcollections, identify the child collection keys and combine their results explicitly. Remove duplicate citing items or entries according to the requested measure.

Use a title fragment, DOI, or author/title combination that matches the raw entry. BM25 score measures text similarity, not identity confidence.

For detailed parameter and scope examples, load [bibliography search details](../../references/zotero/bibliography-graphs.md).

### 3. Interpret resolution status

- `resolved` or `zotero_item`: the entry maps to a library item.
- `external_reference` with `ext:doi:*`: DOI-backed external node.
- `external_reference` with `ext:meta:*`: heuristic metadata node; title variants may split one work.
- `unresolved` or `ambiguous`: verify only the raw occurrence; do not invent an item identity.

A resolved target outside the requested collection remains a library item. An external node does not establish that the work is absent from the library.

### 4. Count carefully

Report the measure actually established:

- `occurrences`: number of returned raw bibliography entries.
- `distinct citing papers`: number of unique citing parent keys.

Check whether the result reached the tool limit. The installed tool has no offset. If capped, report a lower bound or query individual known citing papers without broadening scope.

Do not call inbound-citation graph counts bibliography totals. Unresolved entries are invisible to resolved-edge graph rankings.

### 5. Answer

Return a compact citing-paper list with:

- Citing paper identity and parent key.
- Raw bibliography entry or a bounded excerpt.
- Resolution status and target key/node when available.
- Exact occurrence and distinct-paper counts, or a clear capped/lower-bound statement.

Use `citation-integrity` for evidence wording. Do not infer substantive findings from the bibliography.

## Stop Condition

Stop when the requested raw occurrences and count measure are established within scope, or when the response cap is clearly disclosed.
