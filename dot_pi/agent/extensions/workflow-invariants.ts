import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  autoHealSedCommand,
  checkAuditClaimsPayload,
  checkComparisonManifestPayload,
  checkDestructiveCommand,
  checkEvidenceBundlePayload,
  checkExploreMutatingCommand,
  checkExplorePrompt,
  checkPrivilegedOrHostMutation,
  checkResultEvidenceBudget,
  checkSecretShellAccess,
  checkSessionSummaryStoreShellAccess,
  checkVaultShellAccess,
  checkZoteroCloudUpload,
  checkZoteroIndexMutation,
  checkZoteroSemanticResult,
  DEFAULT_EVIDENCE_BUDGET_CHARS,
  duplicateRetrievalNote,
  EVIDENCE_BUDGET_ENV_VAR,
  healZoteroMcpArgs,
  healZoteroWorkerInput,
  isChezmoiManaged,
  isDotfilesStaticPath,
  resultEvidenceConflictNote,
  retrievalSignature,
  shouldRunPostToolChecks,
  isSecretFilePath,
  isSessionSummaryStorePath,
  isVaultNotePath,
  parseMcpCall,
  validateFileSyntax,
  DOTFILES_ROOT,
  VAULT_ROOT,
} from "../lib/workflow-invariants-logic.js";

// Count of zotero_audit_claims executions that passed pre-dispatch checks in
// the current session. Reset on session_start. Caps the audit cycle at one
// initial call plus one corrected resubmission; mcpScript-wrapped audits are
// invisible here and are governed by skill guidance instead.
let auditClaimDispatches = 0;

// Signatures of completed Zotero retrieval calls in the current session, used
// by the post-tool duplicate-retrieval nudge. Bounded and reset on
// session_start; mcpScript-internal calls do not surface as tool results.
const retrievalSignatures = new Map<string, number>();

