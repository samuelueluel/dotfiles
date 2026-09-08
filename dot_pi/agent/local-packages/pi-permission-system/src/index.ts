import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

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
  const registry = getProcessWrapperRegistry();
  const token = registry.nextToken++;
  registry.activeTokens.add(token);
  const childSession = await isInChildSessionContext();

  const releaseToken = () => {
    registry.activeTokens.delete(token);
  };

  try {
    const packageModule = await import(INSTALLED_PACKAGE_ENTRY) as { default?: ExtensionFactory };
    if (typeof packageModule.default !== "function") {
      throw new Error(`pi-permission-system did not export a valid extension from ${INSTALLED_PACKAGE_ENTRY}`);
    }

    const wrappedPi = new Proxy(pi as ExtensionAPI, {
      get(target, property, receiver) {
        if (property !== "on") {
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }

        return (event: string, handler: (event: SessionShutdownEvent, ctx: unknown) => unknown) => {
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

    await packageModule.default(wrappedPi);
  } catch (error) {
    releaseToken();
    throw error;
  }
}
