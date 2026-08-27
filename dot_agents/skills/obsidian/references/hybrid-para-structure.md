# Hybrid Johnny.Decimal / PARA Vault Structure

**Load this file when** filing notes, organizing folders, understanding the Hybrid Johnny.Decimal / PARA taxonomy, managing project lifecycle transitions, or handling user-applied prefixes.

## 1. Top-Level Taxonomy (Tier 1)

Top-level folders use strict two-digit zero-padded numeric prefixes for deterministic sorting:

| Prefix | Folder | PARA Classification | Purpose & Scope | Lifecycle / Movement |
|---|---|---|---|---|
| `00_` | `00_Inbox/` | Capture | Transient, unprocessed notes, raw web clippings, fleeting thoughts. | Triage regularly into 10, 20, or 30. Empty by default. |
| `01_` | `01_Todo/` | Action | Active task lists, purchases, short-term reminders (`Todo.md`, `Buy.md`, `Remember.md`). | Living, active task hub. |
| `02_` | `02_Memories/` | System Memory | Domain-agnostic persistent memory store for agent discoveries, hardware/Linux configs, benchmarks, and workflows. | Permanent agent memory store. |
| `10_` | `10_Projects/` | Projects | Active, deadline-driven deliverables: working papers (`Paper-Detroit`), custom image builds, active tasks. | **Transient:** Moves to `90_Archive/` upon completion. |
| `20_` | `20_Library/` | Resources | Permanent reference knowledge, academic literature (`Modern-DiD-Lit`, `New-Econometric-Lit`), theory, cheat sheets. | **Permanent / Evergreen.** |
| `30_` | `30_Personal/` | Areas | Indefinite life domains: personal administration, family, hobbies (`Personal-Admin`, `Personal-Interests`). | **Permanent.** |
| `90_` | `90_Archive/` | Archives | Completed manuscripts, retired system configs, past applications, superseded notes. | **Cold storage:** Read-only reference. |
| `98_` | `98_Bases/` | Meta | Vault-wide Dataview bases, dynamic database views, global index tables. | System machinery. |
| `99_` | `99_System/` | Meta | Non-content plumbing: `Templates/`, `Z_Attachments/` (binary assets: PDFs, images), sync configs (`Z_BOOX`). | System machinery. |

## 2. Subfolder Conventions & User Prefix Invariant

- **Default Agent Subfolders:** Subfolders created by agents must use clean semantic **`Title-Case-With-Hyphens`** without numeric prefixes (e.g., `10_Projects/Paper-Detroit/`, `20_Library/Modern-DiD-Lit/`).
- **Samuel's Manual Prefix Invariant:** Samuel personally assigns numeric/alphanumeric prefixes to subfolders and notes to control sort order (e.g., `00_Topic-Notes.md`, `00_Personal-Inbox/`, `z_Archive/`). **Agents must never strip, rename, or modify user-applied prefixes.**

## 3. Note Filename Conventions

1. **Standard Notes (`Title-Case-With-Hyphens.md`):** Conceptual, project, and topic notes (e.g., `System-Architecture.md`, `Music-Management.md`). Acronyms stay uppercase (`Local-LLMs.md`, `SearXNG-MCP.md`).
2. **Academic Literature (`Author-Year.md` or `Author-Year-Slug.md`):** Paper summaries and literature notes (e.g., `Baker-2025.md`, `Oster-2019.md`).
3. **Event / Log Notes (`YYYY-MM-DD-slug.md`):** Benchmark logs, crash post-mortems, and dated memories.
4. **Index / Hub Notes (`00_Topic-Notes.md` or `Index.md`):** Overview notes anchored at the top of directories.

## 4. Lifecycle Rules & Transitions

- **Project Completion $\to$ Archive:** When a project in `10_Projects/<Project-Name>` finishes, move the entire project folder to `90_Archive/<Project-Name>` via `turbovault_move_note` or `turbovault_batch_execute`.
- **Inbox Triage:** Unprocessed notes in `00_Inbox/` or `30_Personal/Personal-Inbox/` must be triaged into permanent homes in `10_Projects/`, `20_Library/`, or `30_Personal/`.
- **Literature vs. Projects:** Literature reviews and theory summaries belong in `20_Library/`. Only active manuscripts being drafted belong in `10_Projects/`.

## 5. Agent Memories Protocol (`02_Memories/`)

- **Trigger:** When Samuel says *"remember this"* or *"save this"*.
- **Target:** `~/Dropbox/Sam-Obsidian-Vault/02_Memories/<Topic-Slug>.md` (or `YYYY-MM-DD-slug.md`).
- **Append Rule:** If a note on that topic exists, append new information rather than creating a duplicate.
- **Epistemic Status:** Historical captures / scratchwork; verify against current system state.
