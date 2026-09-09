#!/usr/bin/env node
/**
 * agy-workflow-invariants.mjs
 * 
 * AGY (Antigravity) lifecycle hook adapter.
 * Reuses the pure, tested workflow invariant logic from:
 *   /var/home/samuel/.pi/agent/lib/workflow-invariants-logic.ts
 * 
 * Supports:
 *   - "pre"            (PreToolUse): blocks unsafe tools, auto-heals sed, auto-mkdir
 *   - "post"           (PostToolUse): validates syntax and checks Chezmoi status
 *   - "pre-invocation" (PreInvocation): emits ephemeral reminders on the wire
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Import pure logic from the shared invariants library (read-only)
import {
  isVaultNotePath,
  isDotfilesStaticPath,
  isSecretFilePath,
  checkPrivilegedOrHostMutation,
  checkDestructiveCommand,
  checkVaultShellAccess,
  autoHealSedCommand,
  validateFileSyntax,
  isChezmoiManaged,
  checkExplorePrompt,
  DOTFILES_ROOT,
  VAULT_ROOT,
} from "/var/home/samuel/.pi/agent/lib/workflow-invariants-logic.ts";

function getRemindersFilePath(conversationId) {
  const safeId = (conversationId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(os.tmpdir(), `agy-reminders-${safeId}.json`);
}

function readJsonStdin() {
  try {
    const input = fs.readFileSync(0, "utf-8");
    if (!input || !input.trim()) return {};
    return JSON.parse(input);
  } catch {
    return {};
  }
}

function writeJsonStdout(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function queueReminder(conversationId, text) {
  const filePath = getRemindersFilePath(conversationId);
  let reminders = [];
  try {
    if (fs.existsSync(filePath)) {
      reminders = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {
    reminders = [];
  }
  reminders.push(text);
  try {
    fs.writeFileSync(filePath, JSON.stringify(reminders), "utf-8");
  } catch {
    // Ignore tmp write failures
  }
}

function drainReminders(conversationId) {
  const filePath = getRemindersFilePath(conversationId);
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    fs.unlinkSync(filePath);
    return Array.isArray(data) ? data : [];
  } catch {
    try {
      fs.unlinkSync(filePath);
    } catch {}
    return [];
  }
}

// -----------------------------------------------------------------------------
// PRE-TOOL USE (PreToolUse)
// -----------------------------------------------------------------------------
function handlePreToolUse(payload) {
  const toolCall = payload.toolCall || {};
  const toolName = toolCall.name || "";
  const args = toolCall.args || {};

  // 1. run_command checks
  if (toolName === "run_command") {
    const cmd = String(args.CommandLine || "");
    if (cmd) {
      // Check shell vault access
      if (checkVaultShellAccess(cmd)) {
        return writeJsonStdout({
          decision: "deny",
          reason:
            "Blocked by policy: Direct shell operations on Obsidian vault notes are prohibited. Route note operations through TurboVault MCP tools. Access to .obsidian/ (CSS snippets, plugins) is permitted.",
        });
      }

      // Check privileged / immutable host commands
      const privCheck = checkPrivilegedOrHostMutation(cmd);
      if (privCheck.blocked) {
        return writeJsonStdout({
          decision: "deny",
          reason: `Blocked by policy: ${privCheck.reason} If this is required to accomplish your goal, stop and ask Samuel for help.`,
        });
      }

      // Check destructive Git and filesystem commands
      const destCheck = checkDestructiveCommand(cmd);
      if (destCheck.blocked) {
        return writeJsonStdout({
          decision: "deny",
          reason: `Blocked by policy: ${destCheck.reason} If this is required to accomplish your goal, stop and ask Samuel for help.`,
        });
      }

      // Auto-heal macOS/BSD sed -i '' on GNU sed Linux
      const healed = autoHealSedCommand(cmd);
      if (healed !== cmd) {
        return writeJsonStdout({
          decision: "allow",
          overwrite: { CommandLine: healed },
        });
      }
    }
    return writeJsonStdout({ decision: "allow" });
  }

  // 2. view_file checks
  if (toolName === "view_file") {
    const rawPath = String(args.AbsolutePath || "");
    if (rawPath) {
      const resolved = path.resolve(rawPath);
      if (isVaultNotePath(resolved)) {
        return writeJsonStdout({
          decision: "deny",
          reason:
            "Blocked by policy: Direct filesystem access to Obsidian vault notes is prohibited. Route note operations through TurboVault MCP tools (turbovault_read_note, turbovault_write_note, turbovault_edit_note). Access to .obsidian/ (CSS snippets, plugins, configuration) is permitted.",
        });
      }
      if (isSecretFilePath(resolved)) {
        return writeJsonStdout({
          decision: "deny",
          reason: "Blocked by policy: Access to private SSH, GPG, or cloud credentials is prohibited.",
        });
      }
    }
    return writeJsonStdout({ decision: "allow" });
  }

  // 3. write_to_file checks
  if (toolName === "write_to_file") {
    const rawPath = String(args.TargetFile || "");
    if (rawPath) {
      const resolved = path.resolve(rawPath);

      if (isVaultNotePath(resolved)) {
        return writeJsonStdout({
          decision: "deny",
          reason:
            "Blocked by policy: Direct filesystem access to Obsidian vault notes is prohibited. Route note operations through TurboVault MCP tools (turbovault_read_note, turbovault_write_note, turbovault_edit_note). Access to .obsidian/ (CSS snippets, plugins, configuration) is permitted.",
        });
      }

      if (isDotfilesStaticPath(resolved)) {
        return writeJsonStdout({
          decision: "deny",
          reason:
            "Blocked by policy: Do not edit static source files inside ~/dotfiles directly. Edit the live file in your home directory, then capture it with 'chezmoi add <live-path>'. (Editing .tmpl files directly is permitted).",
        });
      }

      if (isSecretFilePath(resolved)) {
        return writeJsonStdout({
          decision: "deny",
          reason: "Blocked by policy: Access to private SSH, GPG, or cloud credentials is prohibited.",
        });
      }

      // Auto-mkdir self-healing
      const parentDir = path.dirname(resolved);
      if (!fs.existsSync(parentDir)) {
        try {
          fs.mkdirSync(parentDir, { recursive: true });
        } catch {
          // Ignore; let tool handle or report
        }
      }
    }
    return writeJsonStdout({ decision: "allow" });
  }

  // 4. replace_file_content checks
  if (toolName === "replace_file_content") {
    const rawPath = String(args.TargetFile || "");
    if (rawPath) {
      const resolved = path.resolve(rawPath);

      if (isVaultNotePath(resolved)) {
        return writeJsonStdout({
          decision: "deny",
          reason:
            "Blocked by policy: Direct filesystem access to Obsidian vault notes is prohibited. Route note operations through TurboVault MCP tools (turbovault_read_note, turbovault_write_note, turbovault_edit_note). Access to .obsidian/ (CSS snippets, plugins, configuration) is permitted.",
        });
      }

      if (isDotfilesStaticPath(resolved)) {
        return writeJsonStdout({
          decision: "deny",
          reason:
            "Blocked by policy: Do not edit static source files inside ~/dotfiles directly. Edit the live file in your home directory, then capture it with 'chezmoi add <live-path>'. (Editing .tmpl files directly is permitted).",
        });
      }

      if (isSecretFilePath(resolved)) {
        return writeJsonStdout({
          decision: "deny",
          reason: "Blocked by policy: Access to private SSH, GPG, or cloud credentials is prohibited.",
        });
      }
    }
    return writeJsonStdout({ decision: "allow" });
  }

  // 5. invoke_subagent checks
  if (toolName === "invoke_subagent") {
    const subagents = Array.isArray(args.Subagents) ? args.Subagents : [];
    for (const subagent of subagents) {
      if (subagent.TypeName === "research") {
        const prompt = String(subagent.Prompt || "");
        const check = checkExplorePrompt(prompt);
        if (check.blocked) {
          return writeJsonStdout({
            decision: "deny",
            reason: `Blocked by policy: ${check.reason}`,
          });
        }
      }
    }
    return writeJsonStdout({ decision: "allow" });
  }

  return writeJsonStdout({ decision: "allow" });
}

// -----------------------------------------------------------------------------
// POST-TOOL USE (PostToolUse)
// -----------------------------------------------------------------------------
function handlePostToolUse(payload) {
  // Only process successful tool results
  if (payload.error) {
    return writeJsonStdout({});
  }

  const toolCall = payload.toolCall || {};
  const toolName = toolCall.name || "";
  const args = toolCall.args || {};
  const conversationId = payload.conversationId || "";

  if (toolName === "write_to_file" || toolName === "replace_file_content") {
    const rawPath = String(args.TargetFile || "");
    if (rawPath) {
      const resolved = path.resolve(rawPath);

      // 1. Multi-language syntax verification
      const syntaxCheck = validateFileSyntax(resolved);
      if (!syntaxCheck.valid && syntaxCheck.error) {
        queueReminder(
          conversationId,
          `[Syntax Error Detected] File '${resolved}' has invalid syntax:\n${syntaxCheck.error}\nPlease correct the syntax immediately.`
        );
      }

      // 2. Chezmoi staging reminder (only for tracked live files outside dotfiles and vault)
      if (!resolved.startsWith(DOTFILES_ROOT) && !resolved.startsWith(VAULT_ROOT)) {
        if (isChezmoiManaged(resolved)) {
          queueReminder(
            conversationId,
            `[Chezmoi Staging Reminder] Live file '${resolved}' is tracked by Chezmoi. Remember to validate and stage changes with: chezmoi add ${resolved}`
          );
        }
      }
    }
  }

  return writeJsonStdout({});
}

// -----------------------------------------------------------------------------
// PRE-INVOCATION (PreInvocation)
// -----------------------------------------------------------------------------
function handlePreInvocation(payload) {
  const conversationId = payload.conversationId || "";
  const reminders = drainReminders(conversationId);

  if (reminders.length === 0) {
    return writeJsonStdout({});
  }

  const injectSteps = reminders.map((msg) => ({
    ephemeralMessage: msg,
  }));

  return writeJsonStdout({ injectSteps });
}

// -----------------------------------------------------------------------------
// CLI ROUTER
// -----------------------------------------------------------------------------
const mode = process.argv[2] || "pre";
const payload = readJsonStdin();

switch (mode) {
  case "pre":
  case "PreToolUse":
    handlePreToolUse(payload);
    break;
  case "post":
  case "PostToolUse":
    handlePostToolUse(payload);
    break;
  case "pre-invocation":
  case "PreInvocation":
    handlePreInvocation(payload);
    break;
  default:
    writeJsonStdout({});
    break;
}
