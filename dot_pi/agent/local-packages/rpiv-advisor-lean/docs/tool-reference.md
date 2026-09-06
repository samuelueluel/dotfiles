# `advisor` tool reference

The exact surface rpiv-advisor registers: the tool's schema, its result envelope, what gets sent to the reviewer, and the rules that decide when the tool is visible to the executor model.

## Signature

```ts
advisor()
advisor({ question: "Should we preserve the current merge strategy?" })
advisor({ question: "Is this patch correct?", evidence: "<exact diff or excerpts>" })
```

`question` is optional. Use it for the exact issue the reviewer should answer,
especially when the user says “ask the advisor what it thinks about X.” With no
question, the reviewer supplies the highest-value general plan, correction, or
stop signal. `evidence` accepts up to 60,000 characters of exact source, diffs,
errors, or line-numbered excerpts. Use it when the requested judgment cannot be
grounded in a checkpoint alone; the reviewer has no tools. Evidence is stored on
the tool result, summarized into the next checkpoint refresh, and carried
verbatim into exactly one follow-up consultation before it expires.

## What the reviewer receives

Each call assembles the request in this order:

1. **Tool inventory prefix** — one synthetic message listing every registered
   executor tool. The cache signature includes tool descriptions and schemas, so
   a `/reload` that changes parameters cannot leave stale inventory.
2. **Branch-local checkpoint** — the latest valid advisor checkpoint found in
   tool-result details on the active branch. Its boundary is a session entry ID,
   so forks automatically restore the state valid at that branch point.
3. **Current user request** — copied verbatim and marked authoritative over stale
   or superseded checkpoint content.
4. **Activity since the checkpoint** — only messages after the checkpoint entry.
   Without a checkpoint, Pi's resolved context is used. A Pi compaction or
   branch-summary boundary after a checkpoint resets reuse to that resolved
   context rather than replaying raw pre-boundary messages.
5. **Working git diff** — appended when the working directory is a dirty Git
   repository.
6. **Consultation evidence** — optional exact material copied verbatim outside
   the scribe checkpoint. The prior consultation's evidence is also included
   here for one hop, and the next refresh retains its critical conclusions.
7. **Consultation question** — copied verbatim and labeled as the question to
   answer, or replaced by a general review request when omitted.

History is converted to Pi's labeled conversation serialization before either
the scribe or reviewer call. Native `toolCall` and `toolResult` blocks are never
forwarded, preventing arbitrary context boundaries from producing orphan
function-call outputs. The cached inventory prefix and briefing are merged into
one user message before dispatch.

When new activity exceeds 12 messages or 16,000 content characters, the scribe
rewrites a structured checkpoint from the prior checkpoint plus that delta. A
successful refresh advances the boundary and the reviewer also receives the
latest four serialized messages verbatim. Smaller deltas bypass the scribe and
are sent with the unchanged checkpoint. If the scribe fails, the old checkpoint
and complete raw delta are sent; no generic fallback is allowed to overwrite
real state.

The reviewer is invoked with the advisor system prompt, `tools: []`, and the
configured reasoning effort. It never calls tools and never writes to your
transcript — its answer comes back only as the tool result the executor reads.
The default prompt guidelines direct the executor to restate the advisor's key
guidance in its next visible reply, so the guidance is not left only in a
collapsed tool card.

While the call is in flight the executor streams
`Consulting advisor (<label>[, <effort>])…`.

## Result envelope

```ts
{
  content: [{ type: "text", text: string }], // reviewer's guidance, or an error message
  usage?: Usage,             // scribe + every completed advisor attempt
  details: {
    advisorModel?: string,   // "<provider>:<modelId>" — colon-joined
    effort?: ThinkingLevel,  // the reasoning level actually sent
    usage?: Usage,           // same combined nested usage
    advisorUsage?: Usage,    // accumulated across empty-response retry
    scribeUsage?: Usage,
    stopReason?: StopReason, // pi-ai stop reason
    errorMessage?: string,   // populated on failure paths
    leanMetrics?: {
      summarized: boolean,
      summaryAttempted: boolean,
      checkpointReused: boolean,
      checkpointUpdated: boolean,
      scribeError?: string,
      // message counts and scribe model omitted here
    },
    advisorCheckpoint?: {
      version: 1,
      summary: string,
      throughEntryId: string,
    },
  }
}
```

