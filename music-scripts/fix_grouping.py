#!/usr/bin/python3
import os
import re
import sys
from mutagen.id3 import ID3, TIT1
from mutagen.id3._util import ID3NoHeaderError

MUSIC_DIR = os.environ.get('MUSIC_DIR', os.path.expanduser('~/Music/Music_Linux/mp3 library/Music'))
DRY_RUN = '--dry-run' in sys.argv

def transform(value):
    value = re.sub(r'R: ([0-9.]+) \([^)]+\)', r'R: \1', value)
    value = value.replace('Foreign language', 'FL')
    return value

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

        if 'TIT1' not in tags:
            continue

        original = '; '.join(tags['TIT1'].text)
        new_value = transform(original)

        if original != new_value:
            changed += 1
            print(f"File: {filepath}")
            print(f"  TIT1: {original!r} -> {new_value!r}")
            if not DRY_RUN:
                tags['TIT1'] = TIT1(encoding=tags['TIT1'].encoding, text=[new_value])
                tags.save()

print(f"\nScanned: {total} MP3s | Changed: {changed}")
if DRY_RUN:
    print("(dry run — no files written)")
