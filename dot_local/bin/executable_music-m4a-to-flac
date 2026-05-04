#!/usr/bin/env python3
import os
import re
import subprocess
import sys
from mutagen.flac import FLAC, FLACNoHeaderError

MUSIC_DIR = os.environ.get(
    "MUSIC_DIR",
    os.path.expanduser("~/Music/Music_Linux/mp3 library/Music"),
)
DRY_RUN = "--dry-run" in sys.argv

JUNK_TAGS = {'major_brand', 'minor_version', 'compatible_brands'}

found = []
for root, dirs, files in os.walk(MUSIC_DIR, followlinks=True):
    for f in sorted(files):
        if f.lower().endswith(".m4a"):
            found.append(os.path.join(root, f))

if not found:
    print("No M4A files found.")
    sys.exit(0)

print(f"Found {len(found)} M4A file(s).")
if DRY_RUN:
    print("DRY RUN — no changes will be made.\n")
    for src in found:
        print(f"  {src} -> {src[:-4]}.flac")
    sys.exit(0)

errors = []
for src in found:
    dst = src[:-4] + ".flac"
    print(f"{src}")

    result = subprocess.run(
        ["ffmpeg", "-y", "-i", src, "-map_metadata", "0", "-c:a", "flac", dst],
        capture_output=True,
    )
    if result.returncode != 0:
        print(f"  ERROR: ffmpeg failed")
        print(result.stderr.decode(errors="replace")[-500:])
        errors.append(src)
        continue

    os.remove(src)

    # Clean up M4A container metadata and fix tracknumber
    try:
        audio = FLAC(dst)
        dirty = False
        for tag in JUNK_TAGS:
            if tag in audio:
                del audio[tag]
                dirty = True
        if 'tracknumber' in audio:
            val = audio['tracknumber'][0]
            if not re.match(r'^\d+(/\d+)?$', val.strip()):
                m = re.match(r'^(\d+)', os.path.basename(dst))
                if m:
                    audio['tracknumber'] = [str(int(m.group(1)))]
                else:
                    del audio['tracknumber']
                dirty = True
        if dirty:
            audio.save()
    except FLACNoHeaderError:
        print(f"  WARNING: could not open FLAC for tag cleanup")

    print(f"  -> done\n")

if errors:
    print(f"\n{len(errors)} error(s) — originals NOT deleted:")
    for e in errors:
        print(f"  {e}")
    sys.exit(1)
else:
    print(f"Done. {len(found)} file(s) converted and deleted.")
