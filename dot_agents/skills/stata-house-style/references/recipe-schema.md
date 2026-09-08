# Stata Style Recipe Schema

Load this file when drafting or checking JSON styling recipes for `stata_house_style.py`.

---

## 1. Schema Definition

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "width": 72,
  "header": {
    "filename": "analysis_main.do",
    "Purpose": "Estimate baseline hedonic price models with tract fixed effects.",
    "Author": "Samuel Saltmarsh",
    "Created": "2026-05-10",
    "Updated": "2026-09-07",
    "Inputs": "data/clean/sales_clean.dta, data/clean/zoning_clean.dta",
    "Outputs": "results/tables/table_2_hedonics.tex",
    "Notes": "Restricted to single-family arm-length transactions.",
    "original_start_line": 1,
    "original_end_line": 4
  },
  "preamble": {
    "original_start_line": 6,
    "original_end_line": 21,
    "globals_file": "project_globals.do",
    "legacy_path_alias": true,
    "version": "17"
  },
  "banners": [
    {
      "level": 1,
      "number": "1",
      "title": "Setup & Path Globals",
      "original_start_line": 6,
      "original_end_line": 6
    },
    {
      "level": 2,
      "number": "1.1",
      "title": "Define Project Locals",
      "original_start_line": 15,
      "original_end_line": 17
    }
  ],
  "prose_blocks": [
    {
      "type": "notes_block",
      "original_start_line": 25,
      "original_end_line": 28
    }
  ]
}
```

---

## 2. Field Descriptions

- `width`: (Optional integer, default: 64). Target column width for headers, banners, and wrapped notes (default: 64; optionally 72).
- `header`: Metadata fields:
  - `filename`: Name of the target `.do` file.
  - `Purpose`: 1–2 sentences explaining what the script does.
  - `Author`: Author name.
  - `Created` / `Updated`: Dates in `YYYY-MM-DD` format.
  - `Inputs`: Files read by the script or data dependencies.
  - `Outputs`: Datasets, tables, or graphs created by the script.
  - `Notes`: Important caveats, data warnings, or sample restrictions.
  - `original_start_line` / `original_end_line`: 1-indexed line numbers of the old header to replace. If adding a brand new header, omit both keys.
- `preamble`: (Optional object, used only when passing `--preamble` to the command line):
  - `original_start_line` / `original_end_line`: 1-indexed line numbers of the old preamble or file paths to replace.
  - `globals_file`: (Default: `"project_globals.do"`). Globals script to load. Sets up paths so the script runs from the project root, from a subfolder, or when launched from an editor.
  - `legacy_path_alias`: (Default: `true`). Injects `global path "$root"` for compatibility with older scripts that use `$path`.
  - `version`: (Default: `"17"`). Stata version statement.

### 2.2. `banners` Array
- `level`: `1` for major sections (`* ====`), `2` for subsections (`* ----`).
- `number`: (Optional string). Section number (such as `"1"` or `"2.1"`).
- `title`: Descriptive title. Level 1 titles are capitalized automatically.
- `original_start_line` / `original_end_line`: 1-indexed line numbers of the original comments to replace with the boxed banner.

### 2.3. `prose_blocks` Array
- `type`: `"prose"` for standard paragraphs or `"notes_block"` for bulleted lists (`>` and `-`).
- `original_start_line` / `original_end_line`: 1-indexed line numbers of the prose comment to wrap.

---

## 3. Rules on Code Exclusions

- **Never target active code:** Do not include lines with Stata commands (`regress`, `use`, `gen`, `replace`, `merge`) in `original_start_line` or `original_end_line` of any recipe entry.
- **Never box inline notes:** Keep short inline notes (such as `// drop if missing`) as line comments. Do not turn them into banners.
