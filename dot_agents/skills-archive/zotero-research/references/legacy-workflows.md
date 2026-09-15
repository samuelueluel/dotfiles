# Legacy Zotero Research Workflows

**Load this file when** auditing the pre-refactor combined Zotero research workflow or checking whether guidance was preserved in the task-specific skills. Do not use it as the model-facing task router.


# Zotero Research

## Choose the Workflow

Use every row that applies. A request may need more than one workflow; do not drop any part of it.

| If the user asks to… | Action | Guidance |
|---|---|---|
| Read every paper in a collection or explicit list | Use `zotero-extract` | [Extraction skill](../../../skills/zotero-extract/SKILL.md) |
| Explicitly run an automated evidence audit | Use the bounded `zotero_audit_claims` workflow | Section 6 |
| Find or read a named paper, DOI, citation key, or item key | Use `zotero_resolve_exact_source`, then read the exact paper | Section 4 |
| Compare findings or identify the largest, smallest, or strongest effect | Find candidates, choose the comparison basis, and check papers that could change the answer | Sections 1–3 |
| Answer a substantive question about stored papers | Use `zotero_semantic_search` within scope, then read supporting passages | Sections 1 and 3 |
| Find or count mentions of a work in bibliographies | Use `zotero_search_bibliography_entries` | Section 5 |
| Examine citation relationships or rank papers by citations | Use scoped citation tools | Section 5 |

## What This Skill Covers

- This skill governs which papers to check, what to read next, and when to stop.
- Load [citation integrity](../../../skills/citation-integrity/SKILL.md) for source-grounded answers. It governs what can support a claim, statistical interpretation, where the evidence came from, and footnotes; apply it while reading, not as an extra audit pass.
- Use official Zotero MCP tools. Keep ordinary research in the main session; use extraction workers only through explicitly requested [zotero-extract](../../../skills/zotero-extract/SKILL.md).
- Preserve the requested library, collection and subcollections, exact items, and metadata filters. Collection membership determines which papers are in scope, not study geography.
- Read existing sources only. For requested metadata changes, load [library management](../../../skills/zotero-library/SKILL.md); for requested parsing, indexing, or recovery, load [pipeline operations](../../../skills/zotero-pipeline/SKILL.md).
- Never download or embed a paper just because it appears in a bibliography. Do not invent tags or change metadata during research.
- Read known-item sidecars through `zotero_find_in_item`. Never shell-parse sidecars, MCP internal files, or gateway temporary output.
- Inspect unfamiliar tool schemas before calling them. Use returned locators and current capabilities, not guessed parameters or assumed tools.

## 1. Find Relevant Papers Within the Requested Scope

Identify the requested outcome, comparison, and statistical fields before retrieval.
For a named source, complete section 4 first. For a ranking, use section 2 after initial discovery.

1. Start with one focused `zotero_semantic_search`, normally `limit=5–8`.
2. Pass `collection=<KEY>` for collection scope and `filters={"item_keys": ["<KEY>"]}` for verified exact items.
3. Inspect the best passages for candidate results. Titles and metadata abstracts guide discovery; they are not verified findings.
4. Keep each useful `evidence_id` with its item key and the fact still needed. Keep these evidence IDs when shortening working notes.

Search limits count distinct items, not passages. Increasing the limit cannot expand a preview.
If an evidence ID is lost, recover it with one search restricted to that exact item. Do not repeat searches with different wording to recover the same passage.
For unknown collection keys, load [collection keys](../../../skills/zotero-library/references/collections.md).

## 2. Compare or Rank Findings

### Choose what is being ranked

Before detailed statistical extraction, distinguish:
- Overall outcomes from subtypes or components.
- Counts, rates, percentages, and their baseline denominators.
- Per-unit effects from whole-program effects; for example, buildings, housing units, and demolition events are different doses.
- Local area effects from aggregate effects and outcomes for displaced individuals.
- Main estimates from subgroup, dosage, dynamic, and robustness maxima.

If the user authorizes judgment, choose and state a comparison basis within the requested scope. Do not exclude an allowed outcome or population merely because its estimate uses a different scale.
Otherwise, if the user needs one ranking and plausible definitions would select different winners, ask one focused question.
If the user requests comparisons under multiple definitions, label each comparison separately.
When the comparison basis is otherwise clear, state it and proceed. Never imply that unlike percentages measure the same effect.

