# Stata House Style Guide

**Load this file when** reviewing visual standards, section outlines, comment roles, status labels, or spacing conventions for Stata do-files.

---

## 1. Visual Structure

### 1.1 Structural Width and Code Sprawl

Format headers, banners, and prose comments at 64 columns by default or 72 columns for a wider layout. Active Stata commands may sprawl horizontally. Never split, wrap, trim, or reindent active code to satisfy a visual width.

Do not rewrap an existing `///` continuation chain. Stata joins physical lines while preserving intervening whitespace, so indentation can affect the constructed command.

### 1.2 Section Banners

Use uppercase level-1 banners for major sections:

```stata
* ==============================================================
* [1. DATA INGESTION & HARMONIZATION]
* ==============================================================
```

Use title-case level-2 banners for genuine subsections:

```stata
* --------------------------------------------------------------
* [1.1 Merge Census Boundaries]
* --------------------------------------------------------------
```

Do not promote every short procedural comment to a banner. A banner should mark a section that contains several related operations.

## 2. Metadata Header

Every production do-file should open with a metadata header at the selected structural width:

```stata
* ==============================================================
* clean_tract_demographics.do
*
* Purpose : Harmonize decennial Census demographic tables at
*           tract level.
* Author  : Samuel Saltmarsh
* Created : YYYY-MM-DD
* Updated : YYYY-MM-DD
* Inputs  : data/raw/decennial_2010.dta
*           data/raw/decennial_2020.dta
* Outputs : data/clean/tract_demographics_panel.dta
* Notes   : Tract boundaries use the NHGIS crosswalk.
* ==============================================================
```

List multiple inputs and outputs on separate lines. Keep substantive caveats in `Notes`; do not overload the header with a research diary.

## 3. Comment Selection

Choose comment syntax by role, not personal preference at each occurrence.

### 3.1 Ordinary One-Line Prose: `* `

Use `* ` for one neutral point that fits on one physical line:

```stata
* Standardize parcel identifiers for merging.
generate parcelMCM = parcelBTF
```

The prose line must:

- express one point;
- fit within the selected structural width;
- directly describe the command or short command group below it;
- contain no standardized status label.

Do not use consecutive `* ` lines to wrap a paragraph. Use a multiline block instead.

### 3.2 Disabled Single Commands: `*command`

Use no space after `*` for one self-explanatory disabled command:

```stata
*browse if dupBTF > 0
```

Stata ignores the line whether or not a space follows `*`; the missing space is the house-style signal that the text is executable code. If the reason needs documentation or the command spans multiple physical lines, use a `DISABLED:` block.

Never comment only the first line of a `///` chain. Either prefix every physical line or, preferably, enclose the complete command in a closed `DISABLED:` block.

### 3.3 Short End-of-Line Notes: `//`

Reserve `//` for short notes at the end of active code:

```stata
replace type9 = 1 if TYPE == "S"  // Single-family structure
```

Use two spaces before `//` and one space after it. Stata requires at least one preceding blank when `//` follows code. Move any long explanation above the command.

Do not use `//` as a full-line prose comment even though Stata permits it.

### 3.4 Continuation Syntax: `///`

`///` comments out the rest of the physical line and joins the next line to the current command:

```stata
regress outcome treatment controls  ///
    i.year i.tract
```

Treat `///` as executable syntax. Preserve its marker, physical line boundary, annotation, and following-line indentation exactly. Never insert a blank line into a continuation chain.

### 3.5 Multiline and Structured Content: `/* ... */`

Use a standalone block when prose:

- requires two or more physical lines;
- contains multiple distinct sentences;
- contains paragraphs, bullets, or internal headings;
- carries a standardized status label;
- documents disabled or exploratory code.

Use this layout:

```stata
/*
NOTE: Duplicate addresses do not necessarily identify duplicate
records.

Findings:
  - Some addresses cover a structure and adjacent empty lots.
  - Some identify attached units on separate parcels.
*/

duplicates report addMCM
```

Put `/*` and `*/` on separate lines. Do not put an empty line immediately after `/*` or immediately before `*/`. Use an empty line between internal paragraphs or before headings such as `Findings:`. Put exactly one empty line after the closing delimiter.

Do not use standalone one-line prose of the form `/* explanation */`; convert it to `* explanation` unless it is an inline code fragment.

### 3.6 Inline `/* ... */` Fragments

An enclosed comment may intentionally disable or annotate a fragment inside active code:

```stata
regress outcome treatment /* i.year */ controls
```

Inline block comments share an active physical line and are protected by the formatter. Do not rewrite them as `//`, move them, or adjust adjacent whitespace.

## 4. Standardized Status Labels

Labels appear only inside standalone `/* ... */` blocks. Never write `* NOTE:`, `* ISSUE:`, or another labeled star comment.

| Label | Meaning |
|---|---|
| `NOTE:` | Durable context, caveat, or hazard |
| `ISSUE:` | Unresolved work or a known defect |
| `VERIFY:` | Empirical or data claim requiring confirmation |
| `ASSUMPTION:` | Deliberate maintained assumption |
| `DISABLED:` | Inactive code that might be restored |
| `EXPLORATION:` | Provisional or rejected alternative retained for reference |

Do not introduce `WARNING:`, `TODO:`, or `FIXME:`. Convert warnings to `NOTE:` and actionable defects or unfinished work to `ISSUE:`.

A prose-only status block may be brief:

```stata
/*
VERIFY: Confirm that the duplicate parcel records are exact
copies.
*/
```

Inactive commands require `DISABLED:` or `EXPLORATION:`, not `NOTE:`:

```stata
/*
DISABLED: Manual duplicate inspection retained for data review.

browse if dupBTF > 0
list parcelBTF addBTF if dupBTF > 0
*/
```

Always close disabled and exploratory blocks. Do not use an unclosed `/*` to disable the remainder of a file. Enclosed comments may be nested, which permits a disabled block to contain existing inline block comments.

## 5. Mata Comments

The beginning-of-line `*` form is not valid inside Mata. Use `//` or `/* ... */` in Mata code while retaining the same prose, label, and spacing distinctions where applicable.

## 6. Vertical Spacing

- Put exactly two blank lines before a level-1 banner unless it begins the file.
- Put exactly one blank line before a level-2 banner.
- Put one blank line before an ordinary `* ` step comment when it follows code.
- Put no blank line between a `* ` comment and its associated code.
- Put exactly one blank line after a standalone multiline `/* ... */` block.
- Use no more than two consecutive blank lines anywhere.
- Remove trailing whitespace only from blank and comment-only lines; preserve active physical lines exactly.
- End the file with exactly one newline.
