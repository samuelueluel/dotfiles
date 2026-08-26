---
name: music
description: This skill manages MPD playback and queues with mpc/rmpc and manages music metadata, covers, Beets imports, and onboarding with local music-* tools. Use when the user mentions MPD, mpc, rmpc, Beets, music metadata or tagging, album art, queues, playlists, or adding new music.
---

# Music: MPD, `mpc`, `rmpc`, scripts, and Beets

## Tool split

- **MPD** is the daemon and database. Do not restart or reconfigure it unless asked.
- **`mpc`** is the default for shell automation: status, metadata searches, filter expressions, queue changes, and pipelines.
- **`rmpc`** is the interactive TUI plus a small CLI for rmpc-specific features such as `addrandom`, remote TUI control, and external-media integration. Both clients control the same MPD queue.
- For local-library metadata search, use `mpc`; do not assume an `rmpc search` subcommand exists. Check `rmpc --help` for the installed release.

## Quick start

Inspect without changing playback:

```bash
mpc status
mpc current
mpc playlist
mpc stats
```

Search, preview, then queue:

```bash
mpc search artist "Artist Name"
mpc find artist "Artist Name" album "Album Name"       # exact match
mpc searchadd artist "Artist Name" album "Album Name"  # append to queue
mpc insert "Artist Name/Album Name/01 - Song.mp3"       # play next
```

Replace the queue and play only when explicitly requested:

```bash
mpc clear && mpc searchadd artist "Artist Name" album "Album Name" && mpc play
```

Basic controls include `mpc play`, `pause`, `toggle`, `next`, `prev`, `seek +30`, `volume +5`, `repeat on|off`, `random on|off`, `single on|once|off`, `consume on|off`, `shuffle`, `del POSITION`, and `move FROM TO`. Queue positions are zero-based.

## Safe mutation rules

- Preserve the existing queue unless the request says to replace it; `clear`, `searchadd`, `insert`, `shuffle`, and playback commands change state.
- Treat every metadata or filesystem helper as a write. Run its `--dry-run` first and review the scope. `music-onboard` has no dry-run and moves/deletes files.
- Refresh MPD after approved file/tag changes with `mpc -w update`; onboarding already updates MPD.
- Never probe `music-fix-multivalue` or `music-fix-separators-legacy` with `--help`: they do not parse help and may scan/write the library.

## rmpc essentials

```bash
rmpc                         # TUI; requires a real terminal
rmpc status
rmpc queue
rmpc add "Artist/Album/track.mp3"
rmpc add --position +0 "Artist/Album/track.mp3"
rmpc addrandom album 10
rmpc save "playlist name"
rmpc load "playlist name"
rmpc remote keybind "<KEY>"
rmpc remote switchtab "Queue"
```

Do not assume TUI keybindings; inspect the configured rmpc file. Run `rmpc debuginfo` before using `addyt` or `searchyt`; external playback needs a configured cache directory, local MPD socket, yt-dlp, ffmpeg/ffprobe, and Python Mutagen. A URL playlist may download every item.

## Progressive disclosure

- For grouping vocabulary, tag fields, metadata search, or MPD filters, load [references/tagging-taxonomy.md](references/tagging-taxonomy.md).
- For custom `music-*` behavior, dry-runs, cover art, separator repair, or format conversion, load [references/scripts.md](references/scripts.md).
- For new downloads, `music-onboard`, Beets import/update/replaygain, or metadata-write decisions, load [references/beets-and-onboarding.md](references/beets-and-onboarding.md).

Useful upstream references: [rmpc GitHub](https://github.com/mierak/rmpc), [rmpc CLI mode](https://rmpc.mierak.dev/reference/cli-command-mode/), and [MPD filter syntax](https://www.musicpd.org/doc/protocol/filter_syntax.html).
