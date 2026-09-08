---
name: stata-house-style
description: Formats Stata do-files to Samuel's house style (metadata headers, ASCII section banners, wrapped prose comments, and standardized spacing) under a cryptographic zero-code-mutation invariant. Use when the user asks to "format dofile", "apply house style", "style Stata code", "organize dofile", or asks to standardize Stata script outlines.
---

# Stata House Style

Enforces Samuel's standardized house style on Stata do-files: top-level metadata headers, boxed ASCII section banners, wrapped prose comments, and normalized vertical blank lines.

Operates via an **Architect + Builder** workflow: the agent analyzes the do-file and crafts a JSON recipe; a deterministic Python script verifies that active code syntax is 100% untouched and applies formatting.

## Non-Negotiable Rules

- **Zero Active Code Mutation:** The builder cryptographically hashes all active code tokens before and after formatting (`sha256`). If a single executable character, keyword, variable, option, or macro token changes, it aborts immediately.
- **Code Sprawl Allowed:** Never wrap, break, or force line-continuation (`///`) on active code lines. Executable commands are permitted to sprawl horizontally across the screen without artificial column limits.
- **Column Constraints Apply to Structure Only:** Fixed column widths (default: 64 columns, optimal for Niri 80-column half-splits on 14" screens; optionally 72 columns) apply exclusively to top metadata headers, section banners, and wrapped `/* ... */` prose notes.
- **Never Box Inline Labels:** Short inline or single-line code labels (e.g. `// drop missing`, `// setup paths`) must remain inline. Only genuine section milestones are promoted to banners.
- **Preserve Substantive Rationale:** Never strip or delete comments that document data warnings, citation anchors, sample restrictions, or methodological derivations.

## Request-Routing Playbook

```text
REQUEST
├─ User asks to format or style a do-file ──────────→ WORKFLOW: 4-Step Styling Execution
├─ User asks to inspect or preview formatting ──────→ DRY-RUN: --scan then --diff
└─ User asks to verify active code equality ────────→ VERIFY: python3 stata_house_style.py --verify <orig> <new>
```

## Workflows & Invariants

### 4-Step Styling Execution

1. **Scan Structure & Enumerate Comments:**
   Run the scanner to extract exact line ranges of existing comments and banners:
   ```bash
   python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py --scan <target_file.do>
   ```
2. **Draft Semantic Recipe:**
   Read the script to infer metadata (Purpose, Inputs, Outputs) and logical section divisions. Write `/tmp/style_recipe.json`:
   - `header`: Metadata fields (Purpose, Author, Created, Updated, Inputs, Outputs, Notes) and lines to replace.
   - `preamble`: (Optional). Lines 1-indexed to replace with standard `project_globals.do` preamble.
   - `banners`: Section numbers and titles (`level: 1` for `=`, `level: 2` for `-`).
   - `prose_blocks`: Multi-line methodological prose to wrap cleanly.
   *(See [references/recipe-schema.md](references/recipe-schema.md) for full schema).*
3. **Verify Invariant & Preview Diff:**
   Run `--diff` to preview the proposed layout changes and verify the active code token hash matches:
   ```bash
   # Standard: full-file active code bit-identical
   python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py <target_file.do> /tmp/style_recipe.json --diff

   # With preamble modernization: active code body bit-identical
   python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py <target_file.do> /tmp/style_recipe.json --diff --preamble
   ```
4. **Apply Formatting In-Place:**
   Apply the formatting once verified:
   ```bash
   python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py <target_file.do> /tmp/style_recipe.json [--preamble]
   ```

### Verification & Safety Audit

If an edit was made manually or outside the recipe runner, verify that active code tokens remain bit-identical:
```bash
python3 ~/.agents/skills/stata-house-style/scripts/stata_house_style.py <original.do> --verify <styled.do>
```

## Progressive Disclosure & Reference Routing

- For visual standards, banner designs, spacing rules, and prose formatting conventions, load [house-style-guide](references/house-style-guide.md).
- For JSON recipe fields, validation constraints, and worked recipe examples, load [recipe-schema](references/recipe-schema.md).
