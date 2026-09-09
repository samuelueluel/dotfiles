# Worker Protocol

**Load this file when** preparing a worker extraction turn, handling a validation failure, or checking exactly what `zotero-extract submit` enforces.

## WorkerResultV1 Prompt Template

```
You are an extraction worker for item <KEY> (<title>). The full source text is
at <source_path> (route: <mineru_sidecar|pdf_text_layer>, fidelity: <high|low>) —
read all of it there; the orchestrator does not inline large sources.

ZOTERO_EXTRACT_WORKER: FULL_DOCUMENT

Inclusion rule: <RULE>

Extract EVERY part of the source that satisfies the rule. Return ONLY one
plain JSON object with exactly these three top-level keys:

{
  "records": [
    {"kind": "finding|definition|method|estimate|qualification",
     "span": {"start": 0, "end": 0},
     "anchor": {"page": null, "section": "<nearest heading or null>",
                "table": "<table label or null>"},
     "confidence": "high|medium|low",
     "ambiguous": false,
     "note": "<why flagged, or empty>"}
  ],
  "omission_pass": {"performed": true, "records_added": 0},
  "negative_result": {"examined_in_full": true, "qualifying_evidence": true}
}

`span.start` is the zero-based inclusive character offset and `span.end` is
the exclusive character offset in the exact UTF-8-decoded source text at
<source_path>. The orchestrator will copy `source_text[start:end]` verbatim
into the final packet. Do not emit a `quote` field.

Rules:
- Use a small local script or exact source search to determine character spans;
  never reconstruct a quote from memory or normalize OCR, LaTeX, punctuation,
  glyphs, or whitespace.
- Return no packet metadata or aliases: do not emit `packet_version`, `item_key`,
  `worker`, `inclusion_rule`, `extraction_route`, `route_fidelity`, `source`,
  `source_route`, `path`, `sha256`, `type`, or any other top-level key.
- Each record must have exactly the six fields shown above. Do not replace
  `kind` with `type`, or `span`/`anchor` with strings.
- Be overinclusive on qualifying content; flag ambiguity (`ambiguous: true`)
  rather than resolving it.
- After the first pass, re-scan the full text specifically for omissions
  (tables, appendices, footnotes, qualifications) and set `omission_pass`.
- Set `negative_result.qualifying_evidence=true` when records is non-empty;
  for a negative finding emit an empty records list with
  `qualifying_evidence=false`. `examined_in_full` is always true.
- Do not report bibliography/reference-list entries as findings.
- Do not estimate numbers obscured or absent from the text; flag them instead.
- If a qualifying passage cannot be located exactly in the source, do not
  invent a span; omit it and explain the limitation in an included note.
- If the source content clearly does not match the item's title or type, record
  the problem in a qualifying record's note as a probable sidecar misassignment.
- Return raw JSON only: no Markdown fences, prose, or wrapper commentary.
```

## Orchestrator Notes

- Workers never invoke the spine. The orchestrator runs
  `check-worker-result RUNDIR KEY RESULT.json`, then
  `submit-worker-result RUNDIR KEY RESULT.json` serially — concurrent
  submissions would race the manifest.
- `submit-worker-result` derives item identity, inclusion rule, route, fidelity,
  source path, source hash, packet version, and final quotes from the frozen
  manifest and source file. It stores the accepted raw WorkerResultV1 beside
  the constructed packet for auditability; it never repairs aliases or quotes.
- When the orchestration interface offers schema-constrained Explore output,
  constrain the WorkerResultV1 shape at dispatch. This reduces emission drift
  but does not replace `check-worker-result` or final packet validation.
- Dispatch workers as `Explore` subagents (`subagent_type: "Explore"`) with
  the `ZOTERO_EXTRACT_WORKER: FULL_DOCUMENT` marker and omit `max_turns`.
  When no explicit limit/default is configured, omitted `max_turns` is unlimited
  in pi-subagents; `max_turns: 0` is invalid in the Agent tool schema. The
  ordinary Explore search budget is not a completeness boundary for this
  explicit one-source assignment. Explore runs with `prompt_mode: replace`,
  giving each paper a clean, isolated context.
- For oversized sources, `split-sidecar` carves section-aligned parts with
  base offsets; workers run the unchanged WorkerResultV1 contract per part
  file, and the orchestrator remaps spans (`global = local + base_offset`)
  before assembling the packet for `submit`.

## Citation boundary

Workers emit packet fields only. They do not emit citation-integrity tokens, human-facing footnotes, adjudication decisions, or cross-paper synthesis. The main session performs the packet-to-citation handoff only after deterministic validation and source/hash checks.

## Validation Contract

### WorkerResultV1 (`check-worker-result` / `submit-worker-result`)

- The result must be a JSON object with exactly `records`, `omission_pass`, and `negative_result`; aliases, packet metadata, and extra fields hard-fail.
- Each record must contain exactly `kind`, `span`, `anchor`, `confidence`, `ambiguous`, and `note`. `kind` and `confidence` use the documented enums; `ambiguous` is boolean.
- `span` contains integer character offsets with `0 <= start < end <= len(source_text)`. The CLI materializes the quote from the pinned source; workers never provide or normalize quote text.
- `anchor` contains nullable `page`, `section`, and `table`; `omission_pass.performed` is true; `negative_result.examined_in_full` is true; and `qualifying_evidence` is true if and only if records is non-empty.
- The checker returns machine-readable errors and mutates nothing. Submission stores the accepted raw result and constructed packet only after both intermediate and final validation pass.

