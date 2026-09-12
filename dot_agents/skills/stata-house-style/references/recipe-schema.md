# Stata Style Recipe Schema

**Load this file when** drafting, validating, or debugging JSON recipes for `stata_house_style.py`.

---

## 1. Complete Recipe Example

```json
{
  "width": 64,
  "header": {
    "filename": "analysis_main.do",
    "Purpose": "Estimate baseline hedonic price models with tract fixed effects.",
    "Author": "Samuel Saltmarsh",
    "Created": "YYYY-MM-DD",
    "Updated": "YYYY-MM-DD",
    "Inputs": [
      "data/clean/sales_clean.dta",
      "data/clean/zoning_clean.dta"
    ],
    "Outputs": [
      "results/tables/table_2_hedonics.tex"
    ],
    "Notes": "Restricted to single-family arm-length transactions.",
    "original_start_line": 1,
    "original_end_line": 4
  },
  "preamble": {
    "original_start_line": 6,
    "original_end_line": 20,
    "globals_file": "project_globals.do",
    "legacy_path_alias": true,
    "set_more_off": true,
    "version": "17"
  },
  "banners": [
    {
      "level": 1,
      "number": "1",
      "title": "Data Preparation",
      "original_start_line": 22,
      "original_end_line": 24
    },
    {
      "level": 2,
      "number": "1.1",
      "title": "Merge Census Boundaries",
      "original_start_line": 40,
      "original_end_line": 42
    }
  ],
  "prose_blocks": [
    {
      "type": "notes_block",
      "original_start_line": 26,
      "original_end_line": 29
    }
  ]
}
```

Omit `preamble` from ordinary style recipes. Include it only for an explicitly requested preamble replacement and pass `--preamble` on the command line.

## 2. Top-Level Fields

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `width` | integer | no | Structural width. Must be `64` or `72`; defaults to `64`. |
| `header` | object | no | Metadata header to insert or replace. |
| `preamble` | object | no | Explicit semantic setup replacement used with `--preamble`. |
| `banners` | array | no | Standalone section comments to replace with banners. |
| `prose_blocks` | array | no | Standalone comments to rewrap. |
| `path_rewrites` | array | no | Enumerated active-line path replacements. Requires `--allow-path-rewrites`. |

Unknown top-level fields are rejected so misspelled keys cannot silently do nothing.

## 3. Header Object

Supported display fields are `filename`, `Purpose`, `Author`, `Created`, `Updated`, `Inputs`, `Outputs`, and `Notes`.

- Use arrays for multiple `Inputs` or `Outputs`.
- Use `YYYY-MM-DD` for `Created` and `Updated`.
- To replace an existing comment header, provide both `original_start_line` and `original_end_line`.
- To insert a new header at the beginning, omit both range fields.
- Providing only one range endpoint is an error.

## 4. Preamble Object

A preamble object requires both `original_start_line` and `original_end_line`. Optional fields are:

| Field | Default | Meaning |
|---|---|---|
| `globals_file` | `project_globals.do` | Globals script to locate in the current or parent directory. |
| `legacy_path_alias` | `true` | Add `global path "$root"` for legacy `$path` references. |
| `set_more_off` | `true` | Include `set more off`. |
| `version` | `17` | Stata version statement; use an empty value to omit it. |

The source range may contain only the setup forms listed in `SKILL.md`. The loader exits with code 601 if the globals file is absent and code 198 if the loaded file does not define `$root`.

## 5. Banner Objects

Each banner requires:

- `level`: integer `1` for a major section or `2` for a subsection;
- `title`: nonempty string;
- `original_start_line` and `original_end_line`: inclusive source range.

`number` is optional. Integer-like numbers receive a trailing period in level-1 display; decimal subsection numbers do not.

## 6. Prose Block Objects

Each prose block requires `original_start_line` and `original_end_line`, an inclusive source range. The optional `type` field accepts `prose` or the legacy `notes_block` hint; the formatter infers paragraph and bullet structure from the source text.

The source range must contain only standalone prose comments and blank lines. Comments attached to active code are not valid prose ranges. Do not target a disabled or exploratory block containing Stata commands; preserve its command text exactly.

Formatting follows these rules:

- One unlabeled point that fits within the selected width becomes `* prose`.
- A recognized status label (`NOTE:`, `ISSUE:`, `VERIFY:`, `ASSUMPTION:`, `DISABLED:`, or `EXPLORATION:`) forces a multiline `/* ... */` block even when short.
- Multiple lines, paragraphs, bullets, and internal headings use a multiline block.
- A generated `* ` comment has no blank line before its associated code.
- A generated multiline block has exactly one blank line after `*/`.

## 7. Path Rewrite Objects

Each entry changes exactly one active line. All three fields are required:

| Field | Meaning |
|---|---|
| `original_start_line` | 1-indexed line in the original file. |
| `before` | Exact current text of that line. Must match the file character for character. |
| `after` | Exact replacement text. |

`path_rewrites` requires `--allow-path-rewrites`. Without the flag the recipe is rejected.

The formatter accepts only `$path\<Folder>\rest` becoming `$<global>/rest` for `Data` → `$data`, `Temp` → `$temp`, `Results` → `$results`, and `Programs-2026` → `$progs`. It refuses any rewrite that:

- changes text outside quoted strings;
- changes the number of quoted strings on the line;
- renames the file or leaves a different basename;
- sends the path anywhere other than an approved project global;
- has `before` text that does not match the file exactly.

The resulting hash mode is `exact-active-lines-with-enumerated-path-exceptions`, or `exact-body-with-preamble-and-path-exceptions` when combined with `--preamble`.

After applying, run `--verify-paths` against the file as it stood immediately before the rewrite.

## 8. Common Validation Errors

| Message fragment | Cause | Fix |
|---|---|---|
| `targets active code` | A standard range includes an executable line or protected continuation context. | Narrow the range to standalone comments. |
| `overlaps` | Two recipe entries claim the same original line. | Make all replacement ranges distinct. |
| `outside 1-N` | A range is reversed, zero-based, or beyond the original file. | Re-scan and use 1-indexed inclusive lines. |
| `recipe contains preamble but --preamble was not supplied` | Semantic preamble content appeared in standard mode. | Remove `preamble` or explicitly rerun with `--preamble`. |
| `unsupported active code` | The proposed preamble range contains a substantive command. | Narrow the preamble; never classify analysis code as setup. |
| `unknown recipe field` | A top-level key is misspelled or unsupported. | Use only the fields in section 2. |
| `recipe contains path_rewrites but --allow-path-rewrites was not supplied` | Path rewrites appeared in standard mode. | Add the flag, after obtaining confirmation. |
| `before text does not match line N` | `before` drifted from the file. | Re-read the line and copy it exactly. |
| `unapproved path change` | The rewrite renames a file or targets a non-project folder. | Use an approved `$path\Folder\` → `$global/` move. |
| `path rewrite changes text outside quoted strings` | The rewrite altered command text, not just a path. | Keep everything outside the quoted path identical. |
| `CONFIRMATION REQUIRED: ... /auto is active` | `STATA_HOUSE_STYLE_REQUIRE_CONFIRMATION=1` is set and the session is `/auto`. | Unset the variable, or re-run from `/manual` or `/autoask`. |