### Check for Papers That Could Change the Answer

Supplement semantic search with a bounded collection inventory or a differently targeted metadata search within the same scope.
Use `zotero_list_collection_items(collection_key=..., detail="summary", include_subcollections=true)` to match semantic scope; follow pagination.
Do not fetch full metadata for every item. Inventory titles identify papers worth checking, not their findings.

Keep a short internal shortlist: item key, result or missing fact, and one of these states:
- **Comparable:** source evidence establishes an estimate on the selected basis.
- **Different estimand:** the source reports a relevant effect, but it measures a different outcome, treatment, population, or time horizon from the selected comparison.
- **Outside the question:** source evidence establishes why it does not qualify.
- **Unresolved:** the source or relevant result has not been adequately checked.

A missing hit, negative rerank score, or irrelevant passage leaves a candidate unresolved; it does not exclude the paper.
Read the source's own results, not only its discussion of another paper. Do not classify a paper as model-only from a clipped introduction.
Prioritize the apparent leader and the other paper most likely to change the answer. Do not discard a difficult large estimate for an easily retrieved small one.
Use section 3 to resolve each gap; do not perform an exhaustive extraction unless requested.

### State What the Comparison Established

Apply citation-integrity's scale and inference rules before ranking.
If a paper has not been adequately checked and could plausibly change the ranking, state that uncertainty. A limited search does not establish a collection-wide maximum.
Describe the ranking using the measure actually compared and the papers checked—for example, **largest reported percentage among those checked** when comparing percentages. State material differences in outcome, treatment dose, denominator, and time horizon.
Once the leader and relevant alternatives are supported, stop extracting statistics for papers that will only be named.

## 3. Read the Missing Evidence, Then Stop

Before each follow-up, identify internally the missing requested detail, necessary context, or result that could change the ranking.
If none remains, answer. Do not retrieve again for reassurance, a better rerank score, or citation bookkeeping.

| Evidence state | Smallest useful next action |
|---|---|
| Adequate source text already in context | Use it; no new call |
| Useful hit is clipped or ends at a heading | `zotero_read_passage(evidence_id=...)`; add `neighbors=1` for adjacent context |
| Passage or sidecar window is truncated | Continue from its returned character or line locator |
| Exact phrase, table label, or heading in a known item | Bounded `zotero_find_in_item(item_key=..., query=...)`; use `zotero_find_in_pdf` when a verified PDF-page locator is needed |
| Actual PDF page is known | `zotero_read_pdf_pages(item_key=..., start_page=..., end_page=...)` |
| Text is ambiguous because layout, signs, columns, or a figure matter | `zotero_render_pdf_page(item_key=..., page=..., region=...)` for actual image inspection |
| Conceptual fact is missing and no useful passage exists | One focused exact-item semantic search |
| Whole-argument evaluation or explicit full-read request | Read the full source, using fulltext or complete staged windows |

Before re-searching an item, identify what the previous hit did not supply. Never rerun a search merely to see that hit in full.
After two uninformative attempts to find the same missing fact, use a different search or reading method, or report that the fact remains unresolved.
Do not cycle through synonymous queries that return the same inadequate preview.

Use an outline or an available location tool to find the actual PDF page index.
Never infer PDF pages or source locations from passage numbers, sidecar length, or apparent paper length.
If no PDF page index is available, read a precise sidecar window and identify its source location as required by citation integrity.
For sidecar continuations, pass the returned `source_hash` as `expected_hash` to reject changed text.
For `zotero_find_in_pdf`, page numbers are one-based PDF indices, not printed labels, sidecar lines, or indexed offsets. It searches only the authoritative PDF text layer and reports `complete`, `partial_text_coverage`, or `no_usable_text`; a no-match on incomplete coverage is not evidence of absence. Its windows are verbatim extracted page text. Use `zotero_render_pdf_page` only for unresolved visual ambiguity; coordinates, extracted text, and generated descriptions are not image inspection.
For lookup and continuation examples, load [source-reading details](../../../references/zotero/deep-dive-reading.md).

Reuse a result and its notes once they are adequately verified. Read another representation only to resolve a specific remaining uncertainty. Follow citation integrity when extracted table text is ambiguous; do not silently repair it.
Still retrieve the requested SE, CI, or p-value, even if it cannot change the ranking.
If the requested uncertainty measure cannot be retrieved, say so. Omit optional numerical claims instead of researching them just to fill a table.
Do not expand graphs, read whole papers, or call `advisor` merely to feel thorough.

