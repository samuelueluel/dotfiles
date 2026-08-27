---
name: music
description: Manage MPD playback and queues with mpc/rmpc, and handle music metadata, covers, Beets imports, and onboarding with local music-* tools. Use when managing music playback, queues, playlists, tags, album art, Beets library, or onboarding downloads.
---

# Music Management: MPD, `mpc`, `rmpc`, and Beets

## Architecture & Tool Split

- **MPD (`mpd`):** Music server daemon and database. Do not restart or reconfigure unless explicitly requested.
- **`mpc`:** Primary CLI for playback control, status, queue management, searches, and filter pipelines.
- **`rmpc`:** Interactive terminal TUI and CLI helper (for `addrandom`, `remote keybind`, `save`/`load` playlists). Controls the same MPD queue.
- **Search Tooling:** Always use `mpc search` for local metadata queries (no `rmpc search` exists).

## Safe Mutation Invariants

- **Queue Preservation:** Do not clear or replace the queue unless explicitly instructed. Commands like `mpc clear`, `searchadd`, `insert`, `shuffle`, and `play` mutate playback state.
- **Dry-Run First:** Always preview metadata and filesystem modifications with `--dry-run`.
- **Destructive Onboarding:** `music-onboard` is interactive, moves/deletes source files, and has no dry-run mode. Run only upon explicit request.
- **No `--help` on Legacy Scripts:** Never pass `--help` to `music-fix-multivalue` or `music-fix-separators-legacy` (they do not parse help and may trigger unintended library scans).
- **MPD Cache Invalidation:** Refresh MPD after approved tag or file changes using `mpc -w update`.

## Quick Playback & Queue Cheatsheet

```bash
# Non-mutating inspection
mpc status && mpc current
mpc playlist
mpc stats

# Search & queue (appends without clearing)
mpc search artist "Artist Name"
mpc find artist "Artist Name" album "Album Name"       # exact match
mpc searchadd artist "Artist Name" album "Album Name"  # append to queue
mpc insert "Artist/Album/01 - Song.mp3"                # queue next

# Replace queue & play (explicit request only)
mpc clear && mpc searchadd artist "Artist" album "Album" && mpc play

# Playback controls
mpc play | pause | toggle | next | prev
mpc seek +30 | volume +5
mpc repeat on|off | random on|off | single on|once|off | consume on|off
mpc shuffle | del <POSITION> | move <FROM> <TO>
```

## `rmpc` CLI Operations

```bash
rmpc status | rmpc queue
rmpc add "Artist/Album/track.mp3" [--position +0]
rmpc addrandom album 10
rmpc save "playlist_name" | rmpc load "playlist_name"
rmpc remote switchtab "Queue"
rmpc remote keybind "<KEY>"
```

## RateYourMusic Genre Tagging Convention & Datasets

- **Standard Genre Convention:** RateYourMusic (RYM) is Samuel's official gold-standard taxonomy for all genre tagging.
- **Canonical RYM Subgenres:** When tagging or onboarding music, always assign canonical **RYM Primary and Secondary Genres** (e.g. `Slowcore`, `Midwest Emo`, `Shibuya-kei`, `Chamber Folk`, `Atmospheric Black Metal`, `Neo-Psychedelia`, `Glitch Pop`, `Alt-Country`, `Art Pop`).
- **Native Multi-Value Storage:** Genres are stored as discrete array elements in ID3v2.4 `TCON` (MP3) and Vorbis `genre` (FLAC) via `tag_utils.py` (never raw embedded semicolons in a single string).
- **Library Manifest & Reference Files:**
  - `~/.config/music/library_rym_genres_manifest.csv`: The complete, authoritative RYM genre manifest for all 1,376+ albums in `~/Music/mp3-library`.
  - `~/.config/music/rym_collection_genres.csv`: Snapshot of Samuel's 720+ rated releases with star ratings and release URLs for taste grounding (4.0, 4.5, and 5.0 star tiers).
- **Player State & Ratings:** Active library ratings remain tracked via live MPD `grouping` tags (`R: 5`, `R: 4.5`, `R: 4`, `Unrated`, etc.).


## Progressive Disclosure & Reference Routing

- **Metadata Fields, Grouping, RYM Querying & Filter Grammar:** Tag mappings, canonical grouping order, RYM CSV query recipes, and verified MPD filter syntax $\to$ [references/tagging-taxonomy.md](references/tagging-taxonomy.md).
- **Custom `music-*` Scripts & Tag Surgery:** Bulk tag edits, separator repairs, cover art fixes, and format conversion $\to$ [references/scripts.md](references/scripts.md).
- **Album Onboarding & Beets Operations:** `music-onboard` pipeline, Beets configuration, ReplayGain, and metadata sync $\to$ [references/beets-and-onboarding.md](references/beets-and-onboarding.md).

