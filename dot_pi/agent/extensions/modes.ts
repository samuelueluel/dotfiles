import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Mode state
let currentMode: "plan" | "manual" | "auto" =
  process.env.PI_DEFAULT_MODE === "plan" ? "plan" :
  (process.argv.includes("-a") || process.argv.includes("--approve")) ? "auto" : "manual";

// Store original file contents for Auto mode diffing
const autoModeOriginalContents = new Map<string, string | null>();

// ──────────────────────────────────────────────
// Shared read-only tool set
// Plan mode: strict whitelist (adds bash for shell exploration)
// Manual mode: these pass through without gating; everything else is gated
// ──────────────────────────────────────────────
const COMMON_READ_ONLY = new Set([
  // File reading
  "read",
  "view_file",
  "cat",
  "ls",
  "list_dir",
  "find",
  // Search
  "web_search",
  "code_search",
  "grep_search",
  // Content fetching
  "fetch_content",
  "get_search_content",
  // Export (renders to PDF/HTML/PNG without modifying project files)
  "preview_export",
  // Todo (metadata operations, not project file modifications)
  "todo",
  // Control flow
  "signal_loop_success",
  // UI / interaction
  "ask_user",
  "answer",
]);

// Plan mode: strict whitelist — only these tools are allowed
const PLAN_WHITELIST = new Set([...COMMON_READ_ONLY, "bash"]);

// Manual mode: tools that require approval (modifications & executions)
const MANUAL_GATED = new Set(["write", "edit", "bash", "stata", "python-repl"]);

// ──────────────────────────────────────────────
// Safe bash commands for Plan & Manual modes (read-only only)
// Commands are whitelisted by their first word (command name)
// ──────────────────────────────────────────────
const SAFE_BASH_COMMANDS = new Set([
  // Search & grep
  "rg",
  "fd",
  "grep",
  "ag",
  "pt",
  "ripgrep",
  // File system info
  "ls",
  "tree",
  "stat",
  "file",
  "find",
  "du",
  "df",
  "pwd",
  "which",
  "type",
  // Output formatting
  "column",
  "fmt",
  "expand",
  "unexpand",
  "fold",
  "paste",
  "pr",
  // File content (read-only)
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "zcat",
  "zless",
  "nl",
  "tac",
  "rev",
  // Data/Config Processing (read-only only)
  "jq",
  // Text processing (read-only only)
  "sort",
  "uniq",
  "wc",
  "cut",
  "tr",
  "diff",
  "comm",
  "join",
  // System/Debugging (read-only only)
  "lsof",
  "ss",
  "netstat",
  "lspci",
  "lsusb",
  "lscpu",
  "dmidecode",
  "lsblk",
  // System info (read-only only)
  "env",
  "printenv",
  "whoami",
  "id",
  "uptime",
  "free",
  "ps",
  "cal",
  // Crypto/Integrity (read-only only)
  "sha1sum",
  "cksum",
  // Math & encoding
  "bc",
  "md5sum",
  "sha256sum",
  "base64",
  "xxd",
  "hexdump",
  "od",
  "strings",
  "nm",
  "objdump",
  "readelf",
  // Timing/Benchmarking
  "time",
  // Documentation
  "man",
  "info",
  "apropos",
  "whatis",
  // Other read-only utilities
  "echo",
  "true",
  "false",
]);

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// Extract the first command from a bash command string
function getFirstCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "";

  // Handle subshell, pipes, etc. - get the first command
  const firstPart = trimmed.split(/[\s|;&$()]/)[0];
  return firstPart;
}

