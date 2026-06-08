# Samuel's System Context

## System
- **Linux OS:** Custom Universal Blue (uBlue) atomic image based on Fedora Atomic 44 and built with BlueBuild
    1. Custom image is called **turquoise-halo**
    2. Build process: ~/Dropbox/Sam_Personal_Vault/30_Personal/20_Personal_Interests/Custom Image/Turquoise-Halo Image Build Process.md (long -- read only when necessary). 
    3. Hardware/compatibility/BIOS detail: ~/Dropbox/Sam_Personal_Vault/30_Personal/20_Personal_Interests/Custom Image/HP ZBook Ultra G1a 14'' Ryzen AI Max+ 395.md (long -- read only when necessary). 
    4. AI and LLM workflows: ~/Dropbox/Sam_Personal_Vault/10_Projects/Local LLMs/Strix Halo LLM Guide.md (long -- read only when necessary).
- **WM/compositor:** Niri (scrolling Wayland compositor)
- **Display manager:** greetd + gtkgreet
- **Shell:** zsh
- **Hardware:** HP ZBook Ultra G1a 14" — AMD Ryzen AI MAX+ PRO 395 (32 threads), AMD Radeon 8060S (integrated), 125 GiB unified RAM, btrfs filesystem

## Software
- **Browsers:** Zen Browser (three profiles with separate .desktop launchers: zen-personal, zen-utility, zen-work)
- **Editor:** Zed
- **Terminals:** Ghostty (primary), Kitty (yazi previews)
- **File manager:** Yazi (primary, ran in Kitty), Nemo (backup)
- **Launcher / search:** television (TUI) with custom "channels"
- **Notes:** Obsidian (flatpak)
- **Music:** rmpc + mpd + beets
- **Password manager:** Bitwarden (flatpak)
- **Cloud storage:** Dropbox
- **Drafting/LaTeX:** Overleaf
- **Data analysis:** Stata
- **Phone:** Android | **Tablet:** BOOX Note Air 5C
- **Location:** USA

## Primary Uses
- PhD economist — applied empirical economics (urban, environmental, public policy)
- Stata for data analysis and econometrics
- General productivity and system tinkering
- Personal entertainment

## Config and Backup Structure
Three GitHub-synced repositories:

| Repo | Path | Contents |
|---|---|---|
| `turquoise` | `/var/home/samuel/turquoise` | BlueBuild image recipe, build scripts, post-install setup and custom commands with `sjust` (`/usr/share/turquoise/justfile`) |
| `dotfiles` | `/var/home/samuel/dotfiles` | User dotfiles managed by Chezmoi |

**Important** When editing a file tracked by Chezmoi, edit directly then run `chezmoi add <file>`, unless it is tracked as .tmpl file---.tmpl's do not work with `chezmoi add` and the changes need to be added directly. After any changes to files in these repos, prompt Samuel to commit and push.

## Sudo / Privileged Commands
You cannot run `sudo`. Handle it as follows:
- **Simple one-liners:** Ask Samuel to run them directly.
- **Multi-step or complex:** Write the commands into `~/sudo_temp.sh` and ask Samuel to run `sudo bash ~/sudo_temp.sh`. Overwrite this file freely throughout the session.
- **Never ask Samuel to run commands you can run yourself** — only escalate what genuinely requires sudo.

## Preferences
- When unsure, search quality sources. Official docs preferred; Reddit/StackOverflow acceptable if cited.
- **Do not spawn subagents or sub-sessions** (such as Scout, Explore, or General). Spawning subagents on local models causes severe performance overhead and slows execution to a crawl. You must perform all file modifications, web searches, and command executions directly in this primary session.
