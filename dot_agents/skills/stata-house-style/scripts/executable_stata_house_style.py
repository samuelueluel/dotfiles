#!/usr/bin/env python3
"""
stata_house_style.py

Deterministic house-style engine for Stata do-files.
Enforces header schemas, section banners, prose comment wrapping, and spacing
while preserving protected active-code lines exactly (verified via SHA-256).

Active code lines are allowed to sprawl across columns; only headers, banners,
and designated standalone prose comments are wrapped. Preamble replacement is
an explicit, validated semantic exception and requires separate runtime testing.
"""

import sys
import os
import re
import json
import hashlib
import textwrap
import difflib
import tempfile
from typing import List, Dict, Any, Tuple, Optional

DEFAULT_WIDTH = 64
STATUS_LABELS = ("NOTE", "ISSUE", "VERIFY", "ASSUMPTION", "DISABLED", "EXPLORATION")
LEGACY_STATUS_MAP = {"WARNING": "NOTE", "TODO": "ISSUE", "FIXME": "ISSUE"}
ALL_STATUS_LABELS = STATUS_LABELS + tuple(LEGACY_STATUS_MAP)
STATUS_LABEL_PATTERN = re.compile(rf"^({'|'.join(ALL_STATUS_LABELS)}):\s*", re.IGNORECASE)


def active_line_mask(text: str) -> List[bool]:
    """Return one flag per physical line indicating protected active Stata code.

    Protection is deliberately conservative. A line is protected when it has any
    text outside a standalone comment, when it contains an inline comment beside
    code, or when it uses Stata's semantic `///` continuation marker. The full
    physical line is then compared exactly; comments sharing a code line are not
    rewritten by this formatter.
    """
    lines = text.splitlines()
    mask: List[bool] = []
    comment_depth = 0
    in_str = False
    compound_quote_depth = 0

    for line in lines:
        i = 0
        saw_active = in_str or compound_quote_depth > 0
        at_line_start = True

        while i < len(line):
            c = line[i]
            c2 = line[i:i + 2]
            c3 = line[i:i + 3]

            if comment_depth > 0:
                if c2 == "/*":
                    comment_depth += 1
                    i += 2
                elif c2 == "*/":
                    comment_depth -= 1
                    i += 2
                else:
                    i += 1
                continue

            if in_str:
                saw_active = True
                if c == '"':
                    in_str = False
                i += 1
                continue

            if compound_quote_depth > 0:
                saw_active = True
                if c2 == '`"':
                    compound_quote_depth += 1
                    i += 2
                elif c2 == '"\'':
                    compound_quote_depth -= 1
                    i += 2
                else:
                    i += 1
                continue

            if c.isspace():
                i += 1
                continue

            if at_line_start and c == "*":
                break

            at_line_start = False
            if c2 == '`"':
                saw_active = True
                compound_quote_depth = 1
                i += 2
                continue
            if c == '"':
                saw_active = True
                in_str = True
                i += 1
                continue
            if c2 == "/*":
                comment_depth = 1
                i += 2
                continue
            if c3 == "///":
                # `///` joins the next physical line and is executable syntax.
                saw_active = True
                break
            if c2 == "//":
                break

            saw_active = True
            i += 1

        mask.append(saw_active)

    # `///` joins the immediately following physical line. Protect that line
    # even when it is blank or otherwise comment-only, because deleting or
    # rewriting it can change which command Stata constructs.
    for index, line in enumerate(lines[:-1]):
        if _line_has_semantic_continuation(line):
            mask[index] = True
            mask[index + 1] = True

    return mask


def _line_has_semantic_continuation(line: str) -> bool:
    """Detect an unquoted, non-block-comment `///` marker on one line."""
    i = 0
    in_str = False
    compound_depth = 0
    block_depth = 0
    at_line_start = True
    while i < len(line):
        c = line[i]
        c2 = line[i:i + 2]
        c3 = line[i:i + 3]
        if block_depth:
            if c2 == "/*":
                block_depth += 1
                i += 2
            elif c2 == "*/":
                block_depth -= 1
                i += 2
            else:
                i += 1
            continue
        if in_str:
            if c == '"':
                in_str = False
            i += 1
            continue
        if compound_depth:
            if c2 == '`"':
                compound_depth += 1
                i += 2
            elif c2 == '"\'':
                compound_depth -= 1
                i += 2
            else:
                i += 1
            continue
        if c.isspace():
            i += 1
            continue
        if at_line_start and c == "*":
            return False
        at_line_start = False
        if c2 == '`"':
            compound_depth = 1
            i += 2
        elif c == '"':
            in_str = True
            i += 1
        elif c2 == "/*":
            block_depth = 1
            i += 2
        elif c3 == "///":
            return True
        elif c2 == "//":
            return False
        else:
            i += 1
    return False


def protected_active_lines(text: str) -> List[str]:
    """Return exact physical lines that contain active code or `///`."""
    lines = text.splitlines()
    return [line for line, protected in zip(lines, active_line_mask(text)) if protected]


