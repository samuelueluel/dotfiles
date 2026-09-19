# Zotero Tool Parameter Bounds

**Load this file on the first retrieval call of a session**, before guessing
parameter names. The deployed schema is authoritative; these bounds were
verified against fork release `samuel-v0.11.0.22` — recheck them after any
release upgrade.

## Lookup budgets (all text budgets are 256–16000 chars)

| Tool | Required | Bounds that burn rounds |
|---|---|---|
| `zotero_find_in_item` | `item_key` | No `limit` param — use `max_matches` (1–10). `max_chars` is a TOTAL budget (256–16000). `context_lines` 0–20. `query: null` reads lines (default 40). Literal case-insensitive substring only; math markup splits digits, so search phrases, not numbers. |
| `zotero_find_in_pdf` | `item_key`, `query` | `max_matches` 1–10. Page range over 50 pages is rejected — narrow with `start_page`/`end_page`. `offset` paginates matches. Query whitespace spans source whitespace. |
| `zotero_read_pdf_pages` | `item_key`, `start_page` | No `page` param — one page is `start_page: N` alone. Optional `end_page`, `attachment_key`. |
| `zotero_read_passage` | `evidence_id` | `neighbors` 0–2. Total text budget 256–16000. Offsets are chunk-relative; use the returned `next_char_start` to continue. |
| `zotero_semantic_search` | `query` | `limit` counts items, not passages (one best passage per item). Exact-item scope is `filters: { item_keys: [...] }`; collection scope is the separate `collection` param. |

## Composite research tools

| Tool | Bounds that burn rounds |
|---|---|
| `zotero_collect_result_evidence` | Max 4 items per call. Max 2 phrases per text route (`sidecar_queries`, `pdf_queries`). `neighbors` 0–2. `compact` caps each route read at 1200 chars — too small to adjudicate inclusion; use full windows for decisions. Server trims deterministically via `max_total_chars` and resumes from the returned continuation token. |
| `zotero_validate_comparison_manifest` | `max_reported_items` is 1–3. Card `evidence_ids` must be route-prefixed (`zr1:…`, `pdf:KEY:…`, `mineru:KEY:…`); bare keys and prose are rejected. |
| `zotero_audit_claims` | Max 8 atomic claims, `escalation: "none"`. One cycle per question: one call plus one resubmission, and only for a genuine caller-payload error. `expected_values` carry one estimate plus its inference value per claim; table/figure locators and years are not findings. |
