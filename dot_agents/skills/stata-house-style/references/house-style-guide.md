# Stata House Style Guide

Load this file when reviewing visual standards, section outlines, comment rules, or line-wrapping conventions for Stata do-files.

---

## 1. Visual Structure and Outlines

Stata do-files use a consistent outline so they are easy for people to skim and easy for tools to parse.

### 1.1. Column Width and Code Sprawl

- **Headers, Banners, and Notes:** Formatted to a fixed column width (default: **64 columns**, which fits cleanly into half-screen editor splits on 14" displays; optionally 72 columns for full-width views).
- **Active Code Lines (Let Code Sprawl):** Active Stata commands are **allowed to sprawl**. Long regression calls (`reghdfe`), detailed graphs (`twoway`), and complex variable transformations must never be split or wrapped just to fit column limits. Splitting active code can introduce whitespace bugs into macros and expressions. Only wrap lines if they already use `///` line continuations.

### 1.2. Section Banners

- **Level 1 (Major Sections):** Uppercase, bracketed titles enclosed in full-width ASCII `=` borders. Major integers take a trailing dot (`[1. ...]`).
  ```stata
  * ==============================================================
  * [1. DATA INGESTION & HARMONIZATION]
  * ==============================================================
  ```
- **Level 2 (Subsections):** Title Case, bracketed titles enclosed in full-width ASCII `-` borders. Decimal subsection numbers omit trailing dots (`[1.1 ...]`).
  ```stata
  * --------------------------------------------------------------
  * [1.1 Merge Census Boundaries]
  * --------------------------------------------------------------
  ```
- **Inline Comments and Labels:** Short notes (such as `// clean raw string` or `// drop unmatched`) must remain inline. Never promote short inline notes into banners.

---

## 2. Metadata Header Specification

Every production do-file must open with a standardized top-of-file metadata block at the standard column width. Multiple inputs or outputs are listed on separate lines without trailing punctuation:

```stata
* ==============================================================
* clean_tract_demographics.do
*
* Purpose : Harmonize 2010 and 2020 Census demographic tables at
*           tract level.
* Author  : Samuel Saltmarsh
* Created : 2026-06-15
* Updated : 2026-09-07
* Inputs  : data/raw/decennial_2010.dta
*           data/raw/decennial_2020.dta
* Outputs : data/clean/tract_demographics_panel.dta
* Notes   : Census tract boundary crosswalk uses NHGIS
*           2010-to-2020 weights.
* ==============================================================
```

---

## 3. Comment Types and Placement

Use the right comment style for each task:

- **1. Standalone Line Comments (`* `):**
  - Use `* ` for standalone, single-line step comments (for example, `* 3.2 Correct survey miscodes` or `* Clean tract boundary indicators`).
  - Stata recognizes `* ` across all environments: interactive console, do-files, and batch jobs.
  - Never put `//` on its own line.
- **2. Trailing Comments on Code Lines (`//`):**
  - Use `//` for notes at the end of active code lines (for example, `replace type9 = 1 if TYPE == "S"  // single`).
  - The styling script converts trailing `/* note */` comments into `// note`.
  - Keep trailing notes short (under 50 characters). If an explanation needs more than 50 characters, put it before the command in a wrapped `/* ... */` block.
- **3. Explanatory Notes and Blocks (`/* ... */`):**
  - Short notes that fit within 64 columns stay on a single line:
    ```stata
    /* These have addresses in the separate variables, but not in addRes. */
    ```
  - For longer notes, use a block comment `/* ... */`. Put `/*` on its own line. Start intro sentences at the left edge (no indent). Indent bullet items with 2 spaces (`  - `) and indent continuation lines with 4 spaces:
    ```stata
    /*
    Examine duplicate addresses:
      - IT IS POSSIBLE TO HAVE THE SAME ADDRESSES ATTACHED TO
        MULTIPLE PARCELS!
      - Since parcels are unique, this means when an address is
        associated to multiple parcels, it is the SOLE address
        for each of those parcels.
    */
    ```
  - For nested notes, use `>` (tier 1: 2-space indent) and `-` (tier 2: 4-space indent):
    ```stata
    /*
    Identification & Inference Notes:
      > Primary identification relies on cohort variation across
        counties.
      > Standard errors clustered at state level; see Cameron et al.
        (2011).
        - Clusters < 30 warrant wild bootstrap verification in
          robustness do-file.
    */
    ```
- **4. Old or Exploratory Code:**
  - When keeping test code or alternative specifications for future reference, label them clearly in a comment block:
    ```stata
    /* [EXPLORATION: Fuzzy Address Matching via matchit]
       Kept for reference; string similarity did not recover parcels.
       keep if temp2 == 1
       matchit idadd9 addResorig using ...
    */
    ```
- **5. Line Continuations (`///`):**
  - Use `///` only to continue long executable commands across multiple lines.

---

## 4. Spacing and Blank Lines

- **Major Sections (Level 1):** Exactly two blank lines before the opening border.
- **Subsections (Level 2):** Exactly one blank line before the opening border.
- **Consecutive Blank Lines:** No more than two blank lines in a row anywhere in the file.
- **Trailing Spaces:** Remove trailing whitespace from every line.
- **End of File:** End the file with exactly one newline.
