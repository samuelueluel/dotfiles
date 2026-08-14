#!/usr/bin/env python3
import json
import sys
import re
import hashlib
import textwrap

W = 64

BORDER_RE = re.compile(r'^\s*/?\*{4,}/?\s*$')
DASH_BOX_RE = re.compile(r'^\s*\*\s*[-=]{6,}\s*$')

STOPWORDS = set("""
a an the this that these those it its is was were be been being are am
and or but if then else so as of to in on at by for with without from
into onto over under above below between among not no nor do does did
i we you they he she it's i'm im ive youve theyve dont doesnt didnt
note notes here there now also just very more most some such only own
same than too can will would should could may might must shall
which who whom whose what when where why how all any both each few
other some such nor not only own same so than too very s t don should
now also -- --- --- etc eg ie
""".split())


def get_active_code_hash(lines):
    """
    Extracts all active command lines, strips comments and whitespace,
    and returns a hash. This guarantees we don't accidentally modify code.
    Supports arbitrarily nested /* */ blocks.
    """
    code_string = '\n'.join(lines)
    clean_chars = []

    depth = 0
    i = 0
    while i < len(code_string):
        if code_string[i:i+2] == '/*':
            depth += 1
            i += 2
        elif code_string[i:i+2] == '*/' and depth > 0:
            depth -= 1
            i += 2
        else:
            if depth == 0:
                clean_chars.append(code_string[i])
            i += 1

    active_lines = []
    for line in ''.join(clean_chars).split('\n'):
        line = line.strip()
        if line.startswith('*'):
            continue
        if '//' in line:
            line = line.split('//')[0].strip()

        line = re.sub(r'\s+', ' ', line).strip()
        if line:
            active_lines.append(line)

    return hashlib.sha256('\n'.join(active_lines).encode('utf-8')).hexdigest()


# ---------------------------------------------------------------------------
# SCAN MODE: deterministically enumerate comment regions with exact line
# numbers, so the LLM Architect never has to hand-count lines. This is the
# fix for the "Architect mis-drew banner line ranges" bug class.
# ---------------------------------------------------------------------------

def _line_residual(line, start_depth):
    """
    Walks one line's characters given the /* */ nesting depth carried in
    from previous lines. Swallows (a) any text inside a /* ... */ span
    regardless of whether it opens/closes on this line or is inherited
    open from a previous line, (b) a leading '*' Stata line-comment marker
    (only when it is the first non-blank char AND not the start of a '*/'
    close) through end of line, and (c) a depth-0 trailing '//' comment
    through end of line. Returns (residual_code_text, end_depth).

    A line whose residual (after stripping) is empty is a PURE comment
    line -- whether that's a one-line label, a border line, an interior
    line of a still-open multi-line block, or a disabled '*command' line.
    A line with non-empty residual is an active code line (which may
    still carry a trailing note that got swallowed above).
    """
    depth = start_depth
    residual = []
    i = 0
    n = len(line)
    while i < n:
        if depth == 0 and line[i] == '*' and line[:i].strip() == '' and line[i:i+2] != '*/':
            i = n
            continue
        if depth == 0 and line[i:i+2] == '//':
            i = n
            continue
        if line[i:i+2] == '/*':
            depth += 1
            i += 2
            continue
        if line[i:i+2] == '*/' and depth > 0:
            depth -= 1
            i += 2
            continue
        if depth == 0:
            residual.append(line[i])
        i += 1
    return ''.join(residual).strip(), depth


