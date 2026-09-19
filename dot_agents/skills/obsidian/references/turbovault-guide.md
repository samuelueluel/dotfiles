# TurboVault MCP Substrate Guidance

**Load this file when** handling git-substrate divergence or a timed-out embedding reindex, or deciding whether a broad vault discovery task belongs inline or in an Explore agent.

## Git-Substrate Divergence

TurboVault's git backend may reject mutations when external processes such as Obsidian or sync leave the working tree different from HEAD. Inspect the condition with `turbovault_quick_health_check` or `turbovault_get_vault_context`, report the divergence, and reconcile it through TurboVault or with Samuel before retrying.

## Reindex Timeouts and Live Builds

A full vault reindex can take longer than the MCP client timeout. The call returns an error while the TurboVault server continues the build, so a timeout is weak evidence of failure and is not a reason to reissue.

Mid-build state is `index.stale` present with `index.bin` absent. An aborted build leaves the same state, so `turbovault_embedding_index_status` alone cannot separate them; both report `exists: false` with `chunks: 0`. Start a second build only after confirming the first is dead.

Confirm the build is alive outside the MCP layer:

- The embedding server process is present on the configured endpoint port, and the TurboVault process is still running.
- The embedding server log shows chunk tasks advancing between two samples rather than stopping.
- The cache directory at `~/.cache/turbovault/embeddings/<vault-hash>/` is being written.

A build is complete when `index.bin` exists, `stale` is false, and `built_at` is recent, with `chunks` and `dimensions` nonzero. Then validate end to end with one `turbovault_hybrid_search` and check that `dense_score` and `dense_rank` are populated rather than null.

## Discovery Execution Location

Route selection determines the appropriate TurboVault operation, not whether it runs inline or in a subagent.

- Keep known paths, active working notes, and small bounded metadata or content searches inline.
- Use an `Explore` agent only when the result set is genuinely unknown and broad enough to pollute the main context. Give it the exact vault query, scope, exclusions, stopping condition, and expected concise output.
- In CPTR/headless mode, subagents are unavailable; keep permitted discovery inline with narrow queries and bounded results.
