# Hybrid Johnny.Decimal / PARA Vault Structure

Load this reference when filing new notes, organizing folders, understanding the Hybrid Johnny.Decimal / PARA taxonomy, managing project lifecycle transitions to archive, or applying the manual prefix exception.

---

## 1. Top-Level Taxonomy (Tier 1)

Top-level folders use strict two-digit zero-padded numeric prefixes to guarantee deterministic top-to-bottom sorting across Obsidian, terminal tools (`yazi`, `fzf`), external editors (`Zed`), and Git:

| Prefix | Folder | PARA Classification | Purpose & Scope | Lifecycle / Movement |
| :--- | :--- | :--- | :--- | :--- |
| `00_` | `00_Inbox/` | Capture | Transient, unprocessed notes, raw web clippings, fleeting thoughts. | Triage weekly into 10, 20, or 30. Empty by default. |
| `01_` | `01_Todo/` | Action | Active task lists, purchases, short-term reminders (`Todo.md`, `Buy.md`, `Remember.md`). | Living, active task hub. |
| `02_` | `02_Memories/` | System Memory | Domain-agnostic persistent memory store for LLM agents and system discoveries (hardware, Linux configs, benchmarks, workflows). | Permanent agent memory repository. |
| `10_` | `10_Projects/` | Projects | Active, deadline-driven deliverables with a defined outcome: working papers (`Paper-Detroit`), active software builds (`Custom-Image`), active job search. | **Transient:** Moves to `90_Archive/` upon completion. |
| `20_` | `20_Library/` | Resources | Permanent reference knowledge, academic literature (`Modern-DiD-Lit`, `New-Econometric-Lit`), econometrics theory, coding cheat sheets. | **Permanent / Evergreen.** |
| `30_` | `30_Personal/` | Areas | Indefinite life domains and standards to maintain: personal administration, family, hobbies, interests (`Personal-Admin`, `Family`, `Personal-Interests`). | **Permanent.** |
| `90_` | `90_Archive/` | Archives | Completed manuscripts, retired system/OS configs, past applications, superseded notes. | **Cold storage:** Read-only reference. |
| `98_` | `98_Bases/` | Meta | Vault-wide Dataview bases, dynamic database views, global index tables. | System machinery. |
| `99_` | `99_System/` | Meta | Non-content plumbing: `Templates/`, `Z_Attachments/` (binary assets: PDFs, images), sync configs (`Z_BOOX`). | System machinery. |

---

## 2. Subfolder Conventions (Tier 2+) & Samuel's Manual Prefix Exception

### A. Default Semantic Subfolders
All subfolders created by agents must use clean, semantic **`Title-Case-With-Hyphens`** without numeric prefixes (e.g., `10_Projects/Paper-Detroit/`, `20_Library/Modern-DiD-Lit/`, `30_Personal/Personal-Admin/`, `30_Personal/Personal-Interests/Cooking/Mexican/`).

### B. Samuel's Manual Prefix Exception (User-Managed)
* **Rule:** Samuel personally manages numeric/alphanumeric prefixes on subfolders or notes when he wants to pin them to the top or bottom of alphabetical listings (e.g., `00_Topic-Notes.md`, `00_Personal-Inbox/`, `z_Archive/`).
* **Agent Invariant:** Agents must **never** strip, rename, remove, or modify any user-applied prefix (such as `00_`, `01_`, or `z_`) on existing folders or notes.
* **Agent Default:** When creating a *new* subfolder, the agent defaults to clean semantic naming (`Title-Case-With-Hyphens`) unless Samuel explicitly requests a specific prefix.

---

## 3. Note Filename Conventions

1. **Title Case with Hyphens (`Title-Case-With-Hyphens.md`):**
   * Standard for all conceptual, project, and topic notes (e.g., `System-Architecture.md`, `Music-Management.md`).
   * No spaces or special characters. Acronyms stay uppercase (`Local-LLMs.md`, `SearXNG-MCP.md`).
2. **Academic Citations (`Author-Year.md` or `Author-Year-Slug.md`):**
   * Used for papers and literature notes (e.g., `Baker-2025.md`, `Oster-2019.md`).
3. **Date-Prefixed Event/Log Notes (`YYYY-MM-DD-slug.md`):**
   * Used for benchmark logs, incident post-mortems, and dated memories (e.g., `2026-06-28-zbook-crash-investigation.md`).
4. **Index / Hub Notes (`00_Topic-Notes.md` or `Index.md`):**
   * User-pinned overview notes anchored at the top of a directory.

---

## 4. Lifecycle Rules & Transitions

1. **Project Completion -> Archive:**
   * When a project in `10_Projects/<Project-Name>` finishes (manuscript published, job search concluded, image build finalized and stabilized), move the entire project folder to `90_Archive/<Project-Name>` using `turbovault_move_note` or `turbovault_batch_execute`.
2. **Fleeting -> Evergreen/Project:**
   * Unprocessed notes in `00_Inbox/` or `30_Personal/Personal-Inbox/` must be triaged into their permanent home in `10_Projects/`, `20_Library/`, or `30_Personal/`.
3. **Literature vs. Projects:**
   * Literature reviews and paper summaries belong in `20_Library/` under topic subfolders.
   * Only manuscripts actively being drafted belong in `10_Projects/`.

---

## 5. Agent Memories Protocol (`02_Memories/`)

* **Trigger:** When Samuel says *"remember this"* or *"save this"*.
* **Location:** `~/Dropbox/Sam-Obsidian-Vault/02_Memories/`
* **Filename:** `Topic-Slug.md` or `YYYY-MM-DD-slug.md`.
* **Append Rule:** If a note on that topic already exists, append the new information to the existing note rather than creating a duplicate.
