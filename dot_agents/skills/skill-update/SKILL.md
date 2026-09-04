---
name: skill-update
description: Maintains and refactors existing agent skills while silently enforcing skill-creation standards. Use when the user asks to "check", "review", "update", "refine", or asks whether an existing skill needs maintenance or fixes.
disable-model-invocation: true
---

# Skill Update & Maintenance

## Non-Negotiable Rules

1. **Implied Standards from `skill-creation`:** Compliance with `~/.agents/skills/skill-creation/SKILL.md` (line budgets, decision trees, negative invariants, reference header contracts, and vault isolation) is ALWAYS 100% implied and silently enforced. Samuel never needs to ask for it.
2. **Thematic Anchoring (No Append-Sprawl, No Restless Churn):** Never append new bullets to the bottom of a section or file as an afterthought. Slot updates directly into the specific existing rule, step, or table row governing that concept. Leave surrounding unaffected text untouched.
3. **Pre-Flight RFC Gate for Structural Overhauls (Tier 3):** If an edit alters section hierarchy, rewrites decision tree topology, or overhauls multi-paragraph explanations, the agent MUST present a high-level proposal and receive Samuel's explicit conversational approval BEFORE generating any diff.
4. **Zero Invariant Regression:** Never weaken, soften, or remove existing "Never do X" negative invariants unless Samuel explicitly commands it.
5. **No Rule Offloading:** Never offload governing rules, negative invariants, or output formatting constraints to `references/`. References are strictly for data catalogs, schemas, script code, and deep troubleshooting manuals.
6. **Vault Syntax Isolation:** Never use Obsidian highlight syntax as styling in skill prose, dotfiles, commits, or terminal output. A literal backtick-quoted or fenced example is allowed only when documenting required vault-note output, as specified by `skill-creation`. All other skill documentation uses standard GitHub Markdown.
7. **Direct Execution & Concise Summary:** For Tier 1 and Tier 2 updates, apply edits directly via file tools, stage with chezmoi, and report a concise bullet summary of what changed and why. Never hand-type simulated unified diffs in chat. If Samuel requests a diff or verification is required, display a real terminal `git diff` from `~/dotfiles`.
8. **Chezmoi Synchronization:** Every modified skill file must be captured with `chezmoi add <path>`.
9. **CPTR / Headless Limitation:** CPTR can inspect and draft diffs but cannot write skill files or run `chezmoi add`; use regular Pi to apply an approved diff and never claim persistence when blocked.

## Request-Routing Playbook

```text
REQUEST INTENT
│
├─ "check <skill>" / "does <skill> need work?" ──→ READ-ONLY HEALTH CHECK
│                                                  ├─ Read SKILL.md and references/
│                                                  ├─ Silently audit against skill-creation rules
│                                                  ├─ Report line count, status, or obsolete rules
│                                                  └─ INVARIANT: Never mutate files during a check
│
├─ Tier 1: Procedural or tool fix (90% of updates)
│  Does an existing step or rule already touch this concept?
│  ├─ YES ──→ IN-PLACE ANCHOR EDIT (update sentence; freeze surrounding prose)
│  └─ NO  ──→ WORKFLOW POSITIONING (slot chronologically; NEVER append at file tail)
│
├─ Tier 2: New capability / failure mode
│  ├─ SKILL.md has room (<120 lines) ──→ Add concise workflow step
│  └─ Near line budget (120–150 lines) ──→ Offload to references/<theme>.md
│
└─ Tier 3: Structural overhaul / deep reorganization ──→ PRE-FLIGHT RFC GATE
                                                         ├─ STOP: Present Phase 1 plan in chat (Why, What, Scope)
                                                         ├─ Obtain Samuel's conversational greenlight
                                                         └─ Phase 2: Draft diff against skill-creation checklist
```

## The Execution Workflow

### Read-Only Health Check ("check <skill>" / "does <skill> need work?")
- Triggered by casual inquiries ("Check the music skill", "How is session-log looking?", "Does X need maintenance?").
- Read `SKILL.md` and any `references/`.
- Silently audit against `skill-creation` rules (line budget, negative invariants, reference header contracts, syntax leaks).
- Report status in chat. Never mutate files during a health check.

### Tier 1: Surgical In-Place Update (Default)
- Read target `SKILL.md` (or the affected `references/<file>.md`) via `read`.
- Identify the exact line or list item governing the behavior.
- Slot the update in-place. Do not rephrase adjacent sentences or reorder unaffected blocks.
- Verify that `SKILL.md` remains within the ~120–150 line budget.
- Apply the edit directly, stage with `chezmoi add`, and report a concise 2–3 bullet summary. Display terminal `git diff` only on explicit request.

### Tier 2: Progressive Reference Offload
- When adding a detailed schema, complex CLI table, or deep troubleshooting run that would push `SKILL.md` past ~120–150 lines:
- Keep a concise 1–2 line pointer with trigger phrasing in `SKILL.md` under `## Progressive Disclosure & Reference Routing`.
- Create or update a single-purpose `references/<theme>.md` file.
- Enforce the Header Contract on line 3: `**Load this file when** [triggers]`.
- Apply the changes, stage with `chezmoi add`, and report a concise summary.

### Tier 3: Extensive Structural Refactor (Two-Phase Gated)
- **Phase 1 (The Pre-Flight RFC):** Before touching any files or making structural changes, pause execution and present this conversational brief:
  ```markdown
  ### Proposed Refactor Plan: <skill-name>
  - **Motive:** [Why the overhaul is needed: line budget breach, taxonomy drift, contradictory rules]
  - **Structural Plan:** [Proposed section outline, decision tree changes, reference file splits]
  - **Invariants Preserved:** [Explicit list of "Never do X" rules that remain untouched]
  *Shall I proceed to draft this structural refactor?*
  ```
- **Phase 2 (Execution & Git Diff Verification):** Only after Samuel approves the proposal in chat, apply the structural changes, stage with `chezmoi add`, audit against `skill-creation`, and display the actual terminal `git diff` from `~/dotfiles` for final verification.

## Audit & Application Checklist

- [ ] Edits slotted into thematic anchors (zero append-sprawl)
- [ ] Surrounding unaffected text preserved verbatim (zero restless churn)
- [ ] If Tier 3: Phase 1 RFC proposal was approved in conversation before applying changes
- [ ] All `skill-creation` checklist items passed (no Obsidian highlight syntax used as styling; documented literal examples allowed, under line budget)
- [ ] Concise change summary provided (or real terminal `git diff` displayed for Tier 3 / on request)
- [ ] Synchronized to Chezmoi (`chezmoi add ~/.agents/skills/<skill>/...`)
