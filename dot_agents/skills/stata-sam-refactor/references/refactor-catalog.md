# Refactor catalog: green / yellow / red

Classify every planned refactor before applying it. Apply green freely (snapshot after as a cheap check); apply yellow only with harness verification after each batch; apply red only with harness verification and usually not at all. **THE WALL below is absolute — the harness does not license crossing it.**

## THE WALL — forbidden regardless of the harness

These are the researcher's specification, not refactorable structure. If a refactor seems to require any of these, **stop and ask** — do not assume.

- **The estimation command.** Do not swap `regress`→`reghdfe`, `regress`→`xtreg`, `logit`→`probit`, add/remove `reghdfe`, etc. "Upgrading" an estimator is a methodological change, not a refactor.
- **Estimation options.** `vce(...)`, `cluster(...)`, `robust`, `absorb(...)`, fixed-effects structure, weights (`aw`/`pw`/`iw`/`fweight`), constraints, `if`/`in` on the estimation itself, `level()`, `baselevels`, interaction operators.
- **The estimation sample.** The `keep`/`drop`/`if`/`in` that defines who is in the regression. A sample change is a specification change.
- **Analysis-variable construction.** Every `gen`/`replace`/`egen`/`recode`/`label define` that builds a regressor or outcome. Preserve the *construction* (the formula, the conditions, the order of operations), not just the resulting variable name. Renaming a constructed variable is GREEN only if every later use is updated consistently and no value changes.
- **`set seed`** value and position relative to any RNG-using command.
- **`version`** directive (do not add/remove/change).
- **`merge`** direction and order (do not change).

Backstop: `snap_estimate` records `e(cmdline)`, so any command/option change shows up as a snapshot diff and fails `compare.do`. Do not treat this as a license.

## GREEN — provably output-neutral

Apply freely; snapshot after as a cheap sanity check.

- **Comments — substantive notes are data, not noise.** The refactor must **preserve**, not delete, comments that carry methodological or operational knowledge. The rule is not "comments are safe to remove"; the rule is "comments are safe to touch only if you preserve the information they carry."

  - **Preserve as-is or relocate** (cannot delete):
    - Warnings about data issues: `// NOTE: merge drops obs where X is missing — intentional`
    - Methodological rationale: `// Using wild bootstrap SEs because clusters < 30`
    - Citation anchors: `// See Angrist & Pischke (2009) §5.2`
    - Non-obvious derivations or tricks: `// Had to reshape before merge because pid repeats across waves`
    - TODO / FIXME markers the researcher left (they're still relevant)
  - **Relocate when the refactor moves the code the note describes.** If a warning about a merge caveat sits in the middle of data cleaning, move it to where the merge actually happens in the refactored structure. The harness doesn't check comments — this is editorial judgment.
  - **Collect orphaned notes** that no longer have an obvious home (a method note about a variable that was renamed, a warning about a step now absorbed into a `program`). Gather them into a block comment at the top of the relevant section or file: `/* REFACTOR-NOTES: ... */`. Do not silently drop them.
  - **Safe to remove:**
    - Commented-out dead code (already covered under "Remove dead code")
    - Redundant restatements of what the next line of code literally does: `// generate log of income` immediately before `gen ln_inc = ln(income)`
    - Purely decorative separators: `// ═══════ SECTION 1 ═══════`
    - Obsolete comments that no longer describe the code (the code was changed, the comment wasn't) — but verify with the researcher if the comment describes intent that still matters
  - **Safe to add:** section headers that aid readability, notes about the refactor itself (e.g., `// REFACTORED: consolidated from three repeated blocks`).
- **Line formatting:** split long lines with `///`; convert `#delimit ;` ... `#delimit cr` blocks to `///` continuation (syntax only, logic unchanged).
- **Whitespace/indentation.**
- **Rename a purely internal** `local`, `tempvar`, `tempname`, `tempfile`, or `program` that has no external reliance (no `c_local`/global hand-off, no `estimates store` name relied on downstream, no `frame` name relied on across blocks) — *and* the rename is consistent across all uses within its scope.
- **Remove dead code:** unreachable code after `exit`/`error`, `if 0 { }` blocks, commented-out blocks, locals/tempvars confirmed unused (search the whole pipeline before removing).
- **Path modernization:** replace hard-coded `cd` + relative paths with project globals/locals — **only if the resolved path is byte-identical.** If the path resolution could differ (symlinks, `~`, case-sensitivity), verify with the harness.
- **Add `version`** matching the current effective `c(stata_version)` — neutral (no behavior change). Do **not** add a different version.

## YELLOW — likely neutral; harness mandatory after each batch

- **Reorder consecutive independent data steps** where the only risk is float summation order or sort ties (e.g., two `gen` statements for non-overlapping variables that do not read each other). Verify the harness still passes on `%21x`. The dataset snapshot normalizes variable (column) order, so a pure column-order change from reordering construction is treated as neutral; what remains to verify is that no *value* changed (no hidden read-after-write dependency) and no aggregation/sort order shifted.
- **Consolidate repeated blocks** with `foreach`/`forvalues` over a varlist. Verify each iteration produces identical variables (names *and* values).
- **Replace fixed scratch names** with `tempvar`/`tempfile`/`tempname` — only if no collision and no external reliance.
- **Reorganize independent** `label`/`note`/`char` definitions (order of definitions that do not depend on each other).
- **`preserve/restore` → `frame`** (YELLOW leaning RED). Re-audit every command that runs after the block; see `nondeterminism.md` §3. Prefer leaving `preserve/restore` in place.
- **Split one do-file** into a master + `do`-included modules at a clean boundary (no half-open `preserve`, no pending locals the next line needs, no ambient `set varabbrev`/`set type` state mid-boundary).

## RED — structurally changes state or order; harness mandatory; often not worth it

Prefer to leave these as-is. A passing harness is required but does not make the refactor wise.

- **Reorder** `merge`/`append`/`joinby` operations.
- **Change `merge` direction** (m:1 ↔ 1:m ↔ 1:1). On THE WALL.
- **Swap `sort` ↔ `gsort`**, add/remove `stable`, or reorder any code around a bare `sort`.
- **Replace `collapse`** with `egen` + `by:` aggregation (summation order + sort change).
- **Replace `append`/`merge`** with `frame` + `frlink`/`frget` (changes structure and sort).
- **Extract a block into a `program`** that relies on ambient state; fully self-contained extraction is YELLOW. See `nondeterminism.md` §4.
- **Change the order** of estimation commands relative to the data-prep that feeds them, even if the estimate itself is unchanged (intermediate datasets/estimates may differ).
- **Reorder anything around `set seed`** or around an RNG-using command. On THE WALL.
- **Touch `capture`/`assert`/`set varabbrev`/`set type`** positioning. See `nondeterminism.md` §6.

## Heuristic

When in doubt, leave it. The skill's bias is conservative: the upside of a risky structural refactor is a cleaner file; the downside is a silent error in a result that goes into a paper. Run the harness after *every* batch, bisect on any mismatch, and revert the offending batch rather than "fixing" it.
