---
name: working-state
description: Maintains a UUID-scoped disposable working-state file in ~/.pi/agent/working-state/ that survives compaction without mixing concurrent Pi windows. Use for multi-step empirical, RAG/linux/python projects, long debugging, compaction nudges, session resume, or requests to update working state.
---

# Working State (one file per Pi session)

Within-session memory lives **outside the context window**, at `~/.pi/agent/working-state/<full-Pi-session-UUID>.md`. It is separate from the working directory: multiple Pi windows launched from `~` never share state. Compaction and the context window cannot cut the file. This is disposable working state — never Obsidian vault content, never injected into prompts. Post-compaction re-reading is hook-enforced by `working-state-reminders.ts`, which also fires a pre-compaction early warning (≈40k tokens before the trigger, per the launcher env). Manual `/blackhole` compaction asks for confirmation; choose No to cancel, update/create the named file, then rerun.

**Resolve the exact path before your first write or read:** Call `working_state_path({})` and use its absolute `state_file` value; `session_id` is the full Pi session UUID and `exists` tells you whether to restore an existing file. This read-only tool asks Pi's live session manager and creates nothing. Call it again after a session replacement; do not reuse an old session's path. If the tool is unavailable, use the absolute path printed by this session's hook nudge or Blackhole dialog, or run `printf '%s\n' "$PI_SESSION_ID"` in Pi's `bash` tool and require a full UUID before deriving `~/.pi/agent/working-state/<UUID>.md`. Shell exposure is not guaranteed: an empty variable does not mean the workflow or session is broken. Never use `PI_SESSION_RUNTIME_ID` (a process/runtime identifier), guess an ID, scan for the newest transcript, substitute the cwd, use another window's file, or fall back to `./SESSION-STATE.md`. If no exact current-session path can be resolved, ask Samuel to run `/reload` to load the resolver rather than writing shared state. Create the parent directory only when you decide a file is warranted; do not create a file for a trivial session. Existing legacy `./SESSION-STATE.md` files are left untouched, not automatically copied (they may belong to another live window). Migrate a known file into *this* session's file only after verifying its provenance.

## When to create

Create the file when a session is accumulating state worth preserving: multi-step empirical work, data filtering decisions, RAG or linux setup with versions and endpoints, debugging with diagnoses, specifications tried and rejected. Skip it for quick questions and one-command fixes — creation is a judgment call, and a trivial session must never produce one.

## File contract

```markdown
# SESSION-STATE
<!-- Disposable working state. Graduates into the session-log summary at session end. -->

## Current threads
(one status line per active goal: what it is and its acceptance condition)

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

- **Statuses**: `[ok]`, `[wrong]` (wrong for a describable reason — name it), `[suspect]` (not yet diagnosed — future-you must re-derive before trusting), `[failed]` (hard error with exact command, exit code, and error string). Not every outcome is an error: a run can succeed and still be wrong for a describable reason — that is the category agents under-report, so record it.
- **Exactness**: exact coefficients with SEs and n; exact command lines with exit codes and error strings; exact versions and endpoints. Never paraphrase. Post-compaction, "it errored" is worthless; `ModuleNotFoundError: ragserve` is actionable.
- **Overwrite sections**: Current threads and Environment describe *now*. **Append-only sections**: Decisions log and Outcome ledger — corrections are appended, never rewritten. Ruled out and Open questions are pruned as they resolve.
- **Edit the section that changed; never rewrite the whole file.** Keeps each update at edit-sized cost.
- **When to write**: after any substantive result — a run finished, a spec or filter was chosen, an approach was ruled out, a diagnosis was found, a plan changed. Not after every tool call.
- **Multiple concurrent goals within one session**: still one file for that UUID — list each goal under *Current threads* and tag Decisions/Outcome entries (`[rag]`, `[stata]`). Different sessions, even in the same cwd, always use different files.

## When to re-read

On session start when this session's UUID file exists (resume), after compaction (a transient hook nudge will say so), and whenever you notice you have lost the thread. Restore first: exact outcomes, decisions, open checks — then continue.

## Todo linkage (conventions only, no behavior change)

1. Derive new todo items from *Open questions / next checks* so the terse list matches the real backlog.
2. When a completed todo produced a substantive result, write that result into the *Outcome ledger* with its exact numbers. The todo list is the pointer; the file is the payload.

## End of session

When Samuel asks to log the session, the UUID-scoped file is the evidence companion for the summary: its Decisions, Outcome ledger, and Open questions map to the logger's `what_changed`, `outcomes`, and `next_up` fields. The dedicated logger (`piwork summary log` per the session-log skill) autodetects by the transcript's UUID; never hand-write the summary. Leave the state file in place. The central store is outside project git repos; no project `.gitignore` change is needed.

## Multi-agent note

Explore subagents are read-only (hook-enforced). This file is written only in the main session.
