# CLI Snippets

- Music: Onboard new album | music-onboard
- Music: Update MPD database | mpc update
- Music: Toggle MPD play/pause | mpc toggle
- Music: Clear MPD queue | mpc clear
- Music: Search MPD | mpc search artist "Name"
- Music: Full rescan music library | rmpc rescan
- Music: Restart mpd service | systemctl --user restart mpd
- Music: Update beets DB for artist | beet update "Artist Name"
- Music: Search added last week | beet ls added:-1w..
- Music: View library stats | beet stats
- Music: Find missing replaygain | beet ls replaygain_album:0
- Music: Set tags (overwrite grouping/genre) | music-set-tags "/path/to/album" --grouping "R: 4.5" "FL" --genres "Art Rock"
- Music: Add tag (append grouping/genre) | music-add-tag "/path/to/album" --grouping "[Priority]" --genres "Experimental"
- Music: Set info (song or album dir) | music-set-info "/path/to/target" --title "Title" --artist "Artist" --album "Album" --track "01" --date "YYYY"
- Music: Rename tag (library-wide) | music-rename-tag --grouping "Old Tag" "New Tag"
- Music: Delete tag (library-wide) | music-delete-tag --grouping "<500 ratings" --genres "Pop"
- Music: Normalize grouping order | music-normalize-order
- Music: Convert M4A to FLAC | music-m4a-to-flac
- Music: Fix cover art filenames | music-fix-cover-names "/path/to/album"
- Music: Extract embedded cover art | music-extract-covers "/path/to/album"

- System: Lock screen | swaylock
- System: Suspend & lock | systemctl suspend
- System: Reboot | systemctl reboot
- System: Power off | systemctl poweroff
- System: Clean unused flatpaks | flatpak uninstall --unused
- System: RTK token savings | rtk gain
- System: Sunset (Santa Fe) | night-on
- System: Sunset off | night-off
- System: Chezmoi | chezmoi
- System: Tealdeer (tldr) | tldr
- System: Waydroid status | waydroid status
- System: Stop Waydroid session | waydroid session stop

- TUI: Process monitor (btm) | btm
- TUI: Network (wlctl) | wlctl
- TUI: Bluetooth | bluetuith

- Niri: Toggle debug view | niri msg action toggle-debug-view
- Niri: IPC msg | niri msg

- bootc: Check image status | sudo bootc status
- bootc: Rollback system image | sudo bootc rollback

- Logs: Errors current boot | journalctl -p 3 -xb
- Logs: Greetd (login) follow | journalctl -f -u greetd
- Logs: User units | journalctl --user -n 100
- Logs: Boot performance blame | systemd-analyze blame

- AI: Serve Qwen3.6 35B-A3B MoE Q8, MTP on | serve-qwen-moe-Q8-mtp-p1
- AI: Serve Qwen3.6 35B-A3B MoE Q8, MTP on | serve-qwen-moe-Q8-mtp-p2
- AI: Serve Qwen3.6 27B Dense Q4, MTP on | serve-qwen-dense-Q4-mtp-p1
- AI: Serve Qwen3.6 27B Dense Q4, MTP on | serve-qwen-dense-Q4-mtp-p2
- AI: Serve Qwen3.6 35B-A3B MoE Q4, MTP on | serve-qwen-moe-Q4-mtp-p1
- AI: Serve Qwen3.6 35B-A3B MoE Q4, MTP on | serve-qwen-moe-Q4-mtp-p2
- AI: Serve Qwen3.6 27B Dense Q8, MTP on | serve-qwen-dense-Q8-mtp-p1
- AI: Serve Qwen3.6 27B Dense Q8, MTP on | serve-qwen-dense-Q8-mtp-p2
- AI: Serve Gemma 4 31B Dense QAT4 | serve-gemma4-dense-QAT4-p1
- AI: Serve Gemma 4 31B Dense QAT4 | serve-gemma4-dense-QAT4-p2
- AI: Serve Gemma 4 31B Dense QAT4, MTP on | serve-gemma4-dense-QAT4-mtp-p1
- AI: Serve Gemma 4 31B Dense QAT4, MTP on | serve-gemma4-dense-QAT4-mtp-p2
- AI: Serve autocomplete model (background) | serve-autocomplete
- AI: Serve vector embedder (background) | serve-embedder
- AI: Stop main model (:8080) | stop-main
- AI: Stop autocomplete model | stop-autocomplete
- AI: Stop vector embedder | stop-embedder
- AI: Stop all running models | ramalama stop --all
- AI: Check which models are loaded | model-check
- AI: OpenCode sandbox (read ~, write current dir) | opencode-safe-1
- AI: OpenCode sandbox (strict read/write current dir) | opencode-safe-2
- AI: OpenCode sandbox (write single file) | opencode-safe-3 ""
