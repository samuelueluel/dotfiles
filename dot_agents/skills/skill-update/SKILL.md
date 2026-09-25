---
name: skill-update
description: Updates and cleans up existing agent skills using skill-creation standards. Use when the user asks to "check", "review", "update", or "refine" an existing skill, including "update the skill" after discussing a gap or failure.
---

# Skill Update & Maintenance

## Request-Routing Playbook

```text
REQUEST INTENT
│
├─ "check <skill>" / "does <skill> need work?" ──→ READ-ONLY HEALTH CHECK
│                                                  ├─ List and read the target skill's complete directory
│                                                  ├─ Audit every shipped file against skill-creation rules
│                                                  ├─ Report line count, status, or obsolete rules
│                                                  └─ INVARIANT: Never mutate files during a check
│
├─ "update <named skill(s)>" ──→ NAMED UPDATE: only named skill(s) → choose tier
├─ "update the skill" after a discussed gap ──→ CONTEXTUAL UPDATE: only implicated skill(s)
│                                              └─ Inspect each target's directory → choose tier
├─ Explicit "check/audit all skills" ──→ READ-ONLY HEALTH CHECK for each skill
├─ Explicit "update all skills" ──→ ALL-SKILLS UPDATE: inspect all skill directories → choose tier
│
├─ Tier 1: Procedural or tool fix (default)
│  Does an existing step or rule already touch this concept?
│  ├─ YES ──→ IN-PLACE ANCHOR EDIT (update sentence; freeze surrounding prose)
│  └─ NO  ──→ WORKFLOW POSITIONING (slot chronologically; NEVER append at file tail)
│
├─ Tier 2: New capability / failure mode
│  ├─ SKILL.md has room (<180 lines) ──→ Add plain-language workflow step
│  └─ Near line budget (180–220 lines) ──→ Keep rule in SKILL.md; offload only supporting detail
│
└─ Tier 3: Structural overhaul / deep reorganization ──→ PRE-FLIGHT RFC GATE
                                                         ├─ STOP: Present Phase 1 plan in chat (Why, What, Scope)
                                                         ├─ Obtain Samuel's conversational greenlight
                                                         └─ Phase 2: Draft diff against skill-creation checklist
```

## Non-Negotiable Rules

1. **Always Follow skill-creation Standards:** All rules from `~/.agents/skills/skill-creation/SKILL.md` (plain language, line guidelines, decision trees, rules staying in SKILL.md, and vault syntax isolation) apply automatically whenever updating a skill.
2. **Update in Place (No Tail-Appending, No Random Rewrites):** Never tack new rules onto the very bottom of a section or file. Put updates directly into the existing rule, step, or table row that covers that topic. Leave unrelated surrounding text untouched.
3. **Ask Before Big Structural Changes (Tier 3):** If an edit reorganizes sections, redraws a decision tree, or rewrites multiple paragraphs, present a simple proposal in chat and get Samuel's approval before changing any files.
4. **Keep Existing Safety Rules & Work with Hooks:** Never remove or weaken an existing "Never do X" rule unless Samuel explicitly asks for it.
   - *Hook Optimization:* When a hook in `workflow-invariants.ts` or `Pi-Hooks.md` already blocks an action physically (such as direct vault edits or sudo), simplifying a long warning into a clean, direct tool instruction is approved.
   - *Hook Offloading:* If an update reveals a recurring physical mistake that lacks a hook, **ask Samuel** whether to add a hook to `workflow-invariants.ts`.
   - *Plain Language Expansion:* Expanding instructions into direct, active-voice sentences to make them simpler and easier for models to follow is encouraged. Never compress text into dense technical jargon or nested clauses just to save lines.
5. **Rules Stay in SKILL.md:** Never move basic rules, negative boundaries, or output formatting requirements into `references/`. Keep them in `SKILL.md` where the agent will see them.
6. **Vault Syntax Isolation:** Never use Obsidian highlight syntax (`~={green}...=~`) to style skill text, dotfiles, git commits, or terminal output. Use standard GitHub Markdown.
7. **Make Edits Directly and Summarize Clearly:** For small and medium updates (Tiers 1 and 2), edit files directly, stage with chezmoi, and give a short bullet summary of what changed. Do not type out simulated diffs in chat; show a real `git diff` from `~/dotfiles` only if Samuel asks for it.
8. **Chezmoi Synchronization:** Capture every modified skill file with `chezmoi add <path>`.
9. **CPTR Limitation:** CPTR can inspect and draft diffs, but cannot edit skill files or run `chezmoi add`. Use a regular Pi session to apply approved edits.


