# Dotfiles (chezmoi)

Personal dotfiles managed by [chezmoi](https://www.chezmoi.io/). Global agent rules live in `~/.pi/agent/APPEND_SYSTEM.md`; this file adds repo-local conventions.

## Layout

- `dot_<name>` maps to `.<name>` in `$HOME`: `dot_zshrc` → `~/.zshrc`, `dot_config/` → `~/.config/`, `dot_local/` → `~/.local/`, `dot_pi/` → `~/.pi/`.
- `dot_pi/agent/models.json` is the chezmoi source of `~/.pi/agent/models.json` (Lemonade `local` provider config).
- `dot_local/share/private_containers/private_storage/private_volumes/private_lemonade-recipe/_data/` — Lemonade volume config (`recipe_options.json`, `user_models.json`).
- `dot_Brewfile` (host) and `dot_Brewfile-container` (pi sandbox container image; rebuild with `pi-rebuild`).
- `.chezmoidata.yaml` — template data. `.chezmoiignore` — excluded paths. `run_once_*.sh` — run once on `chezmoi apply`.
- `.tmpl` suffix = template file (currently only `.chezmoi.toml.tmpl`); rendered from `.chezmoidata.yaml`.

## Editing rules

- **Source of truth is this repo.** Edit `dot_*` files here, commit and push; Samuel runs `chezmoi apply` on the host when he wants them live.
- If a live file (`~/.zshrc` etc.) was edited instead, capture it back with `chezmoi add <live-path>`.
- `.tmpl` files: edit the source directly — `chezmoi add` does not work on templates.
- Never run `chezmoi apply` from inside a pi sandbox container ($HOME mounts may be read-only; apply belongs on the host).
- `dot_zshrc` is ~47 KB and holds the LLM aliases/functions (`pi`, `pihat`, `beta`, `betahat`, `lem-status`, `lem-unload`, `model-check`, `serve-*`). Prefer grep/targeted reads over full dumps.
- After changes, prompt Samuel to commit and push.
