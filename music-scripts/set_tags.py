#!/usr/bin/python3
import os
import sys
import argparse
sys.path.insert(0, os.path.expanduser('~'))
from tag_utils import EXTENSIONS, check_for_unsafe_files, open_audio, set_values, save_audio

parser = argparse.ArgumentParser(description='Set multi-value grouping and/or genre tags on all audio files in a directory.')
parser.add_argument('directory', help='Album directory path')
parser.add_argument('--grouping', nargs='+', metavar='VALUE', help='Grouping values to set')
parser.add_argument('--genres', nargs='+', metavar='VALUE', help='Genre values to set')
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()

if not args.grouping and not args.genres:
    print("Error: specify at least one of --grouping or --genres", file=sys.stderr)
    sys.exit(1)

directory = os.path.expanduser(args.directory)
if not os.path.isdir(directory):
    print(f"Error: not a directory: {directory}", file=sys.stderr)
    sys.exit(1)

check_for_unsafe_files(directory, recursive=False)

files = sorted(f for f in os.listdir(directory) if f.lower().endswith(EXTENSIONS))
if not files:
    print("No supported audio files found.", file=sys.stderr)
    sys.exit(1)

for filename in files:
    filepath = os.path.join(directory, filename)
    audio = open_audio(filepath)
    if audio is None:
        print(f"Skipping (could not open): {filename}")
        continue

    print(f"File: {filepath}")
    for field, values in [('grouping', args.grouping), ('genres', args.genres)]:
        if values:
            print(f"  {field}: {values!r}")
            if not args.dry_run:
                set_values(audio, field, values)

    if not args.dry_run:
        save_audio(audio)

if args.dry_run:
    print("\n(dry run — no files written)")
