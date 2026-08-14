---
name: checkpoint
description: Creates a structured Markdown state snapshot in the Obsidian vault to save the current progress of a project for future sessions.
disable-model-invocation: true
---

# Checkpoint Skill

When the user asks to save a checkpoint (e.g., via `/checkpoint`), you will create or update a structured state file in the Obsidian vault so that the agent can seamlessly resume work in a future session.

## 1. File Location & Naming
- **Target Directory:** `~/Dropbox/Sam-Obsidian-Vault/10_Projects/Local-LLMs/Checkpoints/`
- **Filename:** `Checkpoint-[Project-Name].md` (e.g., `Checkpoint-Pi.md`). Use Title-Case-With-Hyphens.

## 2. Information to Gather
Before writing the file, gather the current state of the workspace:
1. **Goal:** What is the overarching objective of the current task?
2. **Git State:** Run `git status` and `git diff` to capture uncommitted changes. (Truncate the diff if it is excessively long).
3. **Recent Context:** Summarize the last few actions taken and the current roadblock or success.
4. **Next Steps:** Explicitly list what needs to be done next when the session resumes.

## 3. File Formatting
Format the file strictly adhering to the `obsidian` skill guidelines:
- Start directly with `H1` (`# 1 `) headings. Do not repeat the filename as a title.
- Do not use periods in the heading numbering (e.g., use `# 1 Checkpoint State`, not `# 1. Checkpoint State`).
- Use code blocks for git status and diffs.
- Do not make subjective choices about coloring. Only use the exact color formatting `text` specifically hardcoded in the Example Output Structure below. Do not apply colors anywhere else in the document.

## 4. Example Output Structure

```markdown
# 1 Original Goal
[Brief summary of the overarching objective]

# 2 Workspace State
Git Status:
\`\`\`
[Output of git status]
\`\`\`

# 3 Recent Execution State
- Completed: [What was just finished]
- Blockers: [Any current errors or walls hit]

# 4 Next Steps
1. [Step 1]
2. [Step 2]
```

## 5. Execution
1. Ensure the `Checkpoints` directory exists at the target path.
2. Overwrite the project's checkpoint file with the fresh state.
3. Once the file is written, automatically commit and push the vault changes using the standard Obsidian git workflow:
   `git -C ~/Dropbox/Sam-Obsidian-Vault add -A && git -C ~/Dropbox/Sam-Obsidian-Vault commit -m "Update checkpoint for [Project]" && git -C ~/Dropbox/Sam-Obsidian-Vault push`
