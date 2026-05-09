#!/usr/bin/env bash
# tv-hub-menu.sh: List available hub workflows (tab-separated: LABEL\tCOMMAND)
printf "Apps\t/home/linuxbrew/.linuxbrew/bin/tv 'Apps'\n"
printf "Files\t/home/linuxbrew/.linuxbrew/bin/tv 'Files'\n"
printf "Directories\t/home/linuxbrew/.linuxbrew/bin/tv 'Directories'\n"
printf "Ripgrep\t/var/home/samuel/.local/bin/tv-yazi-content.sh\n"
printf "Notes (Obsidian)\t/home/linuxbrew/.linuxbrew/bin/tv 'Notes (Obsidian)'\n"
printf "Content (Obsidian)\t/var/home/samuel/.local/bin/tv-obsidian-content.sh\n"
printf "Clipboard\t/home/linuxbrew/.linuxbrew/bin/tv 'Clipboard'\n"
