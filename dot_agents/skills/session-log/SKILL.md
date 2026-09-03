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
   │                                        ├─ Draft 3 bullets + session ID footer
   │                                        ├─ turbovault_read_note → prepend under Section 1
   │                                        └─ Prune entries > 30 days → turbovault_write_note
   │
   ├─ "log last session" ────────────────→ RETROACTIVE SINGLE
   │                                        ├─ Inspect newest ~/.pi/agent/sessions/ transcript
   │                                        ├─ Extract 3 bullets + session ID
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
1. Formulate a strictly 3-bullet summary from the current conversation:
   - `- ~={green}What Changed:=~` 1–2 sentences on high-level architecture, features, or bug fixes.
   - `- ~={green}Where It Lives:=~` Exact file paths (Chezmoi templates, configs, binaries, or datasets).
   - `- ~={green}Next Up / Unfinished:=~` Concrete pending items, tests, or unverified edge cases.
   - `*Session: <session-id>*` (passive metadata footer for human traceability).
2. Read target domain log via `turbovault_read_note`.
3. Prepend the new entry under `# 1. Active Rolling Window (30 Days)`.
4. Prune any entry whose `## YYYY-MM-DD` date is strictly older than 30 days.
5. Write back using `turbovault_write_note`.

### 2. Retroactive Single-Session Log ("log last session")
1. Inspect newest previous transcript in `~/.pi/agent/sessions/<workspace>/` (or current agent logs).
2. Extract substantive changes into the 3 bullets and attach its session ID.
3. Read target domain log, prepend entry, prune > 30 days, and write back.

### 3. Batch Multi-Day Catch-Up ("log sessions from past N days")
1. Scan session transcripts in `~/.pi/agent/sessions/` matching the requested timestamp window.
2. Filter out trivial or cancelled sessions; consolidate related micro-sessions into daily entries.
3. Read target domain log, prepend entry, prune > 30 days, and write back.

### 4. Status Catch-Up ("where did we leave off" / "catch up")
1. Read target domain log via `turbovault_read_note`.
2. Present a brief 3–4 sentence summary of the top 2–3 recent entries in chat.
3. **Invariant:** Never attempt to read, grep, or reconstruct raw JSONL transcript files during catch-up. The distilled log bullets are the authoritative handoff.

## CPTR / Headless Limitation

- CPTR supports read-only catch-up, but `turbovault_write_note` is blocked. Draft the three bullets in chat and state that the log was not saved; use regular Pi for the mutation.

## Formatting & Vault Rules

- **TurboVault MCP Only:** Always interact with `02_Memories/` notes via `turbovault` tools. Never use shell commands on vault files.
- **Closed Palette:** Strictly NO `**bold**`. Use `~={green}active labels=~` for bullet keys.
- **Header Structure:** Use plain `H2` `## YYYY-MM-DD — <Title>` for entries.
