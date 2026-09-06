---
name: session-log
description: Creates, searches, and reviews permanent local Pi session summaries. Use when asked to "log this", "what session did we", "find the session where", "where did we leave off", or "catch up".
---

# Session Summary Management

The canonical store is the permanent local index:

```text
~/.pi/agent/session-summaries.json
```

It is keyed by the full Pi session UUID and is never automatically pruned. It powers Television previews and agent-facing session search. Do not treat the 30-day Obsidian logs as authoritative; routine session logging does not use TurboVault.

## Intent Routing

```text
REQUEST
├─ "log this" / "/log"          → write or update one permanent summary
├─ "what session did we ..."     → search permanent summaries, then report matches
├─ "find the session where ..."  → search permanent summaries, then report matches
├─ "where did we leave off"     → show recent permanent summaries and synthesize status
└─ "catch up"                    → show recent permanent summaries and synthesize status
```

## Search

Use the bounded CLI rather than loading the entire JSON file:

```bash
~/.local/bin/piwork summary search --json "price variable"
~/.local/bin/piwork summary get <session-id> --json
~/.local/bin/piwork summary recent --json --limit 10
```

Search matches titles, summaries, changes, locations, next steps, keywords, and initial prompts. Report the session title, date/updated time, workspace, transcript path, and the relevant summary. If no summary matches, fall back to an exact text search of the raw JSONL transcripts and state that the result came from an unsummarized transcript.

## Writing a Summary

For "log this", write a structured record with:

- `title`: concise session title
- `summary`: one-sentence purpose/outcome
- `what_changed`: substantive changes, decisions, or findings
- `where_it_lives`: exact files, commands, or project locations
- `next_up`: unfinished work or verification
- `keywords`: exact identifiers worth searching later (variable names, functions, papers, commands, paths)

Write it through the atomic CLI interface. In Pi's built-in `bash` tool, use the injected `PI_SESSION_ID` and `PI_SESSION_FILE` values for the active session:

```bash
printf '%s' '<JSON object>' | ~/.local/bin/piwork summary set "$PI_SESSION_ID" --transcript-path "$PI_SESSION_FILE" --stdin
```

For an explicitly identified older session, pass its known UUID and transcript path instead. If the session environment variables are unavailable, do not guess from the newest file; use an explicit session path/ID or state that the summary could not be attached. Preserve existing fields when updating a record.

## Retention and Safety

- Never delete or prune records automatically.
- Session summaries survive transcript moves and folder renames because they are keyed by UUID.
- Do not rewrite raw JSONL transcripts to store summaries.
- Do not write routine summaries to Obsidian or invoke TurboVault.
- If a summary is unavailable, distinguish clearly between a permanent summary result and a raw-transcript fallback.
