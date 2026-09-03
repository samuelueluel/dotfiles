import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cleanupSessionRuntime } from "../lib/session-runtime.js";
import { documentRootAccess, routeFor } from "../lib/document-analysis-bridge-logic.ts";
import { DOCUMENT_ANALYSIS_TOOL_NAMES } from "../lib/document-analysis-bridge-policy.ts";
import { isSafeBashCommand } from "../lib/bash-policy.ts";

/**
 * Compatibility layer for the old modes.ts extension.
 *
 * pi-permission-system owns tool/path/MCP/skill permissions. This extension
 * keeps only the two session modes Samuel uses: manual and auto. Manual mode
 * also retains the old conservative Bash guard because pi-permission-system's
 * bash rules are wildcard-based and cannot safely express the old structured
 * read-only parser.
 */

type Mode = "manual" | "auto";

type PermissionSystemRuntime = {
  getYoloMode?: () => boolean;
  setYoloMode?: (
    enabled: boolean,
    options?: { persist?: boolean; source?: string },
  ) => { error?: string; yoloMode?: boolean };
};

const CPTR_HEADLESS = process.env.PI_CPTR_HEADLESS === "1";
const SCOPED_FILESYSTEM_PREFIX = "openwebui_filesystem_";
// Read-only tool names carried over from modes.ts. Bash commands are checked
// separately by the structured policy in lib/bash-policy.ts.
const HEADLESS_ALLOWED_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "web_search",
  "fetch_content",
  "get_search_content",
  "source_check",
  "preview_export",
  "answer",
  "todo",
  "signal_loop_success",
  "session_search",
  "session_ask",
  "advisor",
  // Fixed, local-only document-analysis bridge tools. These are deliberately
  // exact names; arbitrary shell commands and unknown extension tools remain
  // blocked in CPTR headless mode.
  ...DOCUMENT_ANALYSIS_TOOL_NAMES,
]);

// Namespace proxies expose the underlying MCP name as input.tool, while the
// generic proxy and direct-tool surfaces often use a server-prefixed name.
// Keep both forms so the old read-only MCP allowlist remains useful without
// granting a blanket allow to mcp__<server>.
const READ_ONLY_MCP_OPERATIONS = new Set([
  // TurboVault
  "turbovault:get_vault_context",
  "turbovault:read_note",
  "turbovault:get_backlinks",
  "turbovault:get_forward_links",
  "turbovault:get_related_notes",
  "turbovault:get_hub_notes",
  "turbovault:quick_health_check",
  "turbovault:get_broken_links",
  "turbovault:search",
  "turbovault:advanced_search",
  "turbovault:search_by_frontmatter",
  "turbovault:inspect_frontmatter",
  "turbovault:query_frontmatter_sql",
  "turbovault:list_templates",
  "turbovault:get_notes_info",
  "turbovault:suggest_links",
  "turbovault:semantic_search",
  // Zotero
  "zotero:get_annotations",
  "zotero:get_notes",
  "zotero:get_page_layout",
  "zotero:get_item_metadata",
  "zotero:get_item_fulltext",
  "zotero:get_attachment_path",
  "zotero:get_attachment_paths",
  "zotero:get_collections",
  "zotero:list_collections",
  "zotero:get_collection_items",
  "zotero:list_collection_items",
  "zotero:get_item_children",
  "zotero:list_item_children",
  "zotero:get_tags",
  "zotero:list_tags",
  "zotero:list_libraries",
  "zotero:get_recent",
  "zotero:list_recent_items",
  "zotero:get_collection_hubs",
  "zotero:get_paper_lineage",
  "zotero:find_connected_papers",
  "zotero:audit_references",
  "zotero:get_reference_index_status",
  "zotero:search_bibliography_entries",
  "zotero:search_references",
  "zotero:read_pdf_pages",
  "zotero:search_items",
  "zotero:resolve_exact_source",
  "zotero:search_by_tag",
  "zotero:search_items_by_tag",
  "zotero:search_by_citation_key",
  "zotero:find_item_by_citation_key",
  "zotero:advanced_search",
  "zotero:search_items_advanced",
  "zotero:semantic_search",
  "zotero:get_search_database_status",
  "zotero:compile_annotation_digest",
  "zotero:synthesize_annotations",
  "zotero:export_bibliography",
  "zotero:search_collections",
  "zotero:get_pdf_outline",
]);

