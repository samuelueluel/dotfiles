import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import {
  filterToolNamesForActivation,
  registerToolActivationReconciler,
  resetToolActivationGroups,
  setPermissionAllowedTools,
} from "../../../lib/tool-activation.ts";
import { getPlanModeGate, type PlanModeGateDecision } from "../../../lib/permission-mode-gate.ts";

type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;
type SessionShutdownEvent = {
  reason?: string;
  [key: string]: unknown;
};

type ProcessWrapperRegistry = {
  nextToken: number;
  activeTokens: Set<number>;
};

const PROCESS_WRAPPER_REGISTRY_KEY = Symbol.for("samuel.pi-permission-system.wrapper");

function getProcessWrapperRegistry(): ProcessWrapperRegistry {
  const globalScope = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  const existing = globalScope[PROCESS_WRAPPER_REGISTRY_KEY];
  if (existing && typeof existing === "object") {
    const registry = existing as Partial<ProcessWrapperRegistry>;
    if (!(registry.activeTokens instanceof Set)) registry.activeTokens = new Set<number>();
    return registry as ProcessWrapperRegistry;
  }

  const registry: ProcessWrapperRegistry = { nextToken: 0, activeTokens: new Set<number>() };
  Object.defineProperty(globalScope, PROCESS_WRAPPER_REGISTRY_KEY, {
    configurable: true,
    enumerable: false,
    value: registry,
    writable: true,
  });
  return registry;
}

const INSTALLED_PACKAGE_ENTRY = join(
  getAgentDir(),
  "npm",
  "node_modules",
  "pi-permission-system",
  "index.ts",
);
const CHILD_CONTEXT_ENTRY = join(
  getAgentDir(),
  "npm",
  "node_modules",
  "@tintinweb",
  "pi-subagents",
  "src",
  "child-context.ts",
);
const childContextModulePromise = import(CHILD_CONTEXT_ENTRY).catch(() => undefined);

async function isInChildSessionContext(): Promise<boolean> {
  const childContext = await childContextModulePromise as {
    inChildSessionContext?: () => boolean;
  } | undefined;
  return childContext?.inChildSessionContext?.() === true;
}

type PermissionSystemRuntime = {
  getYoloMode?: () => boolean;
  setYoloMode?: (
    enabled: boolean,
    options?: { persist?: boolean; source?: string },
  ) => { error?: string };
};

type ToolCallEventLike = {
  toolName?: unknown;
  input?: unknown;
};

type PlanYoloLeaseResult =
  | { ok: true }
  | { ok: false; reason: string };

function permissionRuntime(): PermissionSystemRuntime | undefined {
  return (globalThis as typeof globalThis & {
    __piPermissionSystem?: PermissionSystemRuntime;
  }).__piPermissionSystem;
}

function getPlanDecision(event: ToolCallEventLike): PlanModeGateDecision | undefined {
  const toolName = typeof event.toolName === "string" ? event.toolName : "";
  if (!toolName) return undefined;
  return getPlanModeGate()?.(toolName, event.input);
}

function planPreflightFailureReason(toolName: string): string {
  return `PLAN mode is read-only: '${toolName}' was blocked because permission preflight could not suppress an upstream confirmation. Ask Samuel to switch to /manual, /autoask, or /auto before making changes.`;
}

/**
 * Plan mode is process-local, but pi-permission-system's upstream handler is
 * registered before the settings extensions. The wrapper therefore performs a
 * preflight before delegating to the upstream handler. Verified plan calls get
 * a non-persistent YOLO lease for that handler only; hard policy denials still
 * win because YOLO resolves only `ask`, never `deny`.
 */
function createPlanYoloLeaseController() {
  const leases = new WeakMap<object, true>();
  let activeLeases = 0;
  let restoreYoloMode: boolean | undefined;

  const acquire = (event: object, toolName: string): PlanYoloLeaseResult => {
    if (leases.has(event)) return { ok: true };

    const runtime = permissionRuntime();
    if (!runtime?.getYoloMode || !runtime.setYoloMode) {
      return { ok: false, reason: planPreflightFailureReason(toolName) };
    }

    if (activeLeases === 0) {
      restoreYoloMode = runtime.getYoloMode();
      if (!restoreYoloMode) {
        const result = runtime.setYoloMode(true, {
          persist: false,
          source: "plan-preflight",
        });
        if (result?.error) {
          restoreYoloMode = undefined;
          return { ok: false, reason: planPreflightFailureReason(toolName) };
        }
      }
    }

    activeLeases += 1;
    leases.set(event, true);
    return { ok: true };
  };

  const release = (event: object): void => {
    if (!leases.delete(event)) return;

    activeLeases -= 1;
    if (activeLeases > 0) return;

    const previous = restoreYoloMode;
    restoreYoloMode = undefined;
    if (previous === undefined) return;

    permissionRuntime()?.setYoloMode?.(previous, {
      persist: false,
      source: "plan-preflight-restore",
    });
  };

  return { acquire, release };
}

