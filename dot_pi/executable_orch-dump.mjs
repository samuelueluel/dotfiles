#!/usr/bin/env node
// Interleaved orchestrator session dump for post-hoc review.
// Usage: node ~/.pi/orch-dump.mjs [manager-session.jsonl]
// Output: ~/.pi/orch-logs/dump-<timestamp>.md  (path printed to stdout)

import { createReadStream } from 'fs'
import { readdir, writeFile } from 'fs/promises'
import { createInterface } from 'readline'
import { join, basename } from 'path'
import { homedir } from 'os'

const HOME = homedir()
const SESSION_DIR = join(HOME, '.pi/manager-agent/sessions/--var-home-samuel--')
const LOGS_DIR = join(HOME, '.pi/orch-logs')

const LIM_THINKING   = 600
const LIM_TASK       = 3000
const LIM_ARGS       = 400
const LIM_RESULT     = 200
const LIM_DIGEST     = 2000
const LIM_USER_PROMPT = 2000

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g

function clean(s) {
  return s == null ? '' : String(s).replace(ANSI_RE, '')
}

function trunc(s, n) {
  s = clean(s)
  if (s.length <= n) return s
  return s.slice(0, n) + `\n...[+${s.length - n} chars truncated]`
}

function fmtArgs(toolName, args) {
  if (!args || typeof args !== 'object') return String(args || '').slice(0, LIM_ARGS)
  if (toolName === 'bash' || toolName === 'execute_bash') {
    return trunc(args.command || JSON.stringify(args), LIM_ARGS)
  }
  if (toolName === 'write' || toolName === 'multiedit') {
    const { content, ...rest } = args
    const base = JSON.stringify(rest)
    return content != null ? base + ` [content: ${content.length} chars]` : base
  }
  if (toolName === 'edit') {
    const { old_string, new_string, ...rest } = args
    return JSON.stringify(rest) +
      (old_string != null ? ` old:${String(old_string).slice(0,60)}…` : '')
  }
  if (toolName === 'read') return args.file_path || args.path || JSON.stringify(args)
  return trunc(JSON.stringify(args), LIM_ARGS)
}

async function streamJsonl(filePath, onLine) {
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })
  for await (const raw of rl) {
    const line = raw.trim()
    if (!line) continue
    try { await onLine(JSON.parse(line)) } catch {}
  }
}

async function parseManagerSession(filePath) {
  const events = []
  let model = 'unknown'
  let delegateCount = 0

  await streamJsonl(filePath, async (obj) => {
    if (obj.type === 'model_change') {
      model = obj.modelId || model
      return
    }
    if (obj.type !== 'message') return

    const { role, content = [] } = obj.message
    for (const c of content) {
      if (!c || typeof c !== 'object') continue

      if (role === 'user' && c.type === 'text') {
        events.push({ kind: 'user_prompt', text: c.text })
      } else if (role === 'assistant' && c.type === 'thinking') {
        events.push({ kind: 'manager_thinking', text: c.thinking })
      } else if (role === 'assistant' && c.type === 'text') {
        events.push({ kind: 'manager_text', text: c.text })
      } else if (role === 'assistant' && c.type === 'toolCall') {
        if (c.name === 'delegate') {
          delegateCount++
          const taskArg = c.arguments?.task ?? ''
          const compressed = taskArg.startsWith('<<ccr:')
          events.push({ kind: 'delegate', n: delegateCount, task: compressed ? null : taskArg, compressed })
        } else {
          events.push({ kind: 'manager_tool', name: c.name, args: c.arguments })
        }
      } else if (role === 'toolResult' && c.type === 'text') {
        events.push({ kind: 'delegate_result', n: delegateCount, text: c.text })
      }
    }
  })

  return { model, events }
}

async function parseWorkerLog(filePath) {
  const toolCalls = new Map() // id → {name, args, result, ok}
  const toolOrder = []        // ordered list of ids
  let task = null
  let workerModel = 'unknown'
  let turns = []
  let currentTurnTexts = []
  let currentTurnThinking = null

  await streamJsonl(filePath, async (obj) => {
    switch (obj.type) {
      case 'message_start': {
        const msg = obj.message
        if (msg.role === 'user') {
          const text = msg.content?.[0]?.text || ''
          const m = text.match(/=== TASK ===\n([\s\S]*?)(?:\n===|<\/file>|$)/)
          task = m ? m[1].trim() : text.slice(0, 500)
        } else if (msg.role === 'assistant' && msg.model) {
          workerModel = msg.model
        }
        break
      }
      case 'tool_execution_start': {
        const id = obj.toolCallId
        toolCalls.set(id, { name: obj.toolName, args: obj.args, ok: null, result: null })
        toolOrder.push(id)
        break
      }
      case 'tool_execution_end': {
        const id = obj.toolCallId
        const tc = toolCalls.get(id) || { name: obj.toolName, args: {}, ok: null, result: null }
        tc.ok = !obj.result?.isError
        tc.result = obj.result?.content?.[0]?.text || ''
        toolCalls.set(id, tc)
        break
      }
      case 'turn_end': {
        currentTurnTexts = []
        currentTurnThinking = null
        for (const c of obj.message?.content || []) {
          if (c.type === 'thinking') currentTurnThinking = c.thinking
          if (c.type === 'text') currentTurnTexts.push(c.text)
        }
        turns.push({ thinking: currentTurnThinking, texts: currentTurnTexts })
        break
      }
    }
  })

  const lastTurn = turns[turns.length - 1] || {}
  return {
    task,
    workerModel,
    toolOrder,
    toolCalls,
    turnCount: turns.length,
    finalThinking: lastTurn.thinking || null,
    finalText: (lastTurn.texts || []).join('\n\n') || null,
  }
}

