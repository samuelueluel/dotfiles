# 1. CRITICAL ROUTING RULE
Before starting any task, ALWAYS check the current directory (or the root of the project/vault) for a file named `AGENTS.md`.
If this file exists, you MUST read it thoroughly before acting. It contains the overarching rules, coding standards, and formatting guidelines for that specific project.

---

# Samuel's System Context

## System
- **Linux OS:** Custom Universal Blue atomic image based on Fedora Atomic 44 and built with BlueBuild
    1. Custom image is called **turquoise-halo**
    2. Build process: `~/Dropbox/Sam_Personal_Vault/30_Personal/20_Personal-Interests/Custom-Image/Turquoise-Halo Image Build Process.md` (read only when necessary). 
- **WM/compositor:** Niri (scrolling Wayland compositor)
- **Shell:** zsh
- **Hardware:** HP ZBook Ultra G1a 14" — AMD Ryzen AI MAX+ PRO 395 (32 threads), AMD Radeon 8060S (integrated), 125 GiB unified RAM, btrfs filesystem

## Software
- **Browsers:** Zen Browser (three profiles with separate .desktop launchers: zen-personal, zen-utility, zen-work)
- **Editor:** Zed
- **Terminals:** Ghostty (primary), Kitty (yazi previews)
- **File manager:** Yazi (primary, ran in Kitty)
- **Launcher / search:** television (TUI) with custom "channels"
- **Notes:** Obsidian (flatpak)
- **Music:** rmpc + mpd + beets
- **Cloud storage:** Dropbox
- **Drafting/LaTeX:** Overleaf
- **Data analysis:** Stata
- **Location:** USA

## Primary Uses
- PhD economist — applied empirical economics (urban, environmental, public policy)
- Stata for data analysis and econometrics
- General productivity and system tinkering
- Personal entertainment

## Config and Backup Structure
Two main GitHub-synced repositories:

| Repo | Path | Contents |
|---|---|---|
| `turquoise` | `/var/home/samuel/turquoise` | BlueBuild image recipe, build scripts, post-install setup and custom commands with `sjust` (`/usr/share/turquoise/justfile`) |
| `dotfiles` | `/var/home/samuel/dotfiles` | User dotfiles managed by Chezmoi |

**Important** When editing a file tracked by Chezmoi, edit directly then run `chezmoi add <file>`, unless it is tracked as .tmpl file---.tmpl's do not work with `chezmoi add` and the changes need to be added directly. After any changes to files in these repos, prompt Samuel to commit and push.

## Obsidian Notes
- Personal vault is at ~/Dropbox/Sam_Personal_Vault/ 

## Sudo / Privileged Commands
You cannot run `sudo`. Handle it as follows:
- **Simple one-liners:** Ask Samuel to run them directly.
- **Multi-step or complex:** Write the commands into `~/sudo_temp.sh` and ask Samuel to run `sudo bash ~/sudo_temp.sh`. Overwrite this file freely throughout the session.

## Preferences
- When unsure, search quality sources. Official docs preferred; Reddit/StackOverflow acceptable if cited.

## Memory Protocol
If the user explicitly asks you to "remember this", "save this for later", or store a memory:
1. You must use your file writing tools to create or append to a Markdown note in:
   `~/Dropbox/Sam_Personal_Vault/30_Personal/00_Personal-Inbox/LLM-Memories/`
2. Name the file concisely based on the topic. 
3. If a file for this general topic already exists, append the new information to the bottom of the existing file rather than creating a duplicate.