def tokenize_active_code(text: str, normalize_paths: bool = False) -> str:
    """Compatibility name for the strict, line-preserving code projection.

    `normalize_paths` is retained for callers of older versions but no longer
    weakens comparison semantics. Path rewriting is outside house-style scope.
    """
    if normalize_paths:
        raise ValueError("Path normalization is not permitted by the house-style invariant")
    return "\n".join(protected_active_lines(text))


def compute_code_hash(text: str, normalize_paths: bool = False) -> str:
    """Return SHA-256 of exact protected active-code lines."""
    protected = tokenize_active_code(text, normalize_paths=normalize_paths)
    return hashlib.sha256(protected.encode("utf-8")).hexdigest()


def detect_newline(text: str) -> str:
    """Preserve the source file's newline convention."""
    if "\r\n" in text:
        return "\r\n"
    if "\r" in text:
        return "\r"
    return "\n"


def atomic_write_text(filepath: str, content: str) -> None:
    """Atomically replace a file while preserving its permission bits."""
    directory = os.path.dirname(os.path.abspath(filepath))
    mode = os.stat(filepath).st_mode
    fd, temp_path = tempfile.mkstemp(prefix=f".{os.path.basename(filepath)}.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_path, mode)
        os.replace(temp_path, filepath)
        dir_fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except Exception:
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        raise


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


# Global names the generated preamble defines itself. Any other `global` line
# inside a preamble range is authored content and must survive replacement.
GENERATED_GLOBAL_NAMES = frozenset({"path", "root", "data", "temp", "progs", "results", "logs"})
GLOBAL_ASSIGNMENT = re.compile(r"^\s*global\s+([A-Za-z_]\w*)\s+(.+?)\s*$", re.IGNORECASE)


def carried_through_globals(source_lines: List[str]) -> List[str]:
    """Return authored globals the generated loader does not define itself."""
    carried: List[str] = []
    for line in source_lines:
        match = GLOBAL_ASSIGNMENT.match(line)
        if not match:
            continue
        if match.group(1).lower() in GENERATED_GLOBAL_NAMES:
            continue
        carried.append(line.strip())
    return carried


def format_preamble(
    preamble_data: Dict[str, Any],
    width: int = DEFAULT_WIDTH,
    source_lines: Optional[List[str]] = None,
) -> List[str]:
    """
    Generates standard Section 1 preamble and path setup:
    clear all, macro drop _all, log close, set more off, version,
    project_globals.do loader, and legacy $path backward-compatibility alias.

    Authored globals in the replaced range (for example `global date`) are
    carried through after the loader rather than silently discarded. They are
    emitted last so they may reference `$root` or `$path`.
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
    lines.append("    if _rc {")
    lines.append(f'        display as error "Could not locate {globals_file} in the current or parent directory"')
    lines.append("        exit 601")
    lines.append("    }")
    lines.append('    quietly cd ".."')
    lines.append("}")
    lines.append(f'do "{globals_file}"')
    lines.append('if `"$root"\' == "" {')
    lines.append(f'    display as error "{globals_file} did not define global root"')
    lines.append("    exit 198")
    lines.append("}")

    if legacy_path_alias:
        lines.append('global path "$root"  // backward-compatibility alias for legacy $path references')

    carried = carried_through_globals(source_lines or [])
    if carried:
        lines.append("")
        lines.extend(carried)

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
        elif line.endswith(':'):
            # Preserve lead-ins such as "Findings:" as paragraphs rather than
            # folding them into the preceding bullet.
            if current_bullet:
                bullets.append(current_bullet)
            current_bullet = {'type': 'p', 'text': line}
        else:
            if current_bullet:
                current_bullet['text'] += " " + line
            else:
                current_bullet = {'type': 'p', 'text': line}
    if current_bullet:
        bullets.append(current_bullet)

    # Normalize current labels to uppercase and fold retired labels into the
    # compact house vocabulary before choosing the comment form.
    has_status_label = False
    if bullets and bullets[0]['type'] == 'p':
        label_match = STATUS_LABEL_PATTERN.match(bullets[0]['text'])
        if label_match:
            source_label = label_match.group(1).upper()
            target_label = LEGACY_STATUS_MAP.get(source_label, source_label)
            remainder = bullets[0]['text'][label_match.end():]
            bullets[0]['text'] = f"{target_label}: {remainder}".rstrip()
            has_status_label = True

    # One ordinary point that fits on one line uses Stata's `* ` prose form.
    # Status labels always receive a full block, even when short.
    is_single_point = len(bullets) == 1 and bullets[0]['type'] == 'p'
    if is_single_point and not has_status_label and len(bullets[0]['text']) + 2 <= width:
        return [f"* {bullets[0]['text']}"]

    out = ["/*"]
    has_gt = any(b['type'] == '>' for b in bullets)

    for i, b in enumerate(bullets):
        if b['type'] == 'p' and i > 0:
            # Separate internal headings and new prose paragraphs from the
            # preceding paragraph or bullet list.
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

# Commands that take a path as an argument. A backslash inside such a path does
# not resolve on Linux, where Stata treats `\` as an ordinary filename character
# rather than a directory separator.
PATH_COMMANDS = re.compile(
    r"^\s*(?:capture\s+|quietly\s+|noisily\s+)*"
    r"(?:use|save|import|export|cd|do|run|confirm|copy|erase|mkdir|rmdir|log|"
    r"outfile|append|merge|infix|infile)\b",
    re.IGNORECASE,
)
HARDCODED_ROOT = re.compile(r'^\s*global\s+\w+\s+"[A-Za-z]:[\\/]|^\s*global\s+\w+\s+"/')
ABSOLUTE_CD = re.compile(r'^\s*(?:quietly\s+)?cd\s+"[A-Za-z]:[\\/]|^\s*(?:quietly\s+)?cd\s+"/')


def scan_advisories(lines: List[str]) -> List[Dict[str, Any]]:
    """
    Report portability hazards without changing anything.

    These are findings for a human to act on, never automatic edits: the
    formatter must not rewrite active lines on its own. Each finding names the
    line, the problem, and the remediation path.
    """
    advisories: List[Dict[str, Any]] = []
    mask = active_line_mask("\n".join(lines))

    for index, line in enumerate(lines):
        if index >= len(mask) or not mask[index]:
            continue
        line_number = index + 1

        if HARDCODED_ROOT.match(line):
            advisories.append({
                "line": line_number,
                "kind": "hardcoded_root",
                "detail": "absolute root global; replace with project_globals.do via --preamble",
                "sample": line.strip()[:70],
            })

        if ABSOLUTE_CD.match(line):
            advisories.append({
                "line": line_number,
                "kind": "absolute_cd",
                "detail": "cd to an absolute path; the preamble loader makes this redundant",
                "sample": line.strip()[:70],
            })

        if PATH_COMMANDS.match(line):
            for quoted in extract_quoted_strings(line):
                if "\\" not in quoted:
                    continue
                advisories.append({
                    "line": line_number,
                    "kind": "backslash_path",
                    "detail": "backslash path does not resolve on Linux Stata; "
                              "use the project global, e.g. $data/ or $temp/",
                    "sample": quoted[:70],
                })

    return advisories


def scan_dofile(filepath: str) -> Dict[str, Any]:
    """Scans a do-file and extracts comment lines, existing headers, and candidates."""
    with open(filepath, 'r', encoding='utf-8', newline='') as f:
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
        "comment_regions": comment_regions,
        "advisories": scan_advisories(lines)
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
    - Strips trailing whitespace only from blank and comment-only lines
    """
    # Never alter a physical line that contains executable code or `///`.
    # Trailing whitespace cleanup applies only to blank and comment-only lines.
    protected = active_line_mask("\n".join(lines))
    cleaned = [line if is_protected else line.rstrip() for line, is_protected in zip(lines, protected)]
    out = []
    blanks = 0

    level1_bar = "* " + "=" * (width - 2)
    level2_bar = "* " + "-" * (width - 2)

    in_box = False
    after_box = False

    for index, line in enumerate(cleaned):
        if not line:
            if protected[index]:
                if blanks > 0 and out and not in_box:
                    out.extend([""] * min(blanks, 2))
                blanks = 0
                out.append(line)
            elif not in_box and not after_box:
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

PREAMBLE_ACTIVE_LINE_PATTERNS = [
    re.compile(r"^(?:capture\s+)?clear(?:\s+(?:all|matrix))?\s*$", re.IGNORECASE),
    re.compile(r"^macro\s+drop\s+_all\s*$", re.IGNORECASE),
    re.compile(r"^(?:capture\s+)?log\s+close\s*$", re.IGNORECASE),
    re.compile(r"^set\s+more\s+off\s*$", re.IGNORECASE),
    re.compile(r"^version\s+\d+(?:\.\d+)?\s*$", re.IGNORECASE),
    re.compile(r"^global\s+(?:date|path|root|data|temp|progs|results|logs)\b.*$", re.IGNORECASE),
    re.compile(r"^(?:quietly\s+)?cd\b.*$", re.IGNORECASE),
    re.compile(r"^(?:capture\s+)?(?:do|confirm\s+file)\b.*$", re.IGNORECASE),
    re.compile(r"^if\s+!?_rc\b.*$", re.IGNORECASE),
    re.compile(r"^if\s+`\"\$root\"'\s*==\s*\"\"\s*\{\s*$", re.IGNORECASE),
    re.compile(r'^display\s+as\s+error\s+"(?:Could not locate|[^\"]+ did not define global root).*"\s*$', re.IGNORECASE),
    re.compile(r"^exit\s+(?:198|601)\s*$", re.IGNORECASE),
    re.compile(r"^[{}]\s*$"),
]


PERMISSION_CONFIG_ENV = "PI_PERMISSION_SYSTEM_CONFIG_PATH"


def active_line_edits_requested(recipe: Dict[str, Any], enable_preamble: bool, enable_path_rewrites: bool = False) -> bool:
    """True when a recipe changes protected active lines rather than comments only."""
    preamble = recipe.get("preamble") if enable_preamble else None
    if preamble and "original_start_line" in preamble:
        return True
    return bool(enable_path_rewrites and recipe.get("path_rewrites"))


def escalation_available() -> Tuple[bool, str]:
    """
    Report whether the running agent can ask Samuel to confirm a change.

    Pi records the active permission mode in a per-session JSON file and points
    at it with PI_PERMISSION_SYSTEM_CONFIG_PATH. `yoloMode: true` means /auto,
    where ask_user is removed from the tool surface and Samuel cannot be asked.
    Active-line edits must not proceed in that state.

    A missing variable means the script was invoked directly from a shell, so a
    human is present and can answer. An unreadable file fails closed.
    """
    config_path = os.environ.get(PERMISSION_CONFIG_ENV)
    if not config_path:
        return True, "direct invocation (no Pi permission config)"

    try:
        with open(config_path, "r", encoding="utf-8") as handle:
            config = json.load(handle)
    except (OSError, ValueError) as error:
        return False, f"permission config unreadable ({error})"

    if not isinstance(config, dict):
        return False, "permission config is not an object"

    if config.get("yoloMode") is True:
        return False, "/auto is active, so ask_user is unavailable"

    return True, "confirmation channel available"


REQUIRE_CONFIRMATION_ENV = "STATA_HOUSE_STYLE_REQUIRE_CONFIRMATION"


def require_escalation(recipe: Dict[str, Any], enable_preamble: bool, enable_path_rewrites: bool = False) -> None:
    """
    Optionally refuse active-line edits when Samuel cannot be asked to confirm.

    Off by default. `/auto` exists so long unattended runs can finish, and an
    active-line edit is reviewed when its recipe is written, not when it is
    applied. The safety net for a miswired path is `--verify-paths`, which runs
    in every mode.

    Set STATA_HOUSE_STYLE_REQUIRE_CONFIRMATION=1 to make `/auto` refuse instead,
    for a run where a live confirmation round trip is wanted.
    """
    if not os.environ.get(REQUIRE_CONFIRMATION_ENV):
        return
    if not active_line_edits_requested(recipe, enable_preamble, enable_path_rewrites):
        return

    allowed, reason = escalation_available()
    if allowed:
        return

    raise ValueError(
        "this recipe changes active lines (preamble or path rewrites), and "
        f"{REQUIRE_CONFIRMATION_ENV} is set, but {reason}. Preview with --diff, "
        "then re-run from /manual or /autoask, or unset the variable. Nothing was written."
    )


# Path globals a rewrite may target, mapped to the project folder each stands
# for. Only `$path\<Folder>\rest` -> `$<name>/rest` is ever approved.
PROJECT_PATH_GLOBALS = {
    "data": "Data",
    "temp": "Temp",
    "results": "Results",
    "progs": "Programs-2026",
}

BACKSLASH_PROJECT_PATH = re.compile(r"^\$path\\(?P<folder>[^\\/]+)\\(?P<rest>.+)$", re.IGNORECASE)
QUOTED_STRING = re.compile(r'"(?:[^"\\]|\\.)*"')


def extract_quoted_strings(line: str) -> List[str]:
    """Return the contents of double-quoted strings, honoring backslash escapes."""
    return [match.group(0)[1:-1] for match in QUOTED_STRING.finditer(line)]


def describe_approved_rewrite(before: str, after: str) -> Optional[str]:
    """Describe an approved `$path\\Folder\\` -> `$global/` change, else None."""
    match = BACKSLASH_PROJECT_PATH.match(before)
    if not match:
        return None

    folder = match.group("folder")
    rest = match.group("rest")
    global_name = next(
        (name for name, target in PROJECT_PATH_GLOBALS.items() if target.lower() == folder.lower()),
        None,
    )
    if global_name is None:
        return None
    if after != f"${global_name}/{rest}":
        return None
    return f"$path\\{folder}\\ -> ${global_name}/"


def validate_path_rewrite(before_line: str, after_line: str) -> List[str]:
    """
    Raise unless `after_line` differs from `before_line` only by approved path
    rewrites. Text outside quoted strings must be identical, quoted strings must
    correspond one for one, and every changed string must keep its filename while
    moving to a project global.
    """
    if before_line == after_line:
        raise ValueError("path rewrite does not change the line")

    if QUOTED_STRING.sub('""', before_line) != QUOTED_STRING.sub('""', after_line):
        raise ValueError("path rewrite changes text outside quoted strings")

    before_strings = extract_quoted_strings(before_line)
    after_strings = extract_quoted_strings(after_line)
    if len(before_strings) != len(after_strings):
        raise ValueError("path rewrite changes the number of quoted strings")

    changes: List[str] = []
    for before_string, after_string in zip(before_strings, after_strings):
        if before_string == after_string:
            continue
        described = describe_approved_rewrite(before_string, after_string)
        if described is None:
            raise ValueError(f"unapproved path change: {before_string!r} -> {after_string!r}")
        changes.append(described)

    if not changes:
        raise ValueError("path rewrite changes no quoted path string")
    return changes


def collect_path_strings(text: str) -> List[str]:
    """Return quoted strings that look like paths, in file order."""
    return [
        match.group(0)[1:-1]
        for match in QUOTED_STRING.finditer(text)
        if "\\" in match.group(0) or "/" in match.group(0)
    ]


def verify_path_integrity(original_text: str, result_text: str) -> Tuple[List[str], List[str]]:
    """
    Compare every path-like quoted string between two files.

    Returns (mappings, problems). A mapping is either an unchanged path or an
    approved rewrite. A problem is anything else, including a renamed file, a
    lost path, or a path that moved somewhere other than a project global.
    """
    before = collect_path_strings(original_text)
    after = collect_path_strings(result_text)
    mappings: List[str] = []
    problems: List[str] = []

    if len(before) != len(after):
        # Length changes make positional pairing meaningless, so report the
        # difference by identity and stop rather than emit spurious mismatches.
        for path in before:
            if path not in after:
                problems.append(
                    f"path removed: {path}  "
                    "(expected when preamble modernization drops a hardcoded root)"
                )
        for path in after:
            if path not in before:
                problems.append(f"path added: {path}")
        if not problems:
            problems.append(f"path count changed: {len(before)} -> {len(after)}")
        return mappings, problems

    for index, (before_path, after_path) in enumerate(zip(before, after), start=1):
        if before_path == after_path:
            mappings.append(f"[{index}] unchanged: {before_path}")
            continue
        described = describe_approved_rewrite(before_path, after_path)
        if described is None:
            problems.append(f"[{index}] unapproved: {before_path} -> {after_path}")
        else:
            mappings.append(f"[{index}] {described}  {before_path} -> {after_path}")

    return mappings, problems


def _validated_range(entry: Dict[str, Any], entry_type: str, line_count: int) -> Tuple[int, int]:
    """Validate and return a zero-indexed inclusive recipe range."""
    start = entry.get("original_start_line")
    end = entry.get("original_end_line", start)
    if type(start) is not int or type(end) is not int:
        raise ValueError(f"{entry_type} requires integer original_start_line/original_end_line")
    if start < 1 or end < start or end > line_count:
        raise ValueError(f"{entry_type} range {start}-{end} is outside 1-{line_count}")
    return start - 1, end - 1


def _require_single_line(value: Any, field: str) -> str:
    """Return a safe one-line recipe string or raise a clear error."""
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    if "\n" in value or "\r" in value:
        raise ValueError(f"{field} must not contain line breaks")
    return value


def validate_recipe_shape(recipe: Dict[str, Any], width: int, enable_preamble: bool, enable_path_rewrites: bool = False) -> None:
    """Validate recipe keys and mode-specific requirements before line checks."""
    if not isinstance(recipe, dict):
        raise ValueError("recipe must be a JSON object")
    if width not in (64, 72):
        raise ValueError("width must be 64 or 72")

    allowed_keys = {"width", "header", "preamble", "banners", "prose_blocks", "path_rewrites"}
    unknown = sorted(set(recipe) - allowed_keys)
    if unknown:
        raise ValueError(f"unknown recipe field(s): {', '.join(unknown)}")

    header = recipe.get("header")
    if header is not None:
        if not isinstance(header, dict):
            raise ValueError("header must be an object")
        allowed_header = {
            "filename", "Purpose", "Author", "Created", "Updated", "Inputs",
            "Outputs", "Notes", "original_start_line", "original_end_line",
        }
        unknown_header = sorted(set(header) - allowed_header)
        if unknown_header:
            raise ValueError(f"unknown header field(s): {', '.join(unknown_header)}")
        has_start = "original_start_line" in header
        has_end = "original_end_line" in header
        if has_start != has_end:
            raise ValueError("header must provide both original_start_line and original_end_line, or neither")
        for field in ("filename", "Purpose", "Author", "Created", "Updated", "Notes"):
            if field in header:
                _require_single_line(header[field], f"header.{field}")
        for field in ("Inputs", "Outputs"):
            if field not in header:
                continue
            values = header[field] if isinstance(header[field], list) else [header[field]]
            for item in values:
                _require_single_line(item, f"header.{field}")

    preamble = recipe.get("preamble")
    if preamble is not None and not enable_preamble:
        raise ValueError("recipe contains preamble but --preamble was not supplied")
    if enable_preamble:
        if not isinstance(preamble, dict):
            raise ValueError("--preamble requires a preamble object in the recipe")
        allowed_preamble = {
            "original_start_line", "original_end_line", "globals_file",
            "legacy_path_alias", "set_more_off", "version",
        }
        unknown_preamble = sorted(set(preamble) - allowed_preamble)
        if unknown_preamble:
            raise ValueError(f"unknown preamble field(s): {', '.join(unknown_preamble)}")
        if "original_start_line" not in preamble or "original_end_line" not in preamble:
            raise ValueError("preamble requires original_start_line and original_end_line")
        globals_file = _require_single_line(preamble.get("globals_file", "project_globals.do"), "preamble.globals_file")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+\.do", globals_file):
            raise ValueError("preamble.globals_file must be a simple .do filename")
        version = preamble.get("version", "17")
        if version not in (None, ""):
            version = _require_single_line(version, "preamble.version")
            if not re.fullmatch(r"\d+(?:\.\d+)?", version):
                raise ValueError("preamble.version must be numeric")
        for field in ("legacy_path_alias", "set_more_off"):
            if field in preamble and type(preamble[field]) is not bool:
                raise ValueError(f"preamble.{field} must be boolean")

    banners = recipe.get("banners", [])
    if not isinstance(banners, list):
        raise ValueError("banners must be an array")
    for index, banner in enumerate(banners, start=1):
        if not isinstance(banner, dict):
            raise ValueError(f"banner[{index}] must be an object")
        allowed_banner = {"level", "number", "title", "original_start_line", "original_end_line"}
        unknown_banner = sorted(set(banner) - allowed_banner)
        if unknown_banner:
            raise ValueError(f"unknown banner[{index}] field(s): {', '.join(unknown_banner)}")
        if type(banner.get("level")) is not int or banner["level"] not in (1, 2):
            raise ValueError(f"banner[{index}] level must be 1 or 2")
        title = _require_single_line(banner.get("title"), f"banner[{index}].title")
        if not title.strip():
            raise ValueError(f"banner[{index}] requires a nonempty title")
        if "number" in banner:
            _require_single_line(banner["number"], f"banner[{index}].number")
        if "original_start_line" not in banner or "original_end_line" not in banner:
            raise ValueError(f"banner[{index}] requires original_start_line and original_end_line")

    prose_blocks = recipe.get("prose_blocks", [])
    if not isinstance(prose_blocks, list):
        raise ValueError("prose_blocks must be an array")
    for index, prose in enumerate(prose_blocks, start=1):
        if not isinstance(prose, dict):
            raise ValueError(f"prose_blocks[{index}] must be an object")
        allowed_prose = {"type", "original_start_line", "original_end_line"}
        unknown_prose = sorted(set(prose) - allowed_prose)
        if unknown_prose:
            raise ValueError(f"unknown prose_blocks[{index}] field(s): {', '.join(unknown_prose)}")
        if prose.get("type", "prose") not in ("prose", "notes_block"):
            raise ValueError(f"prose_blocks[{index}] type must be prose or notes_block")
        if "original_start_line" not in prose or "original_end_line" not in prose:
            raise ValueError(f"prose_blocks[{index}] requires original_start_line and original_end_line")

    path_rewrites = recipe.get("path_rewrites")
    if path_rewrites is not None and not enable_path_rewrites:
        raise ValueError("recipe contains path_rewrites but --allow-path-rewrites was not supplied")
    if path_rewrites is not None:
        if not isinstance(path_rewrites, list) or not path_rewrites:
            raise ValueError("path_rewrites must be a non-empty array")
        for index, entry in enumerate(path_rewrites, start=1):
            if not isinstance(entry, dict):
                raise ValueError(f"path_rewrites[{index}] must be an object")
            allowed_rewrite = {"original_start_line", "before", "after"}
            unknown_rewrite = sorted(set(entry) - allowed_rewrite)
            if unknown_rewrite:
                raise ValueError(f"unknown path_rewrites[{index}] field(s): {', '.join(unknown_rewrite)}")
            for field in ("original_start_line", "before", "after"):
                if field not in entry:
                    raise ValueError(f"path_rewrites[{index}] requires {field}")
            if type(entry["original_start_line"]) is not int:
                raise ValueError(f"path_rewrites[{index}].original_start_line must be an integer")
            _require_single_line(entry["before"], f"path_rewrites[{index}].before")
            _require_single_line(entry["after"], f"path_rewrites[{index}].after")


def validate_recipe(original_text: str, recipe: Dict[str, Any], width: int, enable_preamble: bool, enable_path_rewrites: bool = False) -> None:
    """Reject malformed, overlapping, or active-code-targeting recipe ranges."""
    validate_recipe_shape(recipe, width=width, enable_preamble=enable_preamble, enable_path_rewrites=enable_path_rewrites)
    lines = original_text.splitlines()
    protected = active_line_mask(original_text)
    occupied: Dict[int, str] = {}

    def claim(entry: Dict[str, Any], entry_type: str, allow_active: bool = False) -> Tuple[int, int]:
        start, end = _validated_range(entry, entry_type, len(lines))
        for idx in range(start, end + 1):
            if idx in occupied:
                raise ValueError(
                    f"{entry_type} range {start + 1}-{end + 1} overlaps "
                    f"{occupied[idx]} at line {idx + 1}"
                )
            if protected[idx] and not allow_active:
                raise ValueError(f"{entry_type} range targets active code at line {idx + 1}")
            occupied[idx] = entry_type
        return start, end

    header = recipe.get("header")
    if header and (header.get("original_start_line") is not None or header.get("original_end_line") is not None):
        claim(header, "header")

    preamble = recipe.get("preamble") if enable_preamble else None
    if preamble and "original_start_line" in preamble:
        start, end = claim(preamble, "preamble", allow_active=True)
        if start >= 100 or end - start + 1 > 100:
            raise ValueError("preamble must be confined to the first 100 lines")
        if end >= len(lines) - 1 or not any(protected[end + 1:]):
            raise ValueError("preamble must leave protected active code in the do-file body")
        for idx in range(start, end + 1):
            if not protected[idx]:
                continue
            code_line = lines[idx].strip()
            if not any(pattern.match(code_line) for pattern in PREAMBLE_ACTIVE_LINE_PATTERNS):
                raise ValueError(
                    f"preamble contains unsupported active code at line {idx + 1}: {code_line}"
                )

    for index, banner in enumerate(recipe.get("banners", []), start=1):
        claim(banner, f"banner[{index}]")

    for index, entry in enumerate(recipe.get("path_rewrites", []) if enable_path_rewrites else [], start=1):
        start, _ = claim(entry, f"path_rewrites[{index}]", allow_active=True)
        if lines[start] != entry["before"]:
            raise ValueError(
                f"path_rewrites[{index}] before text does not match line {start + 1}"
            )
        validate_path_rewrite(entry["before"], entry["after"])
    for index, prose in enumerate(recipe.get("prose_blocks", []), start=1):
        claim(prose, f"prose_blocks[{index}]")


def apply_recipe(filepath: str, recipe: Dict[str, Any], width: int = DEFAULT_WIDTH, enable_preamble: bool = False, normalize_paths: bool = False, enable_path_rewrites: bool = False) -> Tuple[List[str], str, str, str]:
    """
    Apply a recipe in memory and compare exact protected active-code lines.

    Standard formatting must preserve every protected line exactly. Preamble
    mode permits only the validated setup range to change and still requires
    the prefix and substantive body to remain exact.
    """
    if normalize_paths:
        raise ValueError(
            "--normalize-paths is a semantic refactor and is no longer supported by stata-house-style"
        )

    with open(filepath, 'r', encoding='utf-8', newline='') as f:
        original_text = f.read()

    validate_recipe(original_text, recipe, width=width, enable_preamble=enable_preamble, enable_path_rewrites=enable_path_rewrites)
    lines = original_text.splitlines()

    preamble_data = recipe.get("preamble") if enable_preamble else None

    edits = []
    preamble_range = None
    new_preamble_lines = []
    applied_path_rewrites: List[Tuple[int, str]] = []

    # 1. Header
    header_data = recipe.get("header")
    if header_data:
        new_header = format_header(header_data, width=width)
        orig_start = header_data.get("original_start_line")
        orig_end = header_data.get("original_end_line")
        if orig_start is not None and orig_end is not None:
            header_start, header_end = _validated_range(header_data, "header", len(lines))
            edits.append({
                "start": header_start,
                "end": header_end,
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
        p_start, p_end = _validated_range(preamble_data, "preamble", len(lines))
        preamble_range = (p_start, p_end)
        new_preamble_lines = format_preamble(
            preamble_data,
            width=width,
            source_lines=lines[p_start:p_end + 1],
        )
        edits.append({
            "start": p_start,
            "end": p_end,
            "replacement": new_preamble_lines,
            "type": "preamble"
        })

    # 3. Banners
    banners = recipe.get("banners", [])
    for index, b in enumerate(banners, start=1):
        new_banner = format_banner(
            level=b.get("level", 1),
            title=b.get("title", ""),
            number=b.get("number"),
            width=width
        )
        banner_start, banner_end = _validated_range(b, f"banner[{index}]", len(lines))
        edits.append({
            "start": banner_start,
            "end": banner_end,
            "replacement": new_banner,
            "type": "banner"
        })

    # 4. Prose Blocks
    prose_blocks = recipe.get("prose_blocks", [])
    for index, p in enumerate(prose_blocks, start=1):
        start_idx, end_idx = _validated_range(p, f"prose_blocks[{index}]", len(lines))
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

    # 5. Enumerated path rewrites. Each entry names one active line and both the
    # exact current text and the exact replacement, so every change is reviewable.
    for index, entry in enumerate(recipe.get("path_rewrites", []) if enable_path_rewrites else [], start=1):
        line_index = entry["original_start_line"] - 1
        edits.append({
            "start": line_index,
            "end": line_index,
            "replacement": [entry["after"]],
            "type": "path_rewrite",
        })
        applied_path_rewrites.append((line_index, entry["after"]))

    # Apply edits from bottom to top to preserve line indices
    edits.sort(key=lambda x: x["start"], reverse=True)

    for edit in edits:
        if edit["type"] == "header_insert":
            lines = edit["replacement"] + [""] + lines
        else:
            lines[edit["start"]:edit["end"] + 1] = edit["replacement"]
            if edit["type"] == "prose" and edit["replacement"]:
                comment_start = edit["start"]
                while comment_start > 0 and lines[comment_start - 1] == "":
                    del lines[comment_start - 1]
                    comment_start -= 1
                if comment_start > 0:
                    prior_mask = active_line_mask("\n".join(lines[:comment_start]))
                    if prior_mask and prior_mask[-1]:
                        lines.insert(comment_start, "")
                        comment_start += 1

                after = comment_start + len(edit["replacement"])
                while after < len(lines) and lines[after] == "":
                    del lines[after]
                if edit["replacement"][0] == "/*" and after < len(lines):
                    lines.insert(after, "")

    # Normalize vertical spacing. Active physical lines are preserved exactly.
    formatted_lines = normalize_vertical_spacing(lines, width=width)
    formatted_text = "\n".join(formatted_lines)

    # Build the only permitted active-code result, then compare exact protected
    # physical lines. Comment-only edits and blank-line changes disappear from
    # this projection; active line boundaries, whitespace, comments, and `///`
    # remain protected.
    # Reconstruct the only permitted result: the original file with declared
    # preamble and path exceptions applied, in that order of indexing.
    expected_lines = original_text.splitlines()
    hash_mode = "exact-active-lines"
    for line_index, after_line in applied_path_rewrites:
        expected_lines[line_index] = after_line
    if applied_path_rewrites:
        hash_mode = "exact-active-lines-with-enumerated-path-exceptions"
    if preamble_range:
        expected_lines = (
            expected_lines[:preamble_range[0]]
            + new_preamble_lines
            + expected_lines[preamble_range[1] + 1:]
        )
        hash_mode = (
            "exact-body-with-preamble-and-path-exceptions"
            if applied_path_rewrites
            else "exact-body-with-preamble-exception"
        )
    expected_text = "\n".join(expected_lines)

    hash_before = compute_code_hash(expected_text)
    hash_after = compute_code_hash(formatted_text)

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
    parser.add_argument("--normalize-paths", action="store_true", help="Deprecated: rejected because path rewriting is outside house-style scope")
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH, help=f"Target column width (default: {DEFAULT_WIDTH})")
    parser.add_argument("--verify", help="Verify that FILE and VERIFY have identical protected active-code lines")
    parser.add_argument("--allow-path-rewrites", action="store_true", help="Enable enumerated path rewrites from the recipe")
    parser.add_argument("--verify-paths", help="Verify that FILE and VERIFY-PATHS kept filenames and only moved paths to project globals")

    args = parser.parse_args()

    if args.verify:
        with open(args.file, 'r', encoding='utf-8', newline='') as f1, open(args.verify, 'r', encoding='utf-8', newline='') as f2:
            h1 = compute_code_hash(f1.read())
            h2 = compute_code_hash(f2.read())
        if h1 == h2:
            print(f"VERIFIED: Exact protected active-code lines match ({h1}).")
            sys.exit(0)
        else:
            print(f"FAILED: Hash mismatch!\nFile 1: {h1}\nFile 2: {h2}")
            sys.exit(1)

    if args.verify_paths:
        with open(args.file, 'r', encoding='utf-8', newline='') as handle:
            original_text = handle.read()
        with open(args.verify_paths, 'r', encoding='utf-8', newline='') as handle:
            result_text = handle.read()
        mappings, problems = verify_path_integrity(original_text, result_text)
        for mapping in mappings:
            print(mapping)
        for problem in problems:
            print(f"PROBLEM: {problem}", file=sys.stderr)
        if problems:
            print(f"\nPATH CHECK FAILED: {len(problems)} problem(s).", file=sys.stderr)
            sys.exit(1)
        print(f"\nPATH CHECK PASSED: {len(mappings)} path reference(s) verified.")
        sys.exit(0)

    if args.scan:
        scan_data = scan_dofile(args.file)
        print(json.dumps(scan_data, indent=2))
        sys.exit(0)

    if not args.recipe:
        parser.error("A recipe JSON file is required unless running with --scan or --verify")

    with open(args.recipe, 'r', encoding='utf-8') as f:
        recipe = json.load(f)

    target_width = recipe.get("width", args.width)
    try:
        formatted_lines, hash_before, hash_after, hash_mode = apply_recipe(
            args.file,
            recipe,
            width=target_width,
            enable_preamble=args.preamble,
            normalize_paths=args.normalize_paths,
            enable_path_rewrites=args.allow_path_rewrites
        )
    except ValueError as error:
        print(f"CRITICAL ERROR: {error}", file=sys.stderr)
        sys.exit(1)

    # Invariant check
    if hash_before != hash_after:
        print(f"CRITICAL ERROR: Protected active-code line hash mismatch ({hash_mode})!", file=sys.stderr)
        print(f"  Before: {hash_before}", file=sys.stderr)
        print(f"  After:  {hash_after}", file=sys.stderr)
        print(f"The recipe attempted to modify active code outside permitted boundaries ({hash_mode}). Operation aborted.", file=sys.stderr)
        sys.exit(1)

    # Active-line edits are reviewed when the recipe is written. This check is
    # opt-in and off by default so /auto can run unattended.
    if not args.diff:
        try:
            require_escalation(recipe, args.preamble, args.allow_path_rewrites)
        except ValueError as error:
            print(f"CONFIRMATION REQUIRED: {error}", file=sys.stderr)
            sys.exit(2)

    with open(args.file, 'r', encoding='utf-8', newline='') as f:
        original_text = f.read()
    original_lines = original_text.splitlines(keepends=True)
    newline = detect_newline(original_text)

    new_content = newline.join(formatted_lines)
    if not new_content.endswith(newline):
        new_content += newline

    if args.diff:
        # Derive the diff from the exact bytes that would be written. Building it
        # from formatted_lines instead would misreport a trailing empty element
        # as an added blank line at end of file.
        diff = difflib.unified_diff(
            original_lines,
            new_content.splitlines(keepends=True),
            fromfile=f"a/{os.path.basename(args.file)}",
            tofile=f"b/{os.path.basename(args.file)}"
        )
        sys.stdout.writelines(diff)
        print(f"\n[Invariant Verified: sha256 protected active lines ({hash_mode}) = {hash_before}]")
        sys.exit(0)

    atomic_write_text(args.file, new_content)

    print(f"Successfully styled {args.file} (exact active-line invariant passed [{hash_mode}]: {hash_before[:12]}...)")


if __name__ == "__main__":
    main()