const READ_ONLY_MCP_BASELINE_NAMES = new Set([
  "mcp_status",
  "mcp_list",
  "mcp_search",
  "mcp_describe",
  "mcp_connect",
]);

const READ_ONLY_MCP_PREFIXED_NAMES = new Set([
  "turbovault_get_vault_context",
  "turbovault_read_note",
  "turbovault_get_backlinks",
  "turbovault_get_forward_links",
  "turbovault_get_related_notes",
  "turbovault_get_hub_notes",
  "turbovault_quick_health_check",
  "turbovault_get_broken_links",
  "turbovault_search",
  "turbovault_advanced_search",
  "turbovault_search_by_frontmatter",
  "turbovault_inspect_frontmatter",
  "turbovault_query_frontmatter_sql",
  "turbovault_list_templates",
  "turbovault_get_notes_info",
  "turbovault_suggest_links",
  "turbovault_semantic_search",
  "zotero_zotero_get_annotations",
  "zotero_zotero_get_notes",
  "zotero_zotero_get_item_metadata",
  "zotero_zotero_get_item_fulltext",
  "zotero_zotero_get_attachment_path",
  "zotero_zotero_get_attachment_paths",
  "zotero_zotero_list_collections",
  "zotero_zotero_get_collections",
  "zotero_zotero_list_collection_items",
  "zotero_zotero_get_collection_items",
  "zotero_zotero_list_item_children",
  "zotero_zotero_get_item_children",
  "zotero_zotero_list_tags",
  "zotero_zotero_get_tags",
  "zotero_zotero_list_libraries",
  "zotero_zotero_get_recent",
  "zotero_zotero_list_recent_items",
  "zotero_zotero_read_pdf_pages",
  "zotero_zotero_search_items",
  "zotero_zotero_resolve_exact_source",
  "zotero_zotero_search_by_tag",
  "zotero_zotero_search_by_citation_key",
  "zotero_zotero_search_items_advanced",
  "zotero_zotero_advanced_search",
  "zotero_zotero_semantic_search",
  "zotero_zotero_get_search_database_status",
  "zotero_zotero_synthesize_annotations",
  "zotero_zotero_export_bibliography",
  "zotero_zotero_search_collections",
  "zotero_zotero_get_pdf_outline",
  "zotero_read_zotero_collections",
]);

function permissionRuntime(): PermissionSystemRuntime | undefined {
  return (globalThis as typeof globalThis & {
    __piPermissionSystem?: PermissionSystemRuntime;
  }).__piPermissionSystem;
}

function requestedStartupMode(): Mode | undefined {
  const requested = process.env.PI_DEFAULT_MODE?.trim().toLowerCase();
  if (requested === "auto" || requested === "manual") return requested;
  if (process.argv.includes("-a") || process.argv.includes("--approve")) return "auto";
  return undefined;
}

