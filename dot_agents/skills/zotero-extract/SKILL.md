---
name: zotero-extract
description: Recall-led exhaustive extraction over a frozen Zotero item scope using the zotero-extract spine. Use when Samuel explicitly asks to use "zotero-extract" or requests ALL papers, every item, complete coverage, or an audit over an explicit collection or item list. Workers read full documents and emit validated evidence packets; a coverage manifest tracks every scoped item to a terminal state.
---

# Zotero Extract

## Non-Negotiable Rules

- Every eligible item must reach a terminal state — `processed`, `excluded` (reason), `unreadable` (reason), `failed`, or `escalated`. The run ends only at zero pending.
- WorkerResultV1 outputs are the only worker evidence entering the reduce stage; the deterministic CLI materializes exact source-backed quotes and constructs the validated packet. Records never contain prose summaries of sources.
- An empty packet is a negative finding (`examined_in_full: true`, `qualifying_evidence: false`); with records present, `qualifying_evidence` is `true`.
- Never quote from memory or paraphrase. Fix validation failures by re-copying from the source; never weaken a packet or edit a source to pass.
- Never create sidecars during a run. Text-layer and flagged items go to `worklist` for Samuel's local `zotero-sidecar.sh create`.
- No cloud OCR, no cloud embedding, no downloads. pihat receiving sidecar text is Samuel's standing permission; preprocessing stays local.
- Sources that fail closed are escalated, never forced: multi-PDF ambiguity, oversized sources, scanned PDFs.
- Never reprocess a terminal item; interrupted runs resume from `pending`.
- Never run full scoped extraction in local pi/beta; full runs belong strictly in pihat/betahat. For pihat/betahat, the paper-reading fan-out must use four concurrent `Explore` workers whenever at least four items are pending; packet submissions remain serial. Local pi/beta is strictly sequential (1 worker) and reserved for smoke tests or small subsets.
- Dispatch workers strictly as `Explore` subagents (`subagent_type: "Explore"`) with the `ZOTERO_EXTRACT_WORKER: FULL_DOCUMENT` prompt marker; workers must never mutate files or invoke the extraction spine directly. Omit `max_turns` entirely for these assignments: when no explicit limit/default is configured, pi-subagents treats it as unlimited, while `max_turns: 0` is rejected by the Agent tool schema.
- Worker delegation follows `PI_SUBAGENTS_MAX_CONCURRENT` as exported by the launcher; never hardcode a concurrency override.
- Identity, verification, adjudication, and synthesis stay in the main session.

## Request-Routing Playbook

```text
REQUEST
├─ Explicit `zotero-extract` request: new scope/run ──→ INIT: freeze scope → smoke when required
├─ Explicit `zotero-extract` request: existing/interrupted run
│    └─→ RESUME: status → manifest --json → pending loop
└─ Explicit `zotero-extract` request: zero pending
     └─→ CLOSE: manifest → worklist → reduce (citation-integrity)
```

Workflow boundary: `zotero` owns identity, ordinary RAG, metadata, references, graphs, and library operations. This skill begins after explicit extraction selection; explicit invocation is always honored. Within an extraction run, the frozen item inventory determines coverage, collection membership is only one scope provider, and retrieval does not gate completeness. Reduce is a separate stage after manifest close; it consumes packets only.

## Scope Model

Every run freezes a deterministic inventory of Zotero parent item keys at `init`. A collection selector expands and deduplicates a collection subtree; `--item KEY`, `--items KEY1,KEY2`, or `--items-file FILE` selects explicit documents without requiring them to share a Zotero collection. The manifest records `scope_type`, `scope_spec`, and `inventory_source`; downstream source resolution, packet validation, and terminal-state accounting operate on the frozen item inventory rather than on collection membership. A collection is an inventory source, not a requirement for extraction.

An explicit extraction inventory is independent of semantic-index scope. If completed sidecars later need embedding, pass the same explicit parent keys to the exact-key index refresh (`zotero_update_semantic_index(item_keys=[...])` or `zotero-mcp-server update-db --fulltext --no-batch --item-key KEY`); do not broaden it into a collection-wide update or infer an unrequested production scope.

`--items-file` accepts either a JSON list or `{"items": [...]}`. Each entry may be a Zotero item key string or an object with `key`/`item_key`, `title`, `itemType`, and `date`. Explicit duplicate keys and entries declaring attachment/note/annotation item types are rejected; key-only offline entries cannot be type-checked without local Zotero metadata. The legacy `--collection KEY --items-file FILE` form remains accepted as an offline collection snapshot; new runs should use `--items-file` alone for an explicit scope.

## Preconditions

- `zotero-extract` on PATH (chezmoi-managed `~/.local/bin/zotero-extract`).
- Zotero Desktop running with the local API enabled for collection enumeration, direct `--item`/`--items` metadata resolution, and text-layer PDF resolution; `--items-file` is the offline-friendly explicit-scope fallback.
- No embedder, reranker, or VLM is needed — never start support services for this workflow.
- Sandboxed launches: `~/zotero-extraction-runs` is mounted read-write in the pi-safe level 1 containers only, so the default run location works from any launch dir; sidecars are readable through the level-1 read-only home mount. Level 2 has neither sidecar access nor a runs mount and cannot extract — run unsandboxed or at level 1.
- Cloud quota: for a full scoped run prefer an `openrouter-us` worker model over the Codex default (per-5h caps); runs are resumable when capped.

## Operating Sequence

