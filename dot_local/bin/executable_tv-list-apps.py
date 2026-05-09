#!/usr/bin/env python3
import os

# Standard desktop entry locations
dirs = [
    os.path.expanduser("~/.local/share/applications"),
    "/usr/share/applications",
    "/var/lib/flatpak/exports/share/applications",
]

apps = {}

for d in dirs:
    if not os.path.exists(d):
        continue
    for root, _, files in os.walk(d):
        for f in files:
            if f.endswith(".desktop"):
                path = os.path.join(root, f)
                try:
                    with open(path, "r", encoding="utf-8") as file:
                        in_desktop_entry = False
                        name = None
                        no_display = False

                        for line in file:
                            line = line.strip()
                            if line == "[Desktop Entry]":
                                in_desktop_entry = True
                            elif line.startswith("["):
                                in_desktop_entry = False
                            elif in_desktop_entry:
                                if line.startswith("Name=") and not name:
                                    name = line[5:]
                                elif line.startswith("NoDisplay="):
                                    no_display = line[10:].lower() == "true"

                        if name and not no_display:
                            if name not in apps:
                                apps[name] = path
                except Exception:
                    pass

# Using ';' as a separator
for name, path in sorted(apps.items()):
    print(f"{name};{path}")