async function findMostRecentSession() {
  const files = (await readdir(SESSION_DIR)).filter(f => f.endsWith('.jsonl')).sort()
  if (!files.length) throw new Error('No manager session files found in ' + SESSION_DIR)
  return join(SESSION_DIR, files[files.length - 1])
}

async function findWorkerLog(n) {
  const re = new RegExp(`-delegation-${n}\\.jsonl$`)
  const files = (await readdir(LOGS_DIR)).filter(f => re.test(f)).sort()
  return files.length ? join(LOGS_DIR, files[files.length - 1]) : null
}

async function main() {
  const sessionFile = process.argv[2] || await findMostRecentSession()
  process.stderr.write(`Manager session: ${basename(sessionFile)}\n`)

  const { model, events } = await parseManagerSession(sessionFile)
  const delegateNums = events.filter(e => e.kind === 'delegate').map(e => e.n)
  process.stderr.write(`Model: ${model} | Delegations: ${delegateNums.join(', ') || 'none'}\n`)

  const workers = {}
  for (const n of delegateNums) {
    const logFile = await findWorkerLog(n)
    if (logFile) {
      process.stderr.write(`Parsing worker ${n}: ${basename(logFile)}\n`)
      workers[n] = await parseWorkerLog(logFile)
    } else {
      process.stderr.write(`  No log found for delegation ${n}\n`)
    }
  }

  const out = []
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

  out.push(`# Orchestrator Session Dump`)
  out.push(``)
  out.push(`**Session:** \`${basename(sessionFile)}\``)
  out.push(`**Manager model:** ${model}`)
  out.push(`**Delegations:** ${delegateNums.length}`)
  out.push(`**Dump:** ${new Date().toISOString()}`)
  out.push(``)
  out.push(`---`)
  out.push(``)

  for (const ev of events) {
    switch (ev.kind) {
      case 'user_prompt':
        out.push(`## USER PROMPT`)
        out.push(``)
        out.push(trunc(ev.text, LIM_USER_PROMPT))
        out.push(``)
        break

      case 'manager_thinking':
        out.push(`<details><summary>Manager thinking</summary>`)
        out.push(``)
        out.push(trunc(ev.text, LIM_THINKING))
        out.push(``)
        out.push(`</details>`)
        out.push(``)
        break

      case 'manager_text':
        out.push(`**Manager:** ${ev.text}`)
        out.push(``)
        break

      case 'manager_tool':
        out.push(`> Manager: \`${ev.name}\` — ${trunc(fmtArgs(ev.name, ev.args), 300)}`)
        out.push(``)
        break

      case 'delegate': {
        out.push(`---`)
        out.push(``)
        out.push(`## DELEGATE #${ev.n}`)
        out.push(``)

        const w = workers[ev.n]
        const taskText = ev.task || w?.task || null

        if (ev.compressed && !w?.task) {
          out.push(`> *Task was compressed in session file and no worker log found.*`)
        } else {
          out.push(`**Task:**`)
          out.push(``)
          out.push(`\`\`\``)
          out.push(trunc(taskText || '(unknown)', LIM_TASK))
          out.push(`\`\`\``)
        }
        out.push(``)

        if (w) {
          out.push(`**Worker model:** ${w.workerModel} | **Turns:** ${w.turnCount} | **Tool calls:** ${w.toolOrder.length}`)
          out.push(``)

          if (w.toolOrder.length) {
            out.push(`**Tool call sequence:**`)
            out.push(``)
            for (let i = 0; i < w.toolOrder.length; i++) {
              const id = w.toolOrder[i]
              const tc = w.toolCalls.get(id)
              const status = tc.ok === false ? '❌' : '✓'
              const args = fmtArgs(tc.name, tc.args)
              const res = trunc(tc.result || '', LIM_RESULT).replace(/\n/g, ' ')
              out.push(`${i + 1}. \`${tc.name}\` — ${args}`)
              out.push(`   → ${status} ${res}`)
            }
            out.push(``)
          }

          if (w.finalThinking) {
            out.push(`<details><summary>Worker final thinking</summary>`)
            out.push(``)
            out.push(trunc(w.finalThinking, LIM_THINKING))
            out.push(``)
            out.push(`</details>`)
            out.push(``)
          }

          if (w.finalText) {
            out.push(`**Worker final reply:**`)
            out.push(``)
            out.push(w.finalText)
            out.push(``)
          } else {
            out.push(`> *No final text from worker (connection error or interrupted)*`)
            out.push(``)
          }
        } else {
          out.push(`> *No worker log found for delegation ${ev.n}*`)
          out.push(``)
        }
        break
      }

      case 'delegate_result':
        out.push(`**Digest Manager received:**`)
        out.push(``)
        out.push(`\`\`\``)
        out.push(trunc(ev.text, LIM_DIGEST))
        out.push(`\`\`\``)
        out.push(``)
        out.push(`---`)
        out.push(``)
        break
    }
  }

  const outFile = join(LOGS_DIR, `dump-${ts}.md`)
  await writeFile(outFile, out.join('\n'), 'utf8')
  process.stderr.write(`\nWritten: ${outFile}\n`)
  process.stdout.write(outFile + '\n')
}

main().catch(e => { process.stderr.write(String(e) + '\n'); process.exit(1) })
