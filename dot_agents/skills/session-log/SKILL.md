---
name: session-log
description: Creates, searches, and reviews permanent local Pi session summaries, including bounded manual backlog processing. Use when asked to "log this", "what session did we", "find the session where", "where did we leave off", "catch up", "find unlogged sessions", or "backfill summaries".
---

# Session Summary Management

## Request-Routing Playbook

```text
REQUEST
├─ "log this" / "/log" ──→ WRITE: write or update one permanent summary
├─ "what session did we ..." ──→ SEARCH: permanent summaries, then report matches
├─ "find the session where ..." ──→ SEARCH: permanent summaries, then report matches
├─ "where did we leave off" ──→ RECENT: show recent summaries and synthesize current state
├─ "catch up" ──→ RECENT: show recent summaries and synthesize current state
└─ "session backlog" / "unlogged sessions" / "backfill summaries" ──→ BACKLOG: preview bounded candidates, then summarize only after confirmation
```

## Non-Negotiable Rules

- Only create or update summaries when Samuel explicitly asks to log, catch up, or backfill; never run automatic background logging at startup or shutdown.
- Never edit the JSON summaries file by hand; always use the `piwork summary` CLI tools (`set`, `get`, `search`, `recent`, `backlog`).
- Keep each session's full UUID. New summaries omit `status`; older summaries that already have a `status` field are fine and should be left alone.
- Backlog searches are read-only until Samuel confirms what to process. Always inspect the candidate list first; never assume which session to summarize based on the newest file timestamp.
- Skip active, recent, empty, or greeting-only sessions unless Samuel explicitly asks to include them.
- Never delete or prune summaries, rewrite raw JSONL transcripts, or write routine session logs to Obsidian/TurboVault.

## Canonical Store

The permanent index lives at:

```text
~/.pi/agent/session-summaries.json
```

It is organized by full Pi session UUID and is never automatically pruned. It powers Television fuzzy search and session lookups. Do not use Obsidian or TurboVault for routine session summaries.

## Search

Use the bounded CLI rather than loading the entire JSON file:

```bash
~/.local/bin/piwork summary search --json "price variable"
~/.local/bin/piwork summary get <session-id> --json
~/.local/bin/piwork summary recent --json --limit 10
```

Search matches titles, summaries, changes, locations, next steps, keywords, and initial prompts. Report the session title, date/updated time, workspace, transcript path, and the relevant summary. If no summary matches, fall back to an exact text search of the raw JSONL transcripts and state that the result came from an unsummarized transcript.

## Manual Backlog Processing

Backlog processing is manual, bounded, and separate from session creation. The discovery command is read-only: it does not invoke a model, create summaries, rewrite transcripts, or modify the summary index.

Pi transcripts can be filed in either location:

```text
~/.pi/agent/sessions/--var-home-samuel--/*.jsonl
~/.pi/agent/folders/<Workspace>/*.jsonl
```

Use `piwork summary backlog` to find transcripts whose full UUID is not already in the permanent index. It scans both locations, preserves the workspace name (`Unfiled`, `Economics`, etc.), excludes the active `$PI_SESSION_ID` by default, and excludes recently modified sessions using an idle threshold:

```bash
~/.local/bin/piwork summary backlog --json --days 7 --idle-hours 24 --limit 10
~/.local/bin/piwork summary backlog --json --workspace Economics --days 30 --idle-hours 24 --limit 10
~/.local/bin/piwork summary backlog --json --workspace Unfiled --days 7 --idle-hours 24 --limit 10
```

The result reports the total candidate count, returned count, truncation status, UUID, title, workspace, modification time, transcript path, and message count. Always show or inspect the candidate list before writing summaries. The default batch cap is 10; disclose the cap and never silently process an unbounded backlog.

For a confirmed batch:

1. Process candidates one at a time, preserving each candidate's exact UUID, transcript path, and workspace. The requested summary is persisted as part of processing, so it is available to future `piwork summary search` and Television searches.
2. Skip the active/recent sessions, empty sessions, and clearly trivial conversations unless explicitly asked to include them.
3. Never overwrite an existing summary during backlog processing; the discovery command should already exclude those UUIDs.
4. Read the candidate transcript and write a structured record through `piwork summary set`:

   ```bash
   printf '%s' '<JSON summary object>' | ~/.local/bin/piwork summary set <session-id> --transcript-path '<transcript-path>' --stdin
   ```

5. Report created, skipped, and failed entries, including their workspace names. If more candidates remain, stop at the requested batch limit and ask whether to continue.

Backlog discovery must search both filed workspace folders and `Unfiled`; never scan only the default session directory. Do not infer a target session from the newest transcript, and do not use TurboVault for routine backlog processing.

## Writing a Summary

For "log this", write a structured record with:

- `title`: concise session title
- `summary`: one-sentence purpose/outcome; displayed as `Summary`
- `what_changed`: substantive changes, decisions, or findings; displayed as `Outcomes`
- `where_it_lives`: exact files, commands, or project locations; displayed as `Artifacts`
- `next_up`: unfinished work or verification; displayed as `Open Items`
- `keywords`: exact identifiers worth searching later (variable names, functions, papers, commands, paths)

The user-facing outline is exactly `[Summary]`, `[Outcomes]`, `[Artifacts]`, and `[Open Items]`. When updating a historical record, preserve any stored `status` silently for backward compatibility, but never display a separate status section.

Write it through the atomic CLI interface. In Pi's built-in `bash` tool, use the injected `PI_SESSION_ID` and `PI_SESSION_FILE` values for the active session:

```bash
printf '%s' '<JSON object>' | ~/.local/bin/piwork summary set "$PI_SESSION_ID" --transcript-path "$PI_SESSION_FILE" --stdin
```

For an explicitly identified older session, pass its known UUID and transcript path instead. If the session environment variables are unavailable, do not guess from the newest file; use an explicit session path/ID or state that the summary could not be attached. Preserve existing fields when updating a record.

## Retention and Safety

- Session summaries survive transcript moves and folder renames because they are keyed by UUID.
- If a summary is unavailable, distinguish clearly between a permanent summary result and a raw-transcript fallback.