def classify_lines(lines):
    """
    Per-line classification driving region grouping. Each line is tagged
    with exactly one of:
      'blank'          - whitespace only
      'block_open'     - opens a /* that does NOT close on the same line
                          (first line of a genuine multi-line /* */ block)
      'block_interior' - continuation of an already-open multi-line block
                          (may itself close the block; still tagged this
                          way -- callers use end_depth to find the close)
      'self_block'     - a /* ... */ comment that opens AND closes on this
                          same line, with nothing else active on the line
      'self_star'      - a bare Stata '*' line comment (depth 0)
      'code'           - active code (possibly with a trailing // or /* */
                          note)
    Also returns start_depth/end_depth per line so callers can find exact
    block boundaries without re-deriving them.
    """
    depth = 0
    info = []
    for line in lines:
        start_depth = depth
        if line.strip() == '':
            info.append({'class': 'blank', 'start_depth': start_depth, 'end_depth': depth})
            continue
        residual, end_depth = _line_residual(line, depth)
        if start_depth > 0:
            cls = 'block_interior'
        elif end_depth > 0:
            cls = 'block_open'
        elif residual == '':
            cls = 'self_block' if line.strip().startswith('/*') else 'self_star'
        else:
            cls = 'code'
        info.append({'class': cls, 'start_depth': start_depth, 'end_depth': end_depth})
        depth = end_depth
    return info


def scan_regions(lines):
    """
    Walks the file and returns a list of candidate comment regions:
      { start, end (1-indexed, inclusive), kind, has_border, text }
    kind in: 'header_candidate', 'box_comment_candidate', 'block_comment',
             'line_comment', 'nested_comment_line', 'trailing_note'

    This performs NO judgment about label-vs-prose-vs-banner -- that is left
    to the Architect. It only establishes ground-truth line boundaries.

    Grouping rule (important -- this is what the earlier buggy version got
    wrong): a genuine multi-line /* ... */ block (block_open ->
    block_interior* -> close) is ALWAYS its own atomic region and is NEVER
    merged with an adjacent comment of a different kind, even if there is
    no blank line between them. Likewise a run of consecutive self-
    contained one-line comments (all 'self_block' or all 'self_star', not
    mixed) forms its own atomic region, bounded by any blank line, code
    line, or *mechanism change*. This prevents e.g. a 3-line banner box
    from being fused with an immediately-following disabled `/* ... */`
    code block into one giant region.
    """
    n = len(lines)
    info = classify_lines(lines)
    groups = []  # (start_idx, end_idx, group_type)
    i = 0
    while i < n:
        c = info[i]['class']
        if c in ('blank', 'code'):
            i += 1
            continue
        if c == 'block_open':
            j = i
            while info[j]['end_depth'] > 0:
                j += 1
            groups.append((i, j, 'block'))
            i = j + 1
            continue
        if c in ('self_block', 'self_star'):
            j = i
            while j + 1 < n and info[j + 1]['class'] == c:
                j += 1
            groups.append((i, j, c))
            i = j + 1
            continue
        i += 1

    is_header = bool(groups) and all(lines[k].strip() == '' for k in range(0, groups[0][0]))

    regions = []
    for idx, (s, e, gtype) in enumerate(groups):
        region_lines = lines[s:e + 1]
        first_l = region_lines[0].strip()
        last_l = region_lines[-1].strip()
        has_border = bool(BORDER_RE.match(first_l) or DASH_BOX_RE.match(first_l)) and \
                     bool(BORDER_RE.match(last_l) or DASH_BOX_RE.match(last_l))
        span = e - s + 1

        if idx == 0 and is_header:
            kind = 'header_candidate'
        elif gtype in ('self_block', 'self_star') and has_border and span >= 3:
            kind = 'box_comment_candidate'
        elif span == 1:
            kind = 'line_comment'
        else:
            kind = 'block_comment'

        regions.append({
            'start': s + 1,
            'end': e + 1,
            'kind': kind,
            'has_border': has_border,
            'text': '\n'.join(region_lines),
        })

        if span <= 1:
            continue

        if gtype in ('self_block', 'self_star'):
            # Every line in a self-contained run is independently a
            # complete one-line comment -- safe to expose all of them
            # individually, except pure decorative border lines.
            for k in range(s, e + 1):
                stripped = lines[k].strip()
                if BORDER_RE.match(stripped) or DASH_BOX_RE.match(stripped):
                    continue
                regions.append({
                    'start': k + 1,
                    'end': k + 1,
                    'kind': 'nested_comment_line',
                    'has_border': False,
                    'text': lines[k],
                })
        else:
            # gtype == 'block': a genuine multi-line /* ... */ region.
            # Only interior lines that themselves start with a bare '*'
            # are safe to expose individually (Crucial Rule 2) -- these
            # are comments-about-the-disabled-code. Lines with no leading
            # '*' inside a block may be disabled CODE or unmarked prose
            # continuation and must NOT be individually targetable; the
            # Architect may only act on those by claiming the whole
            # block region as one prose_block if 100% sure it is pure
            # prose with zero code inside.
            for k in range(s + 1, e):
                stripped = lines[k].strip()
                if stripped.startswith('*') and not stripped.startswith('/*') \
                   and not BORDER_RE.match(stripped) and not DASH_BOX_RE.match(stripped):
                    regions.append({
                        'start': k + 1,
                        'end': k + 1,
                        'kind': 'nested_comment_line',
                        'has_border': False,
                        'text': lines[k],
                    })

    # ---- active code lines carrying a trailing note (informational only) ----
    for i in range(n):
        if info[i]['class'] == 'code':
            line = lines[i]
            if '//' in line or ('/*' in line and line.rstrip().endswith('*/')):
                regions.append({
                    'start': i + 1,
                    'end': i + 1,
                    'kind': 'trailing_note',
                    'has_border': False,
                    'text': line,
                })

    regions.sort(key=lambda r: (r['start'], -r['end']))
    return regions


