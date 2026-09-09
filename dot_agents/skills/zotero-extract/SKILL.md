---
name: zotero-extract
description: Recall-led exhaustive extraction over a frozen Zotero item scope using the zotero-extract spine. Use when Samuel explicitly asks to use "zotero-extract" or requests ALL papers, every item, complete coverage, or an audit over an explicit collection or item list. Workers read full documents and emit validated evidence packets; a coverage manifest tracks every scoped item to a terminal state.
---

# Zotero Extract

## Request-Routing Playbook

```text
REQUEST
├─ Explicit `zotero-extract` request: new scope/run ──→ INIT: freeze scope → smoke test when required
├─ Explicit `zotero-extract` request: existing/interrupted run
│    └─→ RESUME: status → manifest --json → pending loop
└─ Explicit `zotero-extract` request: zero pending
     └─→ CLOSE: manifest → worklist → reduce (citation-integrity)
```

## Non-Negotiable Rules

- Every paper in the run must reach a final terminal state: `processed`, `excluded` (with reason), `unreadable` (with reason), `failed`, or `escalated`. The run ends only when zero items are pending.
- Workers return only WorkerResultV1 outputs. The `zotero-extract` CLI extracts the exact source quotes and builds the validated packet. Records must never contain prose summaries of papers.
- An empty packet means the paper was read completely and contained no matching evidence under the rule (`examined_in_full: true`, `qualifying_evidence: false`). An empty packet is a valid negative finding.
- Never call `zotero_audit_claims` inside an extraction run. That tool is for ordinary Zotero search only and cannot replace full-document extraction checks.
- Never quote from memory or paraphrase. If a quote fails validation, copy the exact characters from the source text. Never edit the source file or weaken checks to force a pass.
- Never create sidecars during a run. Papers that need sidecars are recorded on the `worklist` for Samuel to process locally with `zotero-sidecar.sh create`.
- No cloud OCR, no cloud embeddings, and no web downloads. Preprocessing stays completely local.
- Sources with unresolvable issues (multiple conflicting PDFs, scanned pages without text, oversized files) fail closed and are marked `escalated`. Never force them through.
- Never reprocess a finished paper; if a run is interrupted, resume from `pending`.
- Run full collection extractions in `pihat`/`betahat`. On cloud sessions, use four concurrent `Explore` subagents to read papers whenever four or more items are pending. Packet submissions are always serial. Local `pi`/`beta` runs one worker at a time and is reserved for smoke tests or small test sets.
- Dispatch workers strictly as `Explore` subagents (`subagent_type: "Explore"`) with the `ZOTERO_EXTRACT_WORKER: FULL_DOCUMENT` prompt marker. Workers are read-only; runtime hooks automatically remove turn caps and block mutations.
- Concurrency follows `PI_SUBAGENTS_MAX_CONCURRENT` as exported by the session launcher; never hardcode a concurrency override.
- Scope definition, verification, adjudication, and final synthesis always stay in the main session.


Workflow boundary: `zotero` handles ordinary search, identity, metadata, and citation graphs. This skill starts only when extraction is explicitly chosen. The run operates on a frozen list of item keys. Synthesis happens in the main session only after all items are processed.

## Scope Model

Every run freezes an exact list of Zotero item keys at `init`. A collection expands and deduplicates all papers within it; `--item KEY`, `--items KEY1,KEY2`, or `--items-file FILE` selects explicit papers without requiring a shared collection. Downstream extraction operates on this frozen inventory, not on live collection membership.

An extraction inventory is independent of the semantic search database. If completed sidecars need to be embedded later, pass those exact keys to `zotero_update_semantic_index(item_keys=[...])`.

`--items-file` accepts a JSON list of keys or objects with `item_key`, `title`, and `date`. Attachments, notes, and annotations are rejected.

## Preconditions

- `zotero-extract` must be on PATH (`~/.local/bin/zotero-extract`).
- Zotero Desktop must be running with the local API enabled.
- No embedder, reranker, or vision model is needed—never start support services for this workflow.
- Sandboxes: `~/zotero-extraction-runs` is mounted read-write only in `pi-safe` level-1 containers. Level-2 containers cannot run extraction. Run unsandboxed or at level 1.
- Cloud quotas: for large runs, prefer an `openrouter-us` worker model over Codex to avoid 5-hour rate limits. Runs can be resumed if a cap is reached.

## Operating Sequence

