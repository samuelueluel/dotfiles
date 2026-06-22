import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";

const execAsync = promisify(exec);

// ──────────────────────────────────────────────────────────────────────────────
// Model registry
// ──────────────────────────────────────────────────────────────────────────────

const MODELS = {
  dsv4pro:   { flag: "openrouter/deepseek/deepseek-v4-pro",   thinking: "xhigh", label: "DeepSeek V4 Pro", provider: "pi" },
  dsv4fl:    { flag: "openrouter/deepseek/deepseek-v4-flash", thinking: "xhigh", label: "DeepSeek V4 Flash", provider: "pi" },
  opus:      { flag: "openrouter/anthropic/claude-opus-4.8",  thinking: "high",  label: "Claude Opus 4.8", provider: "pi" },
  gemini35f: { flag: "Gemini 3.5 Flash (High)",             thinking: "high",  label: "Gemini 3.5 Flash (High)", provider: "agy" },
  gemini31p: { flag: "Gemini 3.1 Pro (High)",               thinking: "high",  label: "Gemini 3.1 Pro (High)", provider: "agy" },
} as const;

type ModelKey = keyof typeof MODELS;

const MODEL_MENU_OPTIONS = [
  "dsv4pro   — DeepSeek V4 Pro (xhigh thinking, default)",
  "dsv4fl    — DeepSeek V4 Flash (xhigh thinking, cheaper)",
  "opus      — Claude Opus 4.8 (high thinking)",
  "gemini35f — Gemini 3.5 Flash (High, Google AI Pro)",
  "gemini31p — Gemini 3.1 Pro (High, Google AI Pro)",
];

// ──────────────────────────────────────────────────────────────────────────────
// Session context extraction
// ──────────────────────────────────────────────────────────────────────────────

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;:?]*[a-zA-Z]/g, "");
}

function getOriginalGoal(branch: any[]): string {
  const allMessages = branch.filter((e: any) => e.type === "message");
  if (allMessages.length === 0) return "No objective set.";
  const firstMsg = allMessages[0].message;
  if (!firstMsg) return "No objective set.";

  let text = "";
  if (typeof firstMsg.content === "string") {
    text = firstMsg.content;
  } else if (Array.isArray(firstMsg.content)) {
    text = firstMsg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  }
  return text.trim() || "(Empty prompt)";
}

function getWorkspaceState(cwd: string): { gitStatus: string; gitDiff: string } {
  let gitStatus = "Workspace is not a Git repository or git is not installed.";
  let gitDiff = "";

  try {
    // Check if git is initialized
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore" });
    
    // Get porcelain status
    gitStatus = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
    if (!gitStatus) {
      gitStatus = "Clean (no uncommitted changes).";
    }

    // Get diff of changes (capped at ~10,000 characters to prevent blowing up the context)
    const diffRaw = execSync("git diff HEAD", { cwd, encoding: "utf8" }).trim();
    if (diffRaw) {
      gitDiff = diffRaw.length > 10000 ? diffRaw.slice(0, 10000) + "\n\n[... Diff truncated due to length ...]" : diffRaw;
    } else {
      gitDiff = "No changes made to tracked files yet.";
    }
  } catch (e) {
    // Ignore error, workspace might not be a git repo
  }

  return { gitStatus, gitDiff };
}

