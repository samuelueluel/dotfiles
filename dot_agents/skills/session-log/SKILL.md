---
name: session-log
description: Record, review, or catch up on session handoffs in Samuel's rolling 30-day domain logs (Pi-Session-Log for systems/tools, Beta-Session-Log for empirical research). Use when asked to "log this", "log last session", "log sessions from past N days", "where did we leave off", or "catch up".
---

# Session Log Management

## Request-Routing Playbook

Before making any tool call, resolve the caller domain and map the request to one route:

```text
REQUEST
│
├─ Domain Resolution:
│  ├─ pi / pihat (Linux, Dotfiles, UI, Tools) ──→ Target: 02_Memories/Pi-Session-Log.md
│  └─ beta / betahat (Stata, Econometrics)    ──→ Target: 02_Memories/Beta-Session-Log.md
│
└─ Intent Routing:
   ├─ "log this" / "/log" ───────────────→ ACTIVE RECORD
   │                                        ├─ Draft one top-level bullet with a blue parenthesized date and four nested child bullets
   │                                        ├─ turbovault_read_note → prepend under the active rolling-window heading
   │                                        └─ Prune entries > 30 days → turbovault_write_note
   │
   ├─ "log last session" ────────────────→ RETROACTIVE SINGLE
   │                                        ├─ Inspect newest ~/.pi/agent/sessions/ transcript
   │                                        ├─ Draft one dated bullet with nested details + session ID
   │                                        └─ Prepend to domain log & prune > 30 days
   │
   ├─ "log sessions from [N] days" ──────→ BATCH CATCH-UP
   │                                        ├─ Scan transcripts in N-day window
   │                                        ├─ Filter trivial turns; consolidate by date
   │                                        └─ Prepend to domain log & prune > 30 days
   │
   └─ "catch up" / "where did we leave" ─→ STATUS BRIEFING (READ-ONLY)
                                            ├─ turbovault_read_note on domain log
                                            ├─ Summarize top 2–3 entries (3–4 sentences)
                                            └─ INVARIANT: Never read raw JSONL transcripts
```

## Intent Procedures

### 1. Active Session Log ("log this" / "/log")
1. Formulate one complete bullet entry from the current conversation:
   - `- ~={blue}(YYYY-MM-DD)=~ Brief session title`
   - `    - ~={green}What changed:=~` 1–2 sentences on high-level architecture, features, or bug fixes.
   - `    - ~={green}Where it lives:=~` Exact file paths (Chezmoi templates, configs, binaries, or datasets); reference vault notes with proper `[[wikilinks]]` (omit `.md`, using `[[Folder/Note|Note]]` when helpful).
   - `    - ~={green}Next up / unfinished:=~` Concrete pending items, tests, or unverified edge cases. Never include routine “commit and push” housekeeping; mention version-control work only when a concrete unresolved failure or user decision remains.
   - `    - *Session: <session-id>*` (passive metadata for human traceability).
2. Read the target domain log via `turbovault_read_note`.
3. Prepend the new entry under the active rolling-window heading.
4. Prune any top-level bullet entry whose `YYYY-MM-DD` date inside `~={blue}(...)=~` is strictly older than 30 days.
5. Write back using `turbovault_write_note`.

### 2. Retroactive Single-Session Log ("log last session")
1. Inspect newest previous transcript in `~/.pi/agent/sessions/<workspace>/` (or current agent logs).
2. Extract substantive changes into one dated top-level bullet with the three labeled child bullets and final italicized session ID child bullet.
3. Read target domain log, prepend the entry under the active rolling-window heading, prune top-level entries older than 30 days, and write back.

### 3. Batch Multi-Day Catch-Up ("log sessions from past N days")
1. Scan session transcripts in `~/.pi/agent/sessions/` matching the requested timestamp window.
2. Filter out trivial or cancelled sessions; consolidate related micro-sessions by date, with each session represented as one dated top-level bullet and four nested child bullets.
3. Read target domain log, prepend the entries under the active rolling-window heading, prune top-level entries older than 30 days, and write back.

### 4. Status Catch-Up ("where did we leave off" / "catch up")
1. Read target domain log via `turbovault_read_note`.
2. Present a brief 3–4 sentence summary of the top 2–3 recent entries in chat.
3. **Invariant:** Never attempt to read, grep, or reconstruct raw JSONL transcript files during catch-up. The distilled log bullets are the authoritative handoff.

## CPTR / Headless Limitation

- CPTR supports read-only catch-up, but `turbovault_write_note` is blocked. Draft the complete nested bullet entry in chat and state that the log was not saved; use regular Pi for the mutation.

## Formatting & Vault Rules

- **TurboVault MCP Only:** Always interact with `02_Memories/` notes via `turbovault` tools. Never use shell commands on vault files.
- **Closed Palette:** Strictly NO `**bold**`. Use `~={green}active labels=~` for bullet keys. Session-log notes have one narrow exception: use `~={blue}(YYYY-MM-DD)=~` for the complete parenthesized date only; keep the brief title plain and do not use blue elsewhere.
- **Session Entry Structure:** Use one top-level bullet per session, with the format below. Use exactly four spaces for each child bullet; do not create a heading or section for an individual session. Use blue for the complete parenthesized date, green for the three content labels, and make the final child bullet the italicized session ID. Bullet-on-bullet nesting is intentional here, even where the general vault guidance recommends alternating list types.
- **Vault Note Links:** Every reference to an Obsidian vault note in a session entry must use proper `[[wikilinks]]`; omit the `.md` extension and prefer `[[Folder/Note|Note]]` when the exact vault path is known. References to scripts, configs, datasets, and other non-vault files remain plain paths or code.

```markdown
- ~={blue}(YYYY-MM-DD)=~ Brief session title
    - ~={green}What changed:=~ Summary of substantive changes.
    - ~={green}Where it lives:=~ Exact paths or locations; vault notes use `[[Folder/Note|Note]]` wikilinks.
    - ~={green}Next up / unfinished:=~ Concrete pending work or verification.
    - *Session: <session-id>*
```
