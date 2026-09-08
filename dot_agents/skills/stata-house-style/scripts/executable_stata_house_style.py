#!/usr/bin/env python3
"""
stata_house_style.py

Deterministic house-style engine for Stata do-files.
Enforces header schemas, section banners, prose comment wrapping, and spacing
under the strict invariant of ZERO active code mutation (verified via SHA-256).

Active code lines are allowed to sprawl across columns; only headers, banners,
and designated prose comments are wrapped to the target column width.
"""

import sys
import os
import re
import json
import hashlib
import textwrap
import difflib
from typing import List, Dict, Any, Tuple, Optional

DEFAULT_WIDTH = 64


def tokenize_active_code(text: str, normalize_paths: bool = False) -> str:
    """
    Parses Stata code and extracts active code tokens, strictly ignoring:
    - /* ... */ block comments (including nested)
    - // and /// comments (respecting string literals)
    - * line comments (first non-whitespace character on line)
    - Simple "..." and compound `"...\"' quotes
    If normalize_paths is True, converts backslashes in quoted strings to forward slashes.
    Returns a normalized string representing all active code tokens.
    """
    i = 0
    n = len(text)
    active_tokens = []
    current_token = []
    comment_depth = 0
    in_line_comment = False
    in_str = False
    compound_quote_depth = 0
    at_line_start = True

    while i < n:
        c = text[i]
        c2 = text[i:i+2] if i + 1 < n else ""
        c3 = text[i:i+3] if i + 2 < n else ""

        # Handle newlines
        if c == '\n':
            in_line_comment = False
            at_line_start = True
            if current_token:
                active_tokens.append("".join(current_token))
                current_token = []
            i += 1
            continue

        # If inside single-line comment (*, //, ///)
        if in_line_comment:
            i += 1
            continue

        # If inside block comment /* ... */
        if comment_depth > 0:
            if c2 == '/*':
                comment_depth += 1
                i += 2
            elif c2 == '*/':
                comment_depth -= 1
                i += 2
            else:
                i += 1
            continue

        # Check for start of string literals if not in quotes
        if not in_str and compound_quote_depth == 0:
            # Compound quote open: ` "
            if c2 == '`"':
                compound_quote_depth += 1
                current_token.append(c2)
                i += 2
                at_line_start = False
                continue
            # Simple quote open: "
            if c == '"':
                in_str = True
                current_token.append(c)
                i += 1
                at_line_start = False
                continue

            # Block comment open: /*
            if c2 == '/*':
                comment_depth = 1
                if current_token:
                    active_tokens.append("".join(current_token))
                    current_token = []
                i += 2
                continue

            # Line continuation /// or line comment //
            if c3 == '///' or c2 == '//':
                in_line_comment = True
                if current_token:
                    active_tokens.append("".join(current_token))
                    current_token = []
                i += len(c3 if c3 == '///' else c2)
                continue

            # Star comment: * only valid at beginning of line (preceded only by whitespace)
            if at_line_start and c == '*':
                in_line_comment = True
                i += 1
                continue

        # Inside string literals
        elif in_str:
            ch = '/' if (normalize_paths and c == '\\') else c
            current_token.append(ch)
            if c == '"':
                in_str = False
            i += 1
            continue
        elif compound_quote_depth > 0:
            if c2 == '`"':
                compound_quote_depth += 1
                current_token.append(c2)
                i += 2
                continue
            elif c2 == '"\'':
                compound_quote_depth -= 1
                current_token.append(c2)
                i += 2
                continue
            else:
                ch = '/' if (normalize_paths and c == '\\') else c
                current_token.append(ch)
                i += 1
                continue

        # Active character outside comments and strings
        if c.isspace():
            if current_token:
                active_tokens.append("".join(current_token))
                current_token = []
        else:
            current_token.append(c)
            at_line_start = False

        i += 1

    if current_token:
        active_tokens.append("".join(current_token))

    return " ".join(active_tokens)


