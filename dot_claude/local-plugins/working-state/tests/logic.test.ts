import { describe, expect, test } from 'claude-code/testing'
import {
  compactInstructions,
  filesLogPath,
  filesText,
  parseFileLog,
  recordFile,
  FILES_MAX,
  countsAsAction,
  resolveCompactAt,
  newTracker,
  onAction,
  onContext,
  onPrompt,
  restoreText,
  resumePointerText,
  rulesText,
  shouldSkipManualCompact,
  statePath,
  STATE_MAX_CHARS,
} from '../hooks/logic.ts'

const ID = '9a3f9391-ac79-434c-9137-1f353e2a320b'
const cfg = { threshold: 15, maxNudges: 2 }

describe('paths and texts', () => {
  test('state path is UUID-scoped under ~/.claude/working-state', () => {
    expect(statePath('/home/s', ID)).toBe(`/home/s/.claude/working-state/${ID}.md`)
    expect(statePath('/home/s/', ID)).toBe(`/home/s/.claude/working-state/${ID}.md`)
  })
  test('invalid session id or missing home yields no path', () => {
    expect(statePath('/home/s', 'not-a-uuid')).toBe(undefined)
    expect(statePath('', ID)).toBe(undefined)
  })
  test('rules text names the exact path and stays small', () => {
    const text = rulesText(`/home/s/.claude/working-state/${ID}.md`)
    expect(text.includes(ID)).toBe(true)
    // ~4 characters per token: keep the always-on block near 200-300 tokens.
    expect(text.length < 1300).toBe(true)
  })
  test('restore text is capped', () => {
    const big = 'x'.repeat(STATE_MAX_CHARS + 500)
    const text = restoreText('/p', big, 'compact')
    expect(text.includes('truncated')).toBe(true)
    expect(text.length < STATE_MAX_CHARS + 1000).toBe(true)
  })
})

describe('staleness nudges', () => {
  test('silent while no file exists', () => {
    const t = newTracker()
    for (let i = 0; i < 40; i++) expect(onAction(t, null, cfg)).toBe(false)
  })
  test('fires after the threshold, capped per prompt, re-armed by a prompt', () => {
    const t = newTracker()
    onAction(t, 100, cfg) // first sight sets the baseline
    let fired = 0
    for (let i = 0; i < 60; i++) if (onAction(t, 100, cfg)) fired++
    expect(fired).toBe(2)
    onPrompt(t)
    for (let i = 0; i < 15; i++) if (onAction(t, 100, cfg)) fired++
    expect(fired).toBe(3)
  })
  test('a file change resets the counter', () => {
    const t = newTracker()
    onAction(t, 100, cfg)
    for (let i = 0; i < 14; i++) expect(onAction(t, 100, cfg)).toBe(false)
    expect(onAction(t, 200, cfg)).toBe(false)
    for (let i = 0; i < 14; i++) expect(onAction(t, 200, cfg)).toBe(false)
    expect(onAction(t, 200, cfg)).toBe(true)
  })
  test('todo and tool-search calls do not count', () => {
    expect(countsAsAction('TodoWrite')).toBe(false)
    expect(countsAsAction('TaskUpdate')).toBe(false)
    expect(countsAsAction('ToolSearch')).toBe(false)
    expect(countsAsAction('Bash')).toBe(true)
    expect(countsAsAction('mcp__turbovault__read_note')).toBe(true)
  })
})

describe('pre-compaction warning', () => {
  test('edge-triggered once, re-armed after the context shrinks', () => {
    const t = newTracker()
    const at = 350_000
    expect(onContext(t, 300_000, at, 40_000)).toBe(false)
    expect(onContext(t, 311_000, at, 40_000)).toBe(true)
    expect(onContext(t, 330_000, at, 40_000)).toBe(false)
    expect(onContext(t, 307_000, at, 40_000)).toBe(false) // inside hysteresis
    expect(onContext(t, 80_000, at, 40_000)).toBe(false) // after compaction
    expect(onContext(t, 312_000, at, 40_000)).toBe(true)
  })
  test('compaction point: option, then engine threshold, then window minus 33k', () => {
    expect(resolveCompactAt(300_000, 350_000, 1_000_000)).toBe(300_000)
    expect(resolveCompactAt(0, 350_000, 1_000_000)).toBe(350_000)
    expect(resolveCompactAt(0, undefined, 1_000_000)).toBe(967_000)
  })
  test('compaction instructions follow any /compact focus text', () => {
    const merged = compactInstructions('focus on the API changes')
    expect(merged.startsWith('focus on the API changes')).toBe(true)
    expect(merged.includes('never paraphrase')).toBe(true)
    expect(compactInstructions(undefined).startsWith('Preserve exactly')).toBe(true)
  })
  test('with a ledger, the summary is told not to restate it and to flag newer facts', () => {
    const ledger = '## Decisions log\n- chose X over Y because Z'
    const text = compactInstructions(undefined, ledger)
    expect(text.includes('do not restate')).toBe(true)
    expect(text.includes('Not yet in the ledger')).toBe(true)
    expect(text.includes('chose X over Y because Z')).toBe(true)
    expect(text.includes('Preserve exactly, never paraphrase')).toBe(false)
  })
  test('an empty ledger falls back to full preservation', () => {
    expect(compactInstructions(undefined, '   ').startsWith('Preserve exactly')).toBe(true)
  })
})

describe('manual compaction', () => {
  test('blocks once while the file lags, then lets the retry through', () => {
    const t = newTracker()
    onAction(t, 100, cfg)
    onAction(t, 100, cfg)
    expect(shouldSkipManualCompact(t, true)).toBe(true)
    expect(shouldSkipManualCompact(t, true)).toBe(false)
  })
  test('never blocks without a file or when the file is current', () => {
    const t = newTracker()
    expect(shouldSkipManualCompact(t, false)).toBe(false)
    onAction(t, 100, cfg)
    expect(shouldSkipManualCompact(t, true)).toBe(false)
  })
})

describe('changed-files log', () => {
  test('sidecar sits beside the ledger', () => {
    expect(filesLogPath('/h/.claude/working-state/x.md')).toBe('/h/.claude/working-state/x.files.json')
  })
  test('records counts and lists most recent first', () => {
    const log = {}
    recordFile(log, '/a.do', 1)
    recordFile(log, '/b.py', 2)
    recordFile(log, '/a.do', 3)
    const text = filesText(log)
    expect(text.indexOf('/a.do (2 edits)') < text.indexOf('/b.py (1 edit)')).toBe(true)
  })
  test('empty log yields no block; long logs are capped', () => {
    expect(filesText({})).toBe('')
    const log = {}
    for (let i = 0; i < FILES_MAX + 5; i++) recordFile(log, `/f${i}`, i)
    expect(filesText(log).includes('5 older files not shown')).toBe(true)
  })
  test('corrupt sidecar parses to an empty log', () => {
    expect(Object.keys(parseFileLog('not json')).length).toBe(0)
    expect(parseFileLog('{"/a":{"count":2,"last":5}}')['/a']?.count).toBe(2)
  })
  test('compaction instructions say the file list is restored automatically', () => {
    expect(compactInstructions(undefined).includes('restored automatically')).toBe(true)
    expect(compactInstructions(undefined, '## Decisions log\n- x').includes('rule Samuel set')).toBe(true)
  })
})

describe('resume', () => {
  test('resume sends a short pointer, not the ledger', () => {
    const text = resumePointerText('/h/.claude/working-state/x.md')
    expect(text.includes('/h/.claude/working-state/x.md')).toBe(true)
    expect(text.length < 300).toBe(true)
  })
})
