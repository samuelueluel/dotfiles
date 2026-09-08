# Stata House Style Guide

**Load this file when** reviewing visual standards, section hierarchy, comment conventions, or line-wrapping rules for Stata do-files.

---

## 1. Visual Hierarchy & Outline Standards

Stata do-files follow a structured outline that enables fast human scanning and clean agent parsing.

### 1.1. Column Width & The Sprawl Rule
- **Headers, Banners, and Prose Blocks:** Formatted to a fixed column width (default: **64 columns**, optimal for 80-column half-screen splits in Niri on 14" displays; optionally 72 columns for full-width views).
- **Active Code Lines (The Sprawl Rule):** Active Stata code statements are **allowed to sprawl**. Long regression calls (`reghdfe`), detailed graphs (`twoway`), and complex variable transformations must never be artificially broken or wrapped simply to satisfy column boundaries unless already continued with `///`. This prevents introducing whitespace errors into macro expansions or expressions.

### 1.2. Section Banners
- **Level 1 (Major Sections):** Uppercase, bracketed titles enclosed in full-width ASCII `=` borders. Major integers take a trailing dot (`[1. ...]`).
  ```stata
  * ==============================================================
  * [1. DATA INGESTION & HARMONIZATION]
  * ==============================================================
  ```
- **Level 2 (Subsections):** Title Case, bracketed titles enclosed in full-width ASCII `-` borders. Decimal subsection identifiers omit trailing dots (`[1.1 ...]`).
  ```stata
  * --------------------------------------------------------------
  * [1.1 Merge Census Boundaries]
  * --------------------------------------------------------------
  ```
- **Inline Comments & Labels:** Short explanatory labels (e.g. `// clean raw string`, `// drop unmatched`) must remain inline. Never promote short inline comments into banners.

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

## 3. Comment Types & Placement Conventions (The 3-Way Separation Rule)

Stata comments follow strict syntactic roles:

- **1. Standalone Line / Step Comments (`* `):**
  - Use `* ` strictly for standalone, single-line human step comments (e.g. `* 3.2 Correct survey miscodes`, `* Clean tract boundary indicators`).
  - `* ` is universally recognized across all Stata execution contexts (interactive console, do-files, and batch jobs).
  - Never use `//` on its own line.
- **2. End-of-Line / Trailing Annotations (`//`):**
  - Use `//` strictly for trailing notes on active code lines (e.g. `replace type9 = 1 if TYPE == "S"  // single`).
  - Trailing `/* note */` comments are automatically converted to `// note` by the style builder.
  - Keep trailing tags short (under 50 characters). Explanations exceeding 50 characters must precede the command as a wrapped `/* ... */` block.
- **3. Substantive Prose & Notes Blocks (`/* ... */`):**
  - Single-line notes that fit within 64 columns remain on a single line:
    ```stata
    /* These have addresses in the separate variables, but not in addRes. */
    ```
  - Multi-line notes and structured rationale use wrapped `/* ... */` blocks where the opening `/*` is on its own line, the title or lead-in sentence sits flush (0 indent), and bullet points take a clean 2-space indent (`  - ` with `    ` continuation):
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
  - Multi-tier structured notes use `>` (tier 1: 2-space indent) and `-` (tier 2: 4-space indent):
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
- **4. Discarded / Exploratory Code:**
  - When exploratory code or alternative estimation attempts are retained for documentation rather than deleted, tag them with a structured header:
    ```stata
    /* [DISCARDED EXPLORATION: Fuzzy Address Matching via matchit]
       Preserved for audit provenance; string similarity did not recover parcels.
       keep if temp2 == 1
       matchit idadd9 addResorig using ...
    */
    ```
- **5. Line Continuations (`///`):**
  - Use `///` strictly when continuing long active commands across lines.

---

## 4. Spacing & Punctuation Invariants

- **Major Sections (Level 1):** Exactly two blank lines preceding the opening border.
- **Subsections (Level 2):** Exactly one blank line preceding the opening border.
- **Consecutive Blank Lines:** No more than two blank lines anywhere in the file.
- **Trailing Whitespace:** Completely stripped from every line.
- **End of File:** Exactly one trailing newline.
