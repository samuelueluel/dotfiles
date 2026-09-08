---
name: skill-creation
description: Creates new agent skills with clear structure, decision trees, plain-language instructions, and guardrails. Use when the user asks to "create a skill", "write a skill", or "build a new skill".
disable-model-invocation: true
---

# Skill Creation

## CPTR / Headless Limitation

CPTR can inspect and draft skill changes, but cannot write to `~/.agents/skills/`, run `chezmoi add`, or apply files. Use a regular Pi session to write and verify approved changes; never claim a skill was created or saved from CPTR.

## Core Design Guidelines

Good skills give models clear, dependable rules to follow so they do not guess or cut corners. Every skill should follow six core guidelines:

1. **Clear Discovery in the Description:** The frontmatter `description:` is the only text the agent sees before choosing to load a skill. It must include exact trigger phrases, keywords, commands, and file patterns so the agent knows when to activate it.
2. **Request-Routing Decision Trees:** When a skill handles multiple tasks or modes, place a top-down ASCII flowchart at the top of `SKILL.md`. This shows the agent which path to take at a glance. Use one main diagram; the numbered sections below then explain each step.
3. **Clear Rules and Hook Synergy:** State non-negotiable boundaries clearly ("Never guess regression specifications", "Always use TurboVault for vault notes") so the model does not cut corners.
   - **Reasoning Rules vs. Physical Tool Limits:** Distinguish thinking rules (how to interpret data, econometric rules, output formatting) from physical tool limits (file paths, blocked commands, read-only tools).
   - **Check Existing Hooks:** Look at active hooks in `10_Projects/Local-LLMs/Agents/Pi/Pi-Hooks.md` and `~/.pi/agent/lib/workflow-invariants-logic.ts`. If a hook already stops a bad action physically, state the proper tool instruction cleanly in `SKILL.md` without long defensive warnings.
   - **Hook Offloading:** If you find a new physical tool rule that does not have a hook yet, **ask Samuel** if you should add a hook to `workflow-invariants.ts`. Hooks enforce physical boundaries automatically, which is more reliable than hoping a prompt prevents a mistake.
4. **Plain Language over Line Compression (~150–200 lines):** `SKILL.md` is loaded on every run. Clarity and plain language always beat strict line brevity:
   - **Direct, Everyday English:** Write in short, active-voice sentences with concrete verbs ("Do X first", "Never delete Y", "If Z fails, ask Samuel"). Avoid abstract phrasing, dense compound clauses, or complicated jargon. Simple commands guide models—especially smaller local models—much more reliably.
   - **Guideline, Not a Straitjacket:** Aim for roughly 150–200 lines (up to 250 for skills with multi-mode decision trees). Never cram ideas into dense, hard-to-read sentences just to save vertical space. If writing clearly takes 180 lines instead of 130, that is completely fine.
   - **What to Move to References:** Keep all governing rules and workflows in `SKILL.md`. Move only large lookup tables, API schemas, full script code, and rare troubleshooting steps into `references/`.
5. **Put Complex Shell Logic in Scripts:** Replace long or fragile shell commands with standalone helper scripts in `scripts/` or `~/.local/bin/`. This avoids syntax errors and keeps skill files short and readable.
6. **Check Live State Instead of Hardcoding Dates or Counts:** Teach the agent to inspect current system state (such as running `chezmoi status` or querying live databases) rather than hardcoding temporary counts, dates, or file lists. Always read files before editing them.

## Skill Directory Structure

```text
skill-name/
├── SKILL.md           # Fast-path instructions (~150–200 lines)
├── references/        # Deep thematic references, loaded on demand only
│   ├── troubleshooting.md
│   └── api-schemas.md
├── EXAMPLES.md        # Concrete usage examples (optional)
└── scripts/           # Standalone deterministic tools (optional)
    └── helper.sh
```

## Request-Routing Playbooks (Decision Trees)

When a skill handles **3 or more distinct sub-intents, sub-modes, or caller domains** (e.g. read vs. write vs. search vs. prune, or `pi` vs. `beta`), open `SKILL.md` directly under the title with a fenced ASCII decision tree under `## Request-Routing Playbook`.

### Decision Tree Rules:
- **Fenced Monospaced Block:** Always wrap in a fenced `text` code block to preserve structural whitespace.
- **Strict Top-Down Hierarchy:** Use box characters (`├─`, `└─`, `│`, `──→`). Never use diagonal lines, cycles, or backwards loops.
- **Trigger-to-Action Mapping:** Left side defines the user phrase or caller context; right side names the target mode and primary tool call.
- **Single Canonical Router:** Do not repeat the same dispatch map in another tree or table. Add another router only when it answers a genuinely different routing question.
- **Dual Coding (Index + Manual):** The tree acts as the routing index; the numbered sections below define the exact parameter and invariant specifications.

## SKILL.md Template

