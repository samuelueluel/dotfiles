import readline from 'readline';

const C_RESET  = "\x1b[0m";
const C_CYAN   = "\x1b[36m";
const C_GREEN  = "\x1b[32m";
const C_RED    = "\x1b[31m";
const C_YELLOW = "\x1b[33m";
const C_BOLD   = "\x1b[1m";
const C_DIM    = "\x1b[2m";

const label = process.env.LABEL || "consultant";

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;:?]*[a-zA-Z]/g, "");
}

function summarizeArgs(args) {
  if (!args || typeof args !== "object") return "";
  if (typeof args.command === "string") return args.command;
  if (typeof args.path === "string") return args.path;
  if (typeof args.targetFile === "string") return args.targetFile;
  try { return JSON.stringify(args); } catch { return String(args); }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let ev;
  try { ev = JSON.parse(t); } catch { return; }
  if (!ev || typeof ev !== "object") return;

  if (ev.type === "tool_execution_start") {
    let argStr = summarizeArgs(ev.args);
    if (argStr.length > 120) argStr = argStr.slice(0, 120) + "…";
    console.log(`${C_CYAN}▶ ${ev.toolName}(${argStr})${C_RESET}`);

  } else if (ev.type === "tool_execution_end") {
    let resultText = "";
    try {
      resultText = (ev.result?.content || [])
        .filter(c => c?.type === "text")
        .map(c => c.text).join("");
    } catch {}
    resultText = stripAnsi(resultText).replace(/\s+/g, " ").trim();
    if (resultText.length > 2000) resultText = resultText.slice(0, 2000) + "… [truncated]";
    const icon  = ev.isError ? `${C_RED}✗` : `${C_GREEN}✓`;
    const color = ev.isError ? C_RED : C_DIM;
    console.log(`   ${icon} ${color}${resultText}${C_RESET}`);

  } else if (ev.type === "message_end" && ev.message?.role === "assistant") {
    let txt = "";
    try {
      txt = (ev.message?.content || [])
        .filter(c => c?.type === "text")
        .map(c => c.text).join("");
    } catch {}
    if (txt.trim()) {
      console.log(`\n${C_YELLOW}${C_BOLD}💬 ${label}:${C_RESET}\n${C_YELLOW}${stripAnsi(txt).trim()}${C_RESET}\n`);
    }

  } else if (ev.type === "model_thinking_delta" && ev.delta) {
    process.stdout.write(`${C_DIM}${ev.delta}${C_RESET}`);

  } else if (ev.type === "message_delta" && ev.message?.role === "assistant" && ev.delta?.type === "text") {
    if (ev.delta.text) process.stdout.write(`${C_YELLOW}${ev.delta.text}${C_RESET}`);
  }
});