def compute_code_hash(text: str, normalize_paths: bool = False) -> str:
    """Returns SHA-256 hash of all active code tokens."""
    tokens = tokenize_active_code(text, normalize_paths=normalize_paths)
    return hashlib.sha256(tokens.encode("utf-8")).hexdigest()


def normalize_path_slashes(text: str) -> str:
    """Converts Windows backslashes to forward slashes inside quoted string literals."""
    def repl(m):
        return m.group(0).replace("\\", "/")
    # Compound quotes `" ... "'
    text = re.sub(r'`"[^"\'\n]*?"\'', repl, text)
    # Simple quotes " ... "
    text = re.sub(r'"[^"\n]*?"', repl, text)
    return text


# ---------------------------------------------------------------------------
# Formatting Generators
# ---------------------------------------------------------------------------

def format_header(meta: Dict[str, Any], width: int = DEFAULT_WIDTH) -> List[str]:
    """Formats top-of-file metadata header at the specified column width."""
    bar = "* " + "=" * (width - 2)
    lines = [bar]

    filename = meta.get("filename", "")
    if filename:
        lines.append(f"* {filename}")
        lines.append("*")

    fields = [
        ("Purpose", meta.get("Purpose", "")),
        ("Author", meta.get("Author", "")),
        ("Created", meta.get("Created", "")),
        ("Updated", meta.get("Updated", "")),
        ("Inputs", meta.get("Inputs", "")),
        ("Outputs", meta.get("Outputs", "")),
        ("Notes", meta.get("Notes", "")),
    ]

    for label, val in fields:
        if not val:
            continue
        prefix = f"* {label.ljust(8)}: "
        wrap_w = width - len(prefix)
        continuation_prefix = "* " + " " * 10

        if label in ("Inputs", "Outputs"):
            if isinstance(val, list):
                items = [str(x).strip() for x in val if str(x).strip()]
            elif isinstance(val, str) and "\n" in val:
                items = [x.strip() for x in val.split("\n") if x.strip()]
            else:
                items = None

            if items:
                for idx, item in enumerate(items):
                    clean_item = item.rstrip(",")
                    if idx == 0:
                        lines.append(f"{prefix}{clean_item}")
                    else:
                        lines.append(f"{continuation_prefix}{clean_item}")
                continue

        wrapped = textwrap.wrap(str(val), width=wrap_w, break_long_words=False, break_on_hyphens=False)
        if wrapped:
            lines.append(prefix + wrapped[0])
            for w in wrapped[1:]:
                lines.append(continuation_prefix + w)

    lines.append(bar)
    return lines


def format_banner(level: int, title: str, number: Optional[str] = None, width: int = DEFAULT_WIDTH) -> List[str]:
    """
    Formats Level 1 (=) or Level 2 (-) section banners.
    Level 1: * ========================================
             * [1. SECTION TITLE]
             * ========================================
    Level 2: * ----------------------------------------
             * [1.1 Subsection Title]
             * ----------------------------------------
    """
    char = "=" if level == 1 else "-"
    bar = "* " + char * (width - 2)

    if number:
        num_str = str(number).strip()
        if "." in num_str:
            num_str = num_str.rstrip(".")  # e.g. "3.1." -> "3.1"
        else:
            num_str = num_str + "."        # e.g. "1" -> "1."
        num_prefix = f"{num_str} "
    else:
        num_prefix = ""

    full_title = f"[{num_prefix}{title.upper() if level == 1 else title}]"

    return [
        bar,
        f"* {full_title}",
        bar
    ]


