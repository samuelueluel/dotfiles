# Beets and album onboarding

Load this file when importing a download, moving an album into the library, checking Beets metadata, calculating ReplayGain, or deciding whether a command will write tags.

## `music-onboard`

```bash
music-onboard "/path/to/Downloads/Album Folder"
```

This is an interactive, mutating workflow with no pretend mode:

1. Converts direct M4A/WAV/FLAC files to V0 MP3 and deletes successful source conversions.
2. Reads artist, album, and date from the first supported file and prompts to accept or edit them.
3. Optionally edits direct track titles and numbers and applies album metadata.
4. Fuzzy-matches an existing artist directory in the main library or `MUSIC_DIR/USB_Library`, asks where to place the album, and moves or merges files.
5. Renames, extracts, or optionally downloads cover art.
6. Prompts for comma-separated genres and grouping values, then calls `music-set-tags`.
7. Calls `beet import`, `beet replaygain`, and `mpc update`.

Run it only for an explicit onboarding request. Review every prompt, especially conversion, target-directory, merge, cover-download, and grouping choices. Verify the result with `beet info` and `mpc search`.

## Beets configuration

Inspect the effective configuration before relying on a default:

```bash
beet config
```

Samuel's configured workflow is intentionally manual:

```yaml
import:
  autotag: no
  write: no
  copy: no
  move: no
  timid: yes
replaygain:
  backend: ffmpeg
  albumgain: yes
  targetlevel: 89
```

Consequences:

- `beet import` is interactive and does not automatically MusicBrainz-autotag, write tags, copy files, or move files unless command-line options override those settings.
- `beet replaygain` uses the import write setting unless `--write` or `--nowrite` is supplied. With `write: no`, the onboarding call stores calculated values in the Beets database but does not write ReplayGain tags to audio files.
- `beet update` reads file metadata into the Beets database. `beet write` writes Beets metadata to audio files and is a separate mutation.

## Beets queries and maintenance

```bash
beet version
beet stats
beet ls -f '$artist — $album — $title' 'artist:Artist Name'
beet ls -a -f '$albumartist — $album' 'artist:Artist Name'
beet ls -f '$artist — $album' 'added:-1w..'
beet info 'artist:Artist Name'       # file tags
beet info -l 'artist:Artist Name'    # Beets library fields
```

Use explicit no-write/pretend modes when reviewing changes:

```bash
beet update --pretend 'artist:Artist Name'
beet replaygain --nowrite 'artist:Artist Name'
```

These commands write metadata and require explicit approval:

```bash
beet replaygain --write 'artist:Artist Name'
beet write 'artist:Artist Name'
```

After an approved file metadata change outside onboarding:

```bash
mpc -w update
```

Then verify both indexes: `beet info`/`beet ls` for Beets and tags, and `mpc search` for MPD.
