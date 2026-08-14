Launch an autonomous sub-agent for isolated exploration, vault search, script grepping, or multi-step execution.

SUBAGENT DELEGATION GUIDELINES (CONTEXT HYGIENE):
- Use `subagent_type: "Explore"` for vault discovery queries (`turbovault_search`, `turbovault_advanced_search`, `turbovault_semantic_search`, backlinks, SQL queries) and multi-file grepping across research scripts (Stata, Python, R) or system configs. DO NOT run discovery queries or multi-file searches directly in the main orchestrator context.
- Known-path `turbovault_read_note` reads are the exception: when the content is the session's working set (to be discussed, quoted, edited, or retained), read inline. Subagents return a summary, not the text.
- Custom types: `Explore` = autonomous read-only discovery (use for ALL vault searches and multi-file grepping). `Executor` = full-privilege worker, user-invoked only; do not spawn it unless the user explicitly asks. If a task needs execution, do it in the main session or ask the user.
- Keep Stata data cleaning, variable construction, dataset merges, and paper/literature reading in the main session by default so intermediate outputs and detailed econometric synthesis are directly visible to the user.

Available agent types:
{{typeList}}

Custom agents live in .pi/agents/ or {{agentDir}}/agents/.
{{scheduleGuideline}}
