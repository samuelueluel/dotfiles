---
name: stata-sam-style
description: "Beautify the layout of a Stata do-file to a fixed house style without changing any code. Purely cosmetic: normalizes the file header/preamble banner, section/subsection header banners, prose comments (/* */ step comments and /* Notes: */ blocks), end-of-line // comments, blank-line spacing, and indentation, all within a 64-column margin. Comment convention: * lines (outside banners) are always treated as disabled Stata commands and left untouched; all prose lives in /* */ blocks; // is for trailing inline notes only. Never edits, reorders, wraps, or deletes any command or commented-out code. The one sanctioned edit inside a /* */ disabled-code block is normalizing a line-trailing inner /* note */ to // note, which is semantically inert and works around a Zed Stata language-server nesting bug. Use to enforce house style across a project; NOT a refactorer (see stata-sam-refactor) and NOT an optimizer (see stata-modernize)."
---

# Stata Style

Cosmetic beautifier for Stata do-files. It rewrites a do-file into a fixed house style — header banners, comment layout, spacing — and changes **nothing else**: no command is altered, reordered, wrapped, or deleted, and commented-out code is left untouched (save one narrow, behavior-preserving exception, below). The output runs identically to the input; only whitespace and comment *formatting* change.

This is the deliberately narrow counterpart to two other skills. `stata-sam-refactor` restructures code while preserving outputs (licensed to delete dead/commented code and reorder logic); `stata-modernize` improves code and accepts behavior risk. **`stata-sam-style` touches neither logic nor commented code** — the safe, run-anywhere formatter.

## The cardinal rule

**Never alter, reorder, wrap, or delete a command, and never touch commented-out code.**

The one failure mode that matters is mangling the user's code or silently dropping a line they commented out on purpose. Reformatting prose is a nicety; harming code is the cardinal sin. So the bias is overwhelmingly conservative: **when in doubt about whether a `/* */` block is prose or disabled code, treat it as disabled code and leave it byte-for-byte untouched.**

What the skill *may* change:
- Header banners (the `=` / `-` rule lines and title lines).
- The file header/preamble (banner, title, metadata fields) and the *layout* of an existing setup block (spacing, step labels) — but never inserting a missing setup command.
- Layout of comments that are clearly natural-language prose (step comments, Notes blocks): re-wrapping to the margin, fixing the comment-character spacing.
- Leading indentation of active command lines (whitespace-only).
- Blank lines between blocks.
- Trailing whitespace (stripped) and final newline (exactly one).