export default function workflowInvariantsExtension(pi: ExtensionAPI): void {
  pi.on("session_start", () => {
    auditClaimDispatches = 0;
    retrievalSignatures.clear();
  });
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

    // MCP calls: silent Zotero argument-shape self-healing (alias repair).
    // Never blocks; unparseable input passes through to normal validation.
    if (
      typeof event.toolName === "string" &&
      (event.toolName === "mcp" ||
        event.toolName === "mcp__zotero" ||
        event.toolName.startsWith("zotero_"))
    ) {
      const { healedInput, wasHealed } = healZoteroMcpArgs(event.toolName, event.input);
      if (wasHealed) {
        event.input = healedInput;
      }
      // Audit-claim guard: validate payload shape before dispatch, because
      // client-side schema errors echo the whole payload plus the full tool
      // schema. Rejected payloads do not consume the audit budget.
      const parsed = parseMcpCall(event.toolName, event.input);
      if (parsed.server === "zotero") {
        if (parsed.operation === "audit_claims") {
          const check = checkAuditClaimsPayload(
            (parsed.args as Record<string, unknown>).claims
          );
          if (!check.ok) {
            return {
              block: true,
              reason: `Blocked by policy: zotero_audit_claims payload rejected pre-dispatch: ${check.reason}. Fix the payload and retry; rejected payloads do not consume the audit budget.`,
            };
          }
          auditClaimDispatches += 1;
          if (auditClaimDispatches > 2) {
            return {
              block: true,
              reason:
                "Blocked by policy: audit budget exhausted (two zotero_audit_claims executions per question: one initial call plus one corrected resubmission). Report the best-supported claims and disclose remaining limits instead of retrying.",
            };
          }
        }
        // Validator-payload preflight: the manifest and evidence-bundle
        // schemas echo oversized failure context, so mechanical defects are
        // rejected here with a one-line reason instead.
        if (parsed.operation === "validate_evidence_bundle") {
          const args = parsed.args as Record<string, unknown>;
          const check = checkEvidenceBundlePayload(args.claims, args.evidence, args.allowed_item_keys);
          if (!check.ok) {
            return {
              block: true,
              reason: `Blocked by policy: zotero_validate_evidence_bundle payload rejected pre-dispatch: ${check.reason}. Fix the payload and retry.`,
            };
          }
        }
        if (parsed.operation === "validate_comparison_manifest") {
          const check = checkComparisonManifestPayload(
            (parsed.args as Record<string, unknown>).manifest
          );
          if (!check.ok) {
            return {
              block: true,
              reason: `Blocked by policy: zotero_validate_comparison_manifest payload rejected pre-dispatch: ${check.reason}. Fix the payload and retry.`,
            };
          }
        }
        // Retrieval-budget guard for composite evidence collection. Calls
        // that already set max_total_chars are bounded server-side and pass.
        if (parsed.operation === "collect_result_evidence") {
          const budget =
            Number(process.env[EVIDENCE_BUDGET_ENV_VAR]) || DEFAULT_EVIDENCE_BUDGET_CHARS;
          const check = checkResultEvidenceBudget(parsed.args as Record<string, unknown>, budget);
          if (check.blocked) {
            return {
              block: true,
              reason: `Blocked by policy: ${check.reason}`,
            };
          }
        }
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

        // Curated session summaries must go through piwork's validated store.
        if (
          (event.toolName === "write" || event.toolName === "edit") &&
          isSessionSummaryStorePath(rawPath)
        ) {
          return {
            block: true,
            reason:
              "Blocked by policy: Direct writes to session-summaries.json are prohibited. Use 'piwork summary log' or another validated 'piwork summary' persistence command.",
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

        // Block private credential access through Bash as well as path tools.
        const secretShellCheck = checkSecretShellAccess(cmd);
        if (secretShellCheck.blocked) {
          return {
            block: true,
            reason: `Blocked by policy: ${secretShellCheck.reason}`,
          };
        }

        // Check vault access in shell
        if (checkVaultShellAccess(cmd)) {
          return {
            block: true,
            reason:
              "Blocked by policy: Direct shell operations on Obsidian vault notes are prohibited. Route note operations through TurboVault MCP tools. Access to .obsidian/ (CSS snippets, plugins) is permitted.",
          };
        }

        // Protect the curated session-summary store from direct shell access.
        const summaryStoreCheck = checkSessionSummaryStoreShellAccess(cmd);
        if (summaryStoreCheck.blocked) {
          return {
            block: true,
            reason: `Blocked by policy: ${summaryStoreCheck.reason}`,
          };
        }

        // Require reviewed helpers for destructive Zotero index maintenance.
        const zoteroIndexCheck = checkZoteroIndexMutation(cmd);
        if (zoteroIndexCheck.blocked) {
          return {
            block: true,
            reason: `Blocked by policy: ${zoteroIndexCheck.reason}`,
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

    // 4. Zotero Cloud upload guard (zero-cloud-bytes policy)
    if (typeof event.toolName === "string") {
      const uploadCheck = checkZoteroCloudUpload(event.toolName, event.input);
      if (uploadCheck.blocked) {
        return {
          block: true,
          reason: `Blocked by policy: ${uploadCheck.reason} If this is required to accomplish your goal, stop and ask Samuel for help.`,
        };
      }
    }
  });

  // Post-tool checks: duplicate-retrieval nudge, evidence-conflict note,
  // Chezmoi staging reminder, and syntax verification
  pi.on("tool_result", async (event) => {
    // Zotero RAG footgun annotator: all-non-positive reranks read as no evidence.
    // Silent on success, mixed/positive scores, errors, and non-search calls.
    const rerankNote = checkZoteroSemanticResult(
      event.toolName,
      event.input,
      event.isError,
      (event as { content?: unknown }).content
    );
    if (rerankNote) {
      event.content.push({ type: "text", text: rerankNote });
    }

    // Duplicate-retrieval nudge and evidence-conflict note for Zotero reads.
    // Both are one-line, non-blocking, and silent on errors.
    if (event.isError !== true) {
      const signature = retrievalSignature(event.toolName, event.input);
      const dupNote = duplicateRetrievalNote(signature, retrievalSignatures);
      if (dupNote) {
        event.content.push({ type: "text", text: `\n\n${dupNote}` });
      }
      const conflictNote = resultEvidenceConflictNote(
        event.toolName,
        event.input,
        event.isError,
        (event as { content?: unknown }).content
      );
      if (conflictNote) {
        event.content.push({ type: "text", text: `\n\n${conflictNote}` });
      }
    }

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