### Constructed packet (`zotero-extract submit`)

- `packet_version` must be `1`; `inclusion_rule` must exactly echo the run's rule (stale or cross-run packets rejected).
- `item_key` must exist in the run and be `pending`.
- `extraction_route` AND `route_fidelity` must match the manifest for the item.
- `source.path` must match the manifest's source; `source.sha256` must match both the current file and the manifest record (mid-run source changes fail closed).
- `worker` is optional; if present, a string (provider/model provenance).
- `records` is a list (possibly empty). Each record: `kind` in {finding, definition, method, estimate, qualification}; `quote` ≥ 20 normalized chars AND contained verbatim in the source text; `anchor` an object with nullable page/section/table (a section string not found in the source soft-warns); `confidence` in {high, medium, low}; `ambiguous` a boolean.
- `omission_pass.performed` must be `true` — the second pass is mandatory.
- `negative_result.examined_in_full` must always be `true`; `qualifying_evidence` must be `true` if and only if `records` is non-empty.
- `submit` reports ALL violations at once and mutates nothing on failure. Section-anchor misses warn only; everything else hard-fails.

## Retry Ladder

1. `check-worker-result` failure → preserve the manifest unchanged, discard the result, and restart a fresh `Explore` worker for the unchanged pending item with the exact machine-readable violations; require complete raw WorkerResultV1 re-emission, never a patch.
2. `submit-worker-result` failure → preserve the manifest unchanged and retry with a fresh complete result and the exact errors.
3. Two consecutive failed submissions on one item → `zotero-extract mark RUNDIR KEY failed --reason "<violation summary>"`.
4. Never add alias mapping, type coercion, fuzzy span/quote repair, weaken the schema, drop the omission pass, or trim source text to force acceptance.
5. Mistakenly closed item → `zotero-extract mark RUNDIR KEY pending --reason "<why>"` (refused from `processed`); then run `source` again, which revalidates hashes and adopts a newly built sidecar automatically.

Truncated or unparsable worker output (e.g. a turn-limit cutoff) is handled like
a validation failure: discard it and restart a fresh worker from the unchanged
pending item with the full wrapper requirements — never resume, splice, repair,
or hand-complete a partial packet. A worker marked `steered`, `aborted`,
`stopped`, failed, or otherwise possibly partial is never admissible, even when
its returned text appears complete. Recurring quote-failure classes observed in
practice: silent OCR repair (the worker normalizes garble the source really
contains) and LaTeX/spacing artifact drift (`$10\%$` vs `$10 \%$`). Name the
class in the re-brief and demand character-for-character re-copying with all
artifacts intact.

## WorkerResultV1 Field Reference

| Field | Type | Notes |
|---|---|---|
| `records` | list | possibly empty; each record is source-span based |
| `records[].kind` | enum | finding \| definition \| method \| estimate \| qualification |
| `records[].span` | obj | integer `start`/`end`, end-exclusive character offsets |
| `records[].anchor` | obj | nullable `page`/`section`/`table` fields |
| `records[].confidence` | enum | high \| medium \| low |
| `records[].ambiguous` | bool | flag, never resolve |
| `records[].note` | str | why flagged, or empty |
| `omission_pass` | obj | `performed: true`, non-negative `records_added` |
| `negative_result` | obj | `examined_in_full: true`; `qualifying_evidence` ⇔ records |

## Escalation & Failure Catalog

| Trigger | State | Reason string |
|---|---|---|
| No resolvable PDF attachment | `unreadable` | `no_pdf: no PDF attachment resolvable` |
| Two or more PDF attachments | `escalated` | `multiple_pdf_attachments: ...` (human selects the source) |
| `pdftotext` not installed | `escalated` | `no_text_extractor: pdftotext not installed` |
| `pdftotext` failure | `escalated` | `text_extraction_failed: ...` |
| PDF with empty text layer (scanned) | `escalated` | `no_text_layer: PDF has no extractable text layer` |
| Source text over the character budget | `escalated` | `oversized_source: ...` (unit processing not yet implemented) |
| Sidecar vanished mid-run | `escalated` | `sidecar disappeared mid-run` |
| Sidecar empty/garbled (worker judgment) | `escalated` (manual `mark`) | `needs local sidecar rebuild` |

Escalated and unreadable items are terminal for the run; the `worklist` command collects them plus text-layer-processed items as local sidecar-creation candidates.

## Packet Field Reference

| Field | Type | Notes |
|---|---|---|
| `packet_version` | int | `1` |
| `item_key` | str | pending item in this run |
| `worker` | str? | optional provider/model provenance |
| `inclusion_rule` | str | exact echo of the run rule |
| `extraction_route` | enum | `mineru_sidecar` \| `pdf_text_layer` |
| `route_fidelity` | enum | `high` \| `low` |
| `source` | obj | `path` + `sha256`, pinned to manifest and disk |
| `records` | list | possibly empty; empty requires an honest negative result |
| `records[].kind` | enum | finding \| definition \| method \| estimate \| qualification |
| `records[].quote` | str | ≥ 20 normalized chars, verbatim in source |
| `records[].anchor` | obj | `page`/`section`/`table`, any nullable; section soft-checked |
| `records[].confidence` | enum | high \| medium \| low |
| `records[].ambiguous` | bool | flag, never resolve |
| `records[].note` | str | why flagged, or empty |
| `omission_pass` | obj | `performed: true` mandatory |
| `negative_result` | obj | `examined_in_full: true` always; `qualifying_evidence` ⇔ records |