1. **Confirm with Samuel**: the scope selector (collection key, explicit item keys, or an item-list file), the inclusion rule (one sentence gating what qualifies), worker tier — and the run directory, which defaults to `~/zotero-extraction-runs/<run-id>/` unless Samuel names a project dir for the artifacts.
2. **Init** with exactly one new scope form: `zotero-extract init --collection <KEY> --rule "<rule>" --outdir ~/zotero-extraction-runs/<run-id>`; `zotero-extract init --item <KEY> --item <KEY> --rule "<rule>" --outdir ...`; or `zotero-extract init --items-file <FILE> --rule "<rule>" --outdir ...` (`--rule-file` for long rules). Collection enumeration covers the subtree and deduplicates; explicit scopes freeze the supplied item keys. Note the sidecar/text-layer split it reports.
3. **Smoke first** (first-ever run, new rule, or new schema): run the loop on ~8 items from the selected scope across both routes, including any deliberately selected negative/control item; inspect packets and manifest; get Samuel's nod; continue.
4. **Per-item loop**: `zotero-extract source RUNDIR KEY` → JSON with source path, route, and hash. For pihat/betahat full runs, dispatch the next batch of up to four pending papers to concurrent `Explore` readers, wait for their complete WorkerResultV1 outputs, run `zotero-extract check-worker-result RUNDIR KEY RESULT.json`, then submit valid results serially with `zotero-extract submit-worker-result RUNDIR KEY RESULT.json --worker LABEL`. For local pi/beta smoke tests, dispatch one reader at a time. Only normally completed workers may enter the checker: `steered`, `aborted`, `stopped`, provider-failed, output-truncated, or otherwise partial results are invalid regardless of JSON appearance. Discard a cutoff result and restart a fresh worker from the unchanged pending scope; never submit a cutoff/resumed result. Spine-marked escalations (`no_pdf`, `multiple_pdf_attachments`, `oversized_source`, `no_text_layer`) are recorded and moved past.
5. **Failures**: validation failures → re-brief the worker with exact violations; two consecutive failures on an item → `mark failed`. Out of scope → `mark excluded --reason out_of_scope_per_rule`. Garbled sidecar → `mark escalated --reason "needs local sidecar rebuild"`.
6. **Close**: zero pending → report manifest counts to Samuel; `worklist` lists sidecar-creation candidates.
7. **Reduce separately**: adjudicate conflicting records, assess comparability, synthesize against the inclusion rule. Final claims follow the citation-integrity contract; the manifest proves coverage, not findings.

## Citation-integrity handoff

A packet accepted by `zotero-extract submit` is candidate evidence for the main session, not an automatically approved citation. After the manifest reaches zero pending and before synthesis, the main session must:

1. Confirm the packet is `processed`, the `item_key` resolves to the requested source, the `inclusion_rule` matches the run, and `source.path`/`source.sha256` still match the manifest and disk.
2. Recheck each `records[].quote` verbatim and preserve its `records[].anchor` as the page, section, or table locator. `records[].kind` classifies the candidate claim; `confidence`, `ambiguous`, and `note` remain flags rather than proof.
3. Preserve `extraction_route` and `route_fidelity`. A `mineru_sidecar` packet must be recheckable against the permitted sidecar route; a `pdf_text_layer` packet must be re-read through `zotero_get_item_fulltext` or `zotero_read_pdf_pages` before final approval when the packet alone is insufficient.
4. Never invent a `Rerank` score for full-document, sidecar, or direct-page evidence. If a claim relies on semantic RAG, retrieve a separate `zotero_semantic_search` passage and require raw `Rerank > 0` under `citation-integrity`.
5. Resolve conflicts, comparability, units, samples, specifications, attribution, and cross-paper synthesis in the main session. `omission_pass`, `negative_result`, and the manifest provide completeness signals, not automatic substantive support.
6. Keep the validated JSON packet unchanged for machine-facing review. Render approved human-facing claims using `citation-integrity`'s `[^cN]` footnotes; never expose raw packet JSON as the answer.

## Worker Delegation & Concurrency

- Worker turns may delegate to subagents in **both tiers** — for context isolation, not speed: each paper's full text lives in a disposable child context, never in main-session history.
- Concurrency is bounded by `PI_SUBAGENTS_MAX_CONCURRENT` exactly as the launcher sets it: `pihat`/`betahat` exports 4 workers for parallel fan-out; `pi`/`beta` exports 1 worker (strictly sequential).
- Full scoped extraction runs should be executed in `pihat`/`betahat`, where the launcher must provide four worker slots for the paper-reading fan-out; local `pi`/`beta` is strictly sequential and reserved for smoke tests or small subsets.
- Workers are dispatched as `Explore` subagents (`subagent_type: "Explore"`) with the `ZOTERO_EXTRACT_WORKER: FULL_DOCUMENT` prompt marker; omit `max_turns` for these assignments so a large source is not cut off by an arbitrary turn ceiling. Use all four available slots for independent paper reads when four or more items are pending; never serialize those reads in the main session. Workers emit only WorkerResultV1 semantic records with source character spans; the CLI derives packet metadata and exact quotes. A worker manager outcome of `completed` is required; `steered`, `aborted`, `stopped`, provider failure, output truncation, or ambiguous termination is a hard failure even when the returned text parses. Discard and freshly restart a failed worker from unchanged pending scope. When the orchestration interface supports schema-constrained Explore output, that is the required WorkerResultV1 dispatch format; otherwise raw output must pass the strict checker and fail closed on violation. The checker never replaces deterministic validation. The main session runs the checker, serial packet submission, manifest mutation, escalations, adjudication, and synthesis.
- The worker model inherits the session model by default; same-model homogeneity is required within a run, and the packet `worker` field records provenance.
- The main session retains enumeration, submits, escalations, adjudication/reduce, synthesis, and all interaction with Samuel.

## Progressive Disclosure & Reference Routing

- If preparing a worker turn, handling a validation failure, or checking exactly what `submit` enforces, load [worker protocol](references/worker-protocol.md).
