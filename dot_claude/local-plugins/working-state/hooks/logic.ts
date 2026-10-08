// Pure working-state logic: paths, texts, and the nudge state machine.
// No engine calls here, so tests can drive it directly.

export const STATE_DIR = '.claude/working-state'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function statePath(home: string, sessionId: string): string | undefined {
  if (!home || !UUID.test(sessionId)) return undefined
  return `${home.replace(/\/+$/, '')}/${STATE_DIR}/${sessionId}.md`
}

// Always-on system-prompt section. Static per session (no "exists" flag),
// so it never invalidates the prompt cache.
export function rulesText(path: string): string {
  return [
    '# Working state',
    `This session's working-state file: ${path}`,
    'It is a ledger of facts that must survive compaction verbatim: rules Samuel set this session (Constraints), decisions with reasons, outcomes with statuses and exact numbers, ruled-out approaches with reasons, exact environment facts, and open questions. It is restored word for word after every compaction; the compaction summary covers the narrative and the work in progress, so do not keep a progress log here. One file per session, never vault content; only the main session writes it.',
    'Create it only when the session accumulates such facts (multi-step empirical work, setup with versions and endpoints, long debugging); skip it for quick questions. Load the working-state skill for the template before creating it.',
    'Write an entry when the fact arises, with its reason, not later; record a rule the moment Samuel states it. Files changed with Edit or Write are tracked automatically, so do not list them. Outcome statuses: [ok], [wrong] (say why), [suspect], [failed] (exact command, exit code, error).',
  ].join('\n')
}

export const STATE_MAX_CHARS = 24_000

export function restoreText(path: string, content: string, reason: 'compact' | 'resume'): string {
  const clipped = content.length > STATE_MAX_CHARS
  const body = clipped ? content.slice(0, STATE_MAX_CHARS) + '\n[... truncated; read the file for the rest]' : content
  const why = reason === 'compact' ? 'The conversation was just compacted.' : 'This session was resumed.'
  return [
    `<working-state-restore path="${path}">`,
    `${why} This is the current content of this session's working-state file. Treat its decisions, outcome statuses, and ruled-out approaches as authoritative; restore from it before continuing.`,
    '',
    body.trim(),
    '</working-state-restore>',
  ].join('\n')
}

// On resume the reloaded conversation already holds the post-compaction
// restore (or the ledger edits themselves), so only a short pointer is sent.
export function resumePointerText(path: string): string {
  return `[working-state] Session resumed. This session's ledger is ${path}; the conversation above already contains its last restore or your edits to it. Re-read the file only if you have lost the thread.`
}

export function staleText(path: string, actions: number): string {
  return `[working-state] ${actions} successful actions since ${path} last changed. If anything substantive happened (a result, decision, diagnosis, or ruled-out approach), update the section that changed; otherwise carry on.`
}

export function preCompactText(path: string, exists: boolean, tokens: number, compactAt: number): string {
  const verb = exists ? 'Update' : 'If this session holds state worth keeping, create'
  return `[working-state] Context is ${Math.round(tokens / 1000)}k tokens; compaction is expected near ${Math.round(compactAt / 1000)}k. ${verb} ${path} now with decisions and their reasons, exact outcomes, and open items. Rationale cannot be recovered after the cut.`
}

export function manualCompactSkipText(path: string): string {
  return `working-state: ${path} has not been updated since the last substantive actions. Ask Claude to update it, then run /compact again (the second attempt proceeds).`
}

// Tools whose calls do not count as substantive actions.
const IGNORED_TOOLS = /^(TodoWrite|Task(Create|Update|List|Get|Stop|Output)|ToolSearch|AskUserQuestion)$/

export function countsAsAction(tool: string): boolean {
  return !IGNORED_TOOLS.test(tool)
}

export type Tracker = {
  actions: number // successful actions since the last change or nudge
  sinceChange: number // successful actions since the file last changed
  baselineMtime: number | null // null: no file (silent)
  nudges: number // staleness nudges since the last user prompt
  preCompactArmed: boolean
  compactAt: number | null // cached engine threshold; null until measured
  manualSkipUsed: boolean
}

export function newTracker(): Tracker {
  return { actions: 0, sinceChange: 0, baselineMtime: null, nudges: 0, preCompactArmed: true, compactAt: null, manualSkipUsed: false }
}

export type StaleConfig = { threshold: number; maxNudges: number }

// One successful action. Returns true when a staleness nudge should fire.
// Strictly silent when no file exists: creation pressure comes from the
// rules and compaction events, never from a counter.
export function onAction(t: Tracker, mtime: number | null, cfg: StaleConfig): boolean {
  if (mtime === null) {
    t.baselineMtime = null
    t.actions = 0
    t.sinceChange = 0
    return false
  }
  if (t.baselineMtime !== mtime) {
    t.baselineMtime = mtime
    t.actions = 0
    t.sinceChange = 0
    t.manualSkipUsed = false
    return false
  }
  t.actions += 1
  t.sinceChange += 1
  if (t.actions >= cfg.threshold && t.nudges < cfg.maxNudges) {
    t.nudges += 1
    t.actions = 0
    return true
  }
  return false
}

export function onPrompt(t: Tracker): void {
  t.nudges = 0
}

export const HYSTERESIS = 5_000

