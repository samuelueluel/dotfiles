# Stata non-determinism catalog

Why a "safe" Stata refactor can silently change outputs, and the discipline to avoid each trap. Read this before classifying any refactor yellow or red. Every item here is a way that reordering, restructuring, or "modernizing" code can change a final dataset, estimate, graph, or table *while the code still runs clean and the numbers look plausible*.

## 1. Sort order and tie-breaking

`sort x` breaks ties by the current physical order in memory **unless `stable` is used.** A refactor that moves any code that touches memory layout *around* a bare `sort` (inserting an earlier `gen`, reordering a `merge`, splitting a block) changes tie order → different `by x:` aggregates → different downstream data and estimates.

- `gsort -x` is **not** equivalent to `gen double _mx = -x` then `sort _mx`; the tie-breaking differs.
- `gsort` ties differ from `sort` ties.
- `merge`, `append`, `duplicates drop`, `joinby`, `fillin` all impose a sort order on the result; reordering them changes row order.

**Discipline:** preserve the exact sequence of sort-producing commands; never reorder around a bare `sort`; treat every bare `sort` as load-bearing. Do *not* add `set sortseed` to "fix" determinism — that itself changes behavior unless the original already pinned it. If you must touch a sort region, it is RED; harness-verify.

## 2. Float associativity and summation order

Floating-point addition is non-associative; summing in a different order perturbs the last bits. For most applied economics this is immaterial in human terms, but the harness compares `e(b)`/`e(V)` in `%21x` (bit-exact), so it will surface as a FAIL.

- `egen total(x)` vs a manual `by g: gen double s = sum(x)` then taking `s[_N]` — different accumulation order.
- `collapse (sum) x, by(g)` order depends on the prior sort; reordering the sort changes the sum.
- `egen ... = mean(...)` over groups in a different order differs in the last ULP.

**Discipline:** never change the order of aggregation; preserve the exact `egen`/`collapse`/`sum` construct. If a structural refactor forces a different summation order, it is RED and must pass the harness; if it fails on `%21x` but the coefficient agrees to displayed precision, *that is still a failure of the invariant* — revert or ask whether the discrepancy is acceptable (it usually is not, for a refactor).

## 3. `preserve/restore` vs `frame`

`stata-modernize` recommends this swap; here it is YELLOW leaning RED. The differences are subtle and stateful:

- After `restore`, the pre-`preserve` data **and its sort order** return. With frames you must explicitly manage what is "current" and re-sort if needed.
- Locals and macros defined inside a `preserve...restore` block survive after `restore`. Inside a `frame ... { }` block or a frame-switch, scoping differs; a local you expect after the block may be gone.
- `sortseed` state can differ because the internal sort history differs.
- What is in memory when a *later* `if`/`in`/`sort`/`merge` runs can differ.

**Discipline:** treat `preserve/restore` → `frame` as RED unless trivial; re-audit every command that runs after the block. Prefer leaving `preserve/restore` in place.

## 4. Extract-to-`program` scoping

Extracting a repeated block into a `program define` is a classic silent-breaker:

- Locals defined in the main do-file are **not** visible inside a `program` unless passed via `args`/`syntax` or globals. A block that "worked" inline because it read a caller local will silently use empty/missing values once extracted.
- `if`/`forvalues`/`while` blocks scope locals to the block, but program boundaries are harder walls than block boundaries.
- `tempvar`/`tempname`/`tempfile` inside a program are local to the program and vanish after it returns. If the caller needs the temp name (e.g., a variable the program created), it must be returned via `c_local` or a global; otherwise the variable disappears.
- `quietly`/`capture` wrappers around the program change what `_rc` and output suppression the surrounding code sees.

**Discipline:** extract only blocks that are fully self-contained (all inputs via `args`, no reliance on caller locals, no caller needing the temp names). Return temp names the caller needs via `c_local`. Treat any extraction that relies on ambient state as RED; harness-verify.

## 5. `version` directive

`version N` pins command behavior to Stata N. Defaults shift across versions (e.g., `merge` syntax/behavior, `margins` defaults, `reghdfe` option defaults, `xtreg` behavior). A refactor must not silently change the effective version:

- Do not remove an existing `version`.
- Do not add a `version` different from the one the code currently runs under.
- Do not wrap code in a `program` that lacks the original's `version` (program scope resets version handling).

If the original has no `version`, the effective version is `c(stata_version)`; the harness manifest captures that so a version drift across the two runs (e.g., original run under 17, refactored under 18) is flagged.

**Discipline:** preserve `version` exactly; do not introduce one. If the code has no `version` and you want to pin it, that is a separate decision for the researcher, not a refactor.

## 6. `capture` / `assert` / `_rc` / `set varabbrev` / `set type`

These are state-bearing and position-sensitive:

- `capture` resets `_rc`; reordering `capture` blocks changes which error is swallowed and what `_rc` the next line sees.
- `set varabbrev on` lets `inc` match `income`; moving code across a `set varabbrev` toggle changes variable resolution.
- `set type float|double` changes the default numeric type produced by `gen` without an explicit type; reordering a `set type` relative to a `gen` changes precision → different data → different estimates.
- `assert` vs `if _rc` vs `capture noisily` differ in abort behavior; a refactor that "cleans up" error handling can change whether the pipeline stops on a real problem.

**Discipline:** preserve the exact positions of all state-setting commands; treat them as load-bearing. Do not "tidy" error handling during a refactor.

## 7. RNG seed path

`set seed 12345` placement relative to `bootstrap`, `simulate`, `vce(bootstrap)`, `permute`, `bsample`, `mi estimate` is critical. Moving a `set seed` across a refactor — even by a few lines, even to a "better" location — changes every replication → different SEs, CIs, p-values, and simulation results.

**Discipline:** never move a `set seed`; preserve its exact line position. The harness flags SE changes via `e(V)` in `%21x`. If a bootstrap SE differs, this is almost always the cause.

## 8. Missing-value predicates

- `if mi(x)` catches all extended missings (`.`, `.a`–`.z`); `if x == .` catches only `.`. Swapping them changes which rows are kept → different estimation sample → different estimates (and a changed `e(N)` the harness will catch).
- For strings, `if x == ""` and `if missing(x)` both catch the empty string, but `if x == "."` does not — a refactor that "normalizes" string-missing checks can change the sample.
- `gen x = a/b` auto-misses (0/0 → `.`); `gen x = .` then `replace x = a/b if !missing(a,b)` differs in which rows are computed and can differ in extended-missing propagation.

**Discipline:** preserve exact missing-value predicates and the exact `gen`/`replace` structure. Do not "simplify" `mi(x)` to `x == .`.

## 9. `merge` direction and `_merge`

- `merge m:1` and `merge 1:m` produce the same matched rows but a different sort order and a `_merge` variable whose semantics differ by side; reordering or flipping direction changes sort and downstream `by:` operations.
- `merge 1:1` requires uniqueness that `m:1` does not; a refactor that "simplifies" direction can error or silently change results.
- The order of multiple `merge` calls changes the cumulative sort and the set of `_merge` codes present.

**Discipline:** never change merge direction; preserve merge order. These are RED and on THE WALL.

## 10. The estimation wall (cross-reference)

Even with a passing harness, you may not change the estimation command, its options, the estimation sample, the construction of analysis variables, `set seed`, or `version`. These are the specification, not structure. See `refactor-catalog.md` → THE WALL. The harness's `e(cmdline)` capture is a backstop that will flag any command/option change, but the prohibition stands regardless of the harness.
