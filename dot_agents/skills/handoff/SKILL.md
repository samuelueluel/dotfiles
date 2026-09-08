---
name: handoff
description: Creates a standalone handoff note in Obsidian for another agent session to pick up. Use when the user asks to "handoff", "create a handoff", "wrap up for next agent", or prepare a session transfer.
disable-model-invocation: true
argument-hint: "What will the next session be used for?"
---

# Session Handoff Document

## Non-Negotiable Rules

- **Use TurboVault MCP:** All notes in `~/Dropbox/Sam-Obsidian-Vault/02_Memories/` must be written with `turbovault_write_note`. Never use raw shell commands or built-in file writing tools on vault notes.
- **Vault Styling Standards:** Do not use markdown bold (`**bold**`). Use `~={green}active labels=~` and `~={magenta}hazard labels=~`. Include standard YAML frontmatter (`created`, `updated`, `description`, `tags`).
- **When to Use Handoff vs. Session Log:** For normal daily session summaries, use the `session-log` skill to add an entry to `02_Memories/Pi-Session-Log.md` or `02_Memories/Beta-Session-Log.md`. Use this `handoff` skill only when Samuel explicitly asks for a standalone handoff document.
- **CPTR Limitation:** CPTR cannot edit TurboVault notes or call `session_handoff`. It can draft the note in chat, but a regular Pi session must save it. Never claim the file was saved when writing is blocked.
- **Do Not Repeat Other Files:** If details are already recorded in plans, notes, commit messages, or diffs, link to their exact file paths instead of copying them.

## Handoff Procedure

1. If Samuel gave specific topics or questions, make them the primary focus for the next session.
2. Structure the standalone note as `02_Memories/<Topic>-Handoff.md`:
   - Frontmatter (`created`, `description`, `tags: [handoff, memory]`).
   - `# <Topic> Handoff`
   - `## Current State & Decisions Made`
   - `## Where Work Lives (Exact Paths)`
   - `## Next Session Action Plan`
   - `## Suggested Skills` (specific skills the next agent should load)
3. Save the note using `turbovault_write_note`.
