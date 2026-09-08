---
name: stata-house-style
description: Formats Stata do-files to Samuel's house style (metadata headers, ASCII section banners, wrapped prose comments, and standardized spacing) without changing active executable code. Use when the user asks to "format dofile", "apply house style", "style Stata code", "organize dofile", or asks to standardize Stata script outlines.
---

# Stata House Style

Formats Stata do-files to match Samuel's house style: top metadata headers, boxed ASCII section banners, wrapped block comments, and clean vertical spacing.

The formatting workflow uses two roles:
1. **The agent** reads the do-file, understands its structure, and creates a JSON recipe.
2. **A Python script** checks that executable code will not change, then applies the formatting.

## Core Rules

- **Zero Active Code Changes:** The Python script hashes all active code tokens before and after formatting using `sha256`. If any executable character, keyword, variable, option, or macro changes, the script stops immediately without modifying the file.
- **Let Code Sprawl:** Never wrap, split, or add line-continuation slashes (`///`) to active code lines. Executable commands can stretch horizontally as far as needed. Do not enforce column width limits on active code.
- **Column Limits Apply Only to Structure:** Fixed column widths (default: 64 columns, optimal for half-screen editor splits; optionally 72 columns) apply only to top metadata headers, section banners, and wrapped `/* ... */` notes.
- **Do Not Box Inline Labels:** Keep short inline notes (such as `// drop missing` or `// setup paths`) on their own lines or at the end of lines. Only turn major section milestones into boxed banners.
- **Keep Substantive Comments:** Never remove comments that explain data caveats, citations, sample restrictions, or methodological choices.

## Request Routing

```text
User Request
├─ Format or style a do-file ──────────→ Follow 4-Step Styling Execution
├─ Inspect or preview formatting ──────→ Dry run: run with --scan, then --diff
└─ Check if active code changed ───────→ Run: python3 stata_house_style.py --verify <orig> <new>
```

## Workflows

### 4-Step Styling Execution

1. **Scan Structure and Find Existing Comments:**
   Run the scanner to see the exact line numbers of existing comments and banners:
   ```bash
   python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py --scan <target_file.do>
   ```

2. **Write the Recipe:**
   Read the script to identify its metadata (Purpose, Inputs, Outputs) and logical sections. Write the configuration to `/tmp/style_recipe.json`:
   - `header`: Metadata fields (Purpose, Author, Created, Updated, Inputs, Outputs, Notes) and line numbers to replace.
   - `preamble`: (Optional). Line numbers to replace with the standard `project_globals.do` preamble.
   - `banners`: Section numbers and titles (`level: 1` uses `=`, `level: 2` uses `-`).
   - `prose_blocks`: Long prose comments to wrap cleanly.
   *(See [references/recipe-schema.md](references/recipe-schema.md) for full schema details).*

3. **Preview the Diff and Verify Active Code:**
   Run `--diff` to preview formatting changes and verify that active code tokens match byte-for-byte:
   ```bash
   # Standard: entire file active code must match exactly
   python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py <target_file.do> /tmp/style_recipe.json --diff

   # With preamble modernization: active code below the preamble must match exactly
   python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py <target_file.do> /tmp/style_recipe.json --diff --preamble
   ```

4. **Apply Formatting:**
   Once verified, write the formatted output to the file:
   ```bash
   python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py <target_file.do> /tmp/style_recipe.json [--preamble]
   ```

### Check Active Code Outside the Script

If you edited a file by hand, check that executable code remained unchanged:
```bash
python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py <original.do> --verify <styled.do>
```

## References

- [house-style-guide](references/house-style-guide.md): Visual standards, banner formats, comment types, and blank-line rules.
- [recipe-schema](references/recipe-schema.md): Recipe fields, schema rules, and complete JSON examples.
