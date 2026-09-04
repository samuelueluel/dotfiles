---
name: skill-creation
description: Creates new agent skills with proper structure, progressive disclosure, request-routing playbooks, and negative invariants. Use when the user asks to "create a skill", "write a skill", or "build a new skill".
disable-model-invocation: true
---

# Skill Creation

## CPTR / Headless Limitation

CPTR can inspect and draft skill changes but cannot write `~/.agents/skills/`, run `chezmoi add`, or apply files. Use regular Pi for the approved write and verification; never claim a skill was created or persisted from CPTR.

## Core Design Pillars

High-performance skills serve as deterministic scaffolding over stochastic models. Every skill must embody six architectural pillars:

1. **Description as Air Traffic Controller:** The frontmatter `description:` is the **only** text visible to the model during global skill discovery. It must include exact trigger phrases, keywords, CLI aliases, and file patterns.
2. **Request-Routing Decision Trees:** Visual top-down ASCII trees at the top of `SKILL.md` anchor attention and enforce an `if/elif/else` mental model across multi-intent skills. Use one canonical dispatch index; workflow sections add details rather than repeat the same route map.
3. **Explicit Negative Invariants ("Do NOT"):** Clearly stated non-negotiable boundaries ("Never use raw shell tools on vault notes", "Never guess regression specifications") that prune hallucinatory shortcuts. **All** negative invariants, behavioral boundaries, and output/syntax rules must reside directly in `SKILL.md`, never hidden in `references/`.
4. **Fast-Path Cognitive Budget (~120–150 lines):** `SKILL.md` is the always-loaded fast path. Treat the line budget as a ceiling, not a measure of clarity. Keep it compact, scannable, and operational; eliminate repeated guidance and long compound bullets before offloading deep edge cases, encyclopedic tables, and manuals to `references/`. Preserve complexity only when it changes routing, tool or evidence requirements, stopping behavior, or safety. Optimize for the least capable intended model, and never strip governing rules merely to make `SKILL.md` smaller.
5. **Deterministic Script Offloading:** Replace fragile, multi-step shell generation with standalone scripts in `scripts/` or `~/.local/bin/` to save tokens and eliminate syntax errors.
6. **Evergreen Verification (No Snapshots):** Teach commands to inspect live system state (`chezmoi status`, `query_frontmatter_sql`), never bake static counts or dates into instructions. Enforce read-before-write checks.

## Skill Directory Structure

```text
skill-name/
├── SKILL.md           # Fast-path instructions (~120–150 lines)
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

The frontmatter description is the discovery gate:
- Max 1024 characters. Third-person phrasing.
- **Sentence 1 (Capability):** What the skill enables.
- **Sentence 2 (Explicit Triggers):** Exact user phrases, slash commands, or file extensions (`"Use when user asks to 'log this', 'catch up', or mentions session handoffs."`).

## Progressive Disclosure (`references/`)

First eliminate redundant explanations and give each governing rule one canonical home. Then split deep material into a `references/` folder when:
- `SKILL.md` approaches ~120–150 lines.
- Material covers encyclopedic catalogs, extensive schemas, multi-table references, deep CLI manuals, or secondary failure recovery.

### The Invariant vs. Reference Boundary:
- **Rules Stay in `SKILL.md`:** 100% of negative invariants, safety boundaries ("Never do X"), and output formatting/syntax requirements (e.g. indentation, title conventions) must live in `SKILL.md`. Agents only load `SKILL.md` by default; any rule banished exclusively to `references/` is invisible during ordinary execution.
- **Catalogs Go to `references/`:** Deep lookup tables, taxonomies, full script code, and rare troubleshooting walkthroughs. References provide *data and manuals*, never *governing constraints*.

### Reference File Standards:
1. **The Header Contract:** Every reference file must open with an H1 title followed immediately by a bold trigger block on line 3:
   ```markdown
   # Topic Title

   **Load this file when** [specific failure mode, advanced operation, schema lookup, or edge case].
   ```
   *Why:* When an agent loads a reference file via `read`, this opening line provides immediate visual and attentional confirmation that it landed on the correct document.
2. **Thematic Cohesion (One File Per Theme):** Create focused, single-purpose references (e.g., `references/troubleshooting.md`, `references/schemas.md`, `references/api-tables.md`). Never create catch-all `misc.md` or `notes.md` files.
3. **Pointer Phrasing in `SKILL.md`:** Never list bare markdown links. In `SKILL.md`, under `## Progressive Disclosure & Reference Routing`, pair every link with an explicit condition:
   - *Good:* `- If page extraction fails, tables are malformed, or OCR is unreadable, load [deep-dive reading](references/deep-dive-reading.md).`
   - *Bad:* `- See [deep-dive reading](references/deep-dive-reading.md).`
4. **Relative Pathing:** Always resolve pointers relative to the skill directory: `[topic](references/topic.md)`.
5. **Evergreen Guarantee:** Reference files must describe timeless protocols, CLI flags, schemas, and invariants. Never record static snapshot facts (e.g. document counts, temporary state dates, or active process IDs).

## Markdown Standards & Vault Syntax Isolation

- **Standard Markdown for Documentation:** Format skill prose, reference docs, dotfiles, scripts, and chat responses with GitHub-Flavored Markdown (`**bold**`, `*italic*`, code fences, lists).
- **Vault Syntax Isolation:** The highlight syntax (`~={green}...=~`, `~={magenta}...=~`) works only inside notes in `~/Dropbox/Sam-Obsidian-Vault/`. Never use it to style skill prose, dotfiles, commits, or terminal output. Literal code examples are allowed only when a skill or reference explicitly documents vault syntax.

## Review Checklist

- [ ] Description includes explicit trigger phrasing ("Use when...")
- [ ] Non-negotiable rules section contains hard negative invariants ("Never do X")
- [ ] 100% of negative invariants, safety boundaries, and output formatting rules reside in `SKILL.md` (never hidden in `references/`)
- [ ] Multi-intent skills (3+ routes) include an ASCII Request-Routing Playbook tree
- [ ] Decision tree is top-down, acyclic, and wrapped in a fenced `text` code block
- [ ] Each rule has one canonical home; the same dispatch map is not repeated
- [ ] Fast-path `SKILL.md` fits within ~120–150 lines
- [ ] A model can identify the route, next action, forbidden shortcuts, stopping condition, and required output without reconciling repeated instructions
- [ ] Uses standard Markdown for skill prose; literal Obsidian highlight syntax appears only in code when documenting vault behavior
- [ ] Complex multi-line shell logic offloaded to scripts
- [ ] Deep edge cases split into self-describing `references/` files
- [ ] No time-sensitive state snapshots or dates baked into instructions
- [ ] Tracked in Chezmoi (`chezmoi add ~/.agents/skills/<skill-name>/SKILL.md`)
