---
name: stata-sam-style
description: "Active style enforcer for Stata do-files. Scaffolds missing headers, upgrades loose comments into formal section banners, and wraps prose into fixed 64-column blocks. Uses a deterministic Python script to apply formatting perfectly without ever modifying active code."
---

# Stata Style

This skill acts as an **Active Style Enforcer** for Stata do-files. It enforces a strict house style — 64-column header banners, structured section banners, wrapped `/* */` prose comments, and precise blank-line spacing. 

To guarantee that active code and disabled code are **never** accidentally altered or deleted, you operate in a strict Architect + Builder workflow. You (the LLM) define *what* needs to be styled by creating a JSON recipe, and a deterministic Python script executes that recipe safely.

## Your Role: The Architect
Your job is to read the unformatted do-file and figure out how it *should* be structured:
- Is it missing a header? Read the code, figure out the inputs/outputs, and draft one.
- Is there a loose comment like `* Section 1: Intro`? Upgrade it to a Level 1 banner.
- Is there unformatted prose explaining a step? Wrap it in a step comment block.

## The JSON Styling Recipe
You will output your decisions into a JSON file (e.g., `/tmp/style_recipe.json`). The JSON must follow this exact schema:

```json
{
  "header": {
    "action": "create_or_update", 
    "filename": "analysis_main.do",
    "Purpose": "Short description of what the script does",
    "Author": "Samuel Saltmarsh",
    "Created": "2026-06-23",
    "Updated": "2026-06-23",
    "Inputs": "dataset1.dta, dataset2.dta",
    "Outputs": "results.csv",
    "original_start_line": 1, 
    "original_end_line": 3
  },
  "banners": [
    {
      "original_start_line": 15,
      "original_end_line": 15,
      "level": 1, 
      "number": "1",
      "title": "SECTION TITLE UPPERCASE"
    }
  ],
  "prose_blocks": [
    {
      "original_start_line": 22,
      "original_end_line": 23,
      "type": "step_comment"
    }
  ]
}
```

### JSON Fields Explanation
- **`header`**: Always include a header. If the file already has some messy top-level comments acting as a header, specify `original_start_line` and `original_end_line` so the script knows to replace them. If there are no top-level comments, omit those line number fields and the script will insert the header at line 1.
- **`banners`**: Identify lines that act as section dividers.
  - `level`: 1 for major sections (uses `=` box), 2 for subsections (uses `-` box).
  - `number`: The section number (e.g. "1" or "1.1"). Leave empty if no number.
  - `title`: The title WITHOUT the number.
- **`prose_blocks`**: Identify lines containing English prose that should be wrapped to 64 columns and enclosed in `/* ... */`. 
  - *Crucial Rule 1:* You MUST flag every single prose comment, even if it is only a single line long (e.g., `* Load in from Data`). Do not ignore single-line comments.
  - *Crucial Rule 2:* You CAN and SHOULD flag prose comments even if they live inside a larger `/* ... */` disabled code block. The script fully supports nested `/* */` blocks.
  - *Crucial Rule 3:* Only flag lines as prose if you are 100% sure they are not disabled Stata code. If a line contains Stata syntax (`using`, `=`, `merge`, `, options`), leave it alone. 

### Example: Targeting Nested Comments
LLMs often incorrectly skip targeting `*` comments if they reside inside disabled code blocks (`/* ... */`). You MUST target them individually!

**Original Code:**
```stata
1: /*
2: * Basic summary
3: count if !missing(id)
4:
5: * Check lengths
6: gen len = length(id)
7: */
```

**Correct Recipe:**
```json
{
  "prose_blocks": [
    { "original_start_line": 2, "original_end_line": 2, "type": "step_comment" },
    { "original_start_line": 5, "original_end_line": 5, "type": "step_comment" }
  ]
}
```

**INCORRECT Recipe:**
Do NOT target the entire `/* ... */` block (e.g. lines 1 to 7), as that would wrap the disabled code into a single paragraph! Target ONLY the `*` comment lines.

- **Line Numbers**: Use 1-indexed line numbers. Ensure they exactly match the original file lines you want to replace/wrap.

## Execution: The Builder
Once you have created the JSON recipe and saved it using the `write_to_file` tool, execute the Python builder script via `run_command`:

```bash
python3 ~/.agents/skills/stata-sam-style/scripts/stata_style_apply.py <target_file.do> /tmp/style_recipe.json
```

The script will:
1. Safely apply your header, banners, and prose wrapping.
2. Automatically enforce all house-style blank line spacing (e.g., 2 blanks before sections, 1 before subsections).
3. Automatically normalize line-trailing inline `/* note */` to `// note` per house style.
4. Verify via cryptographic hash that absolutely zero active code characters were modified.

**Never attempt to format the file manually using text replacement tools.** Always use the Python script to enforce the style perfectly.
