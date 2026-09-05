# Samuel's Operating Context

Samuel is a US-based PhD economist working in applied empirical economics, especially urban, environmental, and public policy.

## Environment

- Turquoise-halo: custom immutable Fedora 44 image managed with BlueBuild.
- Hardware: HP ZBook Ultra G1a 14", Ryzen AI MAX+ PRO 395, Radeon 8060S, 125 GiB unified RAM.
- Desktop: Niri on Wayland, zsh, and Ghostty.
- Main tools include Zed, Yazi, Zen Browser, Obsidian, Dropbox, Zotero, Stata, MPD, and rmpc.

## Routing

- For operations inside `~/Dropbox/Sam-Obsidian-Vault/`, use the Obsidian skill and TurboVault MCP. Never use raw filesystem or shell tools on vault notes.
- A general request involving notes, files, folders, or organization does not imply Obsidian unless Samuel names Obsidian, refers to the vault, or provides a vault path.
- When Samuel says “remember this” or “save this,” use TurboVault to check once for an existing topic-matching note in `02_Memories/`. Append when appropriate; otherwise create one.
- Use Zotero only when Samuel explicitly refers to Zotero, his Zotero library, a collection, stored item, passage search, RAG, or citation graph. General literature, paper, and citation questions do not by themselves imply Zotero.

## System and Configuration

- Do not install native packages on the immutable host.
- Do not run `sudo`. For a simple privileged command, ask Samuel to run it. For a multi-step privileged operation, write `~/sudo_temp.sh` and ask him to run `sudo bash ~/sudo_temp.sh`.
- Use IPv4 addresses such as `127.0.0.1` for local services.
- Sandboxed sessions can access only mounted paths.

Configuration repositories:

- `~/turquoise`: BlueBuild image recipe, build scripts, and `sjust` commands.
- `~/dotfiles`: user configuration managed by Chezmoi.

For Chezmoi-managed configuration:

- Prefer editing the live file, then capture it with `chezmoi add <live-path>`.
- Edit `.tmpl` source files directly; do not use `chezmoi add` for them.
- Never run `chezmoi apply` from inside an agent session.
- After changing `~/dotfiles` or `~/turquoise`, remind Samuel to commit and push.

## Working Rules

- Inspect relevant files and state before editing.
- Preserve unrelated content and avoid unnecessary rewrites.
- Ask one focused question when a consequential decision is unresolved; otherwise proceed with the requested work.
- When Samuel asks only for a proposal or review, do not modify files.
