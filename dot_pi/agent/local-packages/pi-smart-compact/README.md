# Local pi-smart-compact fork

This is a version-controlled runtime fork of `pi-smart-compact` 9.6.2.

The upstream package clamps automatic compaction to 60 seconds even when
`autoTriggerTimeoutMs` is configured higher. This fork removes that hard-coded
clamp. Automatic compaction now honors the configured timeout (currently five
minutes in `settings.json`), while `maxLatencyMs: 0` continues to mean that the
EESV pipeline itself has no separate deadline.

Additionally, this fork removes two artificial restrictions that abort or throttle
generation prematurely:
1. The synthetic `visibleChars > opts.maxTokens * 3` client-side abort watchdog on
   Codex streams (`codex-visible-output-cap`), which counted reasoning tokens
   (`thinking_delta`) against output budgets and aborted synthesis batches.
2. The hard-coded 4-call clamp on automatic compaction (`AUTO_TRIGGER_MAX_LLM_CALLS`)
   and downward-only `effectiveBudget` restriction, allowing auto-compaction and
   user configuration to use the full call budget rather than forcing deterministic
   fallbacks on large sessions.

The bundled `dist/index.js` is based on upstream 9.6.2 with these deliberate patches.
Refresh it deliberately when upgrading upstream.
