---
name: stata-house-style
description: Formats Stata do-files for clear metadata, section structure, comments, and spacing while preserving protected active-code lines, with an explicit validated exception for preamble modernization. Use when the user asks to "format a do-file," "apply house style," "style Stata code," "organize a do-file," "preview Stata formatting," or verify whether styling changed a `.do` file.
---

# Stata House Style

## Request-Routing Playbook

```text
REQUEST
├─ Format, style, or organize a do-file ──→ FORMAT: scan → read → recipe → diff → apply
├─ Preview proposed formatting only ──────→ PREVIEW: scan → recipe → --diff; do not write target
├─ Check whether styling changed code ────→ VERIFY: <original.do> --verify <styled.do>
├─ Modernize setup or project globals ────→ PREAMBLE: --preamble → confirm → runtime test
├─ Fix Windows path syntax ───────────────→ PATHS: --scan advisories → path_rewrites → --verify-paths
└─ Confirm paths were not miswired ───────→ PATH CHECK: <before.do> --verify-paths <after.do>
```

## Non-Negotiable Rules

### Formatting Scope

- Change only metadata headers, standalone comments, section banners, and blank-line structure.
- Never refactor, reorder, wrap, trim, or rewrite active Stata code during a style operation.
- Let long commands sprawl. Never introduce or remove `///` to satisfy a width limit.
- Preserve every comment that shares a physical line with active code.
- Preserve substantive comments about data problems, sample restrictions, citations, methods, and unresolved questions.
- Never normalize path separators. `--normalize-paths` is rejected because quoted strings are semantic content.
- Use `--preamble` only when Samuel explicitly requests setup or path-loader modernization. It is not part of ordinary formatting.

### Physical and Tool Boundaries

- Never edit the target do-file by hand during a house-style operation. Create a JSON recipe and let `stata_house_style.py` make the change.
- Always run `--diff` before an in-place application.
- Treat a nonzero formatter exit, a hash mismatch, or a rejected recipe as a hard stop. Do not bypass the check or reproduce the edit manually.
- The formatter validates active physical lines; it does not prove that an intentionally replaced preamble is behaviorally equivalent.
- Runtime-test every preamble replacement. If Samuel has not enabled Stata MCP, stop after static verification and state that runtime equivalence remains untested. Never enable an MCP server yourself.
- Before running a do-file, inspect its writes. Use only a user-approved disposable location unless Samuel explicitly authorizes production outputs.
- Pi hooks handle Chezmoi reminders and Python syntax checks. The formatter itself enforces the Stata-specific mutation boundary; a global hook that blocks `.do` edits would also block legitimate Stata development.

### Active-Line Edits

Standard formatting never touches active lines. Two modes do:

- `--preamble` replaces the setup block with the project globals loader.
- `--allow-path-rewrites` applies enumerated path changes from the recipe.

Both run unattended, including in `/auto`. Review happens when the recipe is written, not when it is applied: preview with `--diff`, confirm the before/after for every changed line with Samuel, then apply. Once approved, an overnight batch runs it without stopping.

The safety net is `--verify-paths`, which runs in every mode and fails on a renamed file, a lost path, or a path sent to the wrong folder. Run it after every path rewrite.

Never describe an active-line edit as behavior-preserving on the strength of the hash alone. The hash proves which lines changed, not that the change is correct. Run the file and compare outputs.

Set `STATA_HOUSE_STYLE_REQUIRE_CONFIRMATION=1` to make `/auto` refuse active-line edits instead, for a run where a live confirmation round trip is wanted. It is off by default.

## Comment Conventions

Use each comment form for one purpose:

- `* ` introduces ordinary standalone prose that expresses one point on one physical line.
- `*command` disables one self-explanatory command. The missing space is a house-style signal; Stata ignores the line with or without it.
- `//` is only for a short end-of-line note. Use two spaces before `//` and one space after it.
- `///` is executable continuation syntax, not an ordinary comment. Preserve the marker, physical lines, and indentation exactly.
- `/* ... */` is for multiline prose, structured notes, labeled status notes, disabled command blocks, exploratory command blocks, and inline code fragments.

Never use consecutive `* ` lines to simulate wrapped prose. Never use a standalone one-line `/* prose */` comment. Never use `//` as a full-line prose comment. In Mata, use `//` or `/* ... */`; `*` is not a Mata comment.

Ordinary one-line prose must not use a status label:

```stata
* Standardize parcel identifiers for merging.
generate parcelMCM = parcelBTF
```

Status labels are reserved for standalone `/* ... */` blocks:

- `NOTE:` records durable context, caveats, or hazards.
- `ISSUE:` records unresolved work or a known defect.
- `VERIFY:` marks an empirical or data claim that needs confirmation.
- `ASSUMPTION:` states a deliberate maintained assumption.
- `DISABLED:` explains inactive code that might be restored.
- `EXPLORATION:` identifies a provisional or rejected alternative retained for reference.

Do not introduce `WARNING:`, `TODO:`, or `FIXME:`; use `NOTE:` or `ISSUE:` instead. A block containing inactive commands must use `DISABLED:` or `EXPLORATION:`, not `NOTE:`.

Format standalone prose blocks as follows:

```stata
/*
VERIFY: Confirm that duplicate parcel records are exact copies.

Findings:
  - The source contains one repeated parcel identifier.
*/

duplicates report parcelBTF
```

Put `/*` and `*/` on their own lines, with no blank immediately inside either delimiter. Use blank lines between internal paragraphs or before headings such as `Findings:`. Put exactly one blank line after a multiline block. Put no blank line between a `* ` comment and its associated code.

## Workflow

### 1. Inspect the Entire Do-File

Run the scanner:

```bash
python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py \
  --scan <target.do>
```

Then read the entire do-file. Identify:

