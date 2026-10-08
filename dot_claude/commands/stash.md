---
description: File this Claude Code session into a piwork workspace folder
argument-hint: "<folder>"
disable-model-invocation: true
---
!`piwork stash-session "${CLAUDE_SESSION_ID}" $ARGUMENTS`

Relay the line above to Samuel in one sentence. If it lists existing folders because no folder was given, ask which one. Do not run any other command.
