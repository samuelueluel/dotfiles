# Extraction Evidence Packet Fields

**Load this file when** inspecting a validated `zotero-extract` packet during main-session adjudication.

The [citation integrity skill](../SKILL.md) governs adjudication and source verification. This table describes packet fields; it does not introduce another retrieval or audit pass.

| Packet field | Purpose in Review |
|---|---|
| `packet_version`, accepted `processed` state | Packet format and validator/processing status. |
| `item_key`, `inclusion_rule` | Assigned source identity and scope rule. |
| `extraction_route`, `route_fidelity` | Shows how the worker read the source. This is provenance, not a `Rerank` score. |
| `source.path`, `source.sha256` | Verifies that the packet came from an unchanged source file. |
| `records[].kind`, `records[].quote`, `records[].anchor` | Evidence kind, verbatim quote, and page/section locator. |
| `records[].confidence`, `ambiguous`, `note` | Worker review flags and notes. |
| `omission_pass`, `negative_result` | Indicates whether the worker checked the whole document. An empty result is an honest negative finding. |
| `worker` | Model and process metadata for the audit trail. |

