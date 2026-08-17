# Samuel's System Context

**OS:** Turquoise-halo — custom atomic Fedora 44 (immutable, BlueBuild). No native package installs on host.
**HW:** HP ZBook Ultra G1a 14" · AMD Ryzen AI MAX+ PRO 395 · AMD Radeon 8060S iGPU · 125 GiB unified RAM
**WM/Shell:** Niri (Wayland) · zsh · Ghostty terminal

**Key software:** Zen Browser · Zed (editor) · Yazi (files) · Obsidian (notes, flatpak) · Dropbox · Stata (data analysis) · Zotero (references) · rmpc+mpd (music) · Bitwarden

**Config repos:**
- `turquoise` (`~/turquoise`) — BlueBuild image recipe, build scripts, `sjust` justfile commands
- `dotfiles` (`~/dotfiles`) — user dotfiles via Chezmoi. After editing a Chezmoi-tracked file, run `chezmoi add <file>`. Exception: `.tmpl` files — edit source directly, `chezmoi add` doesn't apply.
- After changes to either repo, prompt Samuel to commit and push.

**Obsidian vault:** `~/Dropbox/Sam-Obsidian-Vault/`

**Sudo:** Cannot run `sudo`. Simple one-liners: ask Samuel to run directly. Multi-step: write to `~/sudo_temp.sh`, ask Samuel to run `sudo bash ~/sudo_temp.sh`.

**Memory:** If Samuel says "remember this" or "save this", write a Markdown note to `~/Dropbox/Sam-Obsidian-Vault/02_Memories/`. Name the file by topic. If a file on that topic already exists, append to it rather than creating a duplicate.

**Samuel:** PhD economist — applied empirical economics (urban, environmental, public policy). USA.

# Working Rules

**Skills:** When a task matches the domain of a core skill (e.g., `zotero`, `obsidian`), read the skill first (in `~/.agents/skills/<name>/SKILL.md`) and follow it. Interactive utility skills (checkpoint, grill-me, handoff, small-talk, write-a-skill) are manual: invoke them only when explicitly requested via `/skill:<name>`.

**Obsidian vault integrity (`turbovault` MCP):** All operations on `~/Dropbox/Sam-Obsidian-Vault/` MUST use the `turbovault_*` MCP tools and adhere to the `obsidian` skill (`~/.agents/skills/obsidian/SKILL.md`). NEVER use raw bash tools (`cat`, `grep`, `sed`, `find`) on vault notes.

**Subagent Delegation Rules (Context Hygiene):**
- **Vault Queries (discovery):** ALWAYS delegate operations whose output is a result set (`turbovault_search`, `turbovault_advanced_search`, `turbovault_semantic_search`, backlinks, graph traversal, SQL queries, broken-link reports) to `Agent({ subagent_type: "Explore", prompt: "..." })`. Never run these inline; result-set output pollutes the main KV cache.
- **Vault Reads (working set):** `turbovault_read_note` on known paths stays inline when the content is the session's working set: to be discussed, quoted, edited, or retained for follow-up (e.g. a summary note plus the nodes it cites). Subagents are an anti-pattern for retention: they return a synthesized rendition and the main session loses the exact text. Guard volume with progressive disclosure, not delegation. Full rule: see the `obsidian` skill.
- **Multi-File Script & Config Exploration:** Delegate multi-file searches, variable grepping, and pattern matching across research scripts (Stata `.do`, Python, R) or system configs (`turquoise`, `dotfiles`) to `Agent({ subagent_type: "Explore", prompt: "..." })`.
- **Executor (user-invoked only):** never spawn `Executor` autonomously. It is a full-privilege worker the user calls deliberately; autonomous delegation uses `Explore`, and interactive/execution work stays in the main session.
- **Literature & Paper Reading:** Literature reviews and PDF paper reading stay **in the main session** by default for interactive synthesis, unless Samuel explicitly requests a background batch document scan.

**External grounding:** When asked about external documentation, software/library updates, API schemas, or current facts — or when local files and vault notes don't answer — call `web_search` before answering. Do not guess from training memory when external verification is available.

**Math & LaTeX rendering:** When math comes up, write it as delimited LaTeX (renders as terminal Unicode): `$...$` inline, `$$...$$` or `\[...\]` on their own lines for display blocks. Math inside code fences stays raw — use a fence when the LaTeX source itself is the deliverable. Stick to standard constructs (fractions, roots, sub/superscripts, Greek letters, sums/integrals, matrices, `cases`, `aligned`, `\hat`/`\bar`/`\mathbf`); unsupported syntax falls back to raw source, so simplify rather than risk raw spew.
