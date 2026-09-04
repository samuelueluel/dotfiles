# Worker Protocol

**Load this file when** preparing a worker extraction turn, handling a validation failure, or checking exactly what `zotero-extract submit` enforces.

## Worker Prompt Template

```
You are an extraction worker for item <KEY> (<title>). Below is the FULL text of
the source (route: <mineru_sidecar|pdf_text_layer>). Read all of it.

Inclusion rule: <RULE>

Extract EVERY part of the source that satisfies the rule. For each, emit one
record — evidence packets, not summaries:

{
  "packet_version": 1,
  "item_key": "<KEY>",
  "worker": "<provider/model of this worker session>",
  "inclusion_rule": "<RULE>",
  "extraction_route": "<route>",
  "route_fidelity": "<high|low>",
  "source": {"path": "<source_path>", "sha256": "<source_sha256>"},
  "records": [
    {"kind": "finding|definition|method|estimate|qualification",
     "quote": "<verbatim quote, >=20 chars, copied exactly from the source text>",
     "anchor": {"page": null, "section": "<nearest heading or null>",
                "table": "<table label or null>"},
     "confidence": "high|medium|low",
     "ambiguous": false,
     "note": "<why flagged, or empty>"}
  ],
  "omission_pass": {"performed": true, "records_added": 0},
  "negative_result": {"examined_in_full": true, "qualifying_evidence": true}
}

Rules:
- Copy quotes character-for-character from the provided text (whitespace may
  differ; wording may not). Never quote from memory or paraphrase.
- Be overinclusive on qualifying content; flag ambiguity (ambiguous: true)
  rather than resolving it.
- After the first pass, re-scan the full text specifically for omissions
  (tables, appendices, footnotes, qualifications) and set omission_pass.
- Set negative_result.qualifying_evidence=true when records is non-empty;
  for a negative finding emit an empty records list with
  qualifying_evidence=false. examined_in_full is always true.
- Do not report bibliography/reference-list entries as findings.
- Do not estimate numbers obscured or absent from the text; flag them instead.

[full source text below]
<source>
...
</source>
```

## Validation Contract (`zotero-extract submit`)

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

1. `VALIDATION FAILED` → re-brief the worker with the exact violation list; the worker re-copies quotes from the provided source text.
2. Two consecutive failed submits on one item → `zotero-extract mark RUNDIR KEY failed --reason "<violation summary>"`.
3. Never weaken the schema, drop the omission pass, or trim quotes to force acceptance.

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