```md
---
name: skill-name
description: Brief description of capability. Use when user asks to [action], mentions [keywords], or works with [filetypes/aliases].
---

# Skill Name

## Non-Negotiable Rules

- Invariant 1 (Hard negative boundary: what NEVER to do).
- Invariant 2 (Tooling constraint: required tools or subagent isolation).
- Invariant 3 (Verification rule: read-before-write or output inspection).

## Request-Routing Playbook

```text
REQUEST
├─ Trigger A (Context / Keyword) ──→ MODE 1: tool_call_alpha
├─ Trigger B (Context / Keyword) ──→ MODE 2: tool_call_beta
└─ Trigger C (Context / Keyword) ──→ MODE 3: tool_call_gamma (read-only)
```

## Workflows & Invariants

### 1. Mode 1: Step-by-Step Procedure
- Concrete step sequence with explicit parameter guidelines.

### 2. Mode 2: Step-by-Step Procedure
- Concrete step sequence with verification checks.

## Advanced Features & References

- When encountering edge cases, see [references/troubleshooting.md](references/troubleshooting.md).
```

## Description Requirements

The frontmatter description helps the agent find the skill:
- Max 1024 characters. Third-person phrasing.
- **Sentence 1 (Capability):** What the skill enables.
- **Sentence 2 (Explicit Triggers):** Exact user phrases, slash commands, or file extensions (`"Use when user asks to 'log this', 'catch up', or mentions session handoffs."`).

## Moving Detail to `references/` (Progressive Disclosure)

First remove repeated explanations so each rule lives in one clear place. Then move background detail into a `references/` folder when:
- `SKILL.md` approaches ~180–200 lines (or 250 for skills with multi-mode decision trees).
- The content consists of big lookup tables, schemas, detailed command manuals, or rare troubleshooting guides.

### What Stays in `SKILL.md` vs. What Moves to `references/`:
- **Rules Always Stay in `SKILL.md`:** All safety boundaries, "never do X" rules, and output formatting requirements must stay in `SKILL.md`. Agents only load `SKILL.md` by default; any rule tucked away in `references/` will be ignored during normal work.
- **Reference Material Goes to `references/`:** Large tables, lists of codes, full scripts, and rare troubleshooting steps belong in `references/`. Reference files provide background details and manuals, not basic rules.

### Reference File Standards:
1. **Header Trigger on Line 3:** Every reference file must open with a main title on line 1, followed on line 3 by a clear note explaining when to load it:
   ```markdown
   # Topic Title

   **Load this file when** [specific failure mode, advanced operation, schema lookup, or edge case].
   ```
   *Why:* When an agent loads a reference file via `read`, this opening line confirms right away that it opened the right document.
2. **One Topic Per File:** Create focused reference files (such as `references/troubleshooting.md` or `references/schemas.md`). Never create catch-all `misc.md` or `notes.md` files.
3. **Explain Links in `SKILL.md`:** Never list bare markdown links. Under `## Progressive Disclosure & Reference Routing`, pair every link with an explicit condition:
   - *Good:* `- If page extraction fails, tables are malformed, or OCR is unreadable, load [deep-dive reading](references/deep-dive-reading.md).`
   - *Bad:* `- See [deep-dive reading](references/deep-dive-reading.md).`
4. **Use Relative Paths:** Always write links relative to the skill folder: `[topic](references/topic.md)`.
5. **Keep Instructions Timeless:** Describe permanent commands, flags, and steps. Never hardcode temporary counts, dates, or process IDs that will soon be outdated.

## Markdown Standards & Vault Syntax Isolation

- **Standard Markdown for Documentation:** Format skill prose, reference docs, dotfiles, scripts, and chat responses with GitHub-Flavored Markdown (`**bold**`, `*italic*`, code fences, lists).
- **Vault Syntax Isolation:** The highlight syntax (`~={green}...=~`, `~={magenta}...=~`) works only inside notes in `~/Dropbox/Sam-Obsidian-Vault/`. Never use it to style skill prose, dotfiles, commits, or terminal output. Literal code examples are allowed only when a skill or reference explicitly documents vault syntax.

## Review Checklist

- [ ] Description includes clear trigger phrases ("Use when...")
- [ ] Rules separate thinking guidelines from physical tool limits
- [ ] Physical tool limits checked against `Pi-Hooks.md` / `workflow-invariants.ts`; Samuel asked if a new hook is needed
- [ ] All safety boundaries, rules, and output formatting stay in `SKILL.md` (never hidden in `references/`)
- [ ] Multi-intent skills (3+ tasks) include an ASCII decision tree
- [ ] Decision tree is top-down, straightforward, and wrapped in a fenced `text` code block
- [ ] Each rule lives in one place without repeating the same flowchart
- [ ] Written in plain, direct English with clear active-voice instructions (no dense jargon packing)
- [ ] Fast-path `SKILL.md` fits comfortably within ~150–200 lines (up to 250 if needed for clarity)
- [ ] The agent can see the route, next step, forbidden shortcuts, stopping condition, and required output clearly
- [ ] Uses standard Markdown for skill prose; literal Obsidian highlight syntax appears only in code when documenting vault behavior
- [ ] Long or complex shell commands moved into standalone scripts
- [ ] Rare edge cases and detailed lookup tables moved to self-describing reference files
- [ ] No temporary dates, counts, or time-sensitive snapshots baked into text
- [ ] Tracked in Chezmoi (`chezmoi add ~/.agents/skills/<skill-name>/SKILL.md`)
