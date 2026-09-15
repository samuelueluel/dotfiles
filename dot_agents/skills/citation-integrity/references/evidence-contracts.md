# Evidence Record Formats

**Load this file when** preparing machine-readable evidence records or checking where evidence came from.

The [citation integrity skill](../SKILL.md) governs what can support a claim and how to cite it for readers.
These are working-record examples, not a tool payload schema or extra bookkeeping required for every answer.

## Source Evidence Fields

| Field | Meaning |
|---|---|
| Item key and verified citation identity | Source to which the evidence belongs |
| Supporting excerpt and result context | The actual claim support, including necessary notes |
| Reading method | Indexed passage, extracted PDF text, full-source text, sidecar text, or inspected image |
| Source location | Actual passage, section, PDF page index, printed page, or sidecar window |
| Evidence ID | Returned `evidence_id`; neighbors have separate IDs |
| Hash/version fields | Returned content/source identifiers, retained with their original names and route |
| Source classification | Verified native `itemType`, `source_group`, and canonical tags when already available |

## Source Location Examples

```text
Author Year; item KEY; passage N/M; evidence_id=<returned token>; Rerank=<returned score>
Author Year; item KEY; PDF p. X; Table Y; extracted page text
Author Year; item KEY; PDF p. X; Table Y; inspected page image
Author Year; item KEY; sidecar lines X–Y; source_hash=<returned hash>
```

Record a PDF page index only when its correspondence to the supporting text is established. Otherwise cite the passage, section, or sidecar lines actually read.
`read_passage` character offsets belong to the stored chunk; `find_in_item` character offsets belong to the sidecar source.
An expanded neighbor's source location identifies its text without acquiring the anchor's score.

## Identity and Bibliography Records

```text
Identity: exact / ambiguous / absent; original identifier; item keys; requested scope
Bibliography: citing item KEY; entry identifier; raw entry; resolution status and method
```

Resolver membership fields describe where an identity was established.
Bibliography resolution confidence and BM25 match scores measure different things; do not use one in place of the other.
Raw entries remain useful evidence that a mention occurred when the cited work's identity is unresolved.

## Graph Records

```text
Inbound rank: scope=collection KEY; target KEY; rank=R; inward_citations=N
Neighbors: scope=collection-expanded KEY; seed KEY; direction=incoming; target=ext:doi:...
Coupling: scope=library; seed KEY; related KEY; Jaccard=J; shared_references=N
```

Retain the actual returned measure, node kind, direction, and scope.
For parameters and scope, load [bibliography and graph details](../../zotero-research/references/bibliography-graphs.md).

## Classification Suffixes

Example: `journalArticle/article; review:checked`.
Native types, query-time source groups, and tags are separate fields, not interchangeable credibility labels.
If optional classification fields are missing, leave them absent; the core skill does not require retrieval solely to fill them in.
