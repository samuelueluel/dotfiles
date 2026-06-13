# Agent Instructions

If an `AGENTS.md` file exists in the current working directory or any ancestor directory (up to the project root), read it immediately before starting any work.

When asked to remember something (e.g. "remember this", "make a note of that"), write a brief note as a new file in `~/Dropbox/Sam-Obsidian-Vault/30_Personal/00_Personal-Inbox/LLM-Memories/`.

# Samuel's System Context

## System
- **Linux OS:** Custom Universal Blue atomic image based on Fedora Atomic 44, built with BlueBuild. Image called **turquoise-halo**.
    - Build process: `~/Dropbox/Sam-Obsidian-Vault/10_Projects/Custom-Image/Build-Process.md` (read only if needed)
- **Machine:** HP ZBook Ultra G1a 14" (SBKPFV3)
- **CPU:** AMD Ryzen AI MAX+ PRO 395 (32 threads) @ 5.19 GHz (Strix Halo)
- **GPU:** AMD Radeon 8060S (integrated)
- **RAM:** 125 GiB unified
- **WM/compositor:** Niri (scrolling Wayland compositor)
- **Shell:** zsh 
- **Terminal:** Ghostty 

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
Main GitHub-synced repositories:

| Repo | Path | Contents |
|---|---|---|
| `turquoise` | `/var/home/samuel/turquoise` | BlueBuild image recipe, build scripts, post-install setup and custom commands with `sjust` wrapper for justfile |
| `dotfiles` | `/var/home/samuel/dotfiles` | User dotfiles managed by Chezmoi |

**Important:** When editing a file tracked by Chezmoi, edit directly then run `chezmoi add <file>`, unless it is tracked as a `.tmpl` file — `.tmpl` files do not work with `chezmoi add` and changes must be made directly. After any changes to files in these repos, prompt Samuel to commit and push.

## Obsidian Notes
- Personal vault is at `~/Dropbox/Sam-Obsidian-Vault/`

## Sudo / Privileged Commands
You cannot run `sudo`. Handle it as follows:
- **Simple one-liners:** Ask Samuel to run them directly.
- **Multi-step or complex:** Write the commands into `~/sudo_temp.sh` and ask Samuel to run `sudo bash ~/sudo_temp.sh`. Overwrite this file freely throughout the session.

# RTK - Rust Token Killer

**Usage**: Token-optimized CLI proxy (60-90% savings on dev operations)

## Meta Commands (always use rtk directly)

```bash
rtk gain              # Show token savings analytics
rtk gain --history    # Show command usage history with savings
rtk discover          # Analyze Claude Code history for missed opportunities
rtk proxy <cmd>       # Execute raw command without filtering (for debugging)
```

## Installation Verification

```bash
rtk --version         # Should show: rtk X.Y.Z
rtk gain              # Should work (not "command not found")
which rtk             # Verify correct binary
```

⚠️ **Name collision**: If `rtk gain` fails, you may have reachingforthejack/rtk (Rust Type Kit) installed instead.

## Hook-Based Usage

All other commands are automatically rewritten by the Claude Code hook.
Example: `git status` → `rtk git status` (transparent, 0 tokens overhead)
