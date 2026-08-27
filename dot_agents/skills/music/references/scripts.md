# Custom Music Scripts (`music-*`)

**Load this file when** editing audio tags, fixing multi-value separators, repairing cover art, or converting audio formats.

## Safety Invariants

- **Default Library:** `~/Music/mp3-library` (bulk scripts respect `MUSIC_DIR`).
- **Dry-Run Gating:** Always run `--dry-run` first to preview affected paths and track counts.
- **Audio Formats:** `tag_utils.py` supports MP3 and FLAC only. M4A/OGG/OPUS/AAC files will cause operations to abort.
- **Scope:** Provide explicit album/directory paths for targeted work. Never omit `MUSIC_DIR` for bulk operations unless targeting the primary library.
- **Cache Refresh:** Run `mpc -w update` after applying approved metadata changes.

## Tag Editing Scripts

### `music-set-tags`
Replaces genre and/or grouping tags in a target directory (non-recursive; normalizes grouping; sets canonical multi-value RYM genres):
```bash
music-set-tags "/path/to/album" \
  --grouping "R: 5" "FL" \
  --genres "Chamber Folk" "Ambient Pop" \
  --dry-run
```
*Convention:* Always provide canonical **RateYourMusic Primary & Secondary Genres** in Title Case (e.g. `"Slowcore"` `"Post-Rock"` `"Midwest Emo"`).

### `music-add-tag`
Recursively appends grouping or canonical RYM genre tags without overwriting existing tags:
```bash
music-add-tag "/path/to/album" --grouping "[Priority]" --dry-run
MUSIC_DIR="$HOME/Music/mp3-library" music-add-tag --genres "Neo-Psychedelia" --dry-run
```


### `music-set-info`
Updates standard metadata fields on tracks or top-level directory files (does not clear fields):
```bash
music-set-info "/path/to/track.mp3" \
  --title "Song Title" --album "Album Name" \
  --artist "Artist Name" --date "YEAR" --track "01" --dry-run
```

### `music-rename-tag` & `music-delete-tag`
Performs recursive exact-match tag updates across `MUSIC_DIR` (matches full values, not substrings):
```bash
# Rename tag values
music-rename-tag --grouping "Old Value" "New Value" --dry-run
music-rename-tag --genres "Old Genre" "New Genre" --dry-run

# Delete tag values
music-delete-tag --grouping "Obsolete Value" --dry-run
music-delete-tag --genres "Wrong Genre" --dry-run
```

## Tag & Separator Normalization

### `music-normalize-order`
Recursively applies canonical grouping order and eliminates duplicates:
```bash
music-normalize-order "/path/to/tree" --dry-run
```

### `music-fix-multivalue`
Splits single grouping/genre tags containing `; ` into separate tag entries:
```bash
MUSIC_DIR="/path/to/tree" music-fix-multivalue --dry-run
```
*Warning:* Does not implement `--help`. Never invoke with `--help`.

### `music-fix-separators-legacy`
Bash utility for MP3 files; converts legacy ` / ` separators to `; ` in ID3 `TIT1` and `TCON`:
```bash
MUSIC_DIR="/path/to/tree" music-fix-separators-legacy --dry-run
```
*Warning:* Does not implement `--help`. If running both fixes, run `music-fix-separators-legacy` before `music-fix-multivalue`.

## Cover Art Utilities

```bash
# Rename artwork (folder.jpg, Cover.jpg, front.jpg -> cover.*)
music-fix-cover-names "/path/to/tree" --dry-run

# Extract embedded audio artwork to cover.jpg via ffmpeg
music-extract-covers "/path/to/tree" --dry-run
```

## Format Conversion: `music-m4a-to-flac`

Recursively converts all M4A files in `MUSIC_DIR` to FLAC using ffmpeg, overwrites targets (`-y`), and deletes source M4A files:
```bash
# Always preview first
MUSIC_DIR="/path/to/tree" /usr/bin/python3 "$HOME/.local/bin/music-m4a-to-flac" --dry-run
```
*Requirement:* Requires explicit user authorization and a recent backup before live runs.