## The Execution Workflow

### Choosing the Update Scope
- If Samuel names a skill or skills, update only those. Otherwise, use the preceding conversation to identify the skill(s) whose instructions are implicated by the gap; do not update every skill that happened to be used.
- Inspect or update all skills only when Samuel explicitly requests an all-skills audit or update. "Complete skill directory" means every shipped file within each target skill's folder, not every skill under `~/.agents/skills/`.
- Do not require Samuel to restate an established case. Ask one focused question only if the target or desired behavior remains unclear. Then follow the appropriate update tier below.
- Turn the observed case into a generally useful rule or workflow step in the relevant location. Avoid a one-off patch that only mentions the example.
- Inspect each target skill's complete directory before editing. After editing, check the revised instructions against `skill-creation` and all related files; verify that the rule is discoverable and does not contradict existing guidance.

### Read-Only Health Check ("check <skill>" / "does <skill> need work?")
- Triggered by casual questions ("Check the music skill", "How is session-log looking?", "Does X need maintenance?").
- List the target skill's complete directory, including hidden and nested files.
- Read `SKILL.md`, every Markdown reference, and every shipped script, example, schema, or other documentation file.
- Check both directions: every documented link resolves, and every shipped reference is reachable through an explained loading route.
- Check all files against `skill-creation` standards, including plain language, line guidelines, rule/reference separation, cross-file consistency, and hook alignment.
- Report what you found in chat. Never modify files during a health check.

### Tier 1: Small In-Place Edit (Default)
- List and inspect the complete target skill directory, including `SKILL.md`, references, scripts, and examples.
- Find the exact line or rule governing the behavior.
- Edit it directly in place. Do not rewrite unaffected surrounding sentences.
- Verify that `SKILL.md` remains clear, plain-spoken, and within the ~150–200 line guideline.
- Apply the edit directly, stage with `chezmoi add`, and report a short 2–3 bullet summary. Show a terminal `git diff` only on explicit request.

### Tier 2: Moving Detail to References
- When adding a large schema, table, or deep troubleshooting run that would push `SKILL.md` past ~200 lines, keep governing rules and workflow steps in `SKILL.md`.
- Put only supporting detail in a reference; add a short pointer with trigger phrasing in `SKILL.md` under `## Progressive Disclosure & Reference Routing`.
- Create or update a single-purpose file in `references/<theme>.md`.
- Add the trigger line on line 3: `**Load this file when** [triggers]`.
- Apply the changes, stage with `chezmoi add`, and report a short summary.

### Tier 3: Major Structural Refactor (Two-Phase Gated)
- **Phase 1 (The Proposal):** Before touching files or making structural changes, pause and share a brief plan in chat:
  ```markdown
  ### Proposed Refactor Plan: <skill-name>
  - **Reason:** [Why the overhaul is needed: line budget breach, conflicting rules, reorganized workflow]
  - **Plan:** [Proposed outline, decision tree changes, reference file splits]
  - **Rules Preserved:** [Explicit list of "Never do X" rules that remain untouched]
  *Shall I proceed to draft this structural refactor?*
  ```
- **Phase 2 (Execution):** Only after Samuel approves the proposal in chat, make the changes, stage with `chezmoi add`, check against `skill-creation`, and display the actual terminal `git diff` from `~/dotfiles` for final review.

## Audit & Application Checklist

- [ ] Edits placed directly in the relevant section (no tacking onto the end of the file)
- [ ] Surrounding unaffected text kept intact without unnecessary rewriting
- [ ] Instructions use plain, direct English (no dense jargon packing to save lines)
- [ ] If Tier 3: proposal was approved in chat before modifying files
- [ ] Complete skill directory inspected; no scripts, examples, schemas, or nested files skipped
- [ ] Every reference is reachable, correctly triggered, and consistent with `SKILL.md`
- [ ] All `skill-creation` rules followed (rules in `SKILL.md`, standard Markdown used)
- [ ] Short summary provided (or real terminal `git diff` displayed for Tier 3 / on request)
- [ ] Staged in Chezmoi (`chezmoi add ~/.agents/skills/<skill>/...`)
