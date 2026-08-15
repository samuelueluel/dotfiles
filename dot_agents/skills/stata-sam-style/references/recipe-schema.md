# JSON Styling Recipe Reference

Load this reference when constructing or validating `/tmp/style_recipe.json` for `stata_style_apply.py`.

---

## Schema Overview

```json
{
  "header": {
    "action": "create_or_update", 
    "filename": "analysis_main.do",
    "Purpose": "Short description of what the script does",
    "Author": "Samuel Saltmarsh",
    "Created": "2026-06-23",
    "Updated": "2026-08-14",
    "Inputs": "dataset1.dta, dataset2.dta",
    "Outputs": "results.csv",
    "Notes": "Optional caveats or substantive notes",
    "original_start_line": 1, 
    "original_end_line": 3
  },
  "banners": [
    {
      "original_start_line": 5,
      "original_end_line": 5,
      "level": 1, 
      "number": "1",
      "title": "DATA PREPARATION",
      "action": "promote"
    },
    {
      "original_start_line": 20,
      "original_end_line": 22,
      "level": 2, 
      "number": "1.1",
      "title": "Sample Restrictions"
    }
  ],
  "prose_blocks": [
    {
      "original_start_line": 8,
      "original_end_line": 8,
      "type": "step_comment"
    },
    {
      "original_start_line": 12,
      "original_end_line": 14,
      "type": "notes_block"
    }
  ]
}
```

---

## Field Specifications

### 1. `header`
- `action`: `"create_or_update"`
- `filename`: Base name of the `.do` file.
- `Purpose`: 1–2 sentence summary of script purpose.
- `Author`: Author name.
- `Created` / `Updated`: `YYYY-MM-DD` dates.
- `Inputs` / `Outputs`: Comma-separated list of datasets and artifact files.
- `Notes`: Carry forward any substantive caveats or warnings from legacy headers.
- `original_start_line` / `original_end_line`: 1-indexed lines of the old header comment to replace. If inserting a brand new header where none existed, omit both fields.

### 2. `banners`
- `level`: `1` for major sections (`* ====`), `2` for subsections (`* ----`).
- `number`: Section number string (e.g. `"1"`, `"1.1"`). Omit if unnumbered.
- `title`: Clean title string (Level 1 is uppercased automatically).
- `original_start_line` / `original_end_line`: 1-indexed line numbers from `--scan`.
- `action`: Set to `"promote"` when upgrading a 1-line section header comment (e.g. `* 1. Data Prep`) into a full 3-line ASCII banner box.
- **Rule on Labels:** Never promote short inline label comments (`/* Dropping */`, `/* For merging */`, `/* Preamble */`, `/* Load original dbf */`). Omit them from `banners` so they remain untouched.

### 3. `prose_blocks`
- Target lines containing genuine explanatory sentences or paragraphs.
- `type`:
  - `"step_comment"`: Standard explanatory prose wrapped to 64 columns in `/* ... */`.
  - `"notes_block"`: Notes blocks preserving structured bullet tiers (`>` and `-`).
- **Rule on Code:** Never target disabled Stata code lines (lines containing `using`, `=`, `merge`, `replace`, `sum`).

---

## Worked Examples

### Banner Promotion Example
*Original Code:*
```stata
* 1. Load Data
use "$path/Data/raw.dta", clear
```

*Recipe Entry:*
```json
{
  "banners": [
    {
      "original_start_line": 1,
      "original_end_line": 1,
      "level": 1,
      "number": "1",
      "title": "LOAD DATA",
      "action": "promote"
    }
  ]
}
```

*Output:*
```stata
* ==============================================================
* [1] LOAD DATA
* ==============================================================

use "$path/Data/raw.dta", clear
```
