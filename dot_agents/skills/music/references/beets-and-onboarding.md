# Beets & Album Onboarding Pipeline

**Load this file when** onboarding new downloads, moving albums into the library, inspecting Beets metadata, or managing ReplayGain.

## Interactive Onboarding: `music-onboard`

```bash
music-onboard "/path/to/Downloads/Album Folder"
```

`music-onboard` is an interactive, mutating script with **no dry-run mode**; the core skill's explicit-request invariant governs live use.

### Pipeline Execution Steps:
1. **Audio Conversion:** Converts M4A/WAV/FLAC to V0 MP3 and deletes source files upon success.
2. **Metadata Extraction:** Reads artist, album, and date from the first file; prompts for user confirmation/edits.
3. **Track Editing:** Optionally prompts to adjust track titles and track numbers.
4. **Library Placement:** Fuzzy-matches existing artist directories in `MUSIC_DIR` or `USB_Library`; prompts for placement/merge.
5. **Cover Art:** Renames, extracts, or downloads `cover.jpg`.
6. **Tagging:** Prompts for canonical **RateYourMusic Primary & Secondary Genres** (e.g. `Slowcore`, `Dream Pop`, `Post-Rock`) and grouping tags, then invokes `music-set-tags`.
7. **Indexing:** Executes `beet import`, `beet replaygain`, and `mpc update`.


## Beets Configuration & Behavior

Inspect active configuration: `beet config`.

### Configured Invariants (`~/.config/beets/config.yaml`):
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

### Operational Rules:
- **`beet import`:** Interactive; does not autotag against MusicBrainz, write file tags, copy, or move files by default.
- **`beet replaygain`:** With `write: no`, calculated gain values are stored in the Beets database without modifying audio files (use `--write` to force file tag writes).
- **`beet update`:** Reads file tags into the Beets database.
- **`beet write`:** Writes Beets database metadata to physical audio files (explicit mutation).

## Beets Queries & Maintenance

```bash
# Library statistics & listings
beet stats
beet ls -f '$artist — $album — $title' 'artist:Artist Name'
beet ls -a -f '$albumartist — $album' 'artist:Artist Name'
beet ls -f '$artist — $album' 'added:-1w..'

# Metadata inspection
beet info 'artist:Artist Name'       # Physical audio tags
beet info -l 'artist:Artist Name'    # Beets database fields

# Non-mutating simulation checks
beet update --pretend 'artist:Artist Name'
beet replaygain --nowrite 'artist:Artist Name'

# Approved tag writing
beet replaygain --write 'artist:Artist Name'
beet write 'artist:Artist Name'
mpc -w update
```
