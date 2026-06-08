import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";

// Mode state
let currentMode: "plan" | "manual" | "auto" = "manual";

// Whitelist of safe read-only tools for Plan Mode
const PLAN_WHITELIST = new Set([
  "read",
  "view_file",
  "list_dir",
  "grep_search",
  "find",
  "ls",
  "cat",
  "ask_user",
  "answer"
]);

// Helper to ask the user a question using Pi's native UI
async function askUser(query: string, ctx: any, details?: string): Promise<boolean> {
  const promptText = details ? `${details}\n\n${query}` : query;
  const answer = await ctx.ui.input("Approval Required", promptText);
  const clean = (answer || "").trim().toLowerCase();
  return clean === "y" || clean === "yes" || clean === "";
}

// Helper to generate diff text
function getDiff(filePath: string, oldContent: string, newContent: string): string {
  const tempDir = os.tmpdir();
  const oldTemp = path.join(tempDir, `pi_old_${Date.now()}_${path.basename(filePath)}`);
  const newTemp = path.join(tempDir, `pi_new_${Date.now()}_${path.basename(filePath)}`);

  fs.writeFileSync(oldTemp, oldContent);
  fs.writeFileSync(newTemp, newContent);

  try {
    const diffCmd = `git diff --no-index "${oldTemp}" "${newTemp}"`;
    return execSync(diffCmd, { encoding: "utf8" });
  } catch (error: any) {
    if (error.stdout) {
      return error.stdout;
    } else {
      return `Failed to generate diff: ${error.message}`;
    }
  } finally {
    try {
      if (fs.existsSync(oldTemp)) fs.unlinkSync(oldTemp);
      if (fs.existsSync(newTemp)) fs.unlinkSync(newTemp);
    } catch (e) {}
  }
}

export default function (pi: any) {
  // Register Slash Commands
  pi.registerCommand("plan", {
    description: "Switch to Plan Mode (Read-Only Planning)",
    handler: async (args: any, ctx: any) => {
      currentMode = "plan";
      ctx.ui.notify("Workflow Mode set to PLAN. All file writes and code executions are blocked.", "info");
    },
  });

  pi.registerCommand("manual", {
    description: "Switch to Manual Mode (Gated approvals with diffs)",
    handler: async (args: any, ctx: any) => {
      currentMode = "manual";
      ctx.ui.notify("Workflow Mode set to MANUAL. File edits will show diffs; commands will require approval.", "info");
    },
  });

  pi.registerCommand("auto", {
    description: "Switch to Auto Mode (Fully autonomous execution)",
    handler: async (args: any, ctx: any) => {
      currentMode = "auto";
      ctx.ui.notify("Workflow Mode set to AUTO. Full autonomy enabled. A final diff will be shown at completion.", "info");
    },
  });

  pi.registerCommand("mode", {
    description: "Display the active workflow mode",
    handler: async (args: any, ctx: any) => {
      ctx.ui.notify(`Active Workflow Mode: ${currentMode.toUpperCase()}`, "info");
    },
  });

  // Intercept Tool Calls
  pi.on("tool_call", async (event: any, ctx: any) => {
    // 1. PLAN MODE
    if (currentMode === "plan") {
      if (!PLAN_WHITELIST.has(event.toolName)) {
        ctx.ui.notify(`[Plan Mode] Blocked tool execution: ${event.toolName}`, "error");
        return {
          block: true,
          reason: `You are currently in Plan mode (read-only). You are not allowed to use the '${event.toolName}' tool. Explain your proposed changes or code in the chat and ask the user for approval first.`
        };
      }
      return {};
    }

    // 2. MANUAL MODE
    if (currentMode === "manual") {
      // Direct file edits: write
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
            reason: `User rejected writing to ${filePath}. Please revise your changes.`
          };
        }
        ctx.ui.notify(`Approved writing to ${filePath}`, "success");
        return {};
      }

      // Direct file edits: edit
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
            reason: `User rejected editing ${filePath}. Please revise your changes.`
          };
        }
        ctx.ui.notify(`Approved edits to ${filePath}`, "success");
        return {};
      }

      // Shell execution: bash
      if (event.toolName === "bash") {
        const command = event.input.command || "";
        const details = `--- Proposed Command to Run ---\n$ ${command}`;
        const approved = await askUser(`Execute command? [Y/n] `, ctx, details);
        if (!approved) {
          ctx.ui.notify(`Command blocked: ${command.substring(0, 30)}...`, "error");
          return {
            block: true,
            reason: `User rejected execution of command: "${command}".`
          };
        }
        ctx.ui.notify(`Command execution approved`, "success");
        return {};
      }

      // MCP execution tools: stata and python-repl
      if (event.toolName === "stata" || event.toolName === "python-repl") {
        const code = event.input.code || event.input.command || "";
        const details = `--- Proposed Code to Run (${event.toolName}) ---\n${code}`;
        const approved = await askUser(`Execute ${event.toolName} code? [Y/n] `, ctx, details);
        if (!approved) {
          ctx.ui.notify(`Execution blocked`, "error");
          return {
            block: true,
            reason: `User rejected execution of ${event.toolName} code.`
          };
        }
        ctx.ui.notify(`${event.toolName} execution approved`, "success");
        return {};
      }
    }

    return {};
  });

  // End of session / agent completion hook
  pi.on("agent_end", async (event: any, ctx: any) => {
    if (currentMode === "auto") {
      console.log(`\n\x1b[32m=== Auto Mode Run Finished. Displaying final diffs ===\x1b[0m`);
      try {
        const finalDiff = execSync("git diff --color=always", { encoding: "utf8" });
        if (finalDiff.trim()) {
          console.log(finalDiff);
        } else {
          console.log("No git changes detected.");
        }
      } catch (error) {
        console.error("Could not run git diff:", error);
      }
    }
  });
}
