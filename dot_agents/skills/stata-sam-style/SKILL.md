---
name: stata-sam-style
description: Beautify a Stata do-file to a fixed 64-column house style (headers, section banners, wrapped prose comments, blank-line spacing) without modifying active code. Use when formatting Stata do-files or when user asks to style, standardize, or beautify do-file layout.
---

# Stata Style

Enforces Samuel's 64-column house style on Stata do-files: metadata headers, section banners (`* ====` and `* ----`), wrapped prose comments (`/* ... */`), and standardized blank-line spacing.

Operates via an **Architect + Builder** workflow: the LLM defines formatting operations in a JSON recipe, and a deterministic Python script verifies and applies them safely.

## Quick start

```bash
# 1. Scan the file to get exact comment line numbers
python3 ~/.agents/skills/stata-sam-style/scripts/stata_style_apply.py --scan <target_file.do>

# 2. Write recipe to /tmp/style_recipe.json (see schema in references/recipe-schema.md)

# 3. Dry-run and preview diff
python3 ~/.agents/skills/stata-sam-style/scripts/stata_style_apply.py --diff <target_file.do> /tmp/style_recipe.json

# 4. Apply formatting in-place
python3 ~/.agents/skills/stata-sam-style/scripts/stata_style_apply.py <target_file.do> /tmp/style_recipe.json
```

## Workflows

### 4-Step Styling Execution

1. **Scan**: Run `--scan` to extract comment regions and line numbers. Never hand-count line numbers.
2. **Draft Recipe**: Create `/tmp/style_recipe.json` mapping scanned lines to actions:
   - `header`: Purpose, Author, Created/Updated dates, Inputs, Outputs, Notes.
   - `banners`: Section numbers and titles (`level: 1` for `=`, `level: 2` for `-`). Add `"action": "promote"` for 1-line titles.
   - `prose_blocks`: Explanatory reasoning to wrap at 64 columns (`step_comment` or `notes_block`).
3. **Verify Diff**: Run `--diff` to preview changes and verify the active code token hash matches before touching the file.
4. **Apply**: Run `stata_style_apply.py <file.do> <recipe.json>` to format in-place.

## Invariant & Safety Rules

- **Zero Active Code Mutation**: `stata_style_apply.py` cryptographically hashes all active code tokens before and after formatting. If any command or code character changes, it aborts immediately.
- **Do Not Box Inline Labels**: Short labels (e.g. `/* Dropping */`, `/* Preamble */`) must be omitted from `banners` so they stay untouched.
- **Do Not Wrap Disabled Code**: Never include commented Stata syntax in `prose_blocks`.

## Advanced features

For the full JSON schema specifications, field definitions, and worked examples, see [references/recipe-schema.md](references/recipe-schema.md).
