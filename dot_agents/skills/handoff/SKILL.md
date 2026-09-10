---
name: handoff
description: Creates a standalone handoff note in Obsidian for another agent session to pick up. Use when the user asks to "handoff", "create a handoff", "wrap up for next agent", or prepare a session transfer.
disable-model-invocation: true
argument-hint: "What will the next session be used for?"
---

# Session Handoff Document

## Request-Routing Playbook

```text
REQUEST
├─ Explicit standalone handoff in regular Pi ──→ CREATE: turbovault_write_note in 02_Memories/
├─ Routine session summary or catch-up ─────────→ SESSION LOG: load session-log and use piwork
└─ CPTR/headless session ───────────────────────→ DRAFT ONLY: return note text; never claim it was saved
```

## Non-Negotiable Rules

- **Use TurboVault MCP:** All notes in `~/Dropbox/Sam-Obsidian-Vault/02_Memories/` must be written with `turbovault_write_note`. Never use raw shell commands or built-in file writing tools on vault notes.
- **Vault Styling Standards:** Do not use markdown bold (`**bold**`). Use `~={green}active labels=~` and `~={magenta}hazard labels=~`. Include standard YAML frontmatter (`created`, `updated`, `description`, `tags`).
- **When to Use Handoff vs. Session Log:** For routine session summaries, searches, catch-up, or backlog processing, load the `session-log` skill and use its `piwork summary` workflow. Never write routine session logs to Obsidian. Use this `handoff` skill only when Samuel explicitly asks for a standalone handoff document.
- **CPTR Limitation:** CPTR cannot edit TurboVault notes or call `session_handoff`. It can draft the note in chat, but a regular Pi session must save it. Never claim the file was saved when writing is blocked.
- **Do Not Repeat Other Files:** If details are already recorded in plans, notes, commit messages, or diffs, link to their exact file paths instead of copying them.

## Handoff Procedure

1. If Samuel gave specific topics or questions, make them the primary focus for the next session.
2. Structure the standalone note as `02_Memories/<Topic>-Handoff.md`:
   - Frontmatter (`created`, `updated`, `description`, `tags: [handoff, memory]`).
   - `# <Topic> Handoff`
   - `## Current State & Decisions Made`
   - `## Where Work Lives (Exact Paths)`
   - `## Next Session Action Plan`
   - `## Suggested Skills` (specific skills the next agent should load)
3. Save the note using `turbovault_write_note`.
