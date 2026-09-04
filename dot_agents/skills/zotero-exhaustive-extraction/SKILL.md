---
name: zotero-exhaustive-extraction
description: Recall-led exhaustive extraction over a named Zotero collection using the zotero-extract spine. Use when Samuel asks for ALL papers, every item, complete coverage, or an audit of a collection ("extract every estimate in <collection>", "audit the collection for X", "which papers in <collection> report Y") — never for ordinary topical questions. Workers read full documents and emit validated evidence packets; a coverage manifest tracks every item to a terminal state.
---

# Zotero Exhaustive Collection Extraction

## Non-Negotiable Rules

- Every eligible item must reach a terminal state — `processed`, `excluded` (reason), `unreadable` (reason), `failed`, or `escalated`. The run ends only at zero pending.
- Worker packets are the only evidence entering the reduce stage; records carry verbatim quotes + anchors, never prose summaries of sources.
- An empty packet is a negative finding (`examined_in_full: true`, `qualifying_evidence: false`); with records present, `qualifying_evidence` is `true`.
- Never quote from memory or paraphrase. Fix validation failures by re-copying from the source; never weaken a packet or edit a source to pass.
- Never create sidecars during a run. Text-layer and flagged items go to `worklist` for Samuel's local `zotero-sidecar.sh create`.
- No cloud OCR, no cloud embedding, no downloads. pihat receiving sidecar text is Samuel's standing permission; preprocessing stays local.
- Sources that fail closed are escalated, never forced: multi-PDF ambiguity, oversized sources, scanned PDFs.
- Never reprocess a terminal item; interrupted runs resume from `pending`.
- Worker delegation may never exceed the session's configured subagent concurrency, and no concurrency number may be hardcoded.
- Identity, verification, adjudication, and synthesis stay in the main session.

## Request-Routing Playbook

```text
REQUEST
├─ "all / every / complete / audit" over a named collection
│    └─ first run, new rule, or new schema ──→ SMOKE: ~8 items, then full collection
├─ Named source, finding, number, or topical question ──→ ORDINARY RAG: zotero skill
│                                                          (identity → content → verify)
├─ Existing / interrupted run directory ──→ RESUME: status → manifest --json → pending loop
└─ Run complete (zero pending) ──→ CLOSE: manifest → worklist → reduce (citation-integrity)
```

Mode contracts: ordinary Zotero search answers from best-supported passages — completeness requests never route there. Exhaustive extraction: the collection inventory determines coverage; retrieval plays no role. Reduce: a separate stage after manifest close; it consumes packets only.

## Preconditions

- `zotero-extract` on PATH (chezmoi-managed `~/.local/bin/zotero-extract`).
- Zotero Desktop running with the local API enabled (init + text-layer PDF resolution); `--items-file` is the offline fallback.
- No embedder, reranker, or VLM is needed — never start support services for this workflow.
- Sandboxed launches: `~/zotero-extraction-runs` is mounted read-write in the pi-safe level 1 containers only, so the default run location works from any launch dir; sidecars are readable through the level-1 read-only home mount. Level 2 has neither sidecar access nor a runs mount and cannot extract — run unsandboxed or at level 1.
- Cloud quota: for a full collection prefer an `openrouter-us` worker model over the Codex default (per-5h caps); runs are resumable when capped.

## Operating Sequence

1. **Confirm with Samuel**: collection key (`zotero_list_collections`), the inclusion rule (one sentence gating what qualifies), worker tier — and the run directory, which defaults to `~/zotero-extraction-runs/<run-id>/` unless Samuel names a project dir for the artifacts.
2. **Init**: `zotero-extract init --collection <KEY> --name "<Name>" --rule "<rule>" --outdir ~/zotero-extraction-runs/<run-id>` (`--rule-file` for long rules). Enumeration covers the collection subtree, deduplicated. Note the sidecar/text-layer split it reports.
3. **Smoke first** (first-ever run, new rule, or new schema): run the loop on ~8 items across both routes plus one likely out-of-scope item; inspect packets and manifest; get Samuel's nod; continue.
4. **Per-item loop**: `zotero-extract source RUNDIR KEY` → JSON with source path, route, and hash. Delegate the worker turn per the delegation policy. `zotero-extract submit RUNDIR packet.json`. Spine-marked escalations (`no_pdf`, `multiple_pdf_attachments`, `oversized_source`, `no_text_layer`) are recorded and moved past.
5. **Failures**: validation failures → re-brief the worker with exact violations; two consecutive failures on an item → `mark failed`. Out of scope → `mark excluded --reason out_of_scope_per_rule`. Garbled sidecar → `mark escalated --reason "needs local sidecar rebuild"`.
6. **Close**: zero pending → report manifest counts to Samuel; `worklist` lists sidecar-creation candidates.
7. **Reduce separately**: adjudicate conflicting records, assess comparability, synthesize against the inclusion rule. Final claims follow the citation-integrity contract; the manifest proves coverage, not findings.

## Worker Delegation & Concurrency

- Worker turns may delegate to subagents in **both tiers** — for context isolation, not speed: each paper's full text lives in a disposable child context, never in main-session history.
- Concurrency is bounded by `PI_SUBAGENTS_MAX_CONCURRENT` exactly as the launcher sets it (4 on pihat/betahat; 1–2 on pi/beta per Samuel's launch choice). Never override it and never hardcode a number — cloud multi-fan-out falls out of launcher config.
- The worker model inherits the session model by default; same-model homogeneity is required within a run, and the packet `worker` field records provenance.
- The main session retains enumeration, submits, escalations, adjudication/reduce, synthesis, and all interaction with Samuel.

## Progressive Disclosure & Reference Routing

- If preparing a worker turn, handling a validation failure, or checking exactly what `submit` enforces, load [worker protocol](references/worker-protocol.md).