- its purpose, inputs, outputs, and caveats;
- existing headers and section hierarchy;
- standalone comment regions suitable for banners or prose wrapping;
- each comment's role: ordinary prose, status note, disabled code, exploration, inline note, or continuation;
- comments attached to active code, which must remain untouched;
- full-line `//`, consecutive wrapped `* ` prose, standalone one-line `/* prose */`, unclosed blocks, and partially disabled `///` chains;
- any `///` continuation chains;
- whether the request explicitly includes preamble modernization.

Do not infer metadata from the filename alone. Do not create line ranges from a partial read.

### 2. Create a Recipe

Write a JSON recipe to a temporary path such as `/tmp/stata-house-style-recipe.json`. Recipe line numbers refer to the original file before any formatting.

A standard recipe may contain:

- `header` for metadata replacement or insertion;
- `banners` for major and minor section comments;
- `prose_blocks` for standalone explanatory comments; short unlabeled points become `* ` comments, while labeled or structured content becomes a multiline block;
- `width`, normally `64` or `72`.

Every replacement range must be in bounds, non-overlapping, and limited to standalone comments or blank lines. The script rejects a standard range that touches protected active code. Do not send a `DISABLED:` or `EXPLORATION:` block containing Stata commands through `prose_blocks`; prose wrapping can alter code text even though the code remains commented. Preserve those blocks exactly unless a dedicated code-block transformation is explicitly reviewed.

If exact field shapes or a full JSON example are needed, load [recipe schema](references/recipe-schema.md).

### 3. Preview and Inspect the Diff

Run:

```bash
python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py \
  <target.do> /tmp/stata-house-style-recipe.json --diff
```

Check the complete diff. Confirm that:

- every changed line is formatting or comment prose;
- section numbering follows the script's actual order;
- comments keep their meaning and factual content;
- no active line appears in the diff in standard mode;
- the command ends with `Invariant Verified`.

If any check fails, fix the recipe and rerun `--diff`. Do not apply a questionable diff.

### 4. Apply and Re-Verify

Apply only the reviewed recipe:

```bash
python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py \
  <target.do> /tmp/stata-house-style-recipe.json
```

The script writes through a same-directory temporary file and atomically replaces the target only after its active-line hash passes.

When an original copy exists, run an independent check:

```bash
python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py \
  <original.do> --verify <styled.do>
```

A standard operation is complete only when application exits zero and the independent check passes when requested or available.

### 5. Preamble Modernization

Preamble replacement is an explicit semantic exception. The recipe must supply `original_start_line` and `original_end_line`, and the command must include `--preamble`:

```bash
python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py \
  <target.do> /tmp/stata-house-style-recipe.json --diff --preamble
```

The range must:

- remain within the first 100 lines;
- leave protected active body code below it;
- contain only recognized setup commands such as `clear`, `macro drop _all`, `capture log close`, `set more off`, `version`, approved project globals, `cd`, `do`, `confirm file`, and `_rc` loader checks.

The generated loader fails if `project_globals.do` is absent, runs it without `capture`, verifies that it defines `$root`, and then creates the legacy `$path` alias when requested. Authored globals inside the replaced range survive; the loader regenerates `path`, `root`, `data`, `temp`, `progs`, `results`, and `logs`, and carries every other `global` line through verbatim after the loader.

After applying, use the enabled Stata MCP server to run an original copy and the preamble-styled copy from intended working directories. Compare generated datasets with `datasignature` and `cf`; compare estimation or returned results when the script produces them. A static hash alone is not enough for this mode.

### 6. Verify Two Existing Files Without Formatting

Run:

```bash
python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py \
  <original.do> --verify <styled.do>
```

This check hashes exact protected active-code lines, including physical command boundaries, whitespace, inline comments, strings, and `///` continuation context. It intentionally ignores standalone comments and ordinary blank-line styling.

### 7. Path Modernization

Backslash paths do not resolve on Linux Stata, and a backslash path in `log using` silently creates a file whose name contains a literal backslash rather than failing. Start with `--scan`, which reports `hardcoded_root`, `backslash_path`, and `absolute_cd` advisories without changing anything.

Fixing them uses `--allow-path-rewrites` with an enumerated `path_rewrites` recipe, then `--verify-paths` to confirm nothing was miswired. Both are active-line edits, so review the diff before applying.

For the approved moves, the refusal rules, the preamble carry-through contract, and the sandbox procedure for a real runtime test, load [path modernization](references/path-modernization.md).

## Required Result Report

Report:

- the target path;
- whether the run was preview-only or applied;
- which structural elements changed;
- the invariant mode and whether it passed;
- whether runtime Stata verification ran and what was compared;
- for path rewrites, the full before/after mapping and the `--verify-paths` result;
- whether the session could escalate, and if not, what was left unapplied;
- any semantic exception, especially preamble replacement;
- any remaining limitation or untested condition.

Never describe a preamble replacement as behavior-preserving unless the runtime comparison passed.

## Progressive Disclosure and Reference Routing

- When choosing banner levels, metadata layout, comment syntax, wrapping, or blank-line spacing, load [house style guide](references/house-style-guide.md).
- When drafting or debugging recipe fields and line ranges, load [recipe schema](references/recipe-schema.md).
- When modernizing path syntax, replacing the setup block, or confirming that paths were not miswired, load [path modernization](references/path-modernization.md).

## Maintainer Verification

After changing this skill or formatter, run:

```bash
python3 ~/.agents/skills/stata-house-style/tests/test_stata_house_style.py -v
```

Also rerun at least one disposable Stata equivalence fixture when changes affect parsing, preambles, hashing, or file writes. Capture live skill changes with `chezmoi add ~/.agents/skills/stata-house-style/` and inspect the resulting `~/dotfiles` diff.
