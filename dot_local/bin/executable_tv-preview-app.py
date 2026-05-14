#!/usr/bin/python3
import os
import sys
import subprocess
import gi
import re
import textwrap

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk

def get_icon_path(icon_name, size=128):
    icon_theme = Gtk.IconTheme.get_default()
    icon_info = icon_theme.lookup_icon(icon_name, size, 0)
    if icon_info:
        return icon_info.get_filename()
    return None

def parse_desktop_file(filepath):
    details = {}
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            in_desktop_entry = False
            for line in f:
                line = line.strip()
                if line == "[Desktop Entry]":
                    in_desktop_entry = True
                elif line.startswith("["):
                    in_desktop_entry = False
                elif in_desktop_entry and "=" in line:
                    key, value = line.split("=", 1)
                    details[key] = value
    except Exception:
        pass
    return details

def main():
    if len(sys.argv) < 2:
        return

    input_str = sys.argv[1]
    if ";" not in input_str:
        return

    name, desktop_path = input_str.split(";", 1)
    if not os.path.exists(desktop_path):
        return

    details = parse_desktop_file(desktop_path)
    icon_name = details.get("Icon")
    
    icon_lines = []
    if icon_name:
        icon_path = icon_name if os.path.isabs(icon_name) else get_icon_path(icon_name)
        if icon_path and os.path.exists(icon_path):
            try:
                # Even smaller: 12x6
                cmd = ["chafa", "--probe", "off", "--format", "symbols", "--symbols", "half", "--size", "12x6", icon_path]
                res = subprocess.run(cmd, capture_output=True, text=True)
                output = re.sub(r'\x1b\[\?[0-9]*[hl]', '', res.stdout)
                icon_lines = output.splitlines()
            except Exception:
                pass

    # Layout dimensions
    try:
        term_width = os.get_terminal_size().columns
        preview_width = (term_width // 2) - 4
    except Exception:
        preview_width = 40

    icon_w = 0
    if icon_lines:
        def real_len(s): return len(re.sub(r'\x1b\[[0-9;]*m', '', s))
        icon_w = max(real_len(l) for l in icon_lines)
    
    # Text area width next to icon
    text_w = preview_width - icon_w - 2
    
    # Prepare Name and Comment for side-by-side
    app_name = details.get('Name', name)
    generic = details.get('GenericName')
    comment = details.get('Comment', '')
    
    details_lines = [f"\033[1;32m{l}\033[0m" for l in textwrap.wrap(app_name, width=text_w)]
    if generic:
        details_lines += [f"\033[1;37m{l}\033[0m" for l in textwrap.wrap(generic, width=text_w)]
    
    # Add a bit of the comment if there's room
    if comment and (not generic or comment.lower() != generic.lower()):
        details_lines += [f"\033[36m{l}\033[0m" for l in textwrap.wrap(comment, width=text_w)[:2]]

    # Print Side-by-Side section
    max_lines = max(len(icon_lines), len(details_lines))
    for i in range(max_lines):
        icon_part = icon_lines[i] if i < len(icon_lines) else " " * icon_w
        text_part = details_lines[i] if i < len(details_lines) else ""
        print(f"{icon_part}  {text_part}")

    print("\033[1;30m" + "-" * preview_width + "\033[0m")
    
    # Wrap helper for bottom details
    def print_wrapped(text, prefix=""):
        wrapped = textwrap.wrap(text, width=preview_width)
        for i, line in enumerate(wrapped):
            if i == 0: print(f"{prefix}{line}")
            else:
                indent = " " * len(re.sub(r'\x1b\[[0-9;]*m', '', prefix))
                print(f"{indent}{line}")

    # Full info
    if comment:
        print_wrapped(comment, prefix="\033[1;30mInfo:\033[0m ")
    print_wrapped(details.get('Exec', 'N/A'), prefix="\033[1;30mExec:\033[0m ")
    
    if "Categories" in details:
        cats = details["Categories"].strip(";").replace(";", ", ")
        print_wrapped(cats, prefix="\033[1;30mCategories:\033[0m ")
    
    if "Keywords" in details:
        kw = details["Keywords"].strip(";").replace(";", ", ")
        print_wrapped(kw, prefix="\033[1;30mKeywords:\033[0m ")
        
    if "MimeType" in details:
        mt = details["MimeType"].strip(";").replace(";", ", ")
        print_wrapped(mt, prefix="\033[1;30mMime:\033[0m ")

if __name__ == "__main__":
    main()
