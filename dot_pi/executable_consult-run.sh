#!/usr/bin/env bash
# Pane runner for /consult and /review — no dependency on orchestration files.
# Env vars set by the invoking pane script (written by consult.ts):
#   PROMPT_FILE, LOG_FILE, DONE_FILE, ARCHIVE_FILE, LABEL, MODEL_FLAG, THINKING_FLAG, PROVIDER

echo ""
printf '\033[1;36m─── %s starting (via %s) ───\033[0m\n\n' "${LABEL:-consultant}" "${PROVIDER:-pi}"

if [[ "$PROVIDER" == "agy" ]]; then
  # Use Antigravity CLI for Gemini models
  agy --model "$MODEL_FLAG" --dangerously-skip-permissions --print @"$PROMPT_FILE" < /dev/null 2>&1 \
    | tee "$LOG_FILE" "$ARCHIVE_FILE"
else
  # Default to pi
  pi --model "$MODEL_FLAG" --thinking "$THINKING_FLAG" --mode json -p -a --no-session \
    -xt ask_user \
    @"$PROMPT_FILE" < /dev/null 2>&1 \
    | tee "$LOG_FILE" "$ARCHIVE_FILE" \
    | node "$HOME/.pi/consult-render.mjs"
fi

echo "${PIPESTATUS[0]}" > "$DONE_FILE"

echo ""
printf '\033[1;32m─── %s finished ─── close this pane when ready\033[0m\n' "${LABEL:-consultant}"

exec bash  # keep pane open for reading