function getMcpToolName(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  for (const key of ["tool", "name", "subcommand", "command"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function getMcpServerName(toolName: string, input: unknown): string {
  if (toolName === "mcp__turbovault" || toolName.startsWith("turbovault_")) return "turbovault";
  if (toolName === "mcp__zotero" || toolName.startsWith("zotero_")) return "zotero";
  if (input && typeof input === "object") {
    const server = (input as Record<string, unknown>).server;
    if (typeof server === "string" && server.trim()) return server.trim();
  }
  return "";
}

function getMcpArguments(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;
  const nested = record.args ?? record.arguments;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  if (typeof nested === "string") {
    try {
      const parsed: unknown = JSON.parse(nested);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall back to the outer input for malformed/legacy proxy arguments.
    }
  }
  return record;
}

function isReadOnlyMcpOperation(operation: string, server: string, input: unknown): boolean {
  const normalized = operation.replace(/-/g, "_");
  if (!normalized) return false;

  if (READ_ONLY_MCP_BASELINE_NAMES.has(normalized) || READ_ONLY_MCP_PREFIXED_NAMES.has(normalized)) return true;

  // Direct tools and older generic-proxy callers may include one or two
  // server prefixes in the operation name. Infer a server only from the two
  // configured read-only MCP namespaces, never from an arbitrary operation.
  const candidateServers = server
    ? [server]
    : normalized.startsWith("turbovault_")
      ? ["turbovault"]
      : normalized.startsWith("zotero_")
        ? ["zotero"]
        : [];
  for (const candidateServer of candidateServers) {
    if (READ_ONLY_MCP_OPERATIONS.has(`${candidateServer}:${normalized}`)) return true;
    if (!normalized.startsWith(`${candidateServer}_`)) continue;

    const withoutPrefix = normalized.slice(candidateServer.length + 1);
    if (READ_ONLY_MCP_OPERATIONS.has(`${candidateServer}:${withoutPrefix}`)) return true;
    if (withoutPrefix.startsWith(`${candidateServer}_`)) {
      const withoutSecondPrefix = withoutPrefix.slice(candidateServer.length + 1);
      if (READ_ONLY_MCP_OPERATIONS.has(`${candidateServer}:${withoutSecondPrefix}`)) return true;
    }
  }

  const args = getMcpArguments(input);
  if (
    (normalized === "turbovault_manage_tags" || normalized === "manage_tags")
    && String(args.operation ?? "").toLowerCase() === "list"
  ) {
    return true;
  }
  if (
    (normalized === "turbovault_generate_index" || normalized === "generate_index" || normalized === "turbovault_edit_note" || normalized === "edit_note")
    && args.dry_run === true
  ) {
    return true;
  }

  return false;
}

function isScopedFilesystemOperation(operation: string): boolean {
  return operation.replace(/-/g, "_").startsWith(SCOPED_FILESYSTEM_PREFIX);
}

function isMcpToolCall(toolName: string): boolean {
  return (
    toolName === "mcp"
    || toolName.startsWith("mcp__")
    || toolName.startsWith("turbovault_")
    || toolName.startsWith("zotero_")
  );
}

function isReadOnlyMcpCall(toolName: string, input: unknown): boolean {
  if (!isMcpToolCall(toolName)) return false;
  const isProxy = toolName === "mcp" || toolName.startsWith("mcp__");
  const operation = isProxy ? getMcpToolName(input) : toolName;
  return isReadOnlyMcpOperation(operation, getMcpServerName(toolName, input), input);
}

function setStatus(ctx: ExtensionContext, mode: Mode): void {
  if (!ctx.hasUI) return;
  const label = mode === "auto" ? "auto" : "manual";
  const color = mode === "auto" ? "success" : "muted";
  ctx.ui.setStatus("modes-ext", ctx.ui.theme.fg(color, `mode: ${label}`));
}

function notify(ctx: ExtensionContext, message: string, level: "error" | "info" | "success"): void {
  if (ctx.hasUI) ctx.ui.notify(message, level === "success" ? "info" : level);
}

export default function permissionModeExtension(pi: ExtensionAPI): void {
  let currentMode: Mode = "manual";
  let sessionModeOverride: Mode | undefined;

  const synchronizeModeWithBackend = (ctx: ExtensionContext): void => {
    const runtime = permissionRuntime();
    if (!runtime?.getYoloMode) return;

    if (sessionModeOverride) {
      const enabled = sessionModeOverride === "auto";
      if (runtime.getYoloMode() !== enabled) {
        const result = runtime.setYoloMode?.(enabled, {
          persist: false,
          source: "permission-mode",
        });
        if (result?.error) {
          currentMode = runtime.getYoloMode() ? "auto" : "manual";
          try {
            setStatus(ctx, currentMode);
          } catch {
            // A reload/session replacement may invalidate the old event context.
          }
          return;
        }
      }
      currentMode = sessionModeOverride;
    } else {
      currentMode = runtime.getYoloMode() ? "auto" : "manual";
    }

    try {
      setStatus(ctx, currentMode);
    } catch {
      // A reload/session replacement may invalidate the old event context.
    }
  };

  const applyMode = (mode: Mode, ctx: ExtensionContext): boolean => {
    const runtime = permissionRuntime();
    const result = runtime?.setYoloMode?.(mode === "auto", {
      persist: false,
      source: "permission-mode",
    });

    if (result?.error) {
      notify(ctx, `Could not switch to ${mode} mode: ${result.error}`, "error");
      return false;
    }

    if (!runtime?.setYoloMode) {
      notify(ctx, "pi-permission-system runtime API is unavailable; mode unchanged.", "error");
      return false;
    }

    sessionModeOverride = mode;
    currentMode = mode;
    setStatus(ctx, mode);
    notify(ctx, `Switched to ${mode} mode`, mode === "auto" ? "success" : "info");
    return true;
  };

  pi.on("session_start", async (_event, ctx) => {
    // /auto and /manual are session-local. A new/reloaded session starts from
    // the backend's local snapshot unless the process was launched explicitly
    // with -a/--approve or PI_DEFAULT_MODE.
    sessionModeOverride = requestedStartupMode();
    currentMode = sessionModeOverride
      ?? (permissionRuntime()?.getYoloMode?.() === true ? "auto" : "manual");
    synchronizeModeWithBackend(ctx);
  });

  // pi-permission-system refreshes its extension config during this lifecycle.
  // Its config path is already process-local, and this reconciliation keeps the
  // footer/runtime coherent when the backend or startup mode changed.
  pi.on("resources_discover", async (event, ctx) => {
    if (event.reason !== "startup" && event.reason !== "reload") return;

    const requested = requestedStartupMode();
    if (requested) sessionModeOverride = requested;
    synchronizeModeWithBackend(ctx);
    // Let later package handlers refresh first, then reapply an explicit mode.
    setTimeout(() => synchronizeModeWithBackend(ctx), 0);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    synchronizeModeWithBackend(ctx);
    // pi-permission-system refreshes its config in its own handler. Reapply
    // after that handler so the next tool call sees this window's mode.
    setTimeout(() => synchronizeModeWithBackend(ctx), 0);
  });

  pi.on("session_shutdown", async (event) => {
    if (event.reason === "quit") cleanupSessionRuntime();
  });

  pi.registerCommand("manual", {
    description: "Switch to manual permission mode",
    handler: async (_args, ctx) => {
      applyMode("manual", ctx);
    },
  });

  pi.registerCommand("auto", {
    description: "Switch to auto permission mode for this session",
    handler: async (_args, ctx) => {
      applyMode("auto", ctx);
    },
  });

  pi.registerCommand("mode", {
    description: "Display the active permission mode",
    handler: async (args, ctx) => {
      synchronizeModeWithBackend(ctx);
      const requested = args.trim().toLowerCase();
      if (requested === "manual" || requested === "auto") {
        applyMode(requested, ctx);
        return;
      }
      if (ctx.hasUI) ctx.ui.notify(`Active permission mode: ${currentMode}`, "info");
    },
  });

  // The policy file marks Bash and MCP dispatch surfaces as allowed so this
  // shim can preserve the old structured manual/headless safeguards. All
  // other mutating tools remain owned by pi-permission-system.
  pi.on("tool_call", async (event, ctx) => {
    // The permission package refreshes its config during lifecycle events. Keep
    // its in-memory yolo state aligned with this window before its handler runs.
    synchronizeModeWithBackend(ctx);

    // Cloud/unknown routes must not bypass the private-document bridge through
    // built-in reads, Bash, or the broad folder-scoped filesystem MCP. The
    // OS/container boundary remains separate; this is a Pi policy guard.
    const nonLocalHeadless = CPTR_HEADLESS && routeFor(ctx).classification !== "local";
    if (nonLocalHeadless && event.toolName === "bash") {
      return {
        block: true,
        reason: "Open WebUI Pi policy blocks all Bash commands on non-local or unknown routes; use an explicitly local route.",
      };
    }
    if (nonLocalHeadless && documentRootAccess(event.toolName, event.input, ctx.cwd)) {
      return {
        block: true,
        reason: "Open WebUI Pi policy blocks document-analysis paths on non-local or unknown routes; use an explicitly local route.",
      };
    }

    // Open WebUI's filesystem MCP uses direct, server-prefixed tools when
    // directTools is enabled. The MCP server enforces its exposed-directory
    // boundary; CPTR only needs to let those names reach the server.
    if (CPTR_HEADLESS && isScopedFilesystemOperation(event.toolName)) {
      return {};
    }

    if (isMcpToolCall(event.toolName)) {
      // The generic mcp tool's status/list/search/describe/connect forms are
      // non-mutating; all server operations are checked against explicit
      // allowlists above. Unknown operations remain gated below.
      const operation = getMcpToolName(event.input);
      if (event.toolName === "mcp" && !operation) {
        return {};
      }
      if (event.toolName === "mcp" && event.input && typeof event.input === "object") {
        const record = event.input as Record<string, unknown>;
        if (["connect", "describe", "search"].some((key) => typeof record[key] === "string")) {
          return {};
        }
        // Open WebUI's folder-scoped filesystem MCP is the one intentional
        // exception to the CPTR headless MCP block, matching modes.ts.
        if (isScopedFilesystemOperation(operation)) {
          return {};
        }
      }
      if (isReadOnlyMcpCall(event.toolName, event.input)) return {};
      if (CPTR_HEADLESS) {
        return {
          block: true,
          reason: "Open WebUI Pi policy blocks non-read-only MCP operations.",
        };
      }
      if (currentMode === "auto") return {};
      if (!ctx.hasUI) {
        return {
          block: true,
          reason: "Manual MCP approval requires an interactive UI.",
        };
      }

      const operationLabel = operation || event.toolName;
      const approved = await ctx.ui.confirm(
        "Execute MCP operation?",
        `Manual mode requires approval for ${event.toolName}: ${operationLabel}`,
      );
      if (!approved) {
        return { block: true, reason: "MCP operation rejected in manual mode." };
      }
      return {};
    }

    if (event.toolName !== "bash") {
      // CPTR must remain read-only even if a headless process inherited a
      // yolo/auto setting. The permission-system policy handles normal manual
      // approvals; this compatibility guard is the final headless boundary
      // for writes, execution helpers, and unknown extension tools.
      if (CPTR_HEADLESS && !HEADLESS_ALLOWED_TOOLS.has(event.toolName)) {
        return {
          block: true,
          reason: `Open WebUI Pi policy blocks tool '${event.toolName}' in headless mode.`,
        };
      }
      return;
    }

    const command = typeof event.input?.command === "string" ? event.input.command : "";
    if (CPTR_HEADLESS) {
      if (isSafeBashCommand(command, true)) return {};
      return {
        block: true,
        reason: "Open WebUI Pi policy allows only conservative read-only Bash commands.",
      };
    }

    if (currentMode === "auto" || isSafeBashCommand(command)) return {};

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: "Manual Bash approval requires an interactive UI.",
      };
    }

    const approved = await ctx.ui.confirm(
      "Execute Bash command?",
      `Manual mode requires approval for:\n\n$ ${command}`,
    );
    if (!approved) {
      return { block: true, reason: "Bash command rejected in manual mode." };
    }

    return {};
  });
}