`details.effort` is snapshotted once at entry, so it always matches the
`reasoning` value sent to the provider even if the selection changes mid-call.

Note that `details.advisorModel` uses the **colon** form (`provider:modelId`),
unlike the slash-form `modelKey` persisted in `advisor.json`.

## Failure paths

Every failure returns a normal tool result — the executor reads the text and
keeps going rather than crashing the turn.

| `content` text | `details.errorMessage` |
| --- | --- |
| `No advisor model is configured. The user can enable one with the /advisor command.` | `no advisor model selected` |
| `Advisor (<label>) is misconfigured: <err>` | the registry's auth error |
| `Advisor (<label>) has no API key available.` | `no API key for <provider>` |
| `Advisor call was cancelled before it completed.` | the provider's error message, or `aborted` |
| `Advisor call failed: <err>` | the provider's error message |
| `Advisor returned no text content.` | `empty response` |
| `Advisor call threw: <msg>` | the thrown message |

## When the tool is active

The tool is always **registered** — but it is stripped from the *active* tool
set, meaning the executor model cannot see it and its `promptSnippet` /
`promptGuidelines` drop out of the system prompt, whenever any of:

1. No advisor model is selected.
2. `modelKey` is absent, unparseable, or names a model that is no longer in Pi's
   registry at restore time. The stale in-memory selection is cleared too.
3. The current **executor** model matches a `disabledForModels` entry — see
   [configuration.md](./configuration.md#disabledformodels).

This is what "off costs nothing" means: with no model configured, none of the
advisor's prompt text ever enters the system prompt.

## Lifecycle hooks

| Event | What happens |
| --- | --- |
| `session_start` | Reload `advisor.json`, re-apply model / effort / blocklist, activate or strip, announce once per process. |
| `before_agent_start` | Per-turn reconcile: blocked when no model is selected or the executor is blocklisted. |
| `model_select` | Re-reconcile on executor model change. Skipped for `source === "restore"` to avoid a duplicate notification. |
| `thinking_level_select` | Re-reconcile on reasoning-effort change. |

The three mid-session hooks route through a shared strip-or-add hub
(`reconcileAdvisorTool`). `session_start` uses that hub for the strip path and
adds the tool directly on the restore path.

## `/advisor` picker keys

Both pickers (model, then reasoning level) show up to 10 rows and share the hint
`type to filter • ↑↓ navigate • enter select • esc cancel`.

| Key | Effect |
| --- | --- |
| any printable character | appends to the fuzzy filter and rebuilds the list |
| Backspace | deletes one character from the filter |
| ↑ / ↓ | navigate; ↑ from the first row wraps to the last |
| Enter | select |
| Esc | cancel — the command exits without changing anything |

The filter scores against both the visible label (`Name  (provider)`) and the
underlying `provider/modelId` value, ranking contiguous runs and word-boundary
matches higher — so `op4` and `anthropic` both narrow the list.

`/advisor` requires an interactive TTY. Without one it notifies
`/advisor requires interactive mode` and returns.

## Host compatibility

The reviewer call uses pi-ai's `completeSimple`, which moved between
entrypoints across host versions: Pi ≥ 0.80.1 exports it from
`@earendil-works/pi-ai/compat`, and ≤ 0.79.x from the package root. Because
pi-ai resolves against the *host's* copy at runtime, the loader tries `/compat`
first and falls back to the root **only** on a module-resolution failure
(`ERR_PACKAGE_PATH_NOT_EXPORTED`, `ERR_MODULE_NOT_FOUND`, `MODULE_NOT_FOUND`,
walked through the `cause` chain). Any other `/compat` error is rethrown so the
real failure surfaces instead of being masked.

If neither entrypoint exposes it, the call throws
`pi-ai does not expose completeSimple on /compat or the package root — unsupported host pi-ai version`.