1. **Confirm with Samuel:** The scope selector (collection key, explicit items, or items file), the inclusion rule (one clear sentence defining what qualifies), worker tier, and the run folder (defaults to `~/zotero-extraction-runs/<run-id>/`).
2. **Init the run:** Run `zotero-extract init` with `--collection`, `--item`, or `--items-file` and `--rule "<rule>"`. Note the sidecar/text-layer breakdown it reports. Sidecars over the character budget escalate immediately at init, before any worker is dispatched. Cloud (`pihat`) runs may export `ZOTERO_EXTRACT_MAX_SOURCE_CHARS=600000` (workers there have ~320K-token windows with compaction near 256K tokens); keep the 400000 default on local runs.
3. **Smoke test first:** For a new run or rule, test ~8 items across both sidecar and PDF routes, including a control paper that should test negative. Inspect the packets with Samuel before continuing.
4. **Per-item loop:**
   - Call `zotero-extract source RUNDIR KEY` to get the source path and route. If a sidecar was built after init (e.g. from a worklist pass), `source` adopts it automatically.
   - On `pihat`/`betahat`, dispatch the next batch of up to 4 pending papers to concurrent `Explore` subagents. On local `pi`/`beta`, dispatch one at a time.
   - Wait for the complete WorkerResultV1 outputs.
   - Check each result with `zotero-extract check-worker-result RUNDIR KEY RESULT.json`.
   - Submit valid results serially with `zotero-extract submit-worker-result RUNDIR KEY RESULT.json --worker LABEL`.
   - Only normally completed workers are valid. If a worker was stopped, aborted, or truncated, discard the output and start a fresh worker from the pending list.
5. **Handle Failures:**
   - If quotes fail validation, re-brief the worker with the exact error. After two consecutive failures, mark the item failed (`zotero-extract mark failed`).
   - If a paper does not meet the rule, mark it excluded (`mark excluded --reason out_of_scope_per_rule`).
   - If a sidecar is unreadable, mark it escalated (`mark escalated --reason "needs local sidecar rebuild"`).
   - If an item was closed by mistake, return it with `mark RUNDIR KEY pending --reason "<why>"` (any state except processed, which is final). The next `source` call revalidates hashes and picks up any sidecar built since closing.
   - If an item escalated as `oversized_source` and the paper is worth extracting, carve it with `split-sidecar SIDECAR --max-chars N --out DIR`, dispatch one worker per part (part path in place of the source path; spans are part-local), remap spans by adding each part's `base_offset`, assemble one packet with quotes copied from the full sidecar at global offsets, and submit with `submit` (which revalidates everything verbatim). Each part performs its own omission pass; disclose the cross-part seam in synthesis.
6. **Close:** When zero items are pending, report the final counts to Samuel. The `worklist` command lists items that need sidecars created.
7. **Synthesize Findings:** Adjudicate conflicts and synthesize results in the main session. All final claims use the `citation-integrity` footnote format.

## Citation-Integrity Handoff

A submitted packet contains candidate evidence for the main session. Before writing conclusions:

1. Verify that the packet is `processed`, the `item_key` matches, and the source hash matches disk.
2. Re-check each verbatim quote and anchor (page, section, or table).
3. Check the extraction route. If a claim requires semantic search, retrieve a separate `zotero_semantic_search` passage with `Rerank > 0`. Never invent `Rerank` scores for extraction packets.
4. Compare findings and resolve conflicts across papers in the main session.
5. Format final findings using `citation-integrity` footnotes (`[^cN]`); never dump raw JSON packets in chat.

## Worker Delegation & Concurrency

- Workers run in subagents for context isolation: each paper's full text lives in a temporary child session, keeping the main chat history clean.
- Concurrency follows `PI_SUBAGENTS_MAX_CONCURRENT`: `pihat`/`betahat` uses 4 parallel workers; local `pi`/`beta` uses 1 worker.
- Dispatch workers as `Explore` subagents (`subagent_type: "Explore"`) with `ZOTERO_EXTRACT_WORKER: FULL_DOCUMENT` in the prompt. Do not set `max_turns`.
- Workers emit only WorkerResultV1 data with exact character offsets. The CLI extracts the verbatim quotes and metadata.
- Workers must finish with a status of `completed`. Discard stopped, aborted, or truncated workers and restart them fresh.
- The main session handles all tool submissions, manifest updates, escalations, cross-paper synthesis, and interaction with Samuel.

## Reference Guides

- For worker prompt templates, validation rules, and exact submission checks, read [worker protocol](references/worker-protocol.md).
