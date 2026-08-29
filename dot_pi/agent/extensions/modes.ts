import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Mode state
let currentMode: "plan" | "manual" | "auto" =
  process.env.PI_DEFAULT_MODE === "plan" ? "plan" :
  (process.argv.includes("-a") || process.argv.includes("--approve")) ? "auto" : "manual";

// cptr launches a separate, headless Pi process for Open WebUI. Keep its
// policy distinct from terminal Pi without changing the shared Pi settings.
const CPTR_HEADLESS = process.env.PI_CPTR_HEADLESS === "1";
const SCOPED_FILESYSTEM_PREFIX = "openwebui_filesystem_";
const TURBOVAULT_NAMESPACE_PROXY = "mcp__turbovault";
const MCP_MUTATION_PATTERN = /delete|write|edit|move|rollback|create|update|remove|batch_execute/i;
const HEADLESS_INTERACTIVE_COMMANDS = new Set(["bc", "less", "more", "zless", "man", "info", "apropos", "whatis"]);

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
  // TurboVault read-only operations (used by direct tools and proxy payloads)
  "turbovault_read_note",
  "turbovault_get_notes_info",
  "turbovault_search",
  "turbovault_advanced_search",
  "turbovault_search_by_frontmatter",
  "turbovault_semantic_search",
  "turbovault_query_frontmatter_sql",
  "turbovault_inspect_frontmatter",
  "turbovault_get_backlinks",
  "turbovault_get_forward_links",
  "turbovault_get_broken_links",
  "turbovault_get_related_notes",
  "turbovault_get_hub_notes",
  "turbovault_suggest_links",
  "turbovault_list_templates",
  "turbovault_quick_health_check",
  "turbovault_get_vault_context",
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

// Conservative headless bash policy. We allow known read-only commands and
// pipelines, but reject shell operators that can redirect, chain, or execute
// arbitrary commands. Terminal Pi continues to use the interactive policy.
function splitReadOnlyPipeline(command: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const next = command[i + 1];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }
    if (char === "\\" && !inSingleQuote) {
      current += char;
      escapeNext = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }
    if (!inSingleQuote && (char === "`" || (char === "$" && next === "("))) {
      return null;
    }
    if (!inSingleQuote && !inDoubleQuote) {
      if (char === "|" && next !== "|") {
        if (!current.trim()) return null;
        parts.push(current.trim());
        current = "";
        continue;
      }
      if (char === "|" || char === ";" || char === "&" || char === "<" || char === ">" || char === "`" || char === "\n" || char === "\r") {
        return null;
      }
      if (char === "$" && next === "(") {
        return null;
      }
    }
    current += char;
  }

  if (inSingleQuote || inDoubleQuote || !current.trim()) return null;
  parts.push(current.trim());
  return parts;
}

function isHeadlessReadOnlyBashCommand(command: string): boolean {
  const parts = splitReadOnlyPipeline(command);
  if (!parts) return false;

  for (const part of parts) {
    const words = part.split(/\s+/).filter(Boolean);
    let index = 0;
    while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) index++;
    if (index >= words.length) return false;

    const commandName = words[index].replace(/^.*\//, "");
    if (!SAFE_BASH_COMMANDS.has(commandName)) return false;
    if (HEADLESS_INTERACTIVE_COMMANDS.has(commandName)) return false;

    // These options turn otherwise read-oriented commands into command
    // launchers or file writers.
    if (commandName === "find" && /(?:^|\s)-(?:exec(?:dir)?|delete|ok(?:dir)?|fls|fprint(?:0|f)?|fprintf)(?:\s|$)/.test(part)) return false;
    if (commandName === "fd" && /(?:^|\s)--exec(?:-batch)?(?:[=\s]|$)/.test(part)) return false;
    if (commandName === "rg" && /(?:^|\s)--pre(?:[=\s]|$)/.test(part)) return false;
    if (commandName === "sort" && /(?:^|\s)-o(?:[=\s]|$)/.test(part)) return false;
    if (commandName === "env" || commandName === "time") return false;
  }

  return true;
}

function isZoteroReadOnlyTool(toolName: string): boolean {
  const normalized = toolName.replace(/-/g, "_");
  return normalized.startsWith("zotero_") && !MCP_MUTATION_PATTERN.test(normalized);
}