# ---------------------------------------------------------------------------
# Prose / banner / header rendering (unchanged formatting logic)
# ---------------------------------------------------------------------------

def wrap_prose(text, indent=3):
    """Wraps regular step comment prose to fit within 64 columns."""
    text = re.sub(r'^\s*/\*\s*|\s*\*/\s*$', '', text)
    text = re.sub(r'^\s*\*\s*', '', text, flags=re.MULTILINE)
    text = text.replace('\n', ' ')
    text = re.sub(r'\s+', ' ', text).strip()

    wrapped = textwrap.wrap(text, width=W - indent - 4, break_long_words=False, break_on_hyphens=False)

    if not wrapped:
        return ["/*" + " " * (W - 4) + "*/"]

    out = []
    out.append("/* " + wrapped[0])
    for line in wrapped[1:]:
        out.append(" " * indent + line)

    last_line = out[-1]
    padding = W - len(last_line) - 2
    out[-1] = last_line + " " * padding + "*/"
    return out


def wrap_notes(text):
    """Wraps Notes blocks while preserving bullets (> and -)."""
    text = re.sub(r'^\s*/\*\s*Notes:?\s*|^\s*/\*\s*|\s*\*/\s*$', '', text)
    text = re.sub(r'^\s*\*\s*', '', text, flags=re.MULTILINE)

    lines = [l.strip() for l in text.split('\n') if l.strip()]
    out = []

    title = ""
    if lines and not (lines[0].startswith('>') or lines[0].startswith('-')):
        title = " " + lines[0]
        lines = lines[1:]

    out.append(f"/* Notes:{title}")

    bullets = []
    current_bullet = None
    for line in lines:
        if line.startswith('>'):
            if current_bullet: bullets.append(current_bullet)
            current_bullet = {'type': '>', 'text': line[1:].strip()}
        elif line.startswith('-'):
            if current_bullet: bullets.append(current_bullet)
            current_bullet = {'type': '-', 'text': line[1:].strip()}
        else:
            if current_bullet:
                current_bullet['text'] += " " + line
            else:
                current_bullet = {'type': '>', 'text': line}
    if current_bullet:
        bullets.append(current_bullet)

    for b in bullets:
        if b['type'] == '>':
            indent_len = 5
            prefix = "   > "
            sub_indent = "     "
        else:
            indent_len = 7
            prefix = "     - "
            sub_indent = "       "

        wrapped = textwrap.wrap(b['text'], width=W - indent_len - 2, break_long_words=False, break_on_hyphens=False)
        if not wrapped:
            out.append(prefix)
            continue

        out.append(prefix + wrapped[0])
        for w in wrapped[1:]:
            out.append(sub_indent + w)

    if len(out) == 1 and not title:
        out[0] = "/* Notes:"

    last_line = out[-1]
    padding = W - len(last_line) - 2
    if padding < 0: padding = 0
    out[-1] = last_line + " " * padding + "*/"
    return out


