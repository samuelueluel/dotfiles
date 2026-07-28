#!/usr/bin/env python3
import json
import sys
import re
import hashlib
import textwrap

W = 64

def get_active_code_hash(lines):
    """
    Extracts all active command lines, strips comments and whitespace,
    and returns a hash. This guarantees we don't accidentally modify code.
    """
    active_lines = []
    in_block_comment = False
    
    for line in lines:
        line = line.strip()
        
        # Handle block comments
        if '/*' in line and '*/' in line:
            # Inline comment, remove it for hash
            line = re.sub(r'/\*.*?\*/', '', line).strip()
        elif '/*' in line:
            in_block_comment = True
            line = line.split('/*')[0].strip()
        elif '*/' in line:
            in_block_comment = False
            line = line.split('*/')[1].strip()
            
        if in_block_comment:
            continue
            
        # Handle line comments
        if line.startswith('*'):
            continue
        if '//' in line:
            line = line.split('//')[0].strip()
            
        # Collapse internal whitespace to single space
        line = re.sub(r'\s+', ' ', line).strip()
        
        if line:
            active_lines.append(line)
            
    return hashlib.sha256('\n'.join(active_lines).encode('utf-8')).hexdigest()

def wrap_prose(text, indent=3):
    """Wraps regular step comment prose to fit within 64 columns."""
    text = re.sub(r'^\s*/\*\s*|\s*\*/\s*$', '', text)
    text = re.sub(r'^\s*\*\s*', '', text, flags=re.MULTILINE)
    text = text.replace('\n', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    
    wrapped = textwrap.wrap(text, width=W - indent - 4) # 4 for '/* ' and ' */'
    
    if not wrapped:
        return ["/*" + " " * (W - 4) + "*/"]
        
    out = []
    out.append("/* " + wrapped[0])
    for line in wrapped[1:]:
        out.append(" " * indent + line)
        
    # Pad the last line so */ hits column 64
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
            indent_len = 5 # 3 spaces + "> "
            prefix = "   > "
            sub_indent = "     "
        else:
            indent_len = 7 # 5 spaces + "- "
            prefix = "     - "
            sub_indent = "       "
            
        # The true max width textwrap can use without pushing */ past 64 on the last line
        # is W - indent_len - 2. But we only need room for */ on the very last line of the block.
        # To be safe and simple, we wrap to W - indent_len - 2.
        wrapped = textwrap.wrap(b['text'], width=W - indent_len - 2)
        if not wrapped:
            out.append(prefix)
            continue
            
        out.append(prefix + wrapped[0])
        for w in wrapped[1:]:
            out.append(sub_indent + w)
            
    if len(out) == 1 and not title:
        out[0] = "/* Notes:"
        
    # Pad last line to exactly W
    last_line = out[-1]
    padding = W - len(last_line) - 2
    if padding < 0: padding = 0
    out[-1] = last_line + " " * padding + "*/"
    return out

def format_banner(level, title):
    char = "=" if level == 1 else "-"
    out = []
    out.append("* " + char * (W - 2))
    if level == 1:
        out.append(f"* [{title.upper()}]") 
    else:
        out.append(f"* [{title}]")
    out.append("* " + char * (W - 2))
    return out

def generate_header(hdata):
    out = []
    out.append("* " + "=" * (W - 2))
    if "filename" in hdata:
        out.append(f"* {hdata['filename']}")
        out.append("*")
        
    fields = ["Purpose", "Author", "Created", "Updated", "Inputs", "Outputs"]
    for f in fields:
        if f in hdata and hdata[f]:
            val = hdata[f]
            label = f.ljust(7)
            prefix = f"* {label} : "
            
            wrapped = textwrap.wrap(val, width=W - 12)
            if not wrapped:
                continue
            out.append(prefix + wrapped[0])
            for wline in wrapped[1:]:
                out.append("* " + " " * 10 + wline)
                
    out.append("* " + "=" * (W - 2))
    return out

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
            new_lines = format_banner(mod['data']['level'], mod['data']['title'])
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
        # Normalize line-trailing /* note */ -> // note
        if '/*' in lines[i] and lines[i].rstrip().endswith('*/'):
            parts = lines[i].rsplit('/*', 1)
            if parts[0].strip():
                note = parts[1].replace('*/', '').strip()
                lines[i] = parts[0].rstrip() + "  // " + note
                
        # Globally enforce */ alignment for ANY line ending in */ that isn't too long
        elif lines[i].rstrip().endswith('*/'):
            stripped = lines[i].rstrip()[:-2].rstrip()
            if len(stripped) < W - 2:
                lines[i] = stripped + " " * (W - len(stripped) - 2) + "*/"

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
    if len(sys.argv) != 3:
        print("Usage: stata_style_apply.py <file.do> <recipe.json>")
        sys.exit(1)
        
    do_file = sys.argv[1]
    recipe_file = sys.argv[2]
    
    with open(do_file, 'r') as f:
        lines = f.read().splitlines()
        
    with open(recipe_file, 'r') as f:
        recipe = json.load(f)
        
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