function isScopedFilesystemTool(toolName: string): boolean {
  return toolName.replace(/-/g, "_").startsWith(SCOPED_FILESYSTEM_PREFIX);
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
      ctx.ui.notify(
        "Workflow Mode set to AUTO. Full autonomy enabled.",
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

    // ── 2. MANUAL MODE ──
    if (currentMode === "manual") {
      // ── MCP tool handling ──
      // Open WebUI may use the generic proxy form, while proxy-only servers
      // use mcp__<server>. Inspect the nested operation so read-only
      // TurboVault calls pass without exposing every server tool directly.
      if (event.toolName === TURBOVAULT_NAMESPACE_PROXY) {
        const fullToolName = String(event.input?.tool || "");

        // Only exact entries in COMMON_READ_ONLY bypass approval. In
        // particular, do not treat the namespace proxy itself as safe: any
        // mutable or unknown underlying operation still requires approval.
        if (fullToolName.startsWith("turbovault_") && COMMON_READ_ONLY.has(fullToolName)) return {};

        if (CPTR_HEADLESS) {
          return {
            block: true,
            reason: `Open WebUI Pi policy blocks unapproved TurboVault operation '${fullToolName}'.`,
          };
        }
        const details = `TurboVault proxy call: ${fullToolName}\nInput: ${JSON.stringify(event.input, null, 2)}`;
        const approved = await askUser(`Approve TurboVault operation '${fullToolName}'? [Y/n] `, ctx, details);
        if (!approved) {
          ctx.ui.notify(`TurboVault operation blocked: ${fullToolName}`, "error");
          return { block: true, reason: `User rejected TurboVault operation: ${fullToolName}` };
        }
        ctx.ui.notify(`TurboVault operation approved`, "success");
        return {};
      }

      // The generic proxy is still used by some clients. Keep its existing
      // scoped-server/Zotero behavior, but require exact read-only names for
      // TurboVault rather than relying only on mutation-name heuristics.
      if (event.toolName === "mcp") {
        const fullToolName = String(event.input?.tool || event.input?.name || event.input?.subcommand || event.input?.command || "");
        const isScopedTool = isScopedFilesystemTool(fullToolName);
        const isTurboVaultTool = fullToolName.startsWith("turbovault_");
        const isTurboVaultRead = isTurboVaultTool && COMMON_READ_ONLY.has(fullToolName);
        const isZoteroRead = isZoteroReadOnlyTool(fullToolName);
        const isWriteOp = MCP_MUTATION_PATTERN.test(fullToolName);

        if (isTurboVaultRead) return {};
        if ((isScopedTool || isZoteroRead) && (CPTR_HEADLESS || !isWriteOp)) return {};
        if (!isTurboVaultTool && !isWriteOp) return {};
        if (CPTR_HEADLESS) {
          return {
            block: true,
            reason: `Open WebUI Pi policy blocks MCP operation '${fullToolName}'. Use the explicitly allowed scoped server or read-only TurboVault operation.`,
          };
        }
        const details = `MCP Tool Call: ${fullToolName}\nInput: ${JSON.stringify(event.input, null, 2)}`;
        const approved = await askUser(`Approve MCP operation '${fullToolName}'? [Y/n] `, ctx, details);
        if (!approved) {
          ctx.ui.notify(`MCP operation blocked: ${fullToolName}`, "error");
          return { block: true, reason: `User rejected MCP operation: ${fullToolName}` };
        }
        ctx.ui.notify(`MCP operation approved`, "success");
        return {};
      }

      // ── scoped filesystem direct tools ──
      if (isScopedFilesystemTool(event.toolName) && CPTR_HEADLESS) {
        return {};
      }

      // ── turbovault direct tools (exposed via directTools, not routed through `mcp`) ──
      if (event.toolName.startsWith("turbovault_")) {
        if (COMMON_READ_ONLY.has(event.toolName)) return {};
        if (CPTR_HEADLESS) {
          return {
            block: true,
            reason: `Open WebUI Pi policy blocks unapproved TurboVault operation '${event.toolName}'.`,
          };
        }
        const details = `turbovault tool call: ${event.toolName}\nInput: ${JSON.stringify(event.input, null, 2)}`;
        const approved = await askUser(`Approve turbovault operation '${event.toolName}'? [Y/n] `, ctx, details);
        if (!approved) {
          ctx.ui.notify(`turbovault operation blocked: ${event.toolName}`, "error");
          return { block: true, reason: `User rejected turbovault operation: ${event.toolName}` };
        }
        ctx.ui.notify(`turbovault operation approved`, "success");
        return {};
      }

      // Common read-only tools pass through without approval
      if (COMMON_READ_ONLY.has(event.toolName)) {
        return {};
      }

      // ── write: show diff before approval ──
      if (event.toolName === "write") {
        if (CPTR_HEADLESS) {
          return {
            block: true,
            reason: "Open WebUI Pi policy blocks direct filesystem writes. Use the folder-scoped filesystem MCP instead.",
          };
        }
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
        if (CPTR_HEADLESS) {
          return {
            block: true,
            reason: "Open WebUI Pi policy blocks direct filesystem edits. Use the folder-scoped filesystem MCP instead.",
          };
        }
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

      // ── bash: cptr allows only conservative read-only commands ──
      if (event.toolName === "bash") {
        const command = event.input.command || "";

        if (CPTR_HEADLESS) {
          if (isHeadlessReadOnlyBashCommand(command)) return {};
          return {
            block: true,
            reason: "Open WebUI Pi policy blocks filesystem-changing or arbitrary shell commands. Use the folder-scoped filesystem MCP for file access.",
          };
        }

        // Check whitelist first, then approval if needed
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
        if (CPTR_HEADLESS) {
          return {
            block: true,
            reason: `Open WebUI Pi policy blocks ${event.toolName} execution because it requires interactive approval.`,
          };
        }
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
      if (CPTR_HEADLESS) {
        return {
          block: true,
          reason: `Open WebUI Pi policy blocks unapproved tool '${event.toolName}'.`,
        };
      }
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

}
