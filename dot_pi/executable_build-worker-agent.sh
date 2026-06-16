#!/usr/bin/env bash
# Regenerate ~/.pi/worker-agent — a stripped pi config dir for spawned WORKER
# subagents (used via PI_CODING_AGENT_DIR in spawn-subagent.ts).
#
# Goals:
#   - No SYSTEM.md            -> worker gets pi's BUILT-IN coder prompt
#   - Worker APPEND_SYSTEM.md -> non-interactive hardening (no personal context)
#   - No orchestrator extensions (modes/spawn-subagent/powerline) -> no recursion, lean startup
#   - Lazy Stata MCP (lazy + fast); keep searxng
#   - ALL skills
#   - Heavy shared bits symlinked to ../agent so pi updates flow through automatically
#
# Re-run this after `pi update` (or whenever ~/.pi/agent/settings.json changes).
set -euo pipefail

AD="$HOME/.pi/agent"          # real agent dir (Manager / interactive)
WD="$HOME/.pi/worker-agent"   # generated worker dir
mkdir -p "$WD"

# 1. Symlink shared, update-tracking machinery (auto-follows pi updates).
for item in npm models.json auth.json bin themes; do
  [ -e "$AD/$item" ] && ln -sfn "$AD/$item" "$WD/$item"
done

# 2. Trust: copy so the worker dir / home are pre-trusted (avoid a -p hang).
cp -f "$AD/trust.json" "$WD/trust.json"

# 3. settings.json: derive from the live one so model/provider stay in sync.
#    - drop ALL extensions (modes, spawn-subagent, powerline) -> no recursion
#    - drop pi-tool-display package (cosmetic TUI)
#    - point skills at the curated dir built below
jq '
  .extensions = [] |
  .packages = [ .packages[] | select(((if type=="string" then . else .source end) | test("pi-tool-display")) | not) ] |
  .skills = ["'"$WD"'/skills-curated"]
' "$AD/settings.json" > "$WD/settings.json"

# 4. mcp.json: lazy Stata server; keep the rest (searxng).
jq '.mcpServers.stata.lifecycle = "lazy"' "$AD/mcp.json" > "$WD/mcp.json"

# 5. Curated skills: symlink every skill (from both skill roots).
rm -rf "$WD/skills-curated"; mkdir -p "$WD/skills-curated"
for d in "$HOME/.agents/skills"/*/ "$AD/skills"/*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  ln -sfn "${d%/}" "$WD/skills-curated/$name"
done

# 6. Worker hardening prompt (APPENDED to pi's built-in coder prompt).
cat > "$WD/APPEND_SYSTEM.md" <<'EOF'
# Worker Subagent Context

You are a non-interactive worker subagent spawned by an automated manager agent.
There is NO human in this session — your output is read by another program, not a person.

- Execute the assigned task FULLY and autonomously. Never wait for input or ask questions.
- Never offer to commit, push, or open PRs. Never prompt anyone to do anything. Never save "memories".
- Do not over-polish or gold-plate. Produce a correct, working result, then STOP.
- End by reporting concisely WHAT you did and the final result/outcome (and any errors).
EOF

echo "Built worker agent dir at $WD"
echo "  settings packages: $(jq -c '.packages' "$WD/settings.json")"
echo "  skills: $(ls "$WD/skills-curated" | wc -l) curated"
echo "  mcp servers: $(jq -c '.mcpServers | keys' "$WD/mcp.json")"
