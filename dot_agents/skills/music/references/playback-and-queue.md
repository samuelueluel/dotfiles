# Playback and Queue Command Reference

**Load this file when** inspecting playback, directly controlling MPD, appending named tracks/albums, editing the current queue, or using `rmpc` CLI helpers.

## Non-Mutating Inspection

```bash
mpc status
mpc current
mpc playlist
mpc stats
rmpc status
rmpc queue
```

## Local Search and Exact Matching

```bash
# Case-insensitive search
mpc search artist "Artist Name"
mpc search album "Album Name"

# Exact match; preview before appending
mpc find albumartist "Artist Name" album "Album Name"
mpc find artist "Artist Name" album "Album Name"
```

## Safe Queue Appends

```bash
# Append an exactly matched album
mpc findadd albumartist "Artist Name" album "Album Name"

# Append a known file
mpc add "Artist/Album/01 - Song.mp3"

# Queue a known track next
mpc insert "Artist/Album/01 - Song.mp3"
```

Use `mpc searchadd` only when the intended search result has been previewed; a broad substring match can append unintended tracks.

## Direct Playback Controls

```bash
mpc play
mpc pause
mpc toggle
mpc next
mpc prev
mpc seek +30
mpc volume +5
```

## Playback Options and Queue Editing

```bash
mpc repeat on
mpc random off
mpc single once
mpc consume off
mpc shuffle
mpc del 3
mpc move 3 1
```

These commands mutate playback or queue state. The core skill determines when they are authorized.

## `rmpc` CLI Helpers

```bash
rmpc add "Artist/Album/track.mp3"
rmpc add "Artist/Album/track.mp3" --position +0
rmpc addrandom album 10
rmpc save "playlist_name"
rmpc load "playlist_name"
rmpc remote switchtab "Queue"
rmpc remote keybind "enter"
```

`rmpc` controls and displays MPD but has no metadata search command; use `mpc search` or `mpc find` for library queries.
