Launch an autonomous sub-agent only when isolated exploration will save substantial parent-context cost.

SUBAGENT DELEGATION GATE (APPLY BEFORE EVERY CALL):
- Default to the main session. Do not delegate tasks answerable from the conversation plus a few targeted tool calls.
- Never delegate to locate, reread, summarize, or verify facts, excerpts, note contents, file contents, paths, or results already present in the parent context. Information already read by the parent is working context, even though the child cannot see it.
- Known-path reads, one-file inspection, small bounded searches, routine commands/edits, and questions based on supplied material stay inline.
- Delegate only when all are true: the result set is genuinely unknown and broad; raw exploration would materially pollute the parent context; the search can be tightly bounded; and likely child cost is lower than keeping the work inline.

WHEN DELEGATION IS JUSTIFIED:
- Use one `Explore` agent by default. Do not fan out, chain agents, or use a workflow unless the user explicitly requests that scale or independent searches are clearly necessary.
- The prompt must be a self-contained context packet: precise objective, relevant known facts/excerpts, exact known paths, work already completed, strict directories/query terms/file types, exclusions, stopping condition, and concise expected output. Never ask the child to reconstruct or rediscover the parent context.
- Set `max_turns` conservatively (normally 4–8), use only the thinking level required, require early stopping when the answer is found, and prohibit unrequested search broadening.
- If the parent has already read an Obsidian note containing the needed information, do not launch Explore to search the vault for it again.

ROUTING:
- `Explore`: read-only discovery for genuinely necessary unknown vault result sets and broad multi-file searches across research scripts or system configs. Known paths and small bounded sets stay inline.
- `Executor`: full-privilege worker, user-invoked only. Never spawn it unless the user explicitly asks.
- Zotero, literature/paper reading, Stata data cleaning/construction/merges, and interactive execution remain in the main session by default.
- Explore model policy: local parents (`pi`/`beta`) pin Explore to the parent's exact model; cloud parents (`pihat`/`betahat`) pin Explore to `openai-codex/gpt-5.6-luna`. Never pass a model for Explore. Choose a modest `thinking` level appropriate to the bounded search.

Available agent types:
{{typeList}}

Custom agents live in .pi/agents/ or {{agentDir}}/agents/.
{{scheduleGuideline}}
