#!/usr/bin/env bash
set -euo pipefail
SESSION=orch
# $1 = Manager launch command (a pi-mgr-* alias). Defaults to DeepSeek V4 Pro.
MANAGER_CMD="${1:-pi-mgr-dsv4pro}"
# Auto-prune worker logs older than 7 days
mkdir -p "$HOME/.pi/orch-logs"
find "$HOME/.pi/orch-logs" -type f -mtime +7 -name "*.jsonl" -delete 2>/dev/null || true

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Attaching to existing '$SESSION' session. To switch Manager models, run 'orch-kill' first." >&2
  exec tmux attach -t "$SESSION"
fi
tmux new-session -d -s "$SESSION"
# pane 0 = manager
tmux send-keys -t "$SESSION:0.0" "$MANAGER_CMD" Enter
# pane 1 = worker view (split alongside)
tmux split-window -h -t "$SESSION:0.0"
WORKER_PANE="$(tmux display-message -p -t "$SESSION:0.1" '#{pane_id}')"
echo "$WORKER_PANE" > "$HOME/.pi/orch-worker-pane"
tmux set -p -t "$WORKER_PANE" remain-on-exit on
tmux send-keys -t "$WORKER_PANE" 'echo "worker idle — waiting for delegation"' Enter
tmux select-pane -t "$SESSION:0.0"
exec tmux attach -t "$SESSION"
