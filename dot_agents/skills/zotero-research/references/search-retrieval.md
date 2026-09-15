# Find Exact Papers, Check Collection Membership, and Apply Filters

**Load this file when** choosing fields to identify an exact paper, checking collection membership, reading another page of collection items, or combining metadata filters.

The active task skill—normally [paper discovery](../../zotero-paper-discovery/SKILL.md) or [source reading](../../zotero-source-reading/SKILL.md)—governs which papers to check and what to do with exact, ambiguous, or missing matches. This reference explains the lookup parameters and results.

## Exact-Source Fields and Fallbacks

`zotero_resolve_exact_source` takes the original identifier in `source`.
Explicit fields include `title`, `author`, `year`, `doi`, `citation_key`, and `item_key`.
For collection scope, use `collection_key`; `include_subcollections` defaults to true.
Inspect the deployed schema for supported combinations, especially all-library requests.

The result supplies `identity_status`, match lists, `conflicts`, and `collection_scope`.
Match fields `in_requested_scope` and `scope_basis` describe whether the paper belongs to the requested collection or its subcollections.
A missing parent-collection key in ordinary metadata does not rule out membership through a subcollection.

If the resolver is unavailable, these tools can provide the exact identity evidence required by `zotero-source-reading`:

| Identifier | Lookup |
|---|---|
| Parent item key | `zotero_get_item_metadata` |
| Better BibTeX key | `zotero_find_item_by_citation_key` |
| Title, author/year, or DOI | `zotero_search_items`, then metadata for plausible exact matches |
| Collection membership | Collection inventory or metadata lookup covering the requested collection and subcollections |

Ordinary `search_items` can return simplified or semantic fallback matches. Check that the returned paper matches the requested identifiers before reading it.

## List Collection Items Without Full Metadata

```python
zotero_list_collection_items(collection_key=collection_key, detail="summary",
                             include_subcollections=True, limit=50, offset=0)
# Continue using the next offset returned by the response.
```

`collection_key` is this tool's parameter; semantic search uses `collection` instead.
The summary inventory omits abstracts while retaining titles, keys, creators, and attachment indicators.
It complements semantic discovery without reading every item's full metadata.

## How Search Filters Combine

```python
zotero_semantic_search(query="treatment effects", collection=collection_key,
                       filters={"item_keys": [item_key]})
zotero_semantic_search(query="urban policy", collection=collection_key,
                       filters={"source_group": "article",
                                "tags": ["review:checked"]})
```

| Filter | Meaning |
|---|---|
| `item_type` / `item_types` | Native Zotero type; multiple types are alternatives |
| `item_key` / `item_keys` | Exact parent items that must also match the other scope restrictions |
| `source_group` / `source_groups` | Aliases for Zotero types used when searching; multiple groups are alternatives |
| `tag` / `tags` / `required_tags` | Current Zotero tags; list entries combine with AND |
| `exclude_tags` | Tags to exclude, where supported by the installed tool |

Fields combine with AND. Within a tag entry, `OR` or `||` expresses alternatives.
Type, tag, and collection filters select parent items for both dense and BM25 searches.
Changes to tags or collection membership do not require re-embedding. If a filter fails, report the error and retry without removing the requested restrictions.

## Which Zotero Types Each Source Group Includes

| Group | Native types |
|---|---|
| `reference` | `book`, `bookSection`, `dictionaryEntry`, `encyclopediaArticle` |
| `article` | `journalArticle`, `conferencePaper` |
| `unpublished` | `preprint`, `manuscript`, `presentation` |
| `institutional` | `report`, `dataset`, `standard` |
| `web-media` | `webpage`, `blogPost`, `forumPost`, `magazineArticle`, `newspaperArticle`, `podcast`, `radioBroadcast`, `film`, `videoRecording`, `tvBroadcast`, `audioRecording`, `interview`, `letter`, `email`, `instantMessage` |
| `other` | `artwork`, `map`, `document`, `computerProgram` |

By default, paper retrieval excludes `note`, `thesis`, `case`, `bill`, `hearing`, `statute`, `patent`, `attachment`, and `annotation`.
Source groups are aliases, not tags. Existing canonical review tags are `review:unreviewed`, `review:skimmed`, and `review:checked`.
`type:textbook` accompanies native `book`; `type:lecture-notes` implies no single native type.

For a diagnosed SQLite/WAL or metadata-freshness failure, load [pipeline service operations](../../zotero-pipeline/references/service-ops.md).
Ordinary metadata lookup does not require closing Zotero Desktop.