def format_preamble(preamble_data: Dict[str, Any], width: int = DEFAULT_WIDTH) -> List[str]:
    """
    Generates standard Section 1 preamble and path setup:
    clear all, macro drop _all, log close, set more off, version,
    project_globals.do loader, and legacy $path backward-compatibility alias.
    """
    version = preamble_data.get("version", "17")
    globals_file = preamble_data.get("globals_file", "project_globals.do")
    legacy_path_alias = preamble_data.get("legacy_path_alias", True)
    set_more_off = preamble_data.get("set_more_off", True)

    lines = [
        "clear all",
        "macro drop _all",
        "capture log close"
    ]
    if set_more_off:
        lines.append("set more off")
    if version:
        lines.append(f"version {version}")

    lines.append("")
    lines.append("/* Load project path globals */")
    lines.append(f'capture confirm file "{globals_file}"')
    lines.append("if _rc {")
    lines.append(f'    capture confirm file "../{globals_file}"')
    lines.append('    if !_rc quietly cd ".."')
    lines.append("}")
    lines.append(f'capture do "{globals_file}"')

    if legacy_path_alias:
        lines.append('global path "$root"  // backward-compatibility alias for legacy $path references')

    return lines


def wrap_prose_block(raw_text: str, width: int = DEFAULT_WIDTH, is_notes: bool = False) -> List[str]:
    """
    Wraps explanatory comments into clean /* ... */ blocks to width.
    Option 1: Unindented lead prose, 2-space indented bullets.
    Preserves hierarchical bullet points (> and -).
    """
    # Clean leading/trailing comment syntax
    clean = re.sub(r'^\s*/\*\s*|\s*\*/\s*$', '', raw_text.strip())
    clean = re.sub(r'^\s*\*+\s?', '', clean, flags=re.MULTILINE)
    clean = re.sub(r'^\s*//+\s?', '', clean, flags=re.MULTILINE)

    raw_lines = [l.strip() for l in clean.splitlines()]
    if not any(raw_lines):
        return []

    bullets = []
    current_bullet = None

    for line in raw_lines:
        if not line:
            if current_bullet:
                bullets.append(current_bullet)
                current_bullet = None
            continue
        if line.startswith('>') or line.startswith('-'):
            if current_bullet:
                bullets.append(current_bullet)
            b_type = '>' if line.startswith('>') else '-'
            current_bullet = {'type': b_type, 'text': line[1:].strip()}
        else:
            if current_bullet:
                current_bullet['text'] += " " + line
            else:
                current_bullet = {'type': 'p', 'text': line}
    if current_bullet:
        bullets.append(current_bullet)

    # Check if this is a single short sentence without bullets that fits on one line
    if len(bullets) == 1 and bullets[0]['type'] == 'p' and len(bullets[0]['text']) + 6 <= width:
        return [f"/* {bullets[0]['text']} */"]

    out = ["/*"]
    has_gt = any(b['type'] == '>' for b in bullets)

    for i, b in enumerate(bullets):
        if b['type'] == 'p' and i > 0 and bullets[i - 1]['type'] == 'p':
            out.append("")

        if b['type'] == '>':
            # Tier 1 bullet
            prefix = "  > "
            sub_indent = "    "
            wrap_w = width - 4
        elif b['type'] == '-':
            if has_gt:
                # Tier 2 sub-bullet under >
                prefix = "    - "
                sub_indent = "      "
                wrap_w = width - 6
            else:
                # Primary bullet
                prefix = "  - "
                sub_indent = "    "
                wrap_w = width - 4
        else:
            # Paragraph / lead-in prose: unindented flush left
            prefix = ""
            sub_indent = ""
            wrap_w = width

        wrapped = textwrap.wrap(b['text'], width=wrap_w)
        if not wrapped:
            out.append(prefix.rstrip())
            continue
        out.append(prefix + wrapped[0])
        for w in wrapped[1:]:
            out.append(sub_indent + w)

    out.append("*/")
    return out


# ---------------------------------------------------------------------------
# Scan Mode: Enumerate comment structures for LLM Architect
# ---------------------------------------------------------------------------