// Edge-triggered warning: fires once when tokens cross compactAt - margin,
// re-arms only after tokens fall below compactAt - margin - HYSTERESIS.
export function onContext(t: Tracker, tokens: number, compactAt: number, margin: number): boolean {
  const warnAt = compactAt - margin
  if (tokens < warnAt - HYSTERESIS) {
    t.preCompactArmed = true
    return false
  }
  if (t.preCompactArmed && tokens >= warnAt) {
    t.preCompactArmed = false
    return true
  }
  return false
}

// Compaction point: an explicit option wins, then the engine's own threshold
// (autoCompactWindow / CLAUDE_CODE_AUTO_COMPACT_WINDOW applied), then the
// documented 1M default of window minus 33k.
export function resolveCompactAt(configured: number, engineThreshold: number | undefined, window: number): number {
  if (configured > 0) return configured
  if (typeof engineThreshold === 'number' && engineThreshold > 0) return engineThreshold
  return Math.max(0, window - 33_000)
}

// Instructions for Claude Code's summarizer, merged after any /compact focus
// text. Sent only at compaction, never on ordinary requests.
//
// Without a working-state file the summary must carry everything. With one,
// the file holds decisions and outcomes verbatim and is restored after the
// cut, so the summary covers the rest and only flags newer facts.
export const COMPACT_INSTRUCTIONS = [
  'Preserve exactly, never paraphrase: numbers with units, standard errors and sample sizes; commands with exit codes; error strings; file paths, versions, endpoints, and identifiers (item keys, UUIDs, dataset names).',
  'Keep every rule Samuel set for the session in his own words, every decision with its reason, every approach ruled out with its reason, and every result found wrong or suspect with why.',
  'End with the open items and the exact next step.',
].join('\n')

export function ledgerInstructions(stateContent: string): string {
  const clipped = stateContent.length > STATE_MAX_CHARS ? stateContent.slice(0, STATE_MAX_CHARS) + '\n[... truncated]' : stateContent
  return [
    "This session keeps a working-state ledger, shown below. It is restored verbatim right after this summary, so do not restate its constraints, decisions, outcomes, ruled-out approaches, environment facts, or open questions.",
    'Summarize what it does not hold: what Samuel asked for and why, the task in progress and exactly where it stands, what the code changes do, and recent tool output that still matters. Preserve numbers, commands, error strings, paths, and identifiers exactly.',
    'Then add a section "Not yet in the ledger" listing every rule Samuel set (in his words), decision (with its reason), result (with its status), or ruled-out approach from the conversation that the ledger below does not contain; write "none" if there are none.',
    '',
    '<working-state-ledger>',
    clipped.trim(),
    '</working-state-ledger>',
  ].join('\n')
}

export function compactInstructions(userText: string | undefined, stateContent?: string): string {
  const focus = (userText ?? '').trim()
  const base = stateContent && stateContent.trim() ? ledgerInstructions(stateContent) : COMPACT_INSTRUCTIONS
  const body = `${base}\n${FILES_NOTE}`
  return focus ? `${focus}\n\n${body}` : body
}

// Manual /compact: block once when the file exists and has fallen behind.
export function shouldSkipManualCompact(t: Tracker, exists: boolean): boolean {
  if (!exists || t.sinceChange === 0 || t.manualSkipUsed) return false
  t.manualSkipUsed = true
  return true
}

// Instructions line shared by both variants: the plugin restores the list of
// files changed with Edit/Write, so the summary need not enumerate them.
export const FILES_NOTE =
  'A list of files changed with the Edit and Write tools is restored automatically after this summary; do not enumerate them, but do name files changed by shell commands or other tools.'

// ---- Changed-files log (deterministic; no model involvement) ----

export type FileLog = Record<string, { count: number; last: number }>

export const FILE_TOOLS: Record<string, 'file_path' | 'notebook_path'> = {
  Edit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
}

export function filesLogPath(statePathValue: string): string {
  return statePathValue.replace(/\.md$/, '.files.json')
}

export function recordFile(log: FileLog, path: string, now: number): void {
  const entry = log[path]
  log[path] = { count: (entry?.count ?? 0) + 1, last: now }
}

export const FILES_MAX = 40

export function filesText(log: FileLog, max = FILES_MAX): string {
  const entries = Object.entries(log).sort((a, b) => b[1].last - a[1].last)
  if (entries.length === 0) return ''
  const shown = entries.slice(0, max)
  const lines = shown.map(([path, e]) => `- ${path} (${e.count} edit${e.count === 1 ? '' : 's'})`)
  if (entries.length > max) lines.push(`- ... ${entries.length - max} older files not shown`)
  return [
    '<files-changed>',
    'Files changed with Edit/Write this session, most recent first (tracked by the working-state plugin; shell and MCP changes are not included):',
    ...lines,
    '</files-changed>',
  ].join('\n')
}

export function parseFileLog(text: string): FileLog {
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const log: FileLog = {}
    for (const [path, e] of Object.entries(value as Record<string, unknown>)) {
      const entry = e as { count?: unknown; last?: unknown }
      if (typeof entry?.count === 'number' && typeof entry?.last === 'number') {
        log[path] = { count: entry.count, last: entry.last }
      }
    }
    return log
  } catch {
    return {}
  }
}
