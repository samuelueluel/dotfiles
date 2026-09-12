# Path Modernization

**Load this file when** a do-file needs its path syntax, setup block, or project globals modernized, or when confirming that a path rewrite did not miswire an output.

Both operations on this page change active lines, so review the `--diff` output before applying. Both run unattended, including in `/auto`; the review happens when the recipe is written.

## 1. Why Backslash Paths Fail

`\` is an ordinary filename character on Linux, not a directory separator. Stata therefore cannot open `$path\Data\file.xlsx` and fails with `rc=601`. The failure is visible and safe.

A backslash path in `log using` is the dangerous case. Stata creates a file whose name contains a literal backslash rather than failing, so the run appears to succeed while the log lands somewhere unexpected. Treat any `log using` with backslashes as a defect regardless of whether the run reported errors.

## 2. Scan Before Changing Anything

`--scan` reports hazards without modifying the file:

```bash
python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py --scan <file.do>
```

The `advisories` array carries one entry per finding:

| Kind | Meaning |
|---|---|
| `hardcoded_root` | A `global` holding an absolute path. |
| `backslash_path` | A backslash path in a path-taking command such as `use`, `save`, `import`, `do`, or `log`. |
| `absolute_cd` | A `cd` to an absolute path, which the preamble loader makes redundant. |

Advisories never fire inside comment lines, and they ignore backslashes that are not path arguments, so LaTeX payloads written through `file write` are not reported.

## 3. Enumerated Path Rewrites

Rewrites are enumerated, not pattern-based. Each entry names one line and gives both the exact current text and the exact replacement, so the change is reviewable line by line before it happens.

```json
{
  "path_rewrites": [
    {
      "original_start_line": 42,
      "before": "import excel \"$path\\Data\\file.xlsx\", firstrow",
      "after": "import excel \"$data/file.xlsx\", firstrow"
    }
  ]
}
```

`before` must match the file character for character. `path_rewrites` requires `--allow-path-rewrites`, and the resulting hash mode is `exact-active-lines-with-enumerated-path-exceptions`, or `exact-body-with-preamble-and-path-exceptions` when combined with `--preamble`.

Only these moves are accepted:

| From | To |
|---|---|
| `$path\Data\` | `$data/` |
| `$path\Temp\` | `$temp/` |
| `$path\Results\` | `$results/` |
| `$path\Programs-2026\` | `$progs/` |

A rewrite is refused when it changes text outside quoted strings, changes the number of quoted strings on the line, renames the file, sends the path anywhere other than an approved project global, or supplies `before` text that does not match the file. A folder with no matching global, such as `$path\Programs\`, is refused rather than guessed at; resolve it with Samuel.

## 4. Confirm the Paths Moved as Intended

```bash
python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py \
  <before.do> --verify-paths <after.do>
```

Every path is listed with its mapping. The check fails on a renamed file, a lost path, or a path sent to the wrong folder, and passes unchanged paths through untouched. This is the step that catches a results file quietly repointed at `Temp`.

Compare against the file as it stood immediately before the path rewrite. A hardcoded root removed earlier by `--preamble` is correctly reported as a removed path, so check paths before running the preamble step, or accept that single removal knowingly.

## 5. Preamble Replacement

The preamble range is replaced by the standard setup block: `clear all`, `macro drop _all`, `capture log close`, `set more off`, `version`, the `project_globals.do` loader, and the legacy `$path` alias when requested.

Authored globals inside the replaced range survive. The loader regenerates `path`, `root`, `data`, `temp`, `progs`, `results`, and `logs`, and every other `global` line is carried through verbatim after the loader, so it may still reference `$root` or `$path`. A `global date 9-11-2025` in the range is preserved rather than silently deleted.

`cd` lines and `clear matrix` are dropped. That is safe because the loader positions the session and `clear all` subsumes `clear matrix`. Both removals appear in the `--diff` output.

## 6. Optional: Running a Modernized File Safely

The hash proves which lines changed, not that the change is correct. Running the file is the only real check. This section is optional — skip it whenever the output does not matter.

When the output does matter, note that `Results/` and `Temp/` hold real files, and do-files typically end with `log using ..., replace` and `save ..., replace`. Running a modernized file in place replaces them, so a broken edit overwrites a good result before anyone notices. An isolated sandbox avoids that:

```bash
sb="<project>/Programs-2026/Stata-Style-Test/_runtime_<name>"
mkdir -p "$sb/Temp" "$sb/Results"
cp <project>/project_globals.do "$sb/project_globals.do"
ln -s <project>/Data "$sb/Data"
cp <modernized.do> "$sb/run.do"
```

`project_globals.do` sets `$root` to `c(pwd)`, so running `run.do` from the sandbox resolves `$data` to the symlinked real data while `$temp` and `$results` stay inside the sandbox.
