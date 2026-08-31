import {
  advisorConfigIsolationError,
  getAdvisorConfigPath,
} from "../lib/session-runtime.js";
import advisorFlowExtension from "../npm/node_modules/pi-advisor-flow/extensions/index.js";
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import {
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type AdvisorConfig = Record<string, unknown>;
type ModelLike = { provider?: unknown; id?: unknown };

let syncWarningShown = false;

function modelRef(model: ModelLike | undefined): string | undefined {
  if (!model || typeof model.provider !== "string" || typeof model.id !== "string") {
    return undefined;
  }
  const provider = model.provider.trim();
  const id = model.id.trim();
  return provider && id ? `${provider}/${id}` : undefined;
}

/**
 * Keep pi-advisor-flow's Executor seed aligned with the model that Pi selected,
 * but write only to this Pi process's advisor configuration. The package's
 * config module is given the same path by session-runtime.ts.
 */
function updateAdvisorConfig(patch: Record<string, string>): string | undefined {
  const advisorConfigPath = getAdvisorConfigPath();
  if (!existsSync(advisorConfigPath)) {
    return `local advisor config '${advisorConfigPath}' does not exist`;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(advisorConfigPath, "utf8"));
  } catch {
    return `local advisor config '${advisorConfigPath}' is unreadable`;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return `local advisor config '${advisorConfigPath}' is not a JSON object`;
  }

  const config = parsed as AdvisorConfig;
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (config[key] !== value) {
      config[key] = value;
      changed = true;
    }
  }
  if (!changed) return;

  const temporaryPath = `${advisorConfigPath}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, advisorConfigPath);
    return;
  } catch {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Best-effort synchronization must never interfere with Pi startup.
    }
    return `local advisor config '${advisorConfigPath}' could not be updated`;
  }
}

function reportSyncWarning(ctx: ExtensionContext, error: string | undefined): void {
  if (!error || syncWarningShown || !ctx.hasUI) return;
  syncWarningShown = true;
  ctx.ui.notify(`Could not synchronize the local Advisor configuration: ${error}.`, "warning");
}

function syncCurrentModel(ctx: ExtensionContext, model: ModelLike | undefined = ctx.model): void {
  const executor = modelRef(model);
  if (!executor) return;

  const patch: Record<string, string> = { executor };
  if (typeof ctx.thinkingLevel === "string" && ctx.thinkingLevel.trim()) {
    patch.executorEffort = ctx.thinkingLevel;
  }
  reportSyncWarning(ctx, updateAdvisorConfig(patch));
}

export default function advisorCurrentModelExtension(pi: ExtensionAPI): void {
  if (advisorConfigIsolationError) {
    console.error(`[advisor isolation] ${advisorConfigIsolationError}`);
    pi.on("session_start", async (_event, ctx) => {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Advisor flow is disabled because its process-local config seam is unavailable. ${advisorConfigIsolationError}`,
          "warning",
        );
      }
    });
    return;
  }

  // This wrapper is the only registration of pi-advisor-flow. The npm package
  // remains installed for updates, but its extension entry is filtered out in
  // settings.json so its handlers run only after the local-path seam is ready.
  // Register synchronization first so alwaysOn sees the current local seed.
  pi.on("session_start", async (_event, ctx) => {
    syncCurrentModel(ctx);
  });

  // pi-advisor-flow handles explicit source="set" selections while active. This
  // also covers inactive flow, restore, and pre-activation model changes.
  pi.on("model_select", async (event, ctx) => {
    syncCurrentModel(ctx, event.model);
  });

  // Executor effort follows Pi's actual thinking level; Advisor effort remains
  // independently configured in the process-local advisor.json.
  pi.on("thinking_level_select", async (event, ctx) => {
    reportSyncWarning(ctx, updateAdvisorConfig({ executorEffort: event.level }));
  });

  advisorFlowExtension(pi);
}
