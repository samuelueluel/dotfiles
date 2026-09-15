---
name: zotero-library
description: Manages Zotero metadata, collections, local linked attachments, ingestion, annotations, and bibliography exports. Use when Samuel asks to add, import, edit, delete, organize, tag, export, or look up Zotero records or collections, rather than answer substantive questions about paper contents.
---

# Zotero Library Management

## Request-Routing Playbook

```text
REQUEST
├─ Find a named record or collection? ──────→ LOOKUP: exact-source resolver or collection search
├─ Import a paper or local PDF? ───────────→ INGEST: metadata record → local zotero-link attachment
├─ Edit metadata or tags? ─────────────────→ UPDATE: resolve target → incremental edit
├─ File, move, or remove collection membership? → ORGANIZE: resolve item and destination → set_item_collections
├─ Export citations or bibliography? ──────→ EXPORT: explicit keys/scope → export_bibliography
├─ Read or write annotations/notes? ────────→ ANNOTATE: resolve source → inspect → requested change
├─ Delete a record or collection? ─────────→ DELETE: show exact target and consequences → confirm
└─ Ask about findings in papers? ──────────→ RESEARCH: load zotero-source-reading or zotero-result-comparison
```

## Safety and Scope

- Use official Zotero MCP tools and documented local ingestion helpers.
- Resolve the exact mutation target before writing. Semantic similarity alone cannot select a record to change.
- Preserve unrelated fields, tags, collection memberships, notes, and attachments.
- Never delete a library item or collection without Samuel's explicit confirmation of the exact target and consequences.
- Never upload PDF bytes to Zotero Cloud, call `zotero_attach_file`, or pass a file to `zotero_add_item`.
- Attach local PDFs through `zotero-link`; never replace linked files with cloud uploads.
- Never download, parse, or embed papers merely because they appear in a bibliography.
- Do not treat titles, metadata abstracts, or collection membership as verified empirical findings. For content questions, load [source reading](../zotero-source-reading/SKILL.md) or [result comparison](../zotero-result-comparison/SKILL.md).
- Do not run OCR, embedding, or index recovery during routine record management. Explicit processing belongs to [pipeline operations](../zotero-pipeline/SKILL.md).

## 1. Lookup and Identity

For a named title, author/year/title, DOI, citation key, or item key, use `zotero_resolve_exact_source` with the original identifier.
Preserve the requested collection and descendant scope.
- `exact`: use the returned key.
- `ambiguous`: disclose competing records or conflicting identifiers and clarify.
- `absent`: report absence. Do not silently use a related record.

If the resolver is unavailable, use the narrowest exact metadata or citation-key lookup and proceed only with a uniquely verified record.
Use `zotero_get_item_metadata` for a known key; reuse metadata already returned rather than fetching it again.

For collection names/keys, use `zotero_search_collections` or `zotero_list_collections`.
Load [collection keys and scopes](references/collections.md) for established project keys.
Inventory tools default differently from semantic retrieval: pass `include_subcollections=true` when matching a research scope that includes descendants.
Page through an inventory only when the task needs it; use short metadata queries for targeted record lookup.
Never weaken a requested filter after a lookup failure.

## 2. Ingestion and Local Attachments

Load [library operation commands](references/library-ops.md) before ingestion or bulk edits.

For an explicitly requested local PDF import:
1. Use `zotero-auto-ingest <path_to_pdf> [--collection <KEY>]` to identify metadata and create a linked attachment.
2. Inspect the returned identity and collection filing; do not silently accept an ambiguous title or DOI match.
3. Verify the parent item and local linked attachment before reporting success.

For DOI, URL, or bibliography imports, inspect the deployed tool schema and existing records first.
Create metadata without uploading a file, then use `zotero-link <item_key> <local_pdf_path>` when a local PDF is available.
Check duplicate handling explicitly; do not create another copy merely to change collection membership.
Do not promise immediate semantic searchability: a new source may still require explicit pipeline processing.

## 3. Metadata and Classification

Read the existing record before editing it. Change only the requested fields.
Use `zotero_update_item` for native metadata and incremental `add_tags` / `remove_tags` for tags.
A replacement `tags`, `creators`, or `collections` field overwrites that list; use it only when replacement is intended.
Use `set_keys` / `remove_keys` for Extra fields without erasing unrelated lines.

Native Zotero `itemType` is canonical; `source_group` is a retrieval alias, not a tag.
Use `review:unreviewed`, `review:skimmed`, or `review:checked` for review status and `type:*` only for missing subtypes.
Never invent subject, credibility, standing, research-role, or publication-status tags, or duplicate native types as tags.
Never use a Zotero note as the parent record for a PDF.

For course materials, use `manuscript` for personal notes, `report` for institutional notes, and `book` for published textbooks/excerpts.
Use `presentation` for slides. Put course, lecture, institution, and instructor details in their documented metadata fields or Extra keys.

For working-paper-to-publication updates, verify that the record is the intended work/version before changing its type and publication fields.
Preserve citation keys and linked attachments unless Samuel requests replacement.
Prefer repairing corrupt metadata in place. Deletion and re-ingestion require explicit confirmation.

## 4. Collections and Deletion

Resolve both the item keys and destination collections before filing.
Use `zotero_set_item_collections` with incremental `add_to` / `remove_from` for membership changes.
Removing collection membership is not deleting the item.

Before deletion, show the exact record or collection and whether child collections or attachments are affected.
Use the deployed schema to distinguish trash/recoverable actions from permanent deletion.
Do not treat a general cleanup request as permission to delete uncertain duplicates.

## 5. Exports and Annotations

For bibliography exports, use explicit item keys or collection scope with `zotero_export_bibliography`.
Choose the requested CSL style and output format; inspect tool limits before large exports.
Do not export the entire library by default.

For annotations and notes, resolve the parent and inspect existing content first.
Use `zotero_compile_annotation_digest` for a requested bounded digest; it gathers annotations rather than evaluating findings.
External PDF-viewer highlights may live only inside the linked file, not Zotero's annotation database.
Use the documented annotation tools for requested edits; never replace unrelated notes or highlights.
If the task requires interpreting the underlying source, load [source reading](../zotero-source-reading/SKILL.md) or [result comparison](../zotero-result-comparison/SKILL.md).

## 6. Verification and Failure

After mutations, inspect the changed fields, membership, or attachment once and report the actual outcome.
Do not claim success from intended tool arguments alone.
On metadata or filter failures, report the failure and preserve scope rather than retrying a broader mutation.
Use [pipeline operations](../zotero-pipeline/SKILL.md) only for diagnosed service/storage problems.

After library writes or sync, close Zotero Desktop and allow WAL checkpointing before relying on changed SQLite-backed metadata.
Never treat an immutable SQLite read as current while WAL is active.
Metadata-only edits do not require re-embedding. Changed source text or parsing may require an exact-item refresh through the pipeline skill.

Keep confirmations compact: identify the changed records and any unresolved issue.
For source-grounded conclusions, use the applicable task-specific research skill rather than treating metadata as evidence.

## Reference Routing

- For known project collection keys and descendant semantics, load [collections](references/collections.md).
- For ingestion, annotations, advanced metadata queries, bulk commands, and export parameters, load [library operations](references/library-ops.md).
