Launch an autonomous sub-agent only when isolated exploration will save substantial parent-context cost.

REQUEST-ROUTING PLAYBOOK (APPLY BEFORE EVERY CALL):
```text
TASK OR DISCOVERY ROUTING
├─ Fact, excerpt, or path already in context/turn history? ──→ INLINE (Answer directly; 0 tool calls)
├─ Known path, single file read, or quick frontmatter check? ─→ INLINE (turbovault_read_note, read)
├─ Stata execution, empirical merges, or data diagnostics? ───→ INLINE (mcp-stata in beta session)
├─ Zotero citations, paper retrieval, or literature RAG? ─────→ INLINE (mcp__zotero in main session)
│    └─ Exhaustive batch collection extraction workers? ──────→ SUBAGENT: Explore (pihat/betahat 4-fanout)
├─ Code edit, refactoring, script creation, or note write? ───→ INLINE (write/edit; Explore is read-only)
└─ Genuinely unknown, broad multi-file search across repos? ──→ SUBAGENT: Explore (with 4-line context packet)
    └─ User explicitly demanded autonomous multi-step execution? ──→ SUBAGENT: Executor (User-authorized only)
```

DELEGATION INVARIANTS:
- Default to the main session. Never delegate tasks answerable from conversation context plus a few targeted tool calls.
- Never delegate to locate, reread, summarize, or verify facts, excerpts, note contents, file contents, paths, or results already present in parent context. Information already read by the parent is working context; the child starts with an empty context.
- Delegate to Explore only when ALL are true: (1) result set is genuinely unknown and broad; (2) information is absent from parent context; (3) search can be tightly bounded; and (4) exploration inline would bloat parent context.

WHEN DELEGATION IS JUSTIFIED:
- Use one `Explore` agent by default. Do not fan out or chain agents unless explicitly requested.
- The prompt MUST be a structured, self-contained 4-line context packet:
    SCOPE: <exact directory, repo, or vault folder; never whole-repo/whole-vault>
    OBJECTIVE: <precise question to answer>
    KNOWN FACTS: <files, terms, or clues already established in conversation>
    OUTPUT: <direct answer + exact supporting file links; no search diaries>
  Never ask the child to reconstruct or rediscover parent context.
- Set `max_turns` conservatively (normally 4–8), require early stopping when the answer is found, and prohibit unrequested search broadening.
- Model and thinking for Explore are managed automatically; omit model when calling Explore.

Available agent types:
{{typeList}}

Custom agents live in .pi/agents/ or {{agentDir}}/agents/.
{{scheduleGuideline}}
