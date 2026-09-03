# Obsidian Formatting, Syntax & Frontmatter Schema

**Load this file when** writing note text, applying color tags, formatting headings, nesting lists, inserting wikilinks/callouts, or structuring YAML frontmatter.

## 1. Headings & Note Titles

- **Title Rule:** The filename acts as the note's title (rendered automatically by Obsidian). Start the note body directly at `H1` (`#`) with the first content section (e.g., `# Overview`). Never repeat the note title or filename as a top-level heading.
- **Number Headings Plugin:** Headings are numbered automatically.
  - **Editing existing notes:** **Never remove, strip, or alter existing heading numbers** (e.g., `# 1.`, `## 2.1.`).
  - **Creating new headings:** Write plain titles (e.g., `## Methodology`) and allow the plugin to manage numbering.
- **Plain Text Only:** Keep headings plain text without bolding, italics, or color syntax.

## 2. Closed Color Palette (No Markdown Bolding)

Never use standard Markdown `**bold**`. Use Obsidian's `fast-text-color` syntax restricted strictly to two colors:

| Syntax | Color | Role & Usage |
|---|---|---|
| `~={green}text=~` | Green | **Active / Labels / Confirmed**: Key terms, definitions, organizational labels, confirmed statuses (1–2 spans per paragraph). |
| `~={magenta}text=~` | Magenta | **Warnings & Hazards ONLY**: Dangerous commands, breaking changes, data loss risks, ignored configuration keys. |

- **Legacy Colors:** When editing notes containing legacy colors (`orange`, `red`, `blue`, `pink`), normalize them in place (`green` for labels, `magenta` for warnings).
- **Tables:** Keep table cells in plain text without color tags.

## 3. Lists & Indentation

- **Bullets vs. Numbers:** Use bullets (`-`) by default; use numbered lists only when sequence/ordering is meaningful.
- **Nesting Indentation:** Use a **double indent (4 spaces)** for nested child items. Single 2-space indents fail to nest reliably in Obsidian.
- **Hierarchy:** Alternate list types when nesting (bullet $\to$ numbered or numbered $\to$ bullet) to distinguish hierarchy levels.

## 4. Wikilinks, Embeds & Callouts

- **Wikilinks (`[[Note-Name]]`):** Link entities, papers, datasets, and methods (e.g., `[[Paper-Detroit]]`, `[[Callaway-SantAnna-2021]]`).
  - Aliases: `[[Parallel-Trends-Assumption|parallel trends]]`.
  - Section Links: `[[Zotero-MCP#5. Embedding Pipeline]]`.
  - External URLs: Must include protocol (`https://...`).
- **File Embeds:** `![[filename.pdf]]` (or wrapped in collapsed callout `> [!info]- Title\n> ![[file.pdf]]`).
- **Callouts:** `> [!note] Label` (supported types: `note`, `info`, `warning`, `success`, `question`, `example`, `quote`). Append `-` for collapsed callouts (`> [!info]-`).

## 5. Frontmatter & Tag Typology

All metadata and tags must reside exclusively in YAML frontmatter. Never use inline `#tags` in note prose.

### Frontmatter Template
```yaml
---
created: YYYY-MM-DDTHH:MM:SS
updated: YYYY-MM-DDTHH:MM:SS
description: "Concise 1–2 sentence summary of core takeaway, model, or discovery."
tags:
  - econometrics
  - stata
  - pin
---
```

- **`created` / `updated`:** `YYYY-MM-DDTHH:MM:SS` local time (zero-padded, no timezone/milliseconds). Agent owned.
- **`description:` Policy:**
  - **Required in:** `10_Projects/`, `20_Library/`, and `02_Memories/` (enables token-efficient `query_frontmatter_sql` scans).
  - **Omitted in:** `00_Inbox/`, `01_Todo/`, `30_Personal/`.
  - **Rules:** 1–2 plain-text sentences wrapped in double quotes. **No wikilinks or markdown** inside the string.
- **Canonical Flat Tag Baseline:**

| Category | Tag | Scope & Definition |
|---|---|---|
| **Attention** | `pin` | High-priority reference notes frequently cited across folders. |
| | `to-read` | Literature or documentation queued for reading/extraction. |
| | `to-do` | Actionable task or next-steps bookmark on a note without relocating it. |
| **Structure** | `moc` | Map of Content / Hub note. **Mandatory on all `00_` notes.** |
| **Tools** | `python` | Python scripts, libraries, data workflows. |
| | `stata` | Stata do-files, estimation recipes, syntax guides. |
| | `latex` | TeX/LaTeX templates, math formatting, TikZ. |
| | `linux` | Shell scripts, desktop/OS configuration, CLI tooling. |
| **Disciplines** | `probability` | Probability theory, measure theory. |
| | `econometrics` | Econometric theory, applied econometrics, research design. |
| | `economics` | Non-data economic theory (micro, urban, etc.). |
| | `math` | Mathematics catchall. |

- **Tag Rules:** Flat lowercase strings only. No inline `#tags`. Prefer existing baseline tags before creating new domain tags.
