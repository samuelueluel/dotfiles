#!/usr/bin/python3
import os
import sys
import argparse
sys.path.insert(0, os.path.expanduser('~'))
from tag_utils import EXTENSIONS, check_for_unsafe_files, open_audio, get_values, set_values, save_audio

parser = argparse.ArgumentParser(description='Rename a specific value in grouping and/or genre tags across the library.')
parser.add_argument('--grouping', nargs=2, metavar=('OLD', 'NEW'), help='Grouping value to rename (TIT1/grouping)')
parser.add_argument('--genres', nargs=2, metavar=('OLD', 'NEW'), help='Genre value to rename (TCON/genre)')
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()

if not args.grouping and not args.genres:
    print("Error: specify at least one of --grouping or --genres", file=sys.stderr)
    sys.exit(1)

MUSIC_DIR = os.environ.get('MUSIC_DIR', os.path.expanduser('~/Music/Music_Linux/mp3 library/Music'))

check_for_unsafe_files(MUSIC_DIR, recursive=True)

changed = 0
total = 0

for dirpath, dirnames, filenames in os.walk(MUSIC_DIR, followlinks=True):
    for filename in sorted(filenames):
        if not filename.lower().endswith(EXTENSIONS):
            continue
        filepath = os.path.join(dirpath, filename)
        total += 1

        audio = open_audio(filepath)
        if audio is None:
            continue

        updates = {}
        for field, rename in [('grouping', args.grouping), ('genres', args.genres)]:
            if not rename:
                continue
            old, new = rename
            original = get_values(audio, field)
            new_values = [new if v == old else v for v in original]
            if new_values != original:
                updates[field] = (original, new_values)

        if updates:
            changed += 1
            print(f"File: {filepath}")
            for field, (original, new_values) in updates.items():
                print(f"  {field}: {original!r} -> {new_values!r}")
                if not args.dry_run:
                    set_values(audio, field, new_values)
            if not args.dry_run:
                save_audio(audio)

print(f"\nScanned: {total} files | Changed: {changed}")
if args.dry_run:
    print("(dry run — no files written)")