def format_banner(level, title, number=None):
    char = "=" if level == 1 else "-"
    out = []
    out.append("* " + char * (W - 2))

    if number:
        title_str = f"[{number}] {title}"
    else:
        title_str = f"[{title}]"

    if level == 1:
        out.append(f"* {title_str.upper()}")
    else:
        out.append(f"* {title_str}")
    out.append("* " + char * (W - 2))
    return out


def generate_header(hdata):
    out = []
    out.append("* " + "=" * (W - 2))
    if "filename" in hdata:
        out.append(f"* {hdata['filename']}")
        out.append("*")

    fields = ["Purpose", "Author", "Created", "Updated", "Inputs", "Outputs", "Notes"]
    for f in fields:
        if f in hdata and hdata[f]:
            val = hdata[f]
            label = f.ljust(7)
            prefix = f"* {label} : "

            wrapped = textwrap.wrap(val, width=W - 12, break_long_words=False, break_on_hyphens=False)
            if not wrapped:
                continue
            out.append(prefix + wrapped[0])
            for wline in wrapped[1:]:
                out.append("* " + " " * 10 + wline)

    out.append("* " + "=" * (W - 2))
    return out


# ---------------------------------------------------------------------------
# Validation guardrails -- these run BEFORE any edits are applied and abort
# the whole recipe with a clear, actionable error if violated. Philosophy:
# never trust the Architect's judgment about mechanical facts (line spans,
# content preservation) -- verify them deterministically.
# ---------------------------------------------------------------------------

class RecipeValidationError(Exception):
    pass


def validate_banners(lines, recipe):
    """
    A banner may only replace a source region that was ALREADY a multi-line
    box comment (border line of repeated '*' or '-'/'=', a title line,
    another border line -- 3+ physical lines). This prevents an LLM
    Architect from promoting short one-line labels like '/* Preamble */' or
    '/* Export as csv */' into boxed banners, which is not house style.
    """
    for b in recipe.get('banners', []):
        start = b['original_start_line'] - 1
        end = b.get('original_end_line', b['original_start_line']) - 1
        span = end - start + 1
        if span < 3:
            raise RecipeValidationError(
                f"Banner at original_start_line={b['original_start_line']} "
                f"only spans {span} line(s). Banners must replace an "
                f"existing 3+ line box comment (border/title/border). "
                f"This looks like a one-line label comment being "
                f"incorrectly promoted to a boxed banner -- remove it from "
                f"the recipe and leave the original comment untouched. "
                f"Run --scan to get correct region boundaries."
            )
        region = lines[start:end+1]
        has_border = any(
            BORDER_RE.match(l.strip()) or DASH_BOX_RE.match(l.strip())
            for l in [region[0], region[-1]]
        )
        if not has_border:
            raise RecipeValidationError(
                f"Banner at original_start_line={b['original_start_line']} "
                f"(lines {b['original_start_line']}-{b.get('original_end_line', b['original_start_line'])}) "
                f"does not have a recognizable box-comment border on its "
                f"first/last line in the ORIGINAL file. Only promote "
                f"comments that were already formatted as multi-line boxes. "
                f"Plain labels must be left untouched."
            )


