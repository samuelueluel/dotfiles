# Obsidian Formatting and Syntax

Load this reference when writing note content, formatting headings, applying color syntax, nesting lists, or adding wikilinks, embeds, and callouts.

---

## 1. Headings & Note Titles

* **Title Rule:** The filename acts as the note's title. **Do not** repeat it as an `H1` (`#`) at the top of the note. Start the note body directly at `H1` (`#`).
* **Number Headings Plugin Compatibility:** 
    * Headings are automatically numbered by Obsidian's **Number Headings** plugin.
    * **When editing existing notes:** **Do NOT remove, strip, or alter existing heading numbers** (e.g., `# 1.`, `## 2.1.`).
    * **When creating brand new headings:** Write plain titles (e.g., `## Methodology`) and allow the plugin to manage numbering automatically.
* **No Formatting in Headings:** Keep headings plain text without bolding, italics, or inline color tags.

---

## 2. Color Syntax (Closed Palette)

Never use standard Markdown `**bold**`. Instead, use Obsidian's `fast-text-color` syntax. The palette is strictly closed to two colors:

| Syntax | Color | Strict Role & Meaning | Usage Rule |
| :--- | :--- | :--- | :--- |
| `~={green}text=~` | Green | **Active / Confirmed / Labels**: Definitions, key terms, organizational labels, confirmed statuses. | Highlight key phrases only (1–2 spans per paragraph). |
| `~={magenta}text=~` | Magenta | **Warnings & Dangers ONLY**: Things that can break, cause data loss, or silently mislead (e.g. destructive commands, ignored config keys). | Use sparingly for true hazards. |

* **Legacy Color Normalization:** When editing notes containing legacy colors (`orange`, `red`, `blue`, `pink`), normalize them in place: convert labels/emphasis to `green` and retain `magenta` only for genuine warnings.
* **Tables:** Keep table cells in plain text without color tags.

---

## 3. Lists

* **Bullets vs. Numbers:** Prefer bullets (`-`) unless order or sequence is meaningful. Use numbered lists only when sequential execution matters.
* **Indentation:** For nested (child) bullet/numbered lists, use a **double indent** (4 spaces / two tab-widths) rather than a single indent — children must sit clearly under their parent. A single 2-space indent can fail to nest reliably in Obsidian.
* **Nesting Distinction:** When nesting, alternate list type (bullet -> numbered or numbered -> bullet) to visually distinguish hierarchy levels.

---

## 4. Wikilinks, Embeds, and Callouts

### A. Wikilinks (`[[Note-Name]]`) — For Entities & Concepts
Wikilinks create explicit graph connections between knowledge assets.
* **Entities & Concepts:** Use wikilinks for concrete entities, papers, estimators, datasets, and methods (e.g., `[[Callaway-SantAnna-2021]]`, `[[Paper-Detroit]]`, `[[TWFE-Critique]]`, `[[Stata-MCP]]`).
* **Aliases:** Use aliases when sentence grammar differs from the note title: `[[Parallel-Trends-Assumption|parallel trends]]`.
* **Section Links:** Link directly to headings when citing specific findings: `[[Zotero-MCP#5. Embedding Pipeline]]`.
* **External Links:** Must explicitly specify protocol: `https://...` or `http://...`

### B. Embeds & Callouts
* **File Embeds:** `![[filename.pdf]]`
    * Collapsed embed pattern:
        ```markdown
        > [!info]- Title
        > ![[file.pdf]]
        ```
* **Callouts:**
  ```markdown
  > [!note] Label
  > Content
  ```
    * Supported types: `note`, `info`, `warning`, `success`, `question`, `example`, `quote`.
    * Add `-` immediately after the type identifier to make the callout collapsed by default (e.g., `> [!info]-`).

---

## 5. Frontmatter & Tag Typology (Flat Tag Schema)

All metadata and tags must reside exclusively in the YAML frontmatter block at the top of the note. Never use inline `#tags` in note prose.

