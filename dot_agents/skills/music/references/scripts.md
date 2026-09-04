# Custom Music Scripts (`music-*`)

**Load this file when** editing audio tags, fixing multi-value separators, repairing cover art, or converting audio formats.

## Script Scope and Capabilities

- **Default Library:** `~/Music/mp3-library` (bulk scripts respect `MUSIC_DIR`).
- `tag_utils.py` operates on MP3 and FLAC; unsupported formats cause operations to abort.
- The examples use explicit album/directory paths; bulk commands honor `MUSIC_DIR`.
- Approved metadata changes can be followed by `mpc -w update`.

## Tag Editing Scripts

### `music-set-tags`
Replaces genre and/or grouping tags in a target directory (non-recursive; normalizes grouping; sets canonical multi-value RYM genres):
```bash
music-set-tags "/path/to/album" \
  --grouping "R: 5" "FL" \
  --genres "Chamber Folk" "Ambient Pop" \
  --dry-run
```
*Genre examples:* The commands below use canonical **RateYourMusic Primary & Secondary Genres** in Title Case (e.g. `"Slowcore"` `"Post-Rock"` `"Midwest Emo"`).

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
*Note:* This script does not implement `--help`; the core skill's no-help invariant governs its use.

### `music-fix-separators-legacy`
Bash utility for MP3 files; converts legacy ` / ` separators to `; ` in ID3 `TIT1` and `TCON`:
```bash
MUSIC_DIR="/path/to/tree" music-fix-separators-legacy --dry-run
```
*Note:* These scripts do not implement `--help`. When both repairs are needed, the documented sequence is `music-fix-separators-legacy` before `music-fix-multivalue`; the core skill's separator-order invariant governs the sequence.

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
# Preview command
MUSIC_DIR="/path/to/tree" /usr/bin/python3 "$HOME/.local/bin/music-m4a-to-flac" --dry-run
```
*Note:* Live conversion overwrites targets and deletes source M4A files; the core skill's authorization and backup invariant governs live use.
