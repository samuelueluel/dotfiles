# Data Audit and Provenance Checklist

**Load this file when** auditing an unfamiliar or intermediate dataset, verifying unique identifiers and merge rates, or documenting data lineage for an empirical paper.

## 1. Dataset Structure and Hygiene

Run this inspection sequence when opening any new or transformed dataset:

1. **Structure:** Check observation count, variable count, data types, and variable labels. Use `stata_inspect_data(action="describe")` or compact summary tools.
2. **Missingness and Value Spans:** Inspect ranges, negative sentinel codes (such as `-99`, `999`), and missingness fractions with `count if missing(var)` and `tab var, missing`.
3. **Storage Efficiency:** Ensure numeric variables are stored as appropriate types (`byte`, `int`, `long`, `float`, `double`) rather than bloated strings or excess precision.
4. **Value Labels:** Confirm categorical variables possess informative value labels rather than unmapped integers.

## 2. Key Uniqueness and Merge Integrity

Never execute merges or reshaping without explicit candidate key validation:

1. **Candidate Key Uniqueness:** Run `duplicates report keyvar` or `isid keyvar` to verify that unit-time identifiers uniquely index rows before merging or setting panel structures.
2. **Merge Type Verification:** Match types (`1:1`, `m:1`, `1:m`) must match the econometric structure. Never use `m:m` in Stata under any circumstance.
3. **Merge Return Evaluation:** Examine `_merge` results explicitly:
   - For expected complete matches, enforce `assert _merge == 3`.
   - When unmatched rows are expected, document why master-only (`_merge == 1`) or using-only (`_merge == 2`) records exist before dropping them (`drop if _merge == 2`).
4. **Row Count Conservation:** Check total row counts before and after merges to ensure observations were not duplicated by unintended key collisions.

## 3. Data Lineage and Traceability

Document dataset transformations so that coauthors and referees can audit the pipeline:

- **Source Provenance:** Record raw input filenames, dates accessed, and source agencies or repositories.
- **Sample Selection Log:** Track observation attrition sequentially: starting $N$, drops from missing variables, drops from out-of-scope periods, and final estimation $N$.
- **Variable Definitions:** Provide explicit formulas for constructed analysis variables, noting base variables, recoding rules, and boundary winsorizing or trimming.
- **Intermediate Artifacts:** Keep generated intermediate files read-only and version-controlled, with distinct names distinguishing raw from analysis-ready data.
