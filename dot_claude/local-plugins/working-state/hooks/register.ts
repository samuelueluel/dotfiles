// working-state: Claude Code port of Pi's working-state workflow.
// See ~/Dropbox/Sam-Obsidian-Vault/10_Projects/Local-LLMs/Agents/Claude-Code/Working-State.md
import type { EngineInterface, Register } from 'claude-code'
import {
  compactInstructions,
  countsAsAction,
  FILE_TOOLS,
  filesLogPath,
  filesText,
  parseFileLog,
  recordFile,
  type FileLog,
  manualCompactSkipText,
  newTracker,
  onAction,
  onContext,
  onPrompt,
  preCompactText,
  restoreText,
  resumePointerText,
  resolveCompactAt,
  rulesText,
  shouldSkipManualCompact,
  staleText,
  statePath,
  type Tracker,
} from './logic.ts'

const trackers = new Map<string, Tracker>()
const fileLogs = new Map<string, FileLog>()

// The changed-files log lives in a sidecar beside the ledger so it survives
// plugin reloads and resumes; the in-memory copy is loaded once per session.
async function fileLogFor($: EngineInterface, sessionId: string, statePathValue: string): Promise<FileLog> {
  let log = fileLogs.get(sessionId)
  if (!log) {
    const sidecar = filesLogPath(statePathValue)
    log = (await $.fs.exists(sidecar)) ? parseFileLog(await $.fs.read(sidecar)) : {}
    fileLogs.set(sessionId, log)
  }
  return log
}

function trackerFor(sessionId: string): Tracker {
  let t = trackers.get(sessionId)
  if (!t) {
    t = newTracker()
    trackers.set(sessionId, t)
  }
  return t
}

async function currentPath($: EngineInterface): Promise<{ id: string; path: string } | undefined> {
  const id = await $.session.id()
  const home = (await $.env.get('HOME')) ?? ''
  const path = statePath(home, id)
  return path ? { id, path } : undefined
}

async function mtimeOf($: EngineInterface, path: string): Promise<number | null> {
  if (!(await $.fs.exists(path))) return null
  const stat = await $.fs.stat(path)
  return stat.kind === 'file' ? stat.mtimeMs : null
}

export const register: Register = (on, options) => {
  const num = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const cfg = {
    threshold: num(options.staleThreshold, 15),
    maxNudges: num(options.maxNudgesPerPrompt, 2),
    compactAt: num(options.compactAtTokens, 0),
    margin: num(options.preCompactMargin, 40_000),
  }

  // Always-on rules with this session's exact path.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const current = await currentPath($)
    if (!current) return result
    return {
      sections: [
        ...result.sections,
        { id: 'working-state:rules', text: rulesText(current.path), scope: 'session' as const },
      ],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const current = await currentPath($)
    if (current) onPrompt(trackerFor(current.id))
    return next(e)
  })

  // Staleness and pre-compaction nudges ride on successful main-session tool
  // results as one reminder each (the same channel as a PostToolUse hook).
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined || result.isError) return result
    const current = await currentPath($)
    if (!current) return result

    // Changed-files log: subagent edits count too, since they change files.
    const pathKey = FILE_TOOLS[String(e.tool)]
    const edited = pathKey ? (e as Record<string, unknown>)[pathKey] : undefined
    if (typeof edited === 'string' && edited && !edited.startsWith(current.path.replace(/\.md$/, ''))) {
      const log = await fileLogFor($, current.id, current.path)
      recordFile(log, edited, await $.clock.now())
      await $.fs.write(filesLogPath(current.path), JSON.stringify(log))
    }

    if (e.agentId) return result
    const t = trackerFor(current.id)
    const notes: string[] = []

    if (countsAsAction(String(e.tool))) {
      const mtime = await mtimeOf($, current.path)
      if (onAction(t, mtime, cfg)) notes.push(staleText(current.path, cfg.threshold))
    }

    const usage = await $.session.usage()
    const tokens = usage.context.tokens
    if (typeof tokens === 'number' && usage.context.window > 0) {
      if (t.compactAt === null) {
        // Local estimate only (no API calls); measured once per session and
        // again after each compaction.
        const measured = await $.session.usage({ breakdown: 'summary' })
        t.compactAt = resolveCompactAt(cfg.compactAt, measured.context.breakdown?.autoCompactThreshold, usage.context.window)
      }
      const compactAt = t.compactAt
      if (onContext(t, tokens, compactAt, cfg.margin)) {
        const exists = (await mtimeOf($, current.path)) !== null
        notes.push(preCompactText(current.path, exists, tokens, compactAt))
      }
    }

    if (notes.length === 0) return result
    return { ...result, context: [...(result.context ?? []), ...notes] }
  })

  // Every main-session compaction gets summarizer instructions: full
  // preservation without a ledger, or narrative-only plus a "not yet in the
  // ledger" section when one exists. A manual /compact is blocked once while
  // the file lags behind recent work.
  on('session.compact', async ($, e, next) => {
    if (e.agentId || e.trigger === 'precompute') return next(e)
    const current = await currentPath($)
    if (current && e.trigger === 'manual') {
      const exists = (await mtimeOf($, current.path)) !== null
      if (shouldSkipManualCompact(trackerFor(current.id), exists)) {
        return { skip: manualCompactSkipText(current.path) }
      }
    }
    const content =
      current && (await mtimeOf($, current.path)) !== null ? await $.fs.read(current.path) : undefined
    const result = await next({ ...e, instructions: compactInstructions(e.instructions, content) })
    if (current) trackerFor(current.id).compactAt = null
    return result
  })

  // After compaction, put the ledger and the changed-files list back in
  // context and ask the engine to re-list skills; on resume, send a pointer.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source !== 'compact' && e.source !== 'resume') return result
    const current = await currentPath($)
    if (!current) return result
    const extra: string[] = []
    const exists = (await mtimeOf($, current.path)) !== null
    if (e.source === 'resume') {
      // Resume reloads the conversation since the last compaction, which
      // already holds the full restore; a pointer avoids a second copy.
      if (exists) extra.push(resumePointerText(current.path))
    } else {
      if (exists) {
        const content = await $.fs.read(current.path)
        if (content.trim()) extra.push(restoreText(current.path, content, 'compact'))
      }
      const files = filesText(await fileLogFor($, current.id, current.path))
      if (files) extra.push(files)
    }
    return {
      ...result,
      additionalContext: [...(result.additionalContext ?? []), ...extra],
      ...(e.source === 'compact' ? { reloadSkills: true as const } : {}),
    }
  })
}