def _significant_tokens(text):
    text = re.sub(r'^\s*/?\*+|\*+/?\s*$', '', text, flags=re.MULTILINE)
    words = re.findall(r"[A-Za-z][A-Za-z'\-]{4,}", text)
    return {w.lower() for w in words if w.lower() not in STOPWORDS}


def validate_header_content(lines, recipe):
    """
    Content-preservation guardrail. Regenerating a header from scratch
    (Purpose/Author/etc. fields) can silently DROP substantive prose that
    lived in the old free-form header comment (e.g. caveats, warnings,
    open questions the researcher left themselves). This mechanically
    checks that every "significant" word (len>=5, non-stopword) from the
    ORIGINAL header region still appears somewhere in the NEW header text.
    If something would be dropped, abort and tell the Architect to carry
    it forward explicitly via the header's "Notes" field.
    """
    header = recipe.get('header')
    if not header or header.get('action') != 'create_or_update':
        return
    if 'original_start_line' not in header:
        return  # pure insert, nothing old to preserve

    start = header['original_start_line'] - 1
    end = header['original_end_line'] - 1
    old_text = '\n'.join(lines[start:end+1])
    old_tokens = _significant_tokens(old_text)

    new_text_parts = [str(header.get(f, '')) for f in
                       ['filename', 'Purpose', 'Author', 'Created', 'Updated',
                        'Inputs', 'Outputs', 'Notes']]
    new_tokens = _significant_tokens(' '.join(new_text_parts))

    missing = sorted(old_tokens - new_tokens)
    # allow a small amount of drift (e.g. one incidental word) but not
    # wholesale loss of substantive content
    if len(missing) >= 3:
        raise RecipeValidationError(
            "Header replacement would silently drop substantive words from "
            "the ORIGINAL header comment that do not appear anywhere in the "
            "new header (Purpose/Author/.../Notes fields). Missing words: "
            f"{', '.join(missing[:20])}"
            + (" ..." if len(missing) > 20 else "") +
            ". If this old content is still relevant, carry it forward "
            "verbatim (or lightly condensed) in the header's 'Notes' field. "
            "If it is genuinely obsolete, that is a judgment call for "
            "Samuel -- ask him rather than silently dropping it."
        )


def validate_no_overlaps(recipe):
    spans = []
    for b in recipe.get('banners', []):
        spans.append((b['original_start_line'], b.get('original_end_line', b['original_start_line']), 'banner'))
    for p in recipe.get('prose_blocks', []):
        spans.append((p['original_start_line'], p.get('original_end_line', p['original_start_line']), 'prose_block'))
    header = recipe.get('header')
    if header and header.get('action') == 'create_or_update' and 'original_start_line' in header:
        spans.append((header['original_start_line'], header['original_end_line'], 'header'))

    spans.sort()
    for i in range(1, len(spans)):
        prev = spans[i-1]
        cur = spans[i]
        if cur[0] <= prev[1]:
            raise RecipeValidationError(
                f"Overlapping recipe regions: {prev[2]} lines {prev[0]}-{prev[1]} "
                f"and {cur[2]} lines {cur[0]}-{cur[1]}. Each original line may "
                f"be targeted by at most one recipe entry."
            )


# ---------------------------------------------------------------------------
# Apply recipe
# ---------------------------------------------------------------------------

