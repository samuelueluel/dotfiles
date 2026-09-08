# Stata Style Recipe Schema

**Load this file when** drafting or debugging JSON styling recipes for `stata_house_style.py`.

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

## 2. Field Specifications

- `width`: (Optional integer, default: 64). Target column width for headers, banners, and wrapped prose (optimal for Niri splits on 14" screens; optionally 72).
- `header`: Metadata dictionary.
  - `filename`: Base name of the target `.do` file.
  - `Purpose`: 1–2 sentence statement of what the script does.
  - `Author`: Author name.
  - `Created` / `Updated`: `YYYY-MM-DD` date strings.
  - `Inputs`: Comma-separated list or array of read files or data dependencies.
  - `Outputs`: Comma-separated list or array of generated datasets, tables, or graphs.
  - `Notes`: Optional substantive warnings, data caveats, or sample restrictions.
  - `original_start_line` / `original_end_line`: 1-indexed range of lines in the original file to replace with the formatted header. If inserting a brand new header where none existed, omit both keys.
- `preamble`: (Optional dictionary, activated only when `--preamble` is passed to the CLI).
  - `original_start_line` / `original_end_line`: 1-indexed range of legacy preamble/path lines to replace.
  - `globals_file`: (Default: `"project_globals.do"`). Globals script to load. Generates a self-rooting preamble (`confirm file "project_globals.do"` -> fallback `confirm file "../project_globals.do"` -> `cd ..`) so the script runs identically whether executed from project root, launched via double-click in Windows Explorer, or run via Zed.
  - `legacy_path_alias`: (Default: `true`). Injects `global path "$root"` for backward compatibility with legacy `$path` references.
  - `version`: (Default: `"17"`). Stata version statement.

### 2.2. `banners` Array
- `level`: `1` for major sections (`* ====`), `2` for subsections (`* ----`).
- `number`: (Optional string). Section identifier (e.g. `"1"`, `"2.1"`).
- `title`: Clean descriptive title. (Level 1 titles are automatically uppercased).
- `original_start_line` / `original_end_line`: 1-indexed range of the original comment line(s) to replace with the boxed banner.

### 2.3. `prose_blocks` Array
- `type`: `"prose"` for general narrative or `"notes_block"` for bulleted notes (`>` and `-`).
- `original_start_line` / `original_end_line`: 1-indexed range of lines containing prose commentary to wrap cleanly to the column width.

---

## 3. Strict Rules on Code Exclusions
- **NEVER target active code:** Do NOT include lines containing active Stata syntax (`regress`, `use`, `gen`, `replace`, `merge`) in `original_start_line` or `original_end_line` of any recipe entry.
- **NEVER box inline labels:** Do not promote short inline notes (e.g. `// drop if missing`) to banners.