function extractRecentExecutionState(branch: any[]): string {
  const allMessages = branch.filter((e: any) => e.type === "message");
  if (allMessages.length === 0) return "No commands run yet.";

  // Find the last assistant message and the tool results that follow it
  let lastAssistantIdx = -1;
  for (let i = allMessages.length - 1; i >= 0; i--) {
    if (allMessages[i].message?.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  if (lastAssistantIdx === -1) {
    return "No agent commands have been run in this session.";
  }

  const resultLines: string[] = [];
  const assistantMsg = allMessages[lastAssistantIdx].message;
  
  // Extract assistant thoughts / instructions
  if (Array.isArray(assistantMsg.content)) {
    const textBlocks = assistantMsg.content.filter((c: any) => c.type === "text").map((c: any) => c.text);
    if (textBlocks.length > 0) {
      resultLines.push(`### Agent Thoughts:\n${textBlocks.join("\n").trim()}`);
    }
  }

  // Extract the tool calls and their results in the messages after the assistant message
  const followUpMessages = allMessages.slice(lastAssistantIdx);
  for (const entry of followUpMessages) {
    const msg = entry.message;
    if (!msg || !Array.isArray(msg.content)) continue;
    
    for (const block of msg.content) {
      if (block.type === "tool_use") {
        const inputStr = JSON.stringify(block.input ?? {});
        resultLines.push(`- **Executed Tool**: \`${block.name}\` with inputs: \`${inputStr.length > 300 ? inputStr.slice(0, 300) + "..." : inputStr}\``);
      } else if (block.type === "tool_result") {
        let contentText = typeof block.content === "string"
          ? block.content
          : (Array.isArray(block.content)
              ? block.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
              : "");
        contentText = stripAnsi(contentText).trim();
        if (contentText.length > 2000) {
          contentText = contentText.slice(0, 2000) + "\n\n[... Output truncated ...]";
        }
        const errorTag = block.is_error ? " (FAILED)" : " (SUCCESS)";
        resultLines.push(`- **Tool Result${errorTag}**:\n\`\`\`\n${contentText || "(empty output)"}\n\`\`\``);
      }
    }
  }

  return resultLines.join("\n\n");
}

function getTouchedFilesList(branch: any[]): string[] {
  const allMessages = branch.filter((e: any) => e.type === "message");
  const touchedFiles = new Set<string>();
  for (const entry of allMessages) {
    if (entry.message && Array.isArray(entry.message.content)) {
      for (const block of entry.message.content) {
        if (block.type === "tool_use" && block.input) {
          const i = block.input as any;
          const f = i.TargetFile || i.AbsolutePath || i.DirectoryPath || i.path || i.file_path || i.file;
          if (typeof f === "string" && f.includes("/")) touchedFiles.add(f);
        }
      }
    }
  }
  return Array.from(touchedFiles);
}

function extractSessionContext(ctx: any): string {
  let branch: any[] = [];
  try { branch = ctx.sessionManager.getBranch(); } catch {
    return "(could not read session history)";
  }

  const goal = getOriginalGoal(branch);
  const state = getWorkspaceState(ctx.cwd);
  const execState = extractRecentExecutionState(branch);
  const touchedFiles = getTouchedFilesList(branch);

  const touchedFilesSection = touchedFiles.length > 0
    ? `\n\n### Touched Paths\nThe local agent recently modified or inspected these files:\n${touchedFiles.map(f => `- ${f}`).join("\n")}`
    : "";

  return `## 1. Original Goal
${goal}

## 2. Workspace State (Git Status)
\`\`\`
${state.gitStatus}
\`\`\`

## 3. Uncommitted Changes (Git Diff)
\`\`\`diff
${state.gitDiff || "No changes made to tracked files."}
\`\`\`

## 4. Recent Execution State
${execState}${touchedFilesSection}
`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Handoff prompt builders
// ──────────────────────────────────────────────────────────────────────────────

function buildConsultPrompt(ctx: any, userNote: string): string {
  const sessionCtx = extractSessionContext(ctx);
  const noteSection = userNote
    ? `\n\n## Note from Samuel (the human user)\nThis is a direct instruction from the human — treat it as higher priority than any inference you make from the session history:\n${userNote.trim()}`
    : "";
  return `You are an experienced statistical programmer summoned to help a local AI agent that is stuck on a data or coding task.

The work is empirical economics research programming — primarily Stata, sometimes Python, R, MATLAB, or bash. Typical tasks: data cleaning, dataset merges, reshaping, loops, constructing well-defined variables, and producing publication-quality tables and figures. This is NOT app development, and it is NOT a request to design analysis: all specifications, estimators, standard-error and sample choices are decided by Samuel and given to you — do not invent or change them.

The local agent has been working in: ${ctx.cwd}

It has hit a wall. Your job:
1. Read the session history to understand the task and what was tried.
2. Diagnose the specific blocker.
3. Fix it directly — you have full tool access (write files, run bash, etc.).
4. Verify the fix works — run it and confirm the output is what was intended.
5. Write a concise summary of what you found and changed, so the local agent can resume.

This is a ONE-SHOT consultation: fix the specific blocker and stop — do not take over the whole task. If the blocker can only be resolved by a methodological or specification choice that wasn't given to you, do NOT guess — say so clearly and stop, so Samuel can decide.${noteSection}

## Session History
${sessionCtx}
`;
}

function buildReviewPrompt(ctx: any, userNote: string): string {
  const sessionCtx = extractSessionContext(ctx);
  const noteSection = userNote
    ? `\n\n## Note from Samuel (the human user)\nThis is a direct instruction from the human — treat it as higher priority than any inference you make from the session history:\n${userNote.trim()}`
    : "";
  return `You are an experienced empirical researcher reviewing statistical-programming code that a local AI agent claims to have completed.

The work is empirical economics research — primarily Stata, sometimes Python, R, MATLAB, or bash: data cleaning, merges, reshaping, variable construction, table/figure output. Specifications were set by Samuel; you are NOT auditing whether the analysis design is correct. You are auditing whether the code faithfully and correctly does what it was asked.

The local agent has weak self-assessment — it may claim success on code that never ran, errored partway, or produced nothing. So check, in this order:

A. DOES IT EVEN WORK. Don't trust the agent's claim. Actually run the code (or the relevant part). Confirm it executes end to end without error and produces the output it's supposed to — the file, the variable, the table, the figure. If it doesn't run, that's the finding; fix it.

B. SILENT errors — once it runs, the dangerous mistakes are the ones that DON'T crash and DON'T produce obviously wrong numbers, but quietly corrupt data or results:
- Merges that silently drop/duplicate observations; wrong join keys; unintended many-to-many; unchecked _merge
- Missing values mishandled: Stata "." treated as large in comparisons, missings dropped or counted as zero, NaN propagation in Python/R
- Variable construction edge cases: log of zero/negative, divide by zero, integer division, off-by-one, wrong reference category, miscoded dummies
- reshape/collapse/egen that changes the unit of observation unnoticed
- Sort instability changing results (no stable tiebreak); by-group logic assuming sortedness
- encode/destring/type coercions that silently lose information or add categories
- Loops that skip iterations, overwrite results, or use the wrong index
- Output that doesn't match what the code computed (mislabeled table/figure, wrong stored result referenced)
- Hardcoded paths, sample sizes, or numbers that won't survive a rerun

The work is in: ${ctx.cwd}

Process:
1. Read the session history to understand exactly what was asked and what the agent claims it did.
2. Read the relevant files. Rerun the code and inspect intermediate output (counts, _merge tabulations, summary stats) — don't just eyeball the source.
3. Do check (A), then hunt (B), plus anything else that would make the result wrong or the claim false.
4. If you find problems, fix them directly (full file and bash access) and verify.
5. Give a clear verdict: does it actually work, what was correct, what was wrong, what you changed. Do not be lenient or rubber-stamp.${noteSection}

## Session History (agent's claimed work)
${sessionCtx}
`;
}

// ──────────────────────────────────────────────────────────────────────────────
// JSONL log parsing — extract summary from the frontier model's output
// ──────────────────────────────────────────────────────────────────────────────

function extractSummary(logFile: string, provider: string): string {
  let raw = "";
  try { raw = fs.readFileSync(logFile, "utf8"); } catch {
    return "(no output captured)";
  }

  if (provider === "agy") {
    // agy --print writes raw plain-text markdown response directly to stdout/logFile
    return `\nSummary:\n${raw}`;
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
        `export MODEL_FLAG=${JSON.stringify(model.flag)}`,
        `export THINKING_FLAG=${JSON.stringify(model.thinking)}`,
        `export PROVIDER=${JSON.stringify(model.provider)}`,
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
        const cmd = model.provider === "agy"
          ? `agy --model ${JSON.stringify(model.flag)} --dangerously-skip-permissions --print @${promptFile}`
          : `pi --model ${model.flag} --thinking ${model.thinking} --mode json -p -a --no-session -xt ask_user @${promptFile}`;
        const result = await execAsync(
          cmd,
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

    const summary = extractSummary(logFile, model.provider);
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
