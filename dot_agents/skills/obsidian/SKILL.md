---
name: obsidian
description: Manages reading, writing, creating, editing, listing, and modifying files and directories in Samuel&apos;s Obsidian vault at `~/Dropbox/Sam-Obsidian-Vault/`. Use when working with Obsidian, markdown vault notes, creating new notes, filing documents, or following vault formatting and naming conventions.
---

# Obsidian Vault

## Quick start

When creating or editing a note, follow these core conventions:
- **Location:** `~/Dropbox/Sam-Obsidian-Vault/`
- **Filename:** Title-Case-With-Hyphens.md (e.g., `Local-LLMs.md`). Brief — folder provides context. No spaces or special characters.
  - Academic pattern: `Author-Year.md` or `Author-Year-Slug.md` (e.g., `Baker-2025-DiD.md`)
- **Title:** The filename acts as the title. **Do not** repeat it as a heading. Start the note body directly at `H1` (`#`).

## Workflows

### 1. Determining Target Folder
1. Infer appropriate folder by conversation context.
2. If it is not clear, use top-level folders: 
   - `00_Inbox/`: Fleeting / unprocessed notes
   - `01_Todo/`: Active tasks
   - `10_Projects/`: Projects (one subfolder per project)
   - `20_Library/`: Reference, literature, topic notes
   - `30_Personal/`: Personal notes (family, interests, etc.)
3. Subfolders use hyphens and Title Case (e.g., `30_Personal/20_Personal-Interests`). Acronyms uppercase: `Local-LLMs`.
4. **Never** create new top-level folders without asking.

### 2. Editing an Existing Note
1. **Before editing**, commit the current vault state as a pre-edit snapshot:
   ```bash
   git -C ~/Dropbox/Sam-Obsidian-Vault add -A && git -C ~/Dropbox/Sam-Obsidian-Vault commit -m "pre-edit snapshot" --allow-empty
   ```
2. Apply changes respecting heading numbering (do not use formatting in headings):
   - `H1` (`#`) -> `# 1 First Section Title`, `# 2 Second Section Title`, etc
   - `H2` (`##`) -> `## 1.1 First Subsection Title`, `## 1.2 Second Subsection Title`, etc
   - `H3` (`###`) -> `### 1.1.1 First Subsubsection Title`, `### 1.1.2 Second Subsubsection Title`, etc
   - The `#` is the markdown heading marker; the number is the heading text.
   - Sub-sections reset under each parent: H1 `1` → H2 `1.1`, `1.2` → H2 `2` → H2 `2.1`, `2.2`.
   - Replace placeholder titles with relevant titles.
3. **After editing**, commit and push the changes:
   ```bash
   git -C ~/Dropbox/Sam-Obsidian-Vault add -A && git -C ~/Dropbox/Sam-Obsidian-Vault commit -m "brief description of edit" && git -C ~/Dropbox/Sam-Obsidian-Vault push
   ```
4. Use color syntax for formatting, avoiding `**bold**`:
   - `~={green}text=~` (mid-sentence highlight)
   - `~={orange}text=~` (organizational highlight)
   - `~={magenta}text=~` (warning or danger)
   Note the trailing `=~`.

### 3. Adding Links, Embeds, and Callouts
- **Internal:** `[[wikilink]]` or `[[wikilink|alias]]`
- **Embeds:** `![[filename.pdf]]`
  - Collapsed embed: 
    ```markdown
    > [!info]- Title
    > ![[file.pdf]]
    ```
- **External:** Must use `http://` or `https://` explicitly.
- **Callouts:** 
  ```markdown
  > [!note] Label
  > Content
  ```
  - Common types: note, info, warning, success, question, example, quote. Add `-` to collapse by default.

## Advanced features

- **Folder Structure Reference:**
  - `98_Bases/`: Dataview bases
  - `99_System/`: Templates, system config, attachments
  - `.trash/`: Deleted notes — do not recreate files here
- **LLM Tone & Aesthetics:** Avoid LLM indicators: no emdashes, no negative parallelisms, no emojis.
- **Plugins:** obsidian-git, obsidian-icon-folder, obsidian-latex-suite, obsidian-minimal-settings, obsidian-style-settings, obsidian-vimrc-support, fast-text-color.
