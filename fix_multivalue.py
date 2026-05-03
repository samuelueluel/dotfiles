#!/usr/bin/python3
import os
import sys
from mutagen.id3 import ID3, TIT1, TCON
from mutagen.id3._util import ID3NoHeaderError

MUSIC_DIR = os.environ.get('MUSIC_DIR', os.path.expanduser('~/Music/Music_Linux/mp3 library/Music'))
DRY_RUN = '--dry-run' in sys.argv

def split_values(text_list):
    result = []
    for item in text_list:
        for v in item.split('; '):
            v = v.strip()
            if v:
                result.append(v)
    return result

changed = 0
total = 0

for dirpath, dirnames, filenames in os.walk(MUSIC_DIR, followlinks=True):
    for filename in sorted(filenames):
        if not filename.lower().endswith('.mp3'):
            continue
        filepath = os.path.join(dirpath, filename)
        total += 1

        try:
            tags = ID3(filepath)
        except ID3NoHeaderError:
            continue

        updates = {}
        for tag_name, tag_class in [('TIT1', TIT1), ('TCON', TCON)]:
            if tag_name not in tags:
                continue
            original = tags[tag_name].text
            new_values = split_values(original)
            if original != new_values:
                updates[tag_name] = (tag_class, original, new_values, tags[tag_name].encoding)

        if updates:
            changed += 1
            print(f"File: {filepath}")
            for tag_name, (tag_class, original, new_values, encoding) in updates.items():
                print(f"  {tag_name}: {original!r} -> {new_values!r}")
                if not DRY_RUN:
                    tags[tag_name] = tag_class(encoding=encoding, text=new_values)
            if not DRY_RUN:
                tags.save(v2_version=4)

print(f"\nScanned: {total} MP3s | Changed: {changed}")
if DRY_RUN:
    print("(dry run — no files written)")