/**
 * pi-permission-system is process-global, while pi-subagents creates child
 * AgentSession runners in the same process. The package currently unregisters
 * that process-global runtime API for every `session_shutdown(reason: "quit")`,
 * including child teardown. The subagents host marks child extension loading
 * with AsyncLocalStorage; use that explicit marker rather than inferring root
 * ownership from extension registration order. The active-token registry also
 * handles overlapping roots/reloads: only the last live root may deliver the
 * real process-shutdown reason.
 */
export default async function processPermissionSystem(pi: ExtensionAPI): Promise<void> {
  // The installed permission package owns the final active-tool reconciliation.
  // Keep its permission result authoritative while preserving capability groups
  // that intentionally remain inactive until their loader is called.
  resetToolActivationGroups(pi);
  const originalSetActiveTools = pi.setActiveTools.bind(pi);
  let reconciling = false;
  const applyPermissionAndActivation = (names: readonly string[]) => {
    if (reconciling) {
      originalSetActiveTools([...names]);
      return;
    }
    reconciling = true;
    try {
      originalSetActiveTools(filterToolNamesForActivation(pi, names));
    } finally {
      reconciling = false;
    }
  };
  registerToolActivationReconciler(pi, "pi-permission-system", (names) => {
    applyPermissionAndActivation(names);
  });

  const registry = getProcessWrapperRegistry();
  const token = registry.nextToken++;
  registry.activeTokens.add(token);
  const childSession = await isInChildSessionContext();

  const releaseToken = () => {
    registry.activeTokens.delete(token);
  };
  const planYolo = createPlanYoloLeaseController();

  try {
    const packageModule = await import(INSTALLED_PACKAGE_ENTRY) as { default?: ExtensionFactory };
    if (typeof packageModule.default !== "function") {
      throw new Error(`pi-permission-system did not export a valid extension from ${INSTALLED_PACKAGE_ENTRY}`);
    }

    const wrappedPi = new Proxy(pi as ExtensionAPI, {
      get(target, property, receiver) {
        if (property === "setActiveTools") {
          return (names: string[]) => {
            // The installed package passes its permission-allowed set here.
            // Record it for loaders, then apply capability activation without
            // allowing an inactive group back into the model-facing surface.
            const permittedAndActive = setPermissionAllowedTools(target, names);
            applyPermissionAndActivation(permittedAndActive);
          };
        }
        if (property !== "on") {
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }

        return (event: string, handler: (event: any, ctx: unknown) => unknown) => {
          if (event === "tool_call") {
            return target.on(event as never, (async (toolEvent: ToolCallEventLike, ctx: unknown) => {
              const decision = getPlanDecision(toolEvent);
              const eventObject = toolEvent as object;
              let leased = false;

              if (decision?.mode === "plan" && decision.allowed) {
                const toolName = typeof toolEvent.toolName === "string" ? toolEvent.toolName : "tool";
                const lease = planYolo.acquire(eventObject, toolName);
                if (!lease.ok) {
                  return { block: true, reason: lease.reason };
                }
                leased = true;
              }

              try {
                return await handler(toolEvent, ctx);
              } finally {
                if (leased) planYolo.release(eventObject);
              }
            }) as never);
          }

          if (event === "session_start") {
            return target.on(event as never, async (lifecycleEvent: SessionShutdownEvent, ctx: unknown) => {
              registry.activeTokens.add(token);
              return handler(lifecycleEvent, ctx);
            });
          }
          if (event !== "session_shutdown") {
            return target.on(event as never, handler as never);
          }

          return target.on(event as never, async (lifecycleEvent: SessionShutdownEvent, ctx: unknown) => {
            try {
              if (lifecycleEvent?.reason !== "quit") {
                return await handler(lifecycleEvent, ctx);
              }

              // A child runner's `quit` is a session teardown, not process
              // shutdown. An overlapping live runner also means this runner
              // cannot be the last owner of the process-global API. Preserve
              // the package's ordinary cleanup while changing only the reason
              // that controls its global unregister branch.
              const preserveRuntimeApi = childSession || registry.activeTokens.size > 1;
              if (preserveRuntimeApi) {
                return await handler({ ...lifecycleEvent, reason: "new" }, ctx);
              }
              return await handler(lifecycleEvent, ctx);
            } finally {
              releaseToken();
            }
          });
        };
      },
    });

    // This handler is registered before the installed package's own
    // `tool_call` handler below. In plan mode, a stale or forged call is
    // blocked here, before the upstream package can turn its default `ask`
    // state into a permission dialog.
    pi.on("tool_call", async (event) => {
      const decision = getPlanDecision(event);
      if (decision?.mode === "plan" && !decision.allowed) {
        return { block: true, reason: decision.reason };
      }
      return undefined;
    });

    await packageModule.default(wrappedPi);
  } catch (error) {
    releaseToken();
    throw error;
  }
}
