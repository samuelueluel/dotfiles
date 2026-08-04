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
2. Apply changes using plain heading names (do not use formatting in headings):
   - **Never** prefix headings with numbers, letters, or outline markers (e.g. `1`, `1.1`, `A.`). The Number Headings plugin handles numbering automatically.
   - Replace placeholder titles with relevant titles.
3. **After editing**, commit and push the changes:
   ```bash
   git -C ~/Dropbox/Sam-Obsidian-Vault add -A && git -C ~/Dropbox/Sam-Obsidian-Vault commit -m "brief description of edit" && git -C ~/Dropbox/Sam-Obsidian-Vault push
   ```
4. Use color syntax for formatting, avoiding `**bold**`:
   - `~={green}text=~` (all emphasis — definitions, key terms, inline highlights, organizational labels)
   - `~={magenta}text=~` (warnings and dangers only — e.g. a command that can break something)
   Note the trailing `=~`. When possible it is better to highlight connected segments of sentences rather than whole sentences or paragraphs.
5. Lists:
   - Prefer bullets (`-`) unless order or sequence is meaningful — use numbered lists only when numbering matters.
   - For nested lists, indent with a tab.
   - When nesting, alternate list type (bullet → numbered or numbered → bullet) to visually distinguish levels.

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

### 4. TurboVault MCP Tools (Mandatory Vault Substrate)
You MUST ALWAYS connect to and use the `turbovault` MCP server for all vault operations. **DO NOT** execute raw shell commands (`find`, `grep`, `cat`, `ls`, `sed`, `awk`) against `~/Dropbox/Sam-Obsidian-Vault/`.

- **Mandatory Connection:** At the start of any vault task, connect to `turbovault` (`mcp connect turbovault` or invoke `turbovault` tools).
- **Context & Inspection:** Use `get_vault_context`, `list_vaults`, and `quick_health_check`.
- **Search & Links:** Use `search`, `get_backlinks`, and `get_broken_links`.
- **Reading & Edits:** Use `read_note` and `edit_note` (or `batch_execute` for multi-note changes).
- **Git Sync:** TurboVault creates local atomic Git commits on note mutation, but you must still execute the post-edit `git push` workflow in step 2.3 when required.

## Advanced features

- **Folder Structure Reference:**
  - `98_Bases/`: Dataview bases
  - `99_System/`: Templates, system config, attachments
  - `.trash/`: Deleted notes — do not recreate files here
- **LLM Tone & Aesthetics:** Avoid LLM indicators: no emdashes, no negative parallelisms, no emojis.
- **Plugins:** obsidian-git, obsidian-icon-folder, obsidian-latex-suite, obsidian-minimal-settings, obsidian-style-settings, obsidian-vimrc-support, fast-text-color.
