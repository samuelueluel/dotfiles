---
name: write-a-skill
description: Create new agent skills with proper structure, progressive disclosure, and bundled resources. Use when user wants to create, write, or build a new skill.
disable-model-invocation: true
---

# Writing Skills

## Process

1. **Gather requirements** - ask user about:
   - What task/domain does the skill cover?
   - What specific use cases should it handle?
   - Does it need executable scripts or just instructions?
   - Any reference materials to include?

2. **Draft the skill** - create:
   - SKILL.md with concise instructions
   - A `references/` folder with themed files if content grows past ~100 lines or spans distinct domains
   - Utility scripts if deterministic operations needed

3. **Review with user** - present draft and ask:
   - Does this cover your use cases?
   - Anything missing or unclear?
   - Should any section be more/less detailed?

## Skill Structure

```
skill-name/
├── SKILL.md           # Main instructions (required) — the always-loaded fast path
├── references/        # Detailed docs, loaded on demand only
│   └── <topic>.md     # one file per theme (e.g. troubleshooting.md, index-maintenance.md)
├── EXAMPLES.md        # Usage examples (if needed)
└── scripts/           # Utility scripts (if needed)
    └── helper.js
```

## SKILL.md Template

```md
---
name: skill-name
description: Brief description of capability. Use when [specific triggers].
---

# Skill Name

## Quick start

[Minimal working example]

## Workflows

[Step-by-step processes with checklists for complex tasks]

## Advanced features

[Link to separate files: See [references/troubleshooting.md](references/troubleshooting.md)]
```

## Description Requirements

The description is **the only thing your agent sees** when deciding which skill to load. It's surfaced in the system prompt alongside all other installed skills. Your agent reads these descriptions and picks the relevant skill based on the user's request.

**Goal**: Give your agent just enough info to know:

1. What capability this skill provides
2. When/why to trigger it (specific keywords, contexts, file types)

**Format**:

- Max 1024 chars
- Write in third person
- First sentence: what it does
- Second sentence: "Use when [specific triggers]"

**Good example**:

```
Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when user mentions PDFs, forms, or document extraction.
```

**Bad example**:

```
Helps with documents.
```

The bad example gives your agent no way to distinguish this from other document skills.

## When to Add Scripts

Add utility scripts when:

- Operation is deterministic (validation, formatting)
- Same code would be generated repeatedly
- Errors need explicit handling

Scripts save tokens and improve reliability vs generated code.

## When to Split Files

Split into a `references/` folder when:

- SKILL.md exceeds 100 lines
- Content has distinct domains (e.g. library management vs index infrastructure)
- Advanced features are rarely needed (failure modes, deep internals)

`references/` is a progressive-disclosure folder: SKILL.md stays the always-loaded fast path, and each reference file is read only when SKILL.md points the agent there.

## Reference Folder Conventions

- **One file per theme** — `troubleshooting.md`, `index-maintenance.md`, `error-handling.md` — not one monolithic reference.
- **SKILL.md must point to each reference with trigger phrasing.** Name what the file covers AND the conditions that should send the agent there: "If an update fails, wedges, or silently misses chunks, all recovery procedures live in `references/index-maintenance.md`".
- **Reference files self-describe.** Open each with a header stating when to load it ("Load this file when ..."), so even a context-less open lands correctly.
- **No time-sensitive info anywhere** — not even in references. Prefer commands over snapshots: "run this count check" not "index has 9,735 docs"; "config default is X" not "config state as of 2026-08-10".
- **Pointers resolve relative to the skill directory** (`references/<topic>.md` from SKILL.md); a markdown link `[topic](references/topic.md)` is optional polish.

## Review Checklist

After drafting, verify:

- [ ] Description includes triggers ("Use when...")
- [ ] SKILL.md under 100 lines
- [ ] Heavy material split into `references/` with pointer + trigger phrasing in SKILL.md
- [ ] No time-sensitive info (no doc counts, state snapshots, or dates)
- [ ] Consistent terminology
- [ ] Concrete examples included
- [ ] References one level deep (skill-local, not a vault note elsewhere)
