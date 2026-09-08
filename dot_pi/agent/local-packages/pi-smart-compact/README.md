# Local pi-smart-compact fork

This is a version-controlled runtime fork of `pi-smart-compact` 9.6.2.

The upstream package clamps automatic compaction to 60 seconds even when
`autoTriggerTimeoutMs` is configured higher. This fork removes that hard-coded
clamp. Automatic compaction now honors the configured timeout (currently five
minutes in `settings.json`), while `maxLatencyMs: 0` continues to mean that the
EESV pipeline itself has no separate deadline.

The bundled `dist/index.js` is copied from upstream 9.6.2 and contains the
minimal timeout patch. Refresh it deliberately when upgrading upstream.
