import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";

const execAsync = promisify(exec);

// ──────────────────────────────────────────────────────────────────────────────
// Model registry
// ──────────────────────────────────────────────────────────────────────────────

const MODELS = {
  dsv4pro: { flag: "openrouter/deepseek/deepseek-v4-pro",   thinking: "xhigh", label: "DeepSeek V4 Pro"  },
  dsv4fl:  { flag: "openrouter/deepseek/deepseek-v4-flash", thinking: "xhigh", label: "DeepSeek V4 Flash" },
  opus:    { flag: "openrouter/anthropic/claude-opus-4.8",  thinking: "high",  label: "Claude Opus 4.8"  },
} as const;

type ModelKey = keyof typeof MODELS;

const MODEL_MENU_OPTIONS = [
  "dsv4pro — DeepSeek V4 Pro (xhigh thinking, default)",
  "dsv4fl  — DeepSeek V4 Flash (xhigh thinking, cheaper)",
  "opus    — Claude Opus 4.8 (high thinking)",
];

// ──────────────────────────────────────────────────────────────────────────────
// Session context extraction
// ──────────────────────────────────────────────────────────────────────────────

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;:?]*[a-zA-Z]/g, "");
}

function extractSessionContext(ctx: any, maxMessages = 30): string {
  let branch: any[] = [];
  try { branch = ctx.sessionManager.getBranch(); } catch {
    return "(could not read session history)";
  }

  const recent = branch.filter((e: any) => e.type === "message").slice(-maxMessages);
  const lines: string[] = [];

  for (const entry of recent) {
    const msg = entry.message;
    if (!msg) continue;
    const role: string = msg.role || "unknown";
    const content = msg.content;
    const parts: string[] = [];

    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && block.text?.trim()) {
          parts.push(block.text.trim());
        } else if (block.type === "tool_use") {
          const inputStr = JSON.stringify(block.input ?? {});
          parts.push(`[TOOL: ${block.name}(${inputStr.length > 300 ? inputStr.slice(0, 300) + "…" : inputStr})]`);
        } else if (block.type === "tool_result") {
          let r = typeof block.content === "string"
            ? block.content
            : (Array.isArray(block.content)
                ? block.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
                : "");
          r = stripAnsi(r).replace(/\s+/g, " ").trim();
          if (r.length > 600) r = r.slice(0, 600) + "…";
          parts.push(`[RESULT${block.is_error ? " ERROR" : ""}: ${r}]`);
        }
      }
    }

    const text = parts.join("\n").trim();
    if (text) lines.push(`[${role.toUpperCase()}]\n${text}`);
  }

  return lines.join("\n\n---\n\n") || "(empty session)";
}

// ──────────────────────────────────────────────────────────────────────────────
// Handoff prompt builders
// ──────────────────────────────────────────────────────────────────────────────

function buildConsultPrompt(ctx: any, userNote: string): string {
  const sessionCtx = extractSessionContext(ctx);
  const noteSection = userNote
    ? `\n\n## Note from Samuel (the human user)\nThis is a direct instruction from the human — treat it as higher priority than any inference you make from the session history:\n${userNote.trim()}`
    : "";
  return `You are a senior consultant (Surgeon mode) summoned to help a local AI agent that is stuck.

The local agent has been working on a task in: ${ctx.cwd}

It has hit a wall. Your job:
1. Read the session history to understand what was tried and what failed.
2. Diagnose the specific problem.
3. Fix it directly — you have full tool access (write files, run bash, etc.).
4. Verify the fix works.
5. Write a concise summary of what you found and what you changed. The local agent will read this to resume.

This is a ONE-SHOT consultation. Fix the specific blocker and stop — do not take over the whole task.${noteSection}

## Session History
${sessionCtx}
`;
}

function buildReviewPrompt(ctx: any, userNote: string): string {
  const sessionCtx = extractSessionContext(ctx);
  const noteSection = userNote
    ? `\n\n## Note from Samuel (the human user)\nThis is a direct instruction from the human — treat it as higher priority than any inference you make from the session history:\n${userNote.trim()}`
    : "";
  return `You are a senior code reviewer auditing work that a local AI agent claims to have completed.

The local agent was working in: ${ctx.cwd}

Be a hard-nosed reviewer, not a rubber stamp:
1. Read the session history to understand what the original task was.
2. Read the relevant files in the working directory.
3. Check for bugs, logic errors, missed requirements, incorrect output, and edge cases.
4. If you find problems, fix them directly (you have full file and bash access).
5. Write a clear verdict: what was correct, what was wrong, what you changed.

Do not be lenient. If the agent declared success on broken or incomplete work, say so explicitly.${noteSection}

## Session History (agent's claimed work)
${sessionCtx}
`;
}