// Check if a bash command is safe for Plan mode (read-only only)
function isPlanSafeBashCommand(command: string): boolean {
  // If it redirects output to a file (other than /dev/null), it's not purely read-only
  const modifiedFiles = extractModifiedFiles(command);
  if (modifiedFiles.length > 0) return false;

  // Split by control operators to evaluate every command in the pipeline/list
  // while respecting single and double quotes.
  const parts: string[] = [];
  let currentPart = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escapeNext) {
      currentPart += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      currentPart += char;
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      currentPart += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      currentPart += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '|' && command[i + 1] === '|') {
        parts.push(currentPart);
        currentPart = "";
        i++;
        continue;
      }
      if (char === '&' && command[i + 1] === '&') {
        parts.push(currentPart);
        currentPart = "";
        i++;
        continue;
      }
      if (char === '|' || char === ';') {
        parts.push(currentPart);
        currentPart = "";
        continue;
      }
    }

    currentPart += char;
  }
  if (currentPart) {
    parts.push(currentPart);
  }
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    // Get the first actual command word (ignoring env vars like FOO=bar)
    const words = trimmed.split(/\s+/);
    let cmdWord = "";
    for (const w of words) {
      if (/^[a-zA-Z_][a-zA-Z0-9_]*=/.test(w)) continue;
      cmdWord = w;
      break;
    }
    
    if (!cmdWord) continue;
    
    // Strip common subshell wrappers if they are attached to the word
    cmdWord = cmdWord.replace(/^\$\(/, "").replace(/^`/, "");

    // If any command is NOT in the whitelist, the whole string is unsafe
    if (!SAFE_BASH_COMMANDS.has(cmdWord)) {
      return false;
    }
  }

  return true;
}

// Ask the user a question using Pi's native UI
async function askUser(query: string, ctx: any, details?: string): Promise<boolean> {
  const promptText = details ? `${details}\n\n${query}` : query;
  const answer = await ctx.ui.input("Approval Required", promptText);
  if (answer === null || answer === undefined) {
    return false;
  }
  const clean = answer.trim().toLowerCase();
  return clean === "y" || clean === "yes" || clean === "";
}

// Generate a diff between old and new file content
function getDiff(filePath: string, oldContent: string, newContent: string, colorize: boolean = false): string {
  const tempDir = os.tmpdir();
  const oldTemp = path.join(tempDir, `pi_old_${Date.now()}_${path.basename(filePath)}`);
  const newTemp = path.join(tempDir, `pi_new_${Date.now()}_${path.basename(filePath)}`);

  fs.writeFileSync(oldTemp, oldContent);
  fs.writeFileSync(newTemp, newContent);

  try {
    const diffCmd = `git diff --no-index ${colorize ? '--color=always ' : ''}"${oldTemp}" "${newTemp}"`;
    let output: string;
    try {
      output = execSync(diffCmd, { encoding: "utf8" });
    } catch (error: any) {
      if (error.stdout) {
        output = error.stdout;
      } else {
        return `Failed to generate diff: ${error.message}`;
      }
    }

    // Strip ANSI codes for header-line detection, then clean up temp paths.
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;:?]*[a-zA-Z]/g, "");
    const isNewFile = !oldContent;

    output = output
      .split("\n")
      .filter(line => {
        const bare = stripAnsi(line);
        // Drop the "diff --git a/tmp/... b/tmp/..." and "index ..." header lines —
        // they reference temp paths and add no value when we already print the filename.
        return !bare.startsWith("diff --git") && !bare.startsWith("index ");
      })
      .map(line => {
        const bare = stripAnsi(line);
        // Replace temp paths in the --- / +++ lines with real paths.
        if (bare.startsWith("--- ")) {
          const label = isNewFile ? "/dev/null" : `a/${filePath}`;
          return colorize ? `\x1b[31m--- ${label}\x1b[0m` : `--- ${label}`;
        }
        if (bare.startsWith("+++ ")) {
          return colorize ? `\x1b[33m+++ b/${filePath}\x1b[0m` : `+++ b/${filePath}`;
        }
        return line;
      })
      .join("\n");

    return output;
  } finally {
    try {
      if (fs.existsSync(oldTemp)) fs.unlinkSync(oldTemp);
      if (fs.existsSync(newTemp)) fs.unlinkSync(newTemp);
    } catch (e) {}
  }
}

// Get current working-tree git diff (for post-execution display)
function getGitDiff(): string {
  try {
    return execSync("git diff --color=always", { encoding: "utf8" });
  } catch {
    return "";
  }
}

// Extract file paths that a bash command appears to write to
function extractModifiedFiles(command: string): string[] {
  const files = new Set<string>();

  // Remove quoted strings to avoid false positives with > or tee inside quotes
  let unquotedCommand = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;
  
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote) {
      unquotedCommand += char;
    }
  }

  // Shell redirects: > file  or  >> file
  const redirectMatch = unquotedCommand.match(/>{1,2}\s*([^\s;|&>]+)/g);
  if (redirectMatch) {
    for (const m of redirectMatch) {
      const file = m.replace(/^>{1,2}\s*/, "");
      if (!file.startsWith("$") && !/^&(\d+|-)$/.test(file) && !file.includes("*") && !file.includes("?") && file !== "/dev/null") {
        files.add(file);
      }
    }
  }

  // tee [-options] file
  const teeRegex = /tee\s+(?:-[a-zA-Z]+\s+)*([^\s;|&]+)/g;
  let teeMatch: RegExpExecArray | null;
  while ((teeMatch = teeRegex.exec(unquotedCommand)) !== null) {
    const file = teeMatch[1]; // capture group is the filename, options already consumed
    if (!file.startsWith("$") && !file.includes("*") && !file.includes("?") && file !== "/dev/null") {
      files.add(file);
    }
  }

  return Array.from(files);
}

// ──────────────────────────────────────────────
// Plugin entry point
// ──────────────────────────────────────────────
export default function (pi: any) {
  // ── Slash Commands ──
  pi.registerCommand("plan", {
    description: "Switch to Plan Mode (Read-Only Planning with full exploration tools)",
    handler: async (args: any, ctx: any) => {
      currentMode = "plan";
      ctx.ui.notify(
        "Workflow Mode set to PLAN. Read-only exploration with safe bash commands (rg, git, grep, etc.).",
        "info",
      );
    },
  });

  pi.registerCommand("manual", {
    description: "Switch to Manual Mode (Gated approvals with diffs)",
    handler: async (args: any, ctx: any) => {
      currentMode = "manual";
      ctx.ui.notify(
        "Workflow Mode set to MANUAL. Read-only tools unrestricted; file edits and commands require approval with diffs.",
        "info",
      );
    },
  });

  pi.registerCommand("auto", {
    description: "Switch to Auto Mode (Fully autonomous execution)",
    handler: async (args: any, ctx: any) => {
      currentMode = "auto";
      autoModeOriginalContents.clear(); // Reset tracking when switching to auto
      ctx.ui.notify(
        "Workflow Mode set to AUTO. Full autonomy enabled. A final diff will be shown at completion.",
        "info",
      );
    },
  });

  pi.registerCommand("mode", {
    description: "Display the active workflow mode",
    handler: async (args: any, ctx: any) => {
      ctx.ui.notify(`Active Workflow Mode: ${currentMode.toUpperCase()}`, "info");
    },
  });

  // ── Tool Call Interceptor ──
  pi.on("tool_call", async (event: any, ctx: any) => {
    // ── 1. PLAN MODE ──
    if (currentMode === "plan") {
      // Non-bash tools: use the whitelist
      if (event.toolName !== "bash" && !PLAN_WHITELIST.has(event.toolName)) {
        ctx.ui.notify(`[Plan Mode] Blocked tool execution: ${event.toolName}`, "error");
        return {
          block: true,
          reason: `You are in Plan mode. You cannot use potentially destructive commands or mutation tools like '${event.toolName}'. Your job is strictly to research and explain your proposed changes in the chat. Ask the user for approval or wait for them to switch to Auto or Manual mode before making modifications.`,
        };
      }

      // Bash: check if the command is safe (read-only only)
      if (event.toolName === "bash") {
        const command = event.input.command || "";
        if (!isPlanSafeBashCommand(command)) {
          const firstCmd = getFirstCommand(command);
          ctx.ui.notify(`[Plan Mode] Blocked bash: '${firstCmd}' is not in the safe command whitelist`, "error");
          return {
            block: true,
            reason: `You are in Plan mode. You cannot use potentially destructive bash commands. Bash commands are restricted strictly to safe read-only operations. '${firstCmd}' is not in the whitelist. Use approved commands like rg, git, grep, ls, etc., and explain your plan to the user in chat.`,
          };
        }
        // Command is safe — allow it through
        return {};
      }

      return {};
    }

    // ── 3. AUTO MODE TRACKING ──
    if (currentMode === "auto") {
      if (event.toolName === "write" || event.toolName === "edit") {
        const filePath = event.input.path || event.input.targetFile;
        if (filePath && !autoModeOriginalContents.has(filePath)) {
          if (fs.existsSync(filePath)) {
            autoModeOriginalContents.set(filePath, fs.readFileSync(filePath, "utf8"));
          } else {
            autoModeOriginalContents.set(filePath, null);
          }
        }
      } else if (event.toolName === "bash") {
        const command = event.input.command || "";
        const modifiedFiles = extractModifiedFiles(command);
        for (const filePath of modifiedFiles) {
          if (!autoModeOriginalContents.has(filePath)) {
            if (fs.existsSync(filePath)) {
              autoModeOriginalContents.set(filePath, fs.readFileSync(filePath, "utf8"));
            } else {
              autoModeOriginalContents.set(filePath, null);
            }
          }
        }
      }
    }

    // ── 2. MANUAL MODE ──
    if (currentMode === "manual") {
      // Common read-only tools pass through without approval
      if (COMMON_READ_ONLY.has(event.toolName)) {
        return {};
      }

      // ── write: show diff before approval ──
      if (event.toolName === "write") {
        const filePath = event.input.path || event.input.targetFile;
        const newContent = event.input.content || event.input.code || "";
        let oldContent = "";
        if (filePath && fs.existsSync(filePath)) {
          oldContent = fs.readFileSync(filePath, "utf8");
        }

        const diff = getDiff(filePath, oldContent, newContent);
        const details = `--- Proposed Changes for: ${filePath} ---\n${diff}`;
        const approved = await askUser(`Approve these changes? [Y/n] `, ctx, details);
        if (!approved) {
          ctx.ui.notify(`Write blocked: ${filePath}`, "error");
          return {
            block: true,
            reason: `User rejected writing to ${filePath}. Please revise your changes.`,
          };
        }
        ctx.ui.notify(`Approved writing to ${filePath}`, "success");
        return {};
      }

      // ── edit: show diff before approval ──
      if (event.toolName === "edit") {
        const filePath = event.input.path || event.input.targetFile;
        const oldText = event.input.oldText;
        const newText = event.input.newText;
        let oldContent = "";
        let newContent = "";

        if (filePath && fs.existsSync(filePath)) {
          oldContent = fs.readFileSync(filePath, "utf8");
        }

        if (oldText && oldContent.includes(oldText)) {
          newContent = oldContent.replace(oldText, newText);
        } else {
          newContent = newText || "";
        }

        const diff = getDiff(filePath, oldContent, newContent);
        const details = `--- Proposed Edits for: ${filePath} ---\n${diff}`;
        const approved = await askUser(`Approve these edits? [Y/n] `, ctx, details);
        if (!approved) {
          ctx.ui.notify(`Edits blocked: ${filePath}`, "error");
          return {
            block: true,
            reason: `User rejected editing ${filePath}. Please revise your changes.`,
          };
        }
        ctx.ui.notify(`Approved edits to ${filePath}`, "success");
        return {};
      }

      // ── bash: check whitelist first, then approval if needed ──
      if (event.toolName === "bash") {
        const command = event.input.command || "";

        // Check if the command is in the safe whitelist
        if (isPlanSafeBashCommand(command)) {
          // Safe command - allow without approval
          ctx.ui.notify(`Command approved (safe): ${command.substring(0, 60)}${command.length > 60 ? '...' : ''}`, "success");
          return {};
        }

        // Not in whitelist - show command + affected file contents before approval
        const modifiedFiles = extractModifiedFiles(command);

        let details = `--- Proposed Command to Run ---\n$ ${command}`;

        if (modifiedFiles.length > 0) {
          details += `\n\nAffected files (current content):\n`;
          for (const file of modifiedFiles) {
            if (fs.existsSync(file)) {
              const content = fs.readFileSync(file, "utf8");
              const truncated =
                content.length > 2000 ? content.substring(0, 2000) + "\n... (truncated)" : content;
              details += `\n--- ${file} ---\n${truncated}\n`;
            }
          }
        }

        const approved = await askUser(`Execute command? [Y/n] `, ctx, details);
        if (!approved) {
          ctx.ui.notify(`Command blocked: ${command.substring(0, 30)}...`, "error");
          return {
            block: true,
            reason: `User rejected execution of command: "${command}".`,
          };
        }
        ctx.ui.notify(`Command execution approved`, "success");
        return {};
      }

      // ── stata / python-repl: show code before approval ──
      if (event.toolName === "stata" || event.toolName === "python-repl") {
        const code = event.input.code || event.input.command || "";
        const details = `--- Proposed Code to Run (${event.toolName}) ---\n${code}`;
        const approved = await askUser(`Execute ${event.toolName} code? [Y/n] `, ctx, details);
        if (!approved) {
          ctx.ui.notify(`Execution blocked`, "error");
          return {
            block: true,
            reason: `User rejected execution of ${event.toolName} code.`,
          };
        }
        ctx.ui.notify(`${event.toolName} execution approved`, "success");
        return {};
      }

      // ── catch-all: gate any unrecognized non-read-only tool ──
      const details = `Tool: ${event.toolName}\nInput: ${JSON.stringify(event.input, null, 2)}`;
      const approved = await askUser(`Allow tool '${event.toolName}'? [Y/n] `, ctx, details);
      if (!approved) {
        ctx.ui.notify(`Tool '${event.toolName}' blocked`, "error");
        return {
          block: true,
          reason: `User rejected tool '${event.toolName}'.`,
        };
      }
      ctx.ui.notify(`Tool '${event.toolName}' approved`, "success");
      return {};
    }

    return {};
  });

  // ── Session-end hook (auto mode only) ──
  pi.on("agent_end", async (event: any, ctx: any) => {
    if (currentMode === "auto") {
      console.log(`\n\x1b[32m=== Auto Mode Run Finished. Displaying final diffs ===\x1b[0m`);
      let hasDiffs = false;

      for (const [filePath, oldContent] of autoModeOriginalContents.entries()) {
        const fileExists = fs.existsSync(filePath);
        const newContent = fileExists ? fs.readFileSync(filePath, "utf8") : null;
        
        // Skip if there are no changes
        if (oldContent === newContent) continue;
        
        hasDiffs = true;
        const isNewFile = oldContent === null;
        const label = isNewFile ? `${filePath}  \x1b[32m(new file)\x1b[0m` : filePath;
        console.log(`\n\x1b[1;36m╔══ ${label} ══╗\x1b[0m\n`);

        const diffOutput = getDiff(
          filePath,
          oldContent || "",
          newContent || "",
          true // colorize
        );
        console.log(diffOutput);
      }

      if (!hasDiffs) {
        console.log("No file changes detected during this run.");
      }

      // Reset for next run
      autoModeOriginalContents.clear();
    }
  });
}
