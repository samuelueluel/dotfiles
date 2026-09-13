---
name: session-log
description: Creates, searches, and reviews permanent local Pi session summaries, automatically filters objectively trivial backlog entries, and processes bounded Pi JSONL transcript backlogs through piwork. Use when asked to "log this", "/log", "what session did we", "find the session where", "where did we leave off", "catch up", "find unlogged sessions", or "backfill summaries", or when working with `piwork summary`, `~/.pi/agent/session-summaries.json`, `~/.pi/agent/session-log.sqlite`, or `*.jsonl` transcripts.
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
└─ "session backlog" / "unlogged sessions" / "backfill summaries" ──→ BACKLOG: classify and auto-skip objectively trivial candidates, preview substantive candidates, then summarize after confirmation
```

## Non-Negotiable Rules

- Only create or update curated summaries when Samuel explicitly asks to log, catch up, or backfill; never run automatic model-based summarization at startup or shutdown.
- Use the dedicated session logger for summary drafts; the parent model must not silently substitute itself or write a hand-composed summary.
- Automatic indexing of raw JSONL transcripts into SQLite is allowed and does not count as summary creation.
- Separate reasoning rules from physical boundaries: make eligibility and retrieval decisions here, use `piwork` for summary persistence, and route any vault-note operation through TurboVault. Existing hooks enforce the physical vault and Chezmoi boundaries; do not bypass them with shell workarounds.
- Never edit the JSON summaries file by hand; always use the `piwork summary` CLI tools (`log`, `set`, `get`, `search`, `recent`, `backlog`, `sync`). The workflow-invariants hook blocks direct `write`, `edit`, and shell access to `session-summaries.json`.
- Keep each session's full UUID. New summaries omit `status`; older summaries that already have a `status` field are fine and should be left alone.
- Backlog discovery and eligibility classification are read-only. Automatically exclude objectively trivial candidates before asking Samuel to approve summaries; always inspect the candidate list first and never assume which session to summarize from the newest file timestamp.
- Automatically skip active, recent, empty, greeting-only, and other objectively trivial sessions during backlog classification; do not ask Samuel to decide about each one. An explicit request to include a named session or category overrides the filter.
- Never delete or prune summaries, rewrite raw JSONL transcripts, or write routine session logs to Obsidian/TurboVault.

## Automatic Backlog Eligibility

After read-only discovery, classify candidates before asking Samuel to approve any summaries. Automatically exclude a candidate without prompting only when it is definitively low-value:

- empty or whitespace-only transcript;
- all user turns are greetings, thanks, acknowledgments, cancellations, goodbyes, or obvious test pings, with no substantive assistant work;
- a short transient control/plumbing session—such as agent dispatch/status checking or a one-off settings/path lookup—that produced no persistent change, durable decision, reusable artifact, substantive research or empirical finding, or unresolved follow-up.

Do not classify from the title or message count alone. Do not auto-exclude a session merely because it is short, read-only, delegated, failed, or abandoned. Any persistent change, meaningful conclusion, decision, deliverable, or useful open item makes it substantive. When uncertain, treat it as substantive. An explicit request to include a named session or category overrides this filter.

Active sessions and recent sessions remain excluded from ordinary backlog processing unless Samuel explicitly asks to include them; this is a safety/settling rule, not a judgment that they are unimportant.

Report automatic exclusions as aggregate counts and reason categories by default; do not invoke the logger or create an “ignored” summary record. Preview the remaining substantive candidates with full UUIDs, workspace, modification time, transcript path, and message count, then ask once for confirmation. If no substantive candidates remain, report that no summaries were needed and do not ask for confirmation.

## Storage and Indexing

Pi keeps the original JSONL transcripts in its normal session locations. The curated session-log records remain authoritative in:

```text
~/.pi/agent/session-summaries.json
```

A permanent, rebuildable SQLite projection lives at:

```text
~/.pi/agent/session-log.sqlite
```

SQLite indexes every transcript, including sessions without summaries. Unlogged sessions have no curated summary row; their summary fields are not invented or filled automatically. The database is rebuilt from the JSONL transcripts and JSON summary store if necessary. Do not use Obsidian or TurboVault for routine session summaries.

## Search

Use the bounded CLI rather than loading the entire JSON or any full transcript:

```bash
~/.local/bin/piwork summary search --json "price variable"
~/.local/bin/piwork summary get <session-id> --json
~/.local/bin/piwork summary recent --json --limit 10
~/.local/bin/piwork summary sync --json
```

Search is summary-first. It searches curated titles, summaries, outcomes, artifacts, open items, and keywords through SQLite summary FTS. If no curated summary matches, it searches all indexed transcript chunks, including initial prompts, and labels the results as transcript/unsummarized fallback results. Read the original JSONL transcript only after selecting a relevant result.

## Dedicated Session Logger

`piwork summary log` starts a separate ephemeral Pi logger process pinned to `openai-codex/gpt-5.6-luna` at `high` thinking. This is not an Agent-tool `Explore` or `Executor` subagent: the original session runs in its normal Pi process, while this one-session logger reads a bounded projection and exits after persisting the summary. It flushes and reads the canonical JSONL transcript, then sends a bounded evidence-preserving projection to the logger on stdin. The projection preserves user/assistant text, tool calls, identifiers, and compaction summaries; drops opaque reasoning signatures and tool-result details; and marks excerpted payloads explicitly. The logger input has a conservative 1.5 million-character operational cap; this is a character budget, not a tokenizer-derived model-context guarantee. Malformed JSONL or transcripts whose conversational content still exceeds the cap fail explicitly without writing a summary. The canonical transcript is never rewritten. The logger includes any existing summary as context and requires structured output for `title`, `summary`, `outcomes`, `artifacts`, `open_items`, and `keywords`. `title` is mandatory and must be non-empty; a missing or blank title is a logger-validation failure and must not be persisted. The CLI maps the user-facing fields `outcomes`, `artifacts`, and `open_items` to the stable stored keys `what_changed`, `where_it_lives`, and `next_up`.

For a confirmed cloud/pihat batch, `piwork summary log-batch --stdin --workers 4 --json` may run up to four of these logger processes concurrently. Workers only generate and validate drafts; the parent persists successful drafts in deterministic input order with one atomic JSON write and SQLite sync. This is bounded logger-process fan-out, not Agent-tool subagents. Use `--workers 1` for local/resource-constrained runs or when provider throttling outweighs the latency gain.

`piwork summary log` validates one logger draft and writes it through the summary persistence layer; `piwork summary log-batch` validates several drafts concurrently and persists them atomically; `piwork summary set` is reserved for an already validated draft or an explicitly approved parent fallback. Logger workers never write JSON, SQLite, transcripts, or vault notes directly. Logger failures do not fall back silently to the parent model. Use `--thinking max` only for an explicit exceptional case; the normal logger setting is `high`. A parent-generated fallback requires both a validated `--fallback-json` payload and `--parent-fallback-approved`.

`catch up` first reads existing recent summaries. It creates missing summaries only when Samuel explicitly asks for that follow-up; then it previews the bounded backlog and uses the bounded cloud logger batch path when several substantive candidates are confirmed.

## Manual Backlog Processing

Backlog processing is bounded and separate from session creation. Discovery and eligibility classification are read-only: they do not invoke a model, create summaries, rewrite transcripts, or modify the summary index. Only confirmed substantive candidates are sent to the dedicated logger.

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

The result reports the total candidate count, returned count, truncation status, UUID, title, workspace, modification time, transcript path, and message count. Always show or inspect the candidate list before writing summaries. The default processing cap is 10 substantive candidates per batch; disclose the cap and never silently process an unbounded backlog. Automatically skipped candidates do not consume this cap.

For a confirmed batch:

1. After Samuel confirms the substantive batch, preserve each candidate's exact UUID, transcript path, and workspace. For cloud/pihat candidates, pass the confirmed bounded candidate list to `piwork summary log-batch --stdin --workers 4 --json`; for local/resource-constrained runs, use `--workers 1`. The requested summaries are persisted as part of processing, so they are available to future `piwork summary search` and Television searches.
2. Do not ask for approval about candidates already excluded by the automatic eligibility filter. Preserve the explicit-include override for active, recent, empty, or otherwise trivial sessions.
3. Never overwrite an existing summary during backlog processing; the discovery command should already exclude those UUIDs.
4. Use the batch interface for confirmed cloud/pihat batches:

   ```bash
   printf '%s' '<backlog-json-with-confirmed-candidates>' | ~/.local/bin/piwork summary log-batch --stdin --workers 4 --json
   ```

   For a single session, or when batch fan-out is not appropriate, use:

   ```bash
   ~/.local/bin/piwork summary log <session-id> --transcript-path '<transcript-path>' --json
   ```

5. Report each created record with its session ID, title, and workspace. Report automatically skipped and failed entries, including workspace names; report automatic skips as aggregate counts and reason categories unless Samuel asks for the individual list. If more than 10 substantive candidates remain, stop at the cap and ask whether to continue.

Backlog discovery must search both filed workspace folders and `Unfiled`; never scan only the default session directory. Do not infer a target session from the newest transcript, and do not use TurboVault for routine backlog processing.

## Writing a Summary

For "log this", write a structured record with:

- `title`: mandatory, non-empty, concise session title; never write an untitled record
- `summary`: one-sentence purpose/outcome; displayed as `Summary`
- `outcomes`: substantive changes, decisions, or findings; persisted as `what_changed` and displayed as `Outcomes`
- `artifacts`: exact files, commands, or project locations; persisted as `where_it_lives` and displayed as `Artifacts`
- `open_items`: unfinished work or verification steps; persisted as `next_up` and displayed as `Open Items`
- `keywords`: exact identifiers worth searching later (variable names, functions, papers, commands, paths)

The user-facing outline starts with a Markdown heading containing the non-empty title, followed by exactly `[Summary]`, `[Outcomes]`, `[Artifacts]`, and `[Open Items]`. Titles must be displayed as well as stored. In the Television Workspaces channel, a non-empty curated summary title is the effective session title; fall back to the transcript session name or initial prompt only when no curated title exists. When updating a historical record, preserve any stored `status` silently for backward compatibility, but never display a separate status section.

Run the dedicated logger through the atomic CLI interface. In Pi's built-in `bash` tool, use the injected `PI_SESSION_ID` and `PI_SESSION_FILE` values for the active session:

```bash
~/.local/bin/piwork summary log "$PI_SESSION_ID" --transcript-path "$PI_SESSION_FILE" --json
```

For an explicitly identified older session, pass its known UUID and transcript path instead. If the session environment variables are unavailable, do not guess from the newest file; use an explicit session path/ID or state that the summary could not be attached. The low-level `summary set` command remains for persisting an already validated payload; do not bypass the dedicated logger when updating a record.

## Retention and Safety

- Session summaries survive transcript moves and folder renames because they are keyed by UUID.
- SQLite indexing never rewrites or deletes JSONL transcripts.
- The SQLite database is a rebuildable search projection; the JSONL transcripts and JSON summary store remain the recovery sources.
- If a summary is unavailable, distinguish clearly between a permanent summary result and a raw-transcript fallback.
