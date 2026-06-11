---
name: obsidian
description: Call this skill whenever reading, writing, creating, editing, listing, or modifying files/directories in Samuel's Obsidian vault under `/var/home/samuel/Dropbox/Sam_Personal_Vault/`. Use when working with vault notes, creating new notes, filing documents, or following vault formatting and naming conventions.
---

# Vault

Location: `~/Dropbox/Sam_Personal_Vault/`

## Folder Structure

| Folder | Purpose |
|---|---|
| `00_Inbox/` | Fleeting/unprocessed notes |
| `01_Todo/` | Active tasks |
| `10_Projects/` | Project folders (one subfolder per project) |
| `20_Library/` | Reference material, literature notes |
| `30_Personal/` | Personal notes |
| `98_Bases/` | Dataview bases |
| `99_System/` | Templates, system config |

Top-level folders use `NN_` numeric prefix for ordering. All subfolders use hyphens and Title Case: `10_Projects/Local-LLMs`, `30_Personal/20_Personal-Interests`.

# Formatting Rules

## Headings

The note title is the filename — do not repeat it as a heading inside the document. Body content starts at H1.

Numbering scheme:
- H1 `#` → `1.`, `2.`, `3.`
- H2 `##` → `1.A.`, `1.B.`
- H3 `###` → `1.A.1`, `1.A.2` (no trailing dot)

## Text Emphasis

Do not use `**bold**`. Use the Obsidian color syntax instead:
- `~={green}text=~` — active, correct, confirmed
- `~={orange}text=~` — warnings, pending, commands
- `~={magenta}text=~` — use sparingly for additional contrast

Be consistent: pick a color for a role and stick to it within a note.

# Naming Conventions

## Files

- Hyphens as word separators, no spaces, no special characters
- Title Case: `Build-Process.md`, `Greek-Yogurt.md`
- Prefer brief names — the folder provides context

Special patterns:
- Academic citations: `Author-Year.md` or `Author-Year-Slug.md` → `Baker-2025.md`, `Oster-2019-DiD.md`
- Dated inbox notes: `YYYY-MM-DD-Slug.md` → `2026-06-09-Note-1.md`
- Attachments: same hyphen convention → `Baker-2025-DiD.pdf`

# Creating and Editing Notes

When creating a new note, determine the correct folder before writing:
- Fleeting or unprocessed → `00_Inbox/`
- Belongs to an active project → `10_Projects/<Project-Name>/`
- Reference/literature → `20_Library/`
- Personal → `30_Personal/`

Do not create new top-level folders without asking. Do not add YAML frontmatter unless the existing notes in that folder use it.

# Memories

When Samuel says "remember this", write a brief note to:
`~/Dropbox/Sam_Personal_Vault/30_Personal/00_Personal-Inbox/LLM-Memories/`

Use a descriptive filename: `Topic-Slug.md`. Append to an existing file if one already covers the same topic rather than creating duplicates.