## 4. Find the Exact Named Paper

Call `zotero_resolve_exact_source` with the user's original identifier and requested collection scope.
Preserve the supplied title, author, year, DOI, citation key, and version details. Never use a related paper to resolve conflicting identifiers.

- **Exact:** bind subsequent reads to the returned parent key and reuse its metadata.
- **Ambiguous:** disclose the conflict and ask; do not choose by semantic relevance.
- **Absent:** report absence in the requested scope and stop the named-source task.

`related_matches` are not substitutes. Do not resolve or read a related source unless the user separately requests it or changes the target.
Never silently combine working-paper and published versions.
If the resolver is unavailable, a uniquely verified exact metadata lookup may establish identity and scope.
An empty collection list in metadata, or a missing parent-collection key, does not prove that the paper is absent from the collection and its subcollections.
Ordinary metadata reads do not require the library-management skill.
For identifier fields, fallback lookups, or advanced filters, load [identity and scope details](../../../references/zotero/search-retrieval.md).

## 5. Find Bibliography Mentions and Citation Relationships

To find bibliography mentions, query `zotero_search_bibliography_entries` within the requested set of citing papers.
Distinguish the number of mentions from the number of distinct citing papers. Check whether the response is capped before claiming a total.
Semantic search includes the collection and its subcollections; bibliography `collection_key` filtering includes only direct members. Preserve the requested scope explicitly rather than assuming the tools search the same papers.

For network questions, choose the requested measure and pass an explicit graph scope:
- `zotero_get_citation_neighbors`: direct cited/citing neighbors, `depth=1`.
- `zotero_find_bibliographically_coupled_papers`: shared resolved references.
- `zotero_rank_works_by_inbound_citations`: resolved inbound edges, not raw citation totals or hub centrality.

An external or unresolved reference does not establish absence from the library. Verify metadata identity before labeling it absent.
Never infer a cited work's findings or outgoing bibliography from an external node.
If substantive findings are needed, return to source reading for the identified paper.
For scope tables, resolution fields, and bounded query examples, load [bibliography and graph details](../../../references/zotero/bibliography-graphs.md).

## 6. Run an Automated Evidence Audit Only When Asked

Use `zotero_audit_claims` only when Samuel explicitly requests an automated evidence-contract audit, never inside `zotero-extract`.
A request to verify estimates or consider significance is ordinary research, not audit authorization.

1. Load the archived [audit payload and errors](../../zotero-evidence-audit/references/claim-audit.md) and inspect the deployed schema.
2. Submit up to eight claims, each covering one result or comparison, with literal quotes and an accurate description of where the evidence came from; start with `escalation="none"`.
3. Expand clipped semantic hits and sidecar windows before copying quotes. Reuse successful queries unchanged.
4. Allow one request-wide repair pass: at most three targeted retrievals and one audit rerun, including any tool-side bounded escalation.
5. On a legacy schema or capability failure, report the problem and stop the audit.

Never repair quotes, invent provenance, or tune scores or thresholds to force acceptance.
Passing the audit does not establish that the source supports the claim, identifies a causal effect, makes estimates comparable, or covers all relevant papers. The audit checks only its specified evidence requirements; do not cite it as source evidence.

## 7. Answer and Handle Access Failures

Lead with the answer and the qualification needed to interpret it. Use citation-integrity's footnote format.
For “which paper?”, give the leading estimate and one or two relevant alternative papers, not a literature review.
If the user also requests an eligible-paper list, identify the remaining papers without unnecessary numerical summaries.
Keep ledgers, repeated deliberation, and speculative recollections out of commentary; report only meaningful progress or blockers.
Check that the opening claim does not overstate which papers and findings were checked. Never imply verification or auditing that did not occur.

Research errors do not authorize rebuilding, reinstalling, starting services, or processing missing files.
If an embedder or reranker is unavailable, ask Samuel to run `serve-embedder` or `serve-reranker`; never auto-start them.
If metadata or filters fail, report the error and retry without weakening scope. Use index status only after a readiness/index error.
Missing sidecars or inaccessible attachments are access limitations, not negative findings.
For diagnosed infrastructure failures, load [pipeline operations](../../../skills/zotero-pipeline/SKILL.md). An irrelevant search result does not mean the retrieval service is broken.