def apply_recipe(lines, recipe):
    mods = []

    if 'banners' in recipe:
        for b in recipe['banners']:
            mods.append({
                'start': b['original_start_line'] - 1,
                'end': b.get('original_end_line', b['original_start_line']) - 1,
                'type': 'banner',
                'data': b
            })

    if 'prose_blocks' in recipe:
        for p in recipe['prose_blocks']:
            mods.append({
                'start': p['original_start_line'] - 1,
                'end': p.get('original_end_line', p['original_start_line']) - 1,
                'type': p.get('type', 'step_comment'),
                'data': p
            })

    if 'header' in recipe and recipe['header'].get('action') == 'create_or_update':
        if 'original_start_line' in recipe['header']:
            mods.append({
                'start': recipe['header']['original_start_line'] - 1,
                'end': recipe['header']['original_end_line'] - 1,
                'type': 'header_replace',
                'data': recipe['header']
            })
        else:
            mods.append({
                'start': 0,
                'end': -1,
                'type': 'header_insert',
                'data': recipe['header']
            })

    mods.sort(key=lambda x: x['start'], reverse=True)

    for mod in mods:
        if mod['type'] == 'banner':
            new_lines = format_banner(mod['data']['level'], mod['data']['title'], mod['data'].get('number'))
            lines[mod['start']:mod['end']+1] = new_lines
        elif mod['type'] == 'step_comment':
            raw_text = "\n".join(lines[mod['start']:mod['end']+1])
            new_lines = wrap_prose(raw_text)
            lines[mod['start']:mod['end']+1] = new_lines
        elif mod['type'] == 'notes_block':
            raw_text = "\n".join(lines[mod['start']:mod['end']+1])
            new_lines = wrap_notes(raw_text)
            lines[mod['start']:mod['end']+1] = new_lines
        elif mod['type'] == 'header_replace':
            new_lines = generate_header(mod['data'])
            lines[mod['start']:mod['end']+1] = new_lines
        elif mod['type'] == 'header_insert':
            new_lines = generate_header(mod['data'])
            lines = new_lines + [""] + lines

    return lines


def enforce_spacing(lines):
    for i in range(len(lines)):
        if '/*' in lines[i] and lines[i].rstrip().endswith('*/'):
            parts = lines[i].rsplit('/*', 1)
            if parts[0].strip():
                note = parts[1].replace('*/', '').strip()
                lines[i] = parts[0].rstrip() + "  // " + note

        if lines[i].rstrip().endswith('*/'):
            stripped = lines[i].rstrip()[:-2].rstrip()
            if len(stripped) > 0 and len(stripped) < W - 2:
                lines[i] = stripped + " " * (W - len(stripped) - 2) + "*/"
            elif len(stripped) == 0:
                lines[i] = "*/"

    out = []
    blanks = 0
    for line in lines:
        if not line.strip():
            blanks += 1
            if blanks <= 2:
                out.append("")
        else:
            blanks = 0
            out.append(line.rstrip())

    if out and out[-1] != "":
        out.append("")

    return out


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == '--scan':
        if len(sys.argv) != 3:
            print("Usage: stata_style_apply.py --scan <file.do>")
            sys.exit(1)
        with open(sys.argv[2], 'r') as f:
            lines = f.read().splitlines()
        regions = scan_regions(lines)
        print(json.dumps(regions, indent=2))
        return

    if len(sys.argv) != 3:
        print("Usage: stata_style_apply.py <file.do> <recipe.json>")
        print("       stata_style_apply.py --scan <file.do>")
        sys.exit(1)

    do_file = sys.argv[1]
    recipe_file = sys.argv[2]

    with open(do_file, 'r') as f:
        lines = f.read().splitlines()

    with open(recipe_file, 'r') as f:
        recipe = json.load(f)

    try:
        validate_no_overlaps(recipe)
        validate_banners(lines, recipe)
        validate_header_content(lines, recipe)
    except RecipeValidationError as e:
        print(f"ERROR: Recipe rejected by validation.\n{e}")
        sys.exit(1)

    hash_before = get_active_code_hash(lines)

    new_lines = apply_recipe(list(lines), recipe)
    new_lines = enforce_spacing(new_lines)

    hash_after = get_active_code_hash(new_lines)

    if hash_before != hash_after:
        print(f"ERROR: Active code hash mismatch!\nBefore: {hash_before}\nAfter:  {hash_after}")
        print("The recipe attempted to modify active code. Aborting.")
        sys.exit(1)

    with open(do_file, 'w') as f:
        f.write('\n'.join(new_lines) + '\n')

    print(f"Successfully formatted {do_file}")


if __name__ == "__main__":
    main()