### A. Frontmatter Template
```yaml
---
created: 2026-08-16T17:35:00
updated: 2026-08-16T17:35:00
description: "Concise 1–2 sentence summary of core takeaway, model, or discovery."
tags:
  - econometrics
  - stata
  - pin
---
```

* **`created` / `updated`:** Formatted as `YYYY-MM-DDTHH:MM:SS` (zero-padded local time, no timezone or milliseconds). Agent owned.
* **`description`:** Concise 1–2 sentence plain-text summary (scoped to specific folders; see below).
* **`tags`:** A YAML list of clean, flat, lowercase strings selected from the canonical baseline below (optional when no tag cleanly applies).

### B. Description Field Policy

* **Required Scope:** `10_Projects/`, `20_Library/`, and `02_Memories/` (creates high-signal catalogs for fast token-efficient `turbovault_query_frontmatter_sql` scans and research subagents).
* **Omitted Scope:** `00_Inbox/`, `01_Todo/`, `30_Personal/` (keep personal and transient notes frictionless).
* **Formatting Rules:**
    * Strict length: 1–2 plain text sentences maximum.
    * Always wrap in double quotes (`"..."`).
    * Plain text only: **no wikilinks, inline formatting, or markdown** inside the description string to prevent SQLite/Dataview parsing issues.
* **Domain Guidelines & Examples:**
    * `20_Library/`: Core takeaway, estimator, theorem, or identification strategy.
        * *Example:* `description: "Derives bounds on unobservable selection (delta) using R-squared movements and coefficient stability under proportional selection."`
    * `10_Projects/`: Research question, data sources, empirical specification, or deliverable status.
        * *Example:* `description: "Working paper evaluating Detroit land-value tax reform using parcel microdata and spatial difference-in-differences."`
    * `02_Memories/`: High-level summary of configuration, workflow discovery, hardware tweak, or system benchmark.
        * *Example:* `description: "Resolves ALSA/PipeWire audio crackling on AMD Ryzen AI MAX+ by tuning buffer quantum and headroom settings."`

### C. Canonical Baseline Tag Vocabulary

| Category | Tag | Definition & Scope |
| :--- | :--- | :--- |
| **Attention & Bookmarks** | `pin` | High-priority reference notes frequently referenced across folders. |
| | `to-read` | Literature notes or documentation queued for reading/extraction. |
| | `to-do` | Actionable task or next-steps bookmark on a note without relocating it. |
| **Structure** | `moc` | Map of Content / Hub note (`00_Topic` overview notes). Mandatory on all `00_` notes. |
| **Tools & Environments** | `python` | Python scripts, libraries, data workflows. |
| | `stata` | Stata do-files, estimation recipes, syntax guides. |
| | `latex` | TeX/LaTeX templates, math formatting, TikZ. |
| | `linux` | Shell scripts, desktop/OS configuration, system administration, CLI tooling. |
| **Disciplines & Concepts** | `probability` | Notes related to the mathematical field of probability theory / measure theory. |
| | `econometrics` | Notes related to econometric theory and applied econometrics, including broader topics like research design. |
| | `economics` | Notes related to non-data econ theory like microeconomics, urban economics, etc. |
| | `math` | Catchall for math notes, can include probability theory notes. |

### D. Tagging Rules
* **Flat Lowercase Format:** Use simple flat strings without prefixes or slashes (e.g., `econometrics`, `pin`, `to-read`).
* **Frontmatter Only:** Always declare tags in YAML frontmatter; never embed inline `#tag` tokens in markdown prose.
* **Optional by Default:** Apply tags when they cleanly describe the note. Notes may omit `tags:` if no canonical tag applies cleanly (except `00_` MOC notes where `moc` is mandatory).
* **MOC Requirement:** All `00_` Map of Content / Hub notes must include the `moc` tag.
* **Prefer the Baseline:** Always prefer existing tags from the canonical baseline before creating new domain tags.


