# Search Bibliographies and Trace Citation Relationships

**Load this file when** counting bibliography mentions or citation links, checking whether a reference matches a library item, or choosing which papers a citation-graph query includes.

Use [bibliography search](../../skills/zotero-bibliography-search/SKILL.md) for raw occurrences and [citation analysis](../../skills/zotero-citation-analysis/SKILL.md) for graph relationships. Use citation integrity to decide what their results can support.

## Bibliography Queries

```python
zotero_search_bibliography_entries(query=title_or_doi,
                                   collection_key=collection_key, limit=20)
# Alternatively, inspect occurrences in a single citing paper:
zotero_search_bibliography_entries(query=title_or_doi, item_key=citing_item_key,
                                   limit=20)
```

These queries search raw bibliography entries through BM25, not a cited paper's full text.
`collection_key` includes only citing papers filed directly in that collection; semantic search also includes subcollections.
If the request includes subcollections, identify those collections and combine their scoped results, removing duplicate citing items or entries as appropriate to the requested count.
The installed tool has a `limit` but no offset parameter. A capped response gives only some matches, not a verified total.
If needed, query individual known citing papers to check for additional matches without broadening the collection scope.

## How Bibliography Entries Match Papers

| Status or node kind | Meaning |
|---|---|
| `resolved` / `zotero_item` | Entry matched to a library item; use the returned item key to read the paper |
| `external_reference` / `ext:doi:*` | DOI-backed external graph node |
| `external_reference` / `ext:meta:*` | Heuristic metadata match; title variants can produce separate nodes |
| `unresolved` / `ambiguous` | Raw entry remains searchable but does not establish a resolved graph edge |

BM25 scores measure text matching, not identity confidence.
Use returned resolution fields and raw entry text to interpret the mapping rather than assuming confidence from the node prefix alone.
A resolved target outside the requested collection remains a library item, not an external node.

## Which Papers Each Graph Scope Includes

| Scope | Citing sources | Allowed targets |
|---|---|---|
| `collection` | Scoped collection members | Resolved items in the same collection |
| `library` | Resolved library items | Resolved library items |
| `collection-expanded` | Scoped collection members | Resolved items anywhere in the library plus external nodes |
| `library-expanded` | Sidecar-backed library sources | Resolved library items plus external nodes |

Collection scopes take an explicit `collection_key`.
Expanded scope changes which cited targets are allowed. It does not authorize silently adding citing papers outside the requested scope.

```python
zotero_get_citation_neighbors(item_key=item_key, depth=1,
                              scope="collection-expanded", collection_key=collection_key)
zotero_rank_works_by_inbound_citations(scope="collection",
                                      collection_key=collection_key, top_n=5)
zotero_find_bibliographically_coupled_papers(item_key=item_key,
                                            scope="collection", collection_key=collection_key,
                                            top_n=5)
```

## What Limited Graph Results Can Establish

- Neighbors are one-hop relationships; `depth=1` is the supported operation, not recursive traversal.
- Inbound ranking counts resolved graph edges. Unresolved bibliography entries are invisible to that count.
- Coupling measures shared resolved references. Expanded scopes may include external shared targets while result papers remain resolved library items.
- Few resolved references can produce empty coupling results even when two papers are substantively related.
- An expanded textbook-neighbor query can be large; a targeted bibliography lookup can be a cheaper first operation.

If the user explicitly asks to explore citation relationships around a topic, first search that topic within scope to find starting papers, then query their citation relationships.
Read supporting source passages before reporting substantive findings from any papers discovered this way.
