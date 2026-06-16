#!/usr/bin/env bash
# Pane runner for /consult and /review — no dependency on orchestration files.
# Env vars set by the invoking pane script (written by consult.ts):
#   PROMPT_FILE, LOG_FILE, DONE_FILE, ARCHIVE_FILE, LABEL, MODEL_FLAG, THINKING_FLAG

echo ""
printf '\033[1;36m─── %s starting ───\033[0m\n\n' "${LABEL:-consultant}"

pi $MODEL_FLAG --thinking "$THINKING_FLAG" --mode json -p -a --no-session \
  -xt ask_user \
  @"$PROMPT_FILE" < /dev/null 2>&1 \
  | tee "$LOG_FILE" "$ARCHIVE_FILE" \
  | node "$HOME/.pi/consult-render.mjs"

echo "${PIPESTATUS[0]}" > "$DONE_FILE"

echo ""
printf '\033[1;32m─── %s finished ─── close this pane when ready\033[0m\n' "${LABEL:-consultant}"

exec bash  # keep pane open for reading
