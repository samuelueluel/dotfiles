import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  autoHealSedCommand,
  checkDestructiveCommand,
  checkExploreMutatingCommand,
  checkExplorePrompt,
  checkPrivilegedOrHostMutation,
  checkVaultShellAccess,
  healZoteroWorkerInput,
  isChezmoiManaged,
  isDotfilesStaticPath,
  shouldRunPostToolChecks,
  isSecretFilePath,
  isVaultNotePath,
  validateFileSyntax,
  DOTFILES_ROOT,
  VAULT_ROOT,
} from "../lib/workflow-invariants-logic.js";

export default function workflowInvariantsExtension(pi: ExtensionAPI): void {
  // Pre-tool checks: boundaries, privilege, destructive commands, auto-healing
  pi.on("tool_call", async (event, ctx) => {
    const isExplore = ctx?.getSystemPrompt?.()?.includes("STRICT READ-ONLY SEARCH SPECIALIST") ?? false;

    // Hard boundary for Explore subagents
    if (isExplore) {
      if (event.toolName === "write" || event.toolName === "edit") {
        return {
          block: true,
          reason:
            "Blocked by policy: Explore subagents are strictly read-only. File modifications are prohibited per Explore.md and Subagents.md.",
        };
      }
      if (event.toolName === "bash") {
        const cmd = String((event.input as { command?: unknown }).command || "");
        const check = checkExploreMutatingCommand(cmd);
        if (check.blocked) {
          return {
            block: true,
            reason: `Blocked by policy: ${check.reason}`,
          };
        }
      }
    }

    // Agent tool calls: delegation boundaries and zotero worker auto-healing
    if (event.toolName === "Agent") {
      const input = (event.input || {}) as Record<string, unknown>;
      const prompt = typeof input.prompt === "string" ? input.prompt : "";

      // 1. Check Explore prompt against mutations
      if (input.subagent_type === "Explore") {
        const check = checkExplorePrompt(prompt);
        if (check.blocked) {
          return {
            block: true,
            reason: `Blocked by policy: ${check.reason}`,
          };
        }
      }

      // 2. Auto-heal Zotero extraction workers
      const { healedInput, wasHealed } = healZoteroWorkerInput(input);
      if (wasHealed) {
        event.input = healedInput;
      }
    }

    // 1. Filesystem-touching tools: read, write, edit
    if (event.toolName === "read" || event.toolName === "write" || event.toolName === "edit") {
      const rawPath = String((event.input as { path?: unknown }).path || "");
      if (rawPath) {
        // Vault note isolation (with .obsidian config/snippets/plugins exception)
        if (isVaultNotePath(rawPath)) {
          return {
            block: true,
            reason:
              "Blocked by policy: Direct filesystem access to Obsidian vault notes is prohibited. Route note operations through TurboVault MCP tools (turbovault_read_note, turbovault_write_note, turbovault_edit_note). Access to .obsidian/ (CSS snippets, plugins, configuration) is permitted.",
          };
        }

        // Chezmoi dotfiles repo static edit guard
        if ((event.toolName === "write" || event.toolName === "edit") && isDotfilesStaticPath(rawPath)) {
          return {
            block: true,
            reason:
              "Blocked by policy: Do not edit static source files inside ~/dotfiles directly. Edit the live file in your home directory, then capture it with 'chezmoi add <live-path>'. (Editing .tmpl files directly is permitted).",
          };
        }

        // Secret credential access guard
        if (isSecretFilePath(rawPath)) {
          return {
            block: true,
            reason: "Blocked by policy: Access to private SSH, GPG, or cloud credentials is prohibited.",
          };
        }
      }
    }

    // 2. Auto-mkdir self-healing for write tool
    if (event.toolName === "write") {
      const rawPath = String((event.input as { path?: unknown }).path || "");
      if (rawPath) {
        const resolved = path.resolve(rawPath);
        const parentDir = path.dirname(resolved);
        if (!fs.existsSync(parentDir)) {
          try {
            fs.mkdirSync(parentDir, { recursive: true });
          } catch {
            // Ignore failure; let write tool report normal filesystem error if any
          }
        }
      }
    }

    // 3. Bash commands: privileged, destructive, vault access, and sed auto-healing
    if (event.toolName === "bash") {
      const cmd = String((event.input as { command?: unknown }).command || "");
      if (cmd) {
        // Auto-heal macOS/BSD sed -i '' on GNU sed Linux
        const healed = autoHealSedCommand(cmd);
        if (healed !== cmd) {
          (event.input as { command: string }).command = healed;
        }

        // Check vault access in shell
        if (checkVaultShellAccess(cmd)) {
          return {
            block: true,
            reason:
              "Blocked by policy: Direct shell operations on Obsidian vault notes are prohibited. Route note operations through TurboVault MCP tools. Access to .obsidian/ (CSS snippets, plugins) is permitted.",
          };
        }

        // Check privileged / immutable host commands
        const privCheck = checkPrivilegedOrHostMutation(cmd);
        if (privCheck.blocked) {
          return {
            block: true,
            reason: `Blocked by policy: ${privCheck.reason} If this is required to accomplish your goal, stop and ask Samuel for help.`,
          };
        }

        // Check destructive Git / filesystem commands
        const destCheck = checkDestructiveCommand(cmd);
        if (destCheck.blocked) {
          return {
            block: true,
            reason: `Blocked by policy: ${destCheck.reason} If this is required to accomplish your goal, stop and ask Samuel for help.`,
          };
        }
      }
    }
  });

  // Post-tool checks: Chezmoi staging reminder and syntax verification
  pi.on("tool_result", async (event) => {
    // Failed writes/edits did not establish a new file state. Do not validate
    // the old file or emit a staging reminder for an operation that failed.
    if (!shouldRunPostToolChecks(event.toolName, event.isError)) return;
    const rawPath = String((event.input as { path?: unknown }).path || "");
    if (!rawPath) return;

    const resolved = path.resolve(rawPath);

    // Multi-language syntax verification
    const syntaxCheck = validateFileSyntax(resolved);
    if (!syntaxCheck.valid && syntaxCheck.error) {
      event.content.push({
        type: "text",
        text: `\n\n[Syntax Error Detected] File '${resolved}' has invalid syntax:\n${syntaxCheck.error}\nPlease correct the syntax immediately.`,
      });
    }

    // Skip Chezmoi staging check for paths inside dotfiles repo or vault
    if (resolved.startsWith(DOTFILES_ROOT) || resolved.startsWith(VAULT_ROOT)) return;

    // Check if the live path is actively tracked by Chezmoi
    if (isChezmoiManaged(resolved)) {
      event.content.push({
        type: "text",
        text: `\n\n[Chezmoi Staging Reminder] Live file '${resolved}' is tracked by Chezmoi. Remember to validate and stage changes with: chezmoi add ${resolved}`,
      });
    }
  });
}
