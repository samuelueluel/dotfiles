---
name: music
description: Manages MPD playback and queues with mpc/rmpc, and handles music metadata, covers, Beets imports, and onboarding with local music-* tools. Use when the user asks to inspect or control playback, manage queues or playlists, search or tag music, repair album art, import albums, or use Beets or music-onboard.
---

# Music Management: MPD, `mpc`, `rmpc`, and Beets

## CPTR / Headless Limitation

CPTR's conservative headless Bash policy does not allow `mpc`, `rmpc`, or interactive `music-onboard`. Use CPTR for explanatory guidance only; perform playback, queue, tagging, and onboarding through regular Pi or a host terminal, and report blocked commands without claiming they ran.

## Request-Routing Playbook

```text
REQUEST
├─ Playback & Status Inspection ──→ mpc status / mpc current / mpc playlist (non-mutating)
├─ Playback & Queue Control    ──→ mpc toggle / next / prev / insert / add (NEVER clear unless asked)
├─ Search & Taste Query        ──→ mpc search artist/album / ~/.config/music/ manifest queries
├─ Tag Surgery & Fixes         ──→ references/scripts.md (Dry-run first; ID3v2.4 multi-value TCON)
└─ Album Onboarding & Beets    ──→ references/beets-and-onboarding.md (music-onboard; interactive only)
```

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

## Scope & Syntax Invariants

- **Tagging Scope:** `tag_utils.py` supports only MP3 and FLAC. Targeted scripts require an explicit album/directory path; bulk scripts require `MUSIC_DIR`.
- **Destructive Conversion:** `music-m4a-to-flac` requires explicit user authorization, a recent backup, and a `--dry-run` preview before live use.
- **Separator Repair Order:** If both legacy separator and multivalue repairs are needed, run `music-fix-separators-legacy` before `music-fix-multivalue`.
- **Rating Syntax:** Use `R: 5`, never `R: 5.0`.
- **MPD Filter Syntax:** Filter expressions require explicit parentheses around each clause and sub-expression; `OR` and numeric comparisons are unsupported. When filter behavior is version-sensitive, inspect `mpd --version`.

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

# Playback controls (choose one command)
mpc play
mpc pause
mpc toggle
mpc next
mpc prev

# Seek or volume adjustment
mpc seek +30
mpc volume +5

# Toggle one playback option
mpc repeat on
mpc random off
mpc single once
mpc consume off

# Queue manipulation (example positions)
mpc shuffle
mpc del 3
mpc move 3 1
```

## `rmpc` CLI Operations

```bash
rmpc status
rmpc queue
rmpc add "Artist/Album/track.mp3"
rmpc add "Artist/Album/track.mp3" --position +0
rmpc addrandom album 10
rmpc save "playlist_name"
rmpc load "playlist_name"
rmpc remote switchtab "Queue"
rmpc remote keybind "enter"
```

## RateYourMusic Genre Tagging Convention & Datasets

- **Standard Genre Convention:** RateYourMusic (RYM) is Samuel's official gold-standard taxonomy for all genre tagging.
- **Canonical RYM Subgenres:** When tagging or onboarding music, always assign canonical **RYM Primary and Secondary Genres** (e.g. `Slowcore`, `Midwest Emo`, `Shibuya-kei`, `Chamber Folk`, `Atmospheric Black Metal`, `Neo-Psychedelia`, `Glitch Pop`, `Alt-Country`, `Art Pop`).
- **Native Multi-Value Storage:** Genres are stored as discrete array elements in ID3v2.4 `TCON` (MP3) and Vorbis `genre` (FLAC) via `tag_utils.py` (never raw embedded semicolons in a single string).
- **Library Manifest & Reference Files:**
  - `~/.config/music/library_rym_genres_manifest.csv`: The authoritative RYM genre manifest for the current library; inspect its live contents rather than relying on a baked count.
  - `~/.config/music/rym_collection_genres.csv`: Rated-release dataset with star ratings and release URLs for taste grounding; inspect its current contents before use.
- **Player State & Ratings:** Active library ratings remain tracked via live MPD `grouping` tags (`R: 5`, `R: 4.5`, `R: 4`, `Unrated`, etc.).

## Progressive Disclosure & Reference Routing

- If handling metadata fields, grouping, RYM queries, or MPD filter grammar, load [tagging taxonomy](references/tagging-taxonomy.md).
- If editing audio tags, fixing separators or cover art, or converting formats, load [custom scripts](references/scripts.md).
- If onboarding albums, using Beets, or managing ReplayGain, load [Beets and onboarding](references/beets-and-onboarding.md).