def scan_dofile(filepath: str) -> Dict[str, Any]:
    """Scans a do-file and extracts comment lines, existing headers, and candidates."""
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        lines = f.read().splitlines()

    total_lines = len(lines)
    comment_regions = []
    i = 0

    while i < total_lines:
        line = lines[i]
        sline = line.strip()

        # Check for blank
        if not sline:
            i += 1
            continue

        # Check for star comment or block comment
        if sline.startswith('*') or sline.startswith('/*') or sline.startswith('//'):
            start_line = i + 1
            text_lines = [line]

            # Multi-line /* */ detection
            if sline.startswith('/*') and '*/' not in sline:
                i += 1
                while i < total_lines:
                    text_lines.append(lines[i])
                    if '*/' in lines[i]:
                        break
                    i += 1
            # Contiguous line comments (* or //)
            elif sline.startswith('*') or sline.startswith('//'):
                while i + 1 < total_lines:
                    next_sline = lines[i + 1].strip()
                    if next_sline.startswith('*') or next_sline.startswith('//'):
                        i += 1
                        text_lines.append(lines[i])
                    else:
                        break

            end_line = i + 1
            kind = "comment_block"
            # Detect existing banners
            joined = "\n".join(text_lines)
            if re.search(r'[-=]{8,}', joined):
                kind = "banner_or_header"

            comment_regions.append({
                "start_line": start_line,
                "end_line": end_line,
                "kind": kind,
                "sample": text_lines[0][:60]
            })

        i += 1

    return {
        "file": os.path.basename(filepath),
        "total_lines": total_lines,
        "comment_regions": comment_regions
    }


# ---------------------------------------------------------------------------
# Spacing Normalization
# ---------------------------------------------------------------------------

def normalize_vertical_spacing(lines: List[str], width: int = DEFAULT_WIDTH) -> List[str]:
    """
    Standardizes vertical blank lines:
    - Exactly 2 blank lines before a Level 1 banner (unless at top of file)
    - Exactly 1 blank line before a Level 2 banner
    - Maximum 2 consecutive blank lines anywhere
    - Strips trailing whitespace
    """
    cleaned = [l.rstrip() for l in lines]
    out = []
    blanks = 0

    level1_bar = "* " + "=" * (width - 2)
    level2_bar = "* " + "-" * (width - 2)

    in_box = False
    after_box = False

    for line in cleaned:
        if not line:
            if not in_box and not after_box:
                blanks += 1
            continue

        if line == level1_bar or line == level2_bar:
            if in_box:
                # Closing bar of a banner or header
                in_box = False
                after_box = True
                blanks = 0
                out.append(line)
                continue
            else:
                # Opening bar of a banner or header
                in_box = True
                after_box = False
                if out:
                    while out and out[-1] == "":
                        out.pop()
                    needed_blanks = 2 if line == level1_bar else 1
                    out.extend([""] * needed_blanks)
                blanks = 0
                out.append(line)
                continue

        # Normal line
        if after_box:
            out.append("")
            after_box = False
            blanks = 0
        elif blanks > 0 and out and not in_box:
            num_blanks = min(blanks, 2)
            out.extend([""] * num_blanks)
            blanks = 0

        out.append(line)

    if out and out[-1] != "":
        out.append("")

    return out


# ---------------------------------------------------------------------------
# Recipe Application
# ---------------------------------------------------------------------------

