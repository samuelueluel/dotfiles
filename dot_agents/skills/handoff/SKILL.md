---
name: handoff
description: Compact the current conversation into a comprehensive handoff document for another agent to pick up. Use when user asks to "handoff", "create a handoff", "wrap up for next agent", or prepare a multi-step session transfer.
disable-model-invocation: true
argument-hint: "What will the next session be used for?"
---

# Session Handoff Document

## Non-Negotiable Rules

- **TurboVault MCP Only:** All memory notes in `~/Dropbox/Sam-Obsidian-Vault/02_Memories/` MUST be written using `turbovault_write_note`. Never use raw shell commands (`cat`, `echo`, `write_to_file`) on vault notes.
- **Vault Styling Standards:** Strictly NO markdown bolding (`**bold**`). Use `~={green}active labels=~` and `~={magenta}hazard labels=~`. Include standard YAML frontmatter (`created`, `updated`, `description`, `tags`).
- **Domain Handoff Routing:** For standard rolling session handoffs, prefer appending to `02_Memories/Pi-Session-Log.md` or `02_Memories/Beta-Session-Log.md` via the `session-log` skill. Use this skill only when the user explicitly requests a standalone, multi-topic handoff document.
- **CPTR / Headless Limitation:** CPTR cannot invoke `session_handoff` or mutate TurboVault. It may draft the handoff in chat, but use regular Pi to save it; never claim the note was written when the mutation is blocked.
- **Artifact De-Duplication:** Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, commits, diffs). Reference them by path or URL instead.

## Handoff Generation Procedure

1. If the user passed arguments, treat them as the explicit focus for the next session.
2. Structure the standalone handoff document in `02_Memories/<Topic>-Handoff.md`:
   - Frontmatter (`created`, `description`, `tags: [handoff, memory]`).
   - `# <Topic> Handoff`
   - `## Current State & Decisions Made`
   - `## Where Work Lives (Exact Paths)`
   - `## Next Session Action Plan`
   - `## Suggested Skills` (explicit skills the next agent should invoke)
3. Write using `turbovault_write_note`.
