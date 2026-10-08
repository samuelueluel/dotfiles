---
name: working-state
description: Template and entry rules for this Claude Code session's working-state ledger (~/.claude/working-state/<session-uuid>.md), which is restored verbatim after every compaction. Use before creating the file, when recording a decision, outcome, or ruled-out approach, on compaction or staleness nudges, on resume, or when asked to update working state.
---

# Working State (one ledger per Claude Code session)

The file is a ledger of facts that must survive compaction word for word: rules Samuel set this session, decisions with reasons, outcomes with statuses and exact numbers, ruled-out approaches with reasons, exact environment facts, and open questions. It lives outside the context window. The exact path is in the system prompt's "Working state" section; it is derived from this session's UUID, so concurrent sessions never share a file. Use that path exactly; never guess another session's file or use a shared `./SESSION-STATE.md`.

## Division of labor with compaction

| Ledger (this file) | Compaction summary | Plugin (automatic) |
| :--- | :--- | :--- |
| Constraints: rules Samuel set | What Samuel asked for and why | Files changed with Edit/Write |
| Decisions with reasons | The task in progress and where it stands | |
| Outcomes with statuses and exact numbers | What the code changes do | |
| Ruled-out approaches with reasons | Recent tool output that still matters | |
| Exact environment facts, open questions | Facts newer than the ledger ("Not yet in the ledger") | |

Files changed with Edit or Write are logged by the plugin and restored after compaction (`<files-changed>`); do not list them in the ledger. Files changed through Bash or MCP tools (a `sed -i`, a saved dataset) are not tracked: record those in Environment when they matter.

At compaction the plugin hands the ledger to the summarizer, which is told not to restate it and to list anything newer under "Not yet in the ledger". After the cut the ledger is restored verbatim. Repeated compactions degrade the summary; they never touch the ledger. So the ledger holds no progress log or narrative: those belong to the summary.

The plugin also nudges when the ledger falls behind (at most twice per prompt), warns before compaction, and blocks the first manual `/compact` while the ledger lags. The file is disposable working state, never Obsidian vault content.

## When to create

Create it when a session is accumulating state worth preserving: multi-step empirical work, data filtering decisions, RAG or Linux setup with versions and endpoints, debugging with diagnoses, specifications tried and rejected. Skip it for quick questions and one-command fixes; a trivial session must never produce one. Write creates the parent directory.

## File contract

```markdown
# SESSION-STATE
<!-- Disposable working state. Graduates into the session-log summary at session end. -->

## Constraints (rules Samuel set this session, in his words)
- 2026-10-07 — "do not modify anything under data/raw"

## Environment / dataset
(paths, versions, filters, endpoints that matter right now)

## Decisions log (append-only, dated)
- YYYY-MM-DD — chose X over Y because ...

## Outcome ledger (exact numbers, commands, errors — and problems)
- [ok] spec A: coef 0.12 (se 0.03), n=4,182
- [failed] `python -m ragserve.index ...` → exit 2, ModuleNotFoundError: ragserve
- [wrong] retrieval@k=10: hits all from one duplicated chunk — dedupe before trusting eval numbers
- [suspect] spec B magnitude implausible for a necessity — suspect 2019 column double-counts

## Ruled out (with reason)
- cross-encoder reranking — dropped: +2s/query, no eval gain

## Open questions / next checks
- recall@10 on held-out queries before tuning chunk size
```

## Entry discipline

- Statuses: `[ok]`, `[wrong]` (wrong for a describable reason; name it), `[suspect]` (not yet diagnosed; re-derive before trusting), `[failed]` (hard error with exact command, exit code, and error string). A run can succeed and still be wrong; record that case.
- Exactness: coefficients with SEs and n; command lines with exit codes and error strings; versions and endpoints. Never paraphrase. After compaction, "it errored" is worthless; `ModuleNotFoundError: ragserve` is actionable.
- Constraints: write a rule the moment Samuel states it, in his words; remove it only when he lifts it.
- Overwrite section: Environment describes now. Append-only: Decisions log and Outcome ledger; corrections are appended, never rewritten. Ruled out and Open questions are pruned as they resolve.
- Edit the section that changed with Edit; never rewrite the whole file.
- When to write: when the fact arises (a run finished, a spec or filter chosen, an approach ruled out, a diagnosis found), with its reason written then. Not after every tool call, and never a progress narrative.
- Several goals in one session: one file, entries tagged (`[rag]`, `[stata]`).

## When to re-read

The plugin injects the content after compaction and on resume (`<working-state-restore>`): restore exact outcomes, decisions, and open checks from it before continuing. After a compaction, copy anything the summary lists under "Not yet in the ledger" into the ledger. Re-read the file yourself whenever you notice you have lost the thread.

## Todo linkage

Derive new todo items from Open questions / next checks. When a completed todo produced a substantive result, write the result with its exact numbers into the Outcome ledger. The todo list is the pointer; the file is the payload.

## End of session

When Samuel asks to log the session, `piwork summary log <session-uuid>` reads this file as evidence alongside the transcript (session-log skill). Never hand-write the summary. Leave the file in place.

## Subagents

Only the main session writes this file. Subagents never create or edit it.