def apply_recipe(filepath: str, recipe: Dict[str, Any], width: int = DEFAULT_WIDTH, enable_preamble: bool = False, normalize_paths: bool = False) -> Tuple[List[str], str, str, str]:
    """
    Applies the recipe in-memory, returning (formatted_lines, hash_before, hash_after, mode).
    Mode is 'full' (100% file hash) or 'body' (100% body hash excluding preamble).
    """
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        original_text = f.read()

    lines = original_text.splitlines()

    preamble_data = recipe.get("preamble")
    if not enable_preamble:
        preamble_data = None
    elif not preamble_data:
        preamble_data = {
            "globals_file": "project_globals.do",
            "legacy_path_alias": True,
            "version": "17"
        }

    edits = []
    preamble_range = None
    new_preamble_lines = []

    # 1. Header
    header_data = recipe.get("header")
    if header_data:
        new_header = format_header(header_data, width=width)
        orig_start = header_data.get("original_start_line")
        orig_end = header_data.get("original_end_line")
        if orig_start is not None and orig_end is not None:
            edits.append({
                "start": orig_start - 1,
                "end": orig_end - 1,
                "replacement": new_header,
                "type": "header"
            })
        else:
            # Insert at beginning of file
            edits.append({
                "start": 0,
                "end": -1,
                "replacement": new_header,
                "type": "header_insert"
            })

    # 2. Preamble (Optional)
    if preamble_data and "original_start_line" in preamble_data:
        p_start = preamble_data["original_start_line"] - 1
        p_end = preamble_data.get("original_end_line", preamble_data["original_start_line"]) - 1
        preamble_range = (p_start, p_end)
        new_preamble_lines = format_preamble(preamble_data, width=width)
        edits.append({
            "start": p_start,
            "end": p_end,
            "replacement": new_preamble_lines,
            "type": "preamble"
        })

    # 3. Banners
    banners = recipe.get("banners", [])
    for b in banners:
        new_banner = format_banner(
            level=b.get("level", 1),
            title=b.get("title", ""),
            number=b.get("number"),
            width=width
        )
        edits.append({
            "start": b["original_start_line"] - 1,
            "end": b.get("original_end_line", b["original_start_line"]) - 1,
            "replacement": new_banner,
            "type": "banner"
        })

    # 4. Prose Blocks
    prose_blocks = recipe.get("prose_blocks", [])
    for p in prose_blocks:
        start_idx = p["original_start_line"] - 1
        end_idx = p.get("original_end_line", p["original_start_line"]) - 1
        raw_text = "\n".join(lines[start_idx:end_idx + 1])
        new_prose = wrap_prose_block(
            raw_text,
            width=width,
            is_notes=(p.get("type") == "notes_block")
        )
        edits.append({
            "start": start_idx,
            "end": end_idx,
            "replacement": new_prose,
            "type": "prose"
        })

    # Apply edits from bottom to top to preserve line indices
    edits.sort(key=lambda x: x["start"], reverse=True)

    for edit in edits:
        if edit["type"] == "header_insert":
            lines = edit["replacement"] + [""] + lines
        else:
            lines[edit["start"]:edit["end"] + 1] = edit["replacement"]

    # Normalize Windows backslashes in quoted paths if enabled
    if normalize_paths:
        lines = [normalize_path_slashes(l) for l in lines]

    # Normalize trailing inline /* note */ to // note on active code lines
    normalized_trailing = []
    for line in lines:
        if '/*' in line and line.rstrip().endswith('*/'):
            parts = line.rsplit('/*', 1)
            if parts[0].strip() and not parts[0].strip().startswith('*') and not parts[0].strip().startswith('//'):
                note = parts[1].replace('*/', '').strip()
                line = parts[0].rstrip() + "  // " + note
        normalized_trailing.append(line)
    lines = normalized_trailing

    # Normalize vertical spacing
    formatted_lines = normalize_vertical_spacing(lines, width=width)
    formatted_text = "\n".join(formatted_lines)

    # Compute hashes and verify invariant
    if preamble_range:
        hash_mode = "body"
        orig_lines = original_text.splitlines()
        pre_tokens = tokenize_active_code("\n".join(orig_lines[:preamble_range[0]]), normalize_paths=normalize_paths).split()
        body_before_tokens = tokenize_active_code("\n".join(orig_lines[preamble_range[1] + 1:]), normalize_paths=normalize_paths).split()

        all_formatted_tokens = tokenize_active_code(formatted_text, normalize_paths=normalize_paths).split()
        new_p_tokens = tokenize_active_code("\n".join(new_preamble_lines), normalize_paths=normalize_paths).split()

        n_prefix = len(pre_tokens) + len(new_p_tokens)
        formatted_prefix = all_formatted_tokens[:n_prefix]
        formatted_body = all_formatted_tokens[n_prefix:]

        if formatted_prefix != (pre_tokens + new_p_tokens):
            print("WARNING: Formatted preamble tokens do not match expected preamble tokens!", file=sys.stderr)

        hash_before = hashlib.sha256(" ".join(body_before_tokens).encode("utf-8")).hexdigest()
        hash_after = hashlib.sha256(" ".join(formatted_body).encode("utf-8")).hexdigest()
    else:
        hash_mode = "full"
        hash_before = compute_code_hash(original_text, normalize_paths=normalize_paths)
        hash_after = compute_code_hash(formatted_text, normalize_paths=normalize_paths)

    return formatted_lines, hash_before, hash_after, hash_mode


