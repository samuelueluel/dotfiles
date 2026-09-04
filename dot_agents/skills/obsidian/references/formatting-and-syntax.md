# Obsidian Formatting, Syntax & Frontmatter Schema

**Load this file when** writing note text, applying color tags, formatting headings, nesting lists, inserting wikilinks/callouts, or structuring YAML frontmatter.

## 1. Heading Examples

For `Example-Note.md`, begin with the first content section rather than repeating the filename:

```markdown
# Overview

## Methodology
```

Existing plugin-generated numbers such as `# 1.` and `## 2.1.` remain unchanged. Supply new headings as plain, unnumbered text without bold, italics, or color syntax.

## 2. Closed Color Palette

| Literal syntax | Color | Role and usage |
|---|---|---|
| `~={green}text=~` | Green | Active terms, definitions, organizational labels, and confirmed statuses; normally 1–2 spans per paragraph. |
| `~={magenta}text=~` | Magenta | Genuine warnings and hazards: dangerous commands, breaking changes, data-loss risks, or ignored configuration keys. |

Normalize legacy colors (`orange`, `red`, `blue`, `pink`) to green for labels or magenta for warnings. Keep table cells plain.

## 3. Nested List Example

Use bullets by default and numbers when sequence matters. Alternate list types at each level:

```markdown
- Parent item
    1. Ordered child
        - Nested detail
```

## 4. Wikilinks, Embeds & Callouts

- **Wikilinks:** `[[Note-Name]]` for entities, papers, datasets, and methods.
  - Alias: `[[Parallel-Trends-Assumption|parallel trends]]`
  - Section: `[[Zotero-MCP#5. Embedding Pipeline]]`
- **External URLs:** Include the protocol, such as `https://...`.
- **File embeds:** `![[filename.pdf]]`
- **Callouts:** `> [!note] Label`; supported types are `note`, `info`, `warning`, `success`, `question`, `example`, and `quote`. Append `-` for a collapsed callout: `> [!info]-`.

## 5. Frontmatter Schema

```yaml
---
created: YYYY-MM-DDTHH:MM:SS
updated: YYYY-MM-DDTHH:MM:SS
description: "Concise 1–2 sentence summary of the core takeaway, model, or discovery."
tags:
  - econometrics
  - stata
  - pin
---
```

- **Description placement:** Required in `10_Projects/`, `20_Library/`, and `02_Memories/`; omit it in `00_Inbox/`, `01_Todo/`, and `30_Personal/`. Use 1–2 plain-text sentences in double quotes, without wikilinks or Markdown.
- **Timestamp format:** Local time, zero-padded, without timezone or milliseconds.
- **Canonical flat tags:**

| Category | Tag | Scope |
|---|---|---|
| Attention | `pin` | High-priority reference note |
| | `to-read` | Queued literature or documentation |
| | `to-do` | Actionable task or next step |
| Structure | `moc` | Map of Content; required on every `00_` hub note |
| Tools | `python` | Python scripts, libraries, and workflows |
| | `stata` | Stata code and estimation guidance |
| | `latex` | TeX, LaTeX, TikZ, and math formatting |
| | `linux` | Shell, desktop, OS, and CLI tooling |
| Disciplines | `probability` | Probability and measure theory |
| | `econometrics` | Econometric theory, applied econometrics, and research design |
| | `economics` | Economic theory and applications |
| | `math` | General mathematics |

Prefer these tags before creating a new domain tag.