// ──────────────────────────────────────────────────────────────────────────────
// JSONL log parsing — extract summary from the frontier model's output
// ──────────────────────────────────────────────────────────────────────────────

function extractSummary(logFile: string): string {
  let raw = "";
  try { raw = fs.readFileSync(logFile, "utf8"); } catch {
    return "(no output captured)";
  }

  let lastText = "";
  const toolSteps: string[] = [];

  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const ev = JSON.parse(t);
      if (ev.type === "tool_end" && ev.toolName) {
        let snip = "";
        try {
          snip = (ev.result?.content || [])
            .filter((c: any) => c?.type === "text")
            .map((c: any) => c.text).join("")
            .replace(/\s+/g, " ").trim().slice(0, 200);
        } catch { /* ignore */ }
        toolSteps.push(`${ev.toolName}${ev.isError ? " [ERROR]" : ""}: ${snip}`);
      }
      if (ev.type === "message_end" && ev.message?.role === "assistant") {
        const txt = (ev.message.content || [])
          .filter((c: any) => c?.type === "text")
          .map((c: any) => c.text).join("").trim();
        if (txt) lastText = stripAnsi(txt);
      }
    } catch { /* skip malformed */ }
  }

  const steps = toolSteps.length > 0
    ? `\nTools used:\n${toolSteps.slice(-15).map(s => `  • ${s}`).join("\n")}`
    : "";
  const text = lastText
    ? `\nSummary:\n${lastText.slice(0, 1000)}${lastText.length > 1000 ? "…" : ""}`
    : "\n(no summary text found in output)";

  return `${steps}${text}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Core runner
// ──────────────────────────────────────────────────────────────────────────────

async function runFrontier(
  promptBuilder: (ctx: any, note: string) => string,
  label: string,
  modelKey: ModelKey,
  userNote: string,
  ctx: any
): Promise<void> {
  const model = MODELS[modelKey];
  const home = process.env.HOME!;

  ctx.ui.notify(`Summoning ${model.label} as ${label}…`, "info");

  const prompt = promptBuilder(ctx, userNote);
  const uniq = `${Date.now()}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

  const promptFile  = `/tmp/consult_prompt_${uniq}.txt`;
  const logFile     = `/tmp/consult_log_${uniq}.jsonl`;
  const doneFile    = `/tmp/consult_done_${uniq}`;
  const paneScript  = `/tmp/consult_pane_${uniq}.sh`;

  const archiveDir  = `${home}/.pi/consult-logs`;
  fs.mkdirSync(archiveDir, { recursive: true });
  const stamp       = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const archiveFile = `${archiveDir}/${stamp}-${label}-${modelKey}.jsonl`;

  const stateDir  = `${home}/.pi/running`;
  fs.mkdirSync(stateDir, { recursive: true });
  const stateFile = `${stateDir}/${process.pid}.state`;

  const inTmux = !!process.env.TMUX;

  try {
    fs.writeFileSync(promptFile, prompt, "utf8");
    fs.writeFileSync(stateFile, `type=pi-${label}\nmodel=${model.flag}\nthinking=${model.thinking}\n`);

    let exitCode = 0;

    if (inTmux) {
      // ── Tmux path: split a side pane, run visibly ──────────────────────────
      // Write a small env-injecting script so we don't have to shell-escape
      // model flags and paths into the tmux split-window command string.
      fs.writeFileSync(paneScript, [
        "#!/usr/bin/env bash",
        `export PROMPT_FILE=${JSON.stringify(promptFile)}`,
        `export LOG_FILE=${JSON.stringify(logFile)}`,
        `export DONE_FILE=${JSON.stringify(doneFile)}`,
        `export ARCHIVE_FILE=${JSON.stringify(archiveFile)}`,
        `export LABEL=${JSON.stringify(label)}`,
        `export MODEL_FLAG=${JSON.stringify(`--model ${model.flag}`)}`,
        `export THINKING_FLAG=${JSON.stringify(model.thinking)}`,
        `exec bash ${JSON.stringify(`${home}/.pi/consult-run.sh`)}`,
      ].join("\n") + "\n", "utf8");
      fs.chmodSync(paneScript, 0o755);

      execSync(`tmux split-window -h ${JSON.stringify(paneScript)}`);

      // Poll for done file (max 30 minutes)
      exitCode = await new Promise<number>((resolve) => {
        const start = Date.now();
        const iv = setInterval(() => {
          if (fs.existsSync(doneFile)) {
            clearInterval(iv);
            try { resolve(parseInt(fs.readFileSync(doneFile, "utf8").trim(), 10)); }
            catch { resolve(0); }
          } else if (Date.now() - start > 30 * 60 * 1000) {
            clearInterval(iv);
            resolve(-1);
          }
        }, 500);
      });

    } else {
      // ── Fallback: silent execAsync (no tmux) ───────────────────────────────
      ctx.ui.notify(`(no tmux — running silently, this may take a while…)`, "warn");
      let output = "";
      try {
        const result = await execAsync(
          `pi --model ${model.flag} --thinking ${model.thinking} --mode json -p -a --no-session -xt ask_user @${promptFile}`,
          { cwd: ctx.cwd, env: { ...process.env }, maxBuffer: 50 * 1024 * 1024 }
        );
        output = result.stdout + (result.stderr ?? "");
      } catch (err: any) {
        exitCode = err.code ?? 1;
        output = ((err.stdout as string) ?? "") + ((err.stderr as string) ?? "");
      }
      if (output) {
        fs.writeFileSync(logFile, output, "utf8");
        fs.appendFileSync(archiveFile, output);
      }
    }

    const summary = extractSummary(logFile);
    const status = exitCode !== 0 ? `finished with errors (exit ${exitCode})` : "completed";
    const intro  = `[${label} (${modelKey}) ${status}]\n`;

    if (exitCode !== 0) {
      ctx.ui.notify(`${label} finished with errors (exit ${exitCode})`, "warn");
    } else {
      ctx.ui.notify(`${label} done — review the pane, then hit Enter to continue`, "success");
    }

    ctx.ui.setEditorText(`${intro}${summary}\n\nVerify the changes and continue the task.`);

  } finally {
    try { fs.unlinkSync(promptFile); }  catch { /* ignore */ }
    try { fs.unlinkSync(logFile); }     catch { /* ignore */ }
    try { fs.unlinkSync(doneFile); }    catch { /* ignore */ }
    try { fs.unlinkSync(paneScript); }  catch { /* ignore */ }
    try { fs.unlinkSync(stateFile); }   catch { /* ignore */ }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Extension entry point
// ──────────────────────────────────────────────────────────────────────────────

const NOTE_MENU_OPTIONS = [
  "Proceed without a note",
  "Add a note (pre-fills input box — type your note and hit Enter)",
];

export default function (pi: any) {

  async function handleConsult(args: string, ctx: any) {
    let modelKey: ModelKey | undefined;
    let userNote = args.trim();

    const parts = userNote.split(/\s+/);
    const first = parts[0]?.toLowerCase() as ModelKey;

    if (first && first in MODELS) {
      // Fast path: model (and optional note) provided inline
      modelKey = first;
      userNote = parts.slice(1).join(" ");
    } else {
      // Step 1: pick model
      const modelChoice = await ctx.ui.select("consultant · model", MODEL_MENU_OPTIONS);
      if (!modelChoice) return;
      modelKey = modelChoice.split(/\s+/)[0] as ModelKey;
      if (!(modelKey in MODELS)) return;

      // Step 2: note or proceed
      const noteChoice = await ctx.ui.select("consultant · note", NOTE_MENU_OPTIONS);
      if (!noteChoice) return;
      if (noteChoice.startsWith("Add")) {
        ctx.ui.setEditorText(`/consult ${modelKey} `);
        return;
      }
      userNote = "";
    }

    await runFrontier(buildConsultPrompt, "consultant", modelKey, userNote, ctx);
  }

  async function handleReview(args: string, ctx: any) {
    let modelKey: ModelKey | undefined;
    let userNote = args.trim();

    const parts = userNote.split(/\s+/);
    const first = parts[0]?.toLowerCase() as ModelKey;

    if (first && first in MODELS) {
      modelKey = first;
      userNote = parts.slice(1).join(" ");
    } else {
      // Step 1: pick model
      const modelChoice = await ctx.ui.select("reviewer · model", MODEL_MENU_OPTIONS);
      if (!modelChoice) return;
      modelKey = modelChoice.split(/\s+/)[0] as ModelKey;
      if (!(modelKey in MODELS)) return;

      // Step 2: note or proceed
      const noteChoice = await ctx.ui.select("reviewer · note", NOTE_MENU_OPTIONS);
      if (!noteChoice) return;
      if (noteChoice.startsWith("Add")) {
        ctx.ui.setEditorText(`/review ${modelKey} `);
        return;
      }
      userNote = "";
    }

    await runFrontier(buildReviewPrompt, "reviewer", modelKey, userNote, ctx);
  }

  pi.registerCommand("consult", {
    description: "Summon a frontier consultant to fix a hard problem (menu to pick model + optional note)",
    handler: async (args: string, ctx: any) => handleConsult(args, ctx),
  });

  pi.registerCommand("review", {
    description: "Summon a frontier reviewer to audit completed work (menu to pick model + optional note)",
    handler: async (args: string, ctx: any) => handleReview(args, ctx),
  });
}
