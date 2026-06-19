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

- AI: Pi agent - local model, sandboxed (model/MTP/parallel picker) | pi
- AI: Beta agent - local model, Stata-mounted | beta
- AI: Pi cloud agent (OpenRouter picker) | pihat
- AI: Beta cloud agent (OpenRouter picker) | betahat
- AI: Rebuild Pi container image | pi-rebuild

- AI: Lemonade status (loaded models + slots) | lem-status
- AI: Lemonade unload all models | lem-unload
- AI: Lemonade logs (downloads / activity) | podman logs --tail 20 lemonade
- AI: Restart Lemonade (reload recipe/registry) | podman restart lemonade

- AI: Serve autocomplete model (background) | serve-autocomplete
- AI: Serve vector embedder (background) | serve-embedder
- AI: Stop autocomplete model | stop-autocomplete
- AI: Stop vector embedder | stop-embedder
- AI: Stop all ramalama models | ramalama stop --all
- AI: Check which models are loaded | model-check


- Stata: Start Stata in tmux session | tmux new-session -d -s stata '/usr/local/stata19/stata-mp'
- Stata: Kill stata tmux session | tmux kill-session -t stata
- Stata: List all tmux sessions | tmux list-sessions
- Stata: Check for running Stata processes | pgrep -la stata