# ---------------------------------------------------------------------------
# CLI Entrypoint
# ---------------------------------------------------------------------------

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Stata House Style Engine")
    parser.add_argument("file", help="Path to Stata do-file")
    parser.add_argument("recipe", nargs="?", help="Path to styling recipe JSON (optional for scan)")
    parser.add_argument("--scan", action="store_true", help="Scan do-file and output comment regions")
    parser.add_argument("--diff", action="store_true", help="Preview unified diff without modifying file")
    parser.add_argument("--preamble", action="store_true", help="Enable Section 1 preamble standardization")
    parser.add_argument("--normalize-paths", action="store_true", help="Convert Windows backslashes to forward slashes in quoted path strings")
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH, help=f"Target column width (default: {DEFAULT_WIDTH})")
    parser.add_argument("--verify", help="Verify that FILE and VERIFY have identical active code hashes")

    args = parser.parse_args()

    if args.verify:
        with open(args.file, 'r', encoding='utf-8') as f1, open(args.verify, 'r', encoding='utf-8') as f2:
            h1 = compute_code_hash(f1.read())
            h2 = compute_code_hash(f2.read())
        if h1 == h2:
            print(f"VERIFIED: Active code token hashes match ({h1}).")
            sys.exit(0)
        else:
            print(f"FAILED: Hash mismatch!\nFile 1: {h1}\nFile 2: {h2}")
            sys.exit(1)

    if args.scan:
        scan_data = scan_dofile(args.file)
        print(json.dumps(scan_data, indent=2))
        sys.exit(0)

    if not args.recipe:
        parser.error("A recipe JSON file is required unless running with --scan or --verify")

    with open(args.recipe, 'r', encoding='utf-8') as f:
        recipe = json.load(f)

    target_width = recipe.get("width", args.width)
    should_normalize_paths = args.normalize_paths or args.preamble

    formatted_lines, hash_before, hash_after, hash_mode = apply_recipe(
        args.file,
        recipe,
        width=target_width,
        enable_preamble=args.preamble,
        normalize_paths=should_normalize_paths
    )

    # Invariant check
    if hash_before != hash_after:
        print(f"CRITICAL ERROR: Active code {hash_mode} token hash mismatch!", file=sys.stderr)
        print(f"  Before: {hash_before}", file=sys.stderr)
        print(f"  After:  {hash_after}", file=sys.stderr)
        print(f"The recipe attempted to modify active code outside permitted boundaries ({hash_mode}). Operation aborted.", file=sys.stderr)
        sys.exit(1)

    with open(args.file, 'r', encoding='utf-8') as f:
        original_lines = f.read().splitlines(keepends=True)

    new_content = "\n".join(formatted_lines)
    if not new_content.endswith("\n"):
        new_content += "\n"

    if args.diff:
        diff = difflib.unified_diff(
            original_lines,
            [l + "\n" for l in formatted_lines],
            fromfile=f"a/{os.path.basename(args.file)}",
            tofile=f"b/{os.path.basename(args.file)}"
        )
        sys.stdout.writelines(diff)
        print(f"\n[Invariant Verified: sha256 active code ({hash_mode}) = {hash_before}]")
        sys.exit(0)

    # In-place write
    with open(args.file, 'w', encoding='utf-8') as f:
        f.write(new_content)

    print(f"Successfully styled {args.file} (Invariant passed [{hash_mode}]: {hash_before[:12]}...)")


if __name__ == "__main__":
    main()
