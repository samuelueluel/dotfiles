# Custom music scripts

Load this file when editing tags, repairing separators or cover art, converting formats, or checking the scope and side effects of a `music-*` command.

## Shared safety rules

- The default library is `~/Music/mp3-library`; bulk scripts honor `MUSIC_DIR`.
- Run `--dry-run` first and review the listed paths and counts.
- `tag_utils.py` supports MP3 and FLAC. Its tag operations may abort when unsupported audio such as M4A, OGG, OPUS, AAC, APE, or WV is present.
- Use an album path for album-level work. Never omit `MUSIC_DIR` for a bulk operation unless the main library is intended.
- Refresh MPD after an approved file/tag change with `mpc -w update`.

## Tag scripts

### `music-set-tags`

```bash
music-set-tags "/path/to/album" \
  --grouping "R: 5" "FL" \
  --genres "Art Rock" "Indie Rock" \
  --dry-run
```

Requires a directory and processes supported files directly inside it; it is not recursive. It replaces grouping and/or genre values. Grouping values are normalized and deduplicated when written.

### `music-add-tag`

```bash
music-add-tag "/path/to/album" --grouping "[Priority]" --dry-run
MUSIC_DIR="$HOME/Music/mp3-library" music-add-tag \
  --genres "Experimental" --dry-run
```

It defaults to `MUSIC_DIR` or the main library and recursively processes the supplied tree. It appends exact values only when absent, then normalizes grouping values.

### `music-set-info`

```bash
music-set-info "/path/to/track.mp3" \
  --title "Song Title" --album "Album Name" \
  --artist "Artist Name" --date "YEAR" --track "01" --dry-run
```

It accepts one or more files or directories. A directory is processed only at its top level. Supported fields are title, album, artist, date, and track; it does not clear fields.

### Exact library-wide tag surgery

`music-rename-tag` and `music-delete-tag` recurse through `MUSIC_DIR` and match complete values, not substrings:

```bash
music-rename-tag --grouping "Old Value" "New Value" --dry-run
music-rename-tag --genres "Old Genre" "New Genre" --dry-run
music-delete-tag --grouping "Obsolete Value" --dry-run
music-delete-tag --genres "Wrong Genre" --dry-run
```

Deletion can remove the last value of a field. Use the dry-run as the review step.

## Grouping and separator repair

```bash
music-normalize-order --dry-run
music-normalize-order "/path/to/tree" --dry-run
```

`music-normalize-order` recursively applies the grouping order in [tagging-taxonomy.md](tagging-taxonomy.md) and deduplicates grouping values.

`music-fix-multivalue` has no argparse help output. It honors `--dry-run` and recursively splits a single MP3/FLAC grouping or genre value containing `; ` into separate values:

```bash
MUSIC_DIR="/path/to/tree" music-fix-multivalue --dry-run
```

`music-fix-separators-legacy` is a Bash, MP3-only script. It replaces the legacy literal separator ` / ` with `; ` in ID3 `TIT1` and `TCON`:

```bash
MUSIC_DIR="/path/to/tree" music-fix-separators-legacy --dry-run
```

It does not implement normal `--help`; never run `music-fix-separators-legacy --help`. If both repairs are needed, review the dry-run of the legacy conversion before running `music-fix-multivalue`.

## Cover-art utilities

```bash
music-fix-cover-names "/path/to/tree" --dry-run
music-extract-covers "/path/to/tree" --dry-run
```

Both recurse through directories containing audio. `music-fix-cover-names` renames known candidates such as `folder.jpg`, `Cover.jpg`, `artwork.png`, or `front.jpg` to an MPD-friendly `cover.*` name when no recognized cover exists. `music-extract-covers` uses ffmpeg on the first sorted audio file and writes `cover.jpg` when embedded art is available.

## `music-m4a-to-flac`

The script has no positional directory argument; it recursively scans `MUSIC_DIR`:

```bash
# Always preview first.
MUSIC_DIR="/path/to/tree" /usr/bin/python3 \
  "$HOME/.local/bin/music-m4a-to-flac" --dry-run
```

A real run converts every M4A to FLAC with ffmpeg, overwrites an existing destination (`ffmpeg -y`), deletes each successfully converted source, and performs limited FLAC tag cleanup. Do not run it without a backup and explicit approval. If the normal command raises `ModuleNotFoundError: mutagen`, use `/usr/bin/python3` as above or fix the script's interpreter before proceeding.
