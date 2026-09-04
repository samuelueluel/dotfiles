# TurboVault MCP Substrate Guidance

**Load this file when** handling git-substrate divergence or deciding whether a broad vault discovery task belongs inline or in an Explore agent.

## Git-Substrate Divergence

TurboVault's git backend may reject mutations when external processes such as Obsidian or sync leave the working tree different from HEAD. Inspect the condition with `turbovault_quick_health_check` or `turbovault_get_vault_context`, report the divergence, and reconcile it through TurboVault or with Samuel before retrying.

## Discovery Execution Location

Route selection determines the appropriate TurboVault operation, not whether it runs inline or in a subagent.

- Keep known paths, active working notes, and small bounded metadata or content searches inline.
- Use an `Explore` agent only when the result set is genuinely unknown and broad enough to pollute the main context. Give it the exact vault query, scope, exclusions, stopping condition, and expected concise output.
- In CPTR/headless mode, subagents are unavailable; keep permitted discovery inline with narrow queries and bounded results.
