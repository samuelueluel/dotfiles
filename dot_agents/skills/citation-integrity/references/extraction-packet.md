# Extraction Evidence Packet Fields

**Load this file when** inspecting a validated `zotero-extract` packet during main-session adjudication.

The [citation integrity skill](../SKILL.md), section 5, explains how to accept packets and verify them against sources.
This reference explains fields; it is not a separate retrieval route or audit requirement.

| Field or associated status | Review purpose |
|---|---|
| `packet_version` | Identifies the packet format |
| Accepted `processed` state | Manifest/validator status for the item; distinct from confidence in any claim |
| `item_key`, `inclusion_rule` | Assigned source and extraction scope |
| `extraction_route`, `route_fidelity` | How the worker read the source; describes the evidence's origin, not a reranker score |
| `source.path`, `source.sha256` | Source identity and hash used to check for changed input |
| `records[].kind`, `records[].quote`, `records[].anchor` | Evidence type, literal excerpt, and source locator |
| `records[].confidence`, `ambiguous`, `note` | Worker review flags, not proof of correctness |
| `omission_pass`, `negative_result` | Coverage/omission reporting under the inclusion rule |
| `worker` | Which model and process produced the packet |

An empty packet records that no matching evidence was found under its inclusion rule.
The manifest records which items were processed; checking the source establishes whether a claim is supported.
For exact accepted field combinations, use the extraction workflow's validator/schema rather than treating this explanatory table as a payload template.
