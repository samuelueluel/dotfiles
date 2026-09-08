import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  checkDestructiveCommand,
  checkPrivilegedOrHostMutation,
  checkVaultShellAccess,
  isChezmoiManaged,
  isDotfilesStaticPath,
  isSecretFilePath,
  isVaultNotePath,
  DOTFILES_ROOT,
  VAULT_ROOT,
} from "../lib/workflow-invariants-logic.js";

export default function workflowInvariantsExtension(pi: ExtensionAPI): void {
  // Pre-tool checks: boundaries, privilege, destructive commands, auto-healing
  pi.on("tool_call", async (event) => {
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

    // 3. Bash commands: privileged, destructive, vault access
    if (event.toolName === "bash") {
      const cmd = String((event.input as { command?: unknown }).command || "");
      if (cmd) {
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

  // Post-tool checks: Chezmoi staging reminder for tracked live files
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    const rawPath = String((event.input as { path?: unknown }).path || "");
    if (!rawPath) return;

    const resolved = path.resolve(rawPath);

    // Skip paths inside the dotfiles repo or vault
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