What it must **never** change:
- The text of any command (anything beyond leading whitespace on an active line).
- The order of any lines.
- Any commented-out code — not its indentation, spacing, wrapping, or existence.
- Anything inside a `#delimit ;` region, a `/* ... */` span, a `///` continuation, or a string literal — with the **single** sanctioned exception in ["Line-trailing `/* */` inside a block"](#line-trailing---inside-a-block-the-one-permitted-edit).

## Line width

One governing constant: **`W = 64` columns.** It bounds the right margin of everything the skill writes, so the file never overflows a half-screen editor pane:

- Header rule lines are exactly `W` columns (`* ` + 62 box characters).
- Prose comment text (steps, Notes) wraps at `W`.
- **Code is never wrapped** — re-flowing a command would change it. Long command lines are left exactly as the user wrote them; line continuation is the user's responsibility via `///`.

## Header (file preamble)

Every do-file opens with a **header banner** — a boxed comment block carrying the filename and a fixed set of metadata fields. It is a comment block, so it is fully in scope: the beautifier formats and aligns it (and may assemble it from fields the user already wrote), but invents no facts.

```stata
* ==============================================================
* analysis_main.do
*
* Purpose : Estimate the effect of X on Y
* Author  : Samuel Saltmarsh
* Created : 2026-06-23
* Updated : 2026-06-23
* Inputs  : cohort.dta, covars.dta
* Outputs : results/main.tex, figures/fig1.pdf
* ==============================================================
```

- **Box:** top and bottom rule lines are `* ` + 62 `=` (64 columns), identical to a section banner.
- **Title line:** `* <filename.do>` — the do-file's own name, nothing else. No purpose text here; purpose is its own field.
- **Spacer:** one bare `*` line separates the title from the fields. No inner `-` rule (this is the "no inner rule" variant).
- **Fields:** label left-padded to 7 characters, then ` : `, then the value. Colons align at column 11, values start at column 13. The standard set, in this order:
  - `Purpose` — one line on what the do-file does.
  - `Author`  — name, optionally `Name (email)`.
  - `Created` — date created, ISO `yyyy-mm-dd`.
  - `Updated` — date last modified, ISO `yyyy-mm-dd`.
  - `Inputs`  — datasets/files read.
  - `Outputs` — datasets, tables, and figures written.
- **Long values wrap** at `W = 64`, the continuation flush under the value text (column 13), like a Notes continuation. A field with many files may list them across wrapped lines.
- **Never fabricate field values** — reformat and align what the user wrote. Leave a field blank (or omit it) rather than guess; dates, inputs, and outputs are facts about the file, not style. Omit a field only when genuinely N/A (e.g. a do-file that writes no `Outputs`).

## Setup block

Directly under the header comes the **setup block**: the canonical opening commands that reset state, load project paths, and start logging. Unlike the header, these are *commands*, which sits at the edge of this skill's remit:

- The beautifier **formats and orders** an existing setup block — its spacing and the step comments that label its parts — but **never inserts** one that is missing. Adding commands would violate the cardinal rule; scaffolding a setup block from nothing belongs to a refactor/scaffold skill, not this cosmetic pass.

Canonical contents and order:

```stata
clear matrix
clear all
macro drop _all
set more off

/* Project paths                                                */
do "project_globals.do"

/* Logging                                                      */
cap log close
log using "$logs/analysis_main.log", replace text
```

- **Reset stanza** — `clear matrix`, `clear all`, `macro drop _all`, `set more off`, in that order, with no blank lines between them and no step comment above them. It runs **first**, before the project-paths line, so that `macro drop _all` cannot wipe the globals the project file is about to define.
- **Project paths** — a single `do "project_globals.do"` that defines the global path macros (`$root`, `$data`, `$out`, `$logs`, …) every do-file relies on. Labelled with a `* Project paths` step.
- **Logging** — `cap log close`, then `log using ... , replace text` (plain text, greppable). The log path is built from a path global (e.g. `$logs`), so logging follows the project-paths line. Labelled with a `* Logging` step.

### Locating `project_globals.do` (the pwd-as-root convention)

A Stata do-file cannot introspect its own path, so the project root is derived from the **working directory**: you always launch Stata from the project root, and `project_globals.do` — which lives at that root — reads `c(pwd)` to set `$root`:

```stata
* project_globals.do  (at the project root)
global root "`c(pwd)'"
global data "$root/data"
global out  "$root/output"
global logs "$out/logs"
```

Because the do-file's first real line is the **relative** `do "project_globals.do"`, it resolves whenever the working directory is the root — no absolute path anywhere, and no `cd`. The one rule the workflow guarantees: **the working directory is the project root when Stata starts** (the `stata-start` tmux helper passes `-c "$PWD"`; the agent sandboxes set `-w` to the project dir; a bare `stata` in a pane already sitting in the project inherits that dir).

## Sections

Top-level section: a full box of `=`, a bracketed integer index, and an **UPPERCASE** title.

```stata
* ==============================================================
* [1] SECTION TITLE
* ==============================================================
```

- Both rule lines are `* ` + 62 `=` (64 columns total).
- Title line: `* [N] TITLE` where `N` is an integer and the title is uppercased.

## Subsections

Second-level: a full box of `-`, a bracketed `N.M` index, and a **Title Case** title.

```stata
* --------------------------------------------------------------
* [1.1] Subsection Title
* --------------------------------------------------------------
```

- Both rule lines are `* ` + 62 `-` (64 columns total).
- Title line: `* [N.M] Title Case`.
- **Two levels only.** Do not invent `[1.1.1]`; there is no third banner style. If the code seems to want one, leave the structure as the user has it — do not force a deeper hierarchy.

## Notes blocks

An **optional** block for caveats, findings, and explanations. It may follow a section or subsection banner, **or float inline** in the code body wherever a note is relevant — identical format in all positions. This is the home for any note too structured for a one-line step comment, including titled, multi-level notes.

```stata
/* Notes: Optional Note Title
   > Tier-1 note that runs to the right margin and then wraps,
     the continuation aligned under the note text.
   > Another tier-1 note.
     - Tier-2 note nested under the point above; it also wraps
       at the right margin when it runs long.
     - Another tier-2 note.                                    */
```

- **Opener:** `/* Notes:` flush. An **optional title** may follow on the same line — `/* Notes: Title In Title Case`. Use `/* Notes:` alone when there is no title.
- **Tier 1:** 3 spaces + `> ` + text → marker `>` at column 4, text at column 6.
- **Tier 2** (nested, optional): 5 spaces + `- ` + text → marker `-` at column 6, text at column 8.
- **Wrapped continuation:** flush under that tier's text — tier 1 at column 6 (5 spaces), tier 2 at column 8 (7 spaces). Wrap at `W = 64`.
- **Closer:** `*/` on the **last content line**, right-padded with spaces so `*/` lands exactly at column 64 (the `/` is on column 64). This applies to both single-line and multi-line blocks.
- **Two tiers only** (`>` then `-`), mirroring the two-level section hierarchy. Do not invent a third tier.
- Omit the entire block (and its surrounding blank line) when there are no notes. **Never fabricate notes, never reword them** — only reformat (re-prefix, re-wrap, re-indent to the tiers) notes the user already wrote; if you cannot tell where a note ends and code begins, leave it alone.

## Step comments

The everyday workhorse comment: a `/* */` block that says what the block of code below it does. Short label or full sentences — same format, it just wraps when long.

```stata
/* Merge in county covariates                                   */
use cohort.dta, clear
merge m:1 county using covars.dta, keep(3) nogen

/* Drop the pre-policy years: the treatment isn't defined
   before 2014, so including them would bias the baseline.     */
drop if year < 2014
```

- `/* ` opener, content starts immediately after on the same line.
- Continuation lines: 3-space indent.
- **Closer:** `*/` on the **last content line**, right-padded with spaces so `*/` lands exactly at column 64 (the `/` is on column 64). This applies to both single-line and multi-line blocks.
- Wrap at `W = 64`; break at word boundaries.
- A step sits **directly above** the code it labels — no blank line between the prose block and its code.
- This is the format for any free-standing prose comment that is *not* a section/subsection banner or a `Notes:` block.

## End-of-line comments

```stata
gen lwage = ln(wage)                  // log wage
egen cmean = mean(wage), by(county)   // county mean
```

- `code  // note` — at least **2 spaces** before `//`.
- Do **not** force column alignment across consecutive lines. Alignment churns the file whenever a code length changes and is brittle; the 2-space minimum is enough.
- The code to the left of `//` is a command — do not touch it.
- A **line-trailing** `/* note */` — one that opens *and* closes on the same line with nothing but whitespace after the `*/` — is the same end-of-line comment as `// note`; normalize it to `code  // note`. A **mid-line** inline `/* note */` that is followed by more code on the same line is real syntax (it splices, not terminates) and is left untouched — converting it to `//` would swallow the rest of the line.

## Commented-out code

```stata
* reg lwage treat i.year        ← disabled code: LEFT ENTIRELY UNTOUCHED
```

Every `*` line that is **not** part of a section banner (`* ===...===`, `* [N] TITLE`), subsection banner (`* ---...---`, `* [N.M] Title`), or file header preamble is a **commented-out Stata command** — left entirely untouched: not reformatted, not re-indented, not re-wrapped, not deleted.

No disambiguation heuristic is needed. Under the house convention, all `*`-prefixed prose has been migrated to `/* */` blocks. A `*` line outside a banner is disabled code, full stop.

### `/* */` block disambiguation

A `/* */` block may be either **prose** (step comment or Notes block — reformattable to house style) or **disabled code** (left verbatim). Tell them apart in priority order:

1. If the block starts with `/* Notes:` → it is a **Notes block**; reformat to Notes block style.
2. If the block's interior is or strongly resembles Stata commands — command syntax, option commas, `=` assignment, `using`, `if`/`in`, factor notation, etc. — treat it as **disabled code**: leave it byte-for-byte.
3. If the content is plainly English prose → treat it as a **step comment** and reformat.
4. **When genuinely unsure, treat it as disabled code and leave it untouched.**

A `/* */` disabled-code block is never converted into per-line `*` comments. **Do not explode into individual `*` lines.**

The beautifier does **not** auto-convert an existing `/* */` prose block into the house step-comment or Notes format unless explicitly asked. An unattended style pass leaves existing `/* */` blocks intact.

#### Line-trailing `/* */` inside a block (the one permitted edit)

The single sanctioned exception to "leave `/* */` blocks byte-for-byte": a **line-trailing** `/* ... */` comment *inside* a `/* */` block is normalized to `// ...`.

The motivation is a real tool bug. Stata nests `/* */` correctly, but the Zed Stata language server does not — it treats the inner `*/` as closing the whole block, corrupting the rest of the file's highlighting/diagnostics. Rewriting the inner trailing comment to `//` removes the nesting and fixes it.

This is **semantically inert**: while the block is commented out, an interior `//` is just comment text (it does not terminate the enclosing `/* */`); if the block is re-enabled, `code // note` and `code /* note */` behave identically.

Convert `<text> /* note */` → `<text>  // note` only when **all** of these hold:
- The `/*` and its matching `*/` are on the **same physical line**.
- Nothing but whitespace follows the closing `*/` (it is genuinely line-trailing).
- There is content to its left — it is a trailing comment, not the block's own opening `/*` or closing `*/` delimiter.

Leave untouched, exactly as before: a **mid-line** inline `/* note */` followed by more code on the same line (converting it would swallow that code), the block's own `/*` / `*/` delimiters, and any `/* */` that spans more than one line. When a line does not clearly meet all three conditions, leave it — the cardinal rule still governs everything else in the block.

## Blank-line spacing

- **1 blank line** between the header banner and the setup block.
- **1 blank line** between the parts of the setup block (reset stanza, project-paths `do`, logging).
- **2 blank lines** before a section banner.
- **1 blank line** before a subsection banner.
- **1 blank line** between a banner's closing rule and what follows (the `Notes:` block, or the first step/command).
- **1 blank line** between a `Notes:` block and the first step/command.
- **No blank line** between a `/* */` prose block (step comment or Notes block) and the code it labels.
- **1 blank line** between a `/* */` prose block or Notes block and an immediately following `*` commented-out command line — without this separator, prose and disabled code visually blur.
- Collapse any run of **3 or more** blank lines to at most 2.
- Strip trailing whitespace from every line; end the file with exactly one newline.

## Indentation

- 4 spaces per nesting level inside brace blocks (`foreach { }`, `forvalues { }`, `if { }`, `while { }`, `program { }`, `quietly { }`, etc.). Spaces, never tabs.
- Adjust **leading** whitespace only — never the content of a line.
- **Do not re-indent** lines inside a `#delimit ;` region, a `/* ... */` span, a `///` continuation, or any commented-out code. Leave those exactly as written.
- If the brace structure is ambiguous or the file uses `#delimit ;`, prefer leaving indentation as-is over guessing.

## Verification

Because this skill must make **no functional change** — the do-file must run identically before and after; only layout and comment *formatting* may differ — verify mechanically after formatting, the cheap analog to a refactor harness:

1. **Active-code invariant.** Extract every active command line (drop blank lines and full-line comments), trim leading/trailing whitespace, and collapse internal runs of whitespace to a single space. The resulting ordered sequence must be **identical** before and after. If it differs, the beautifier altered code — revert and investigate.
2. **Comment preservation.** No comment may be deleted. Every `*` line (outside banners) must be present **byte-for-byte** in the output — with the **only** allowed difference being a line-trailing inner `/* note */` rewritten to `// note` per ["Line-trailing `/* */` inside a block"](#line-trailing---inside-a-block-the-one-permitted-edit). `/* */` prose blocks may be re-wrapped but must not lose any content.
3. **Diff review.** `git diff` (or equivalent) should show only whitespace, rule-line, banner, prose-comment-layout, and sanctioned line-trailing `/* */`→`//` changes — no change to any token of executable code and no other change to any disabled-code line.

If any check fails, the formatting is wrong, not the code. Discard and redo conservatively.

## Related skills

- `stata-sam-refactor` — restructures code while preserving final outputs; *may* delete dead/commented code and reorder logic. Use when changing structure, not just layout.
- `stata-modernize` — improves/optimizes code and accepts behavior risk. Use when changing behavior on purpose.
- `stata-sam-style` (this skill) — layout only, zero code or commented-code changes. Use to enforce house style.
