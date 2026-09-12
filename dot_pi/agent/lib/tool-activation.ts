import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type ToolActivationGroup = {
  id: string;
  owner: string;
  tools: readonly string[];
  defaultActive?: boolean;
};

type GroupDefinition = {
  id: string;
  owner: string;
  tools: readonly string[];
  defaultActive: boolean;
};

type GroupState = GroupDefinition & {
  active: boolean;
};

type ToolActivationReconciler = {
  owner: string;
  generation: number;
  reconcile: (permissionAllowedTools: readonly string[]) => void;
};

type ActivationState = {
  groups: Map<string, GroupState>;
  ownerByTool: Map<string, string>;
  permissionAllowedTools?: Set<string>;
  reconciler?: ToolActivationReconciler;
  attachedBindings: Set<object>;
};

type ActivationBinding = {
  definitions: Map<string, GroupDefinition>;
  state: ActivationState;
  sessionId?: string;
  reconciler?: ToolActivationReconciler;
  nextReconcilerGeneration: number;
  lifecycleHandlersInstalled: boolean;
};

type ToolHost = Pick<ExtensionAPI, "getActiveTools" | "on">;

type SessionContext = {
  sessionManager?: {
    getSessionId?: () => string;
  };
};

const bindings = new WeakMap<object, ActivationBinding>();
const GLOBAL_ACTIVATION_REGISTRY = Symbol.for("samuel.pi.tool-activation");

type GlobalActivationRegistry = {
  sessionStates: Map<string, ActivationState>;
};

function globalActivationRegistry(): GlobalActivationRegistry {
  const globalScope = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  const existing = globalScope[GLOBAL_ACTIVATION_REGISTRY];
  if (existing && typeof existing === "object" && "sessionStates" in existing) {
    return existing as GlobalActivationRegistry;
  }

  const registry: GlobalActivationRegistry = { sessionStates: new Map() };
  Object.defineProperty(globalScope, GLOBAL_ACTIVATION_REGISTRY, {
    configurable: true,
    enumerable: false,
    value: registry,
    writable: true,
  });
  return registry;
}

function emptyState(): ActivationState {
  return {
    groups: new Map(),
    ownerByTool: new Map(),
    attachedBindings: new Set(),
  };
}

function resetState(state: ActivationState): void {
  for (const group of state.groups.values()) group.active = group.defaultActive;
  state.permissionAllowedTools = undefined;
}

function sessionIdFrom(context: unknown): string | undefined {
  try {
    const value = (context as SessionContext | undefined)?.sessionManager?.getSessionId?.();
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function bindingFor(pi: ToolHost): ActivationBinding {
  const key = pi as object;
  let binding = bindings.get(key);
  if (binding) return binding;

  binding = {
    definitions: new Map(),
    state: emptyState(),
    nextReconcilerGeneration: 0,
    lifecycleHandlersInstalled: false,
  };
  bindings.set(key, binding);
  installLifecycleHandlers(pi, binding);
  return binding;
}

function addDefinitionToState(state: ActivationState, definition: GroupDefinition): void {
  const existing = state.groups.get(definition.id);
  if (existing) {
    if (
      existing.owner !== definition.owner
      || existing.defaultActive !== definition.defaultActive
      || existing.tools.length !== definition.tools.length
      || existing.tools.some((name, index) => name !== definition.tools[index])
    ) {
      throw new Error(`Tool activation group ${definition.id} was registered with conflicting definitions.`);
    }
    return;
  }

  for (const toolName of definition.tools) {
    const existingGroup = state.ownerByTool.get(toolName);
    if (existingGroup) {
      throw new Error(`Tool ${toolName} belongs to both ${existingGroup} and ${definition.id} activation groups.`);
    }
  }

  const group: GroupState = {
    ...definition,
    active: definition.defaultActive,
  };
  state.groups.set(definition.id, group);
  for (const toolName of definition.tools) state.ownerByTool.set(toolName, definition.id);
}

function removeDefinitionFromState(state: ActivationState, id: string): void {
  const group = state.groups.get(id);
  if (!group) return;
  state.groups.delete(id);
  for (const toolName of group.tools) state.ownerByTool.delete(toolName);
}

function attachSessionState(binding: ActivationBinding, context: unknown): void {
  const sessionId = sessionIdFrom(context);
  if (!sessionId) {
    resetState(binding.state);
    return;
  }

  const sessionStates = globalActivationRegistry().sessionStates;
  if (binding.sessionId && binding.sessionId !== sessionId) {
    const previous = sessionStates.get(binding.sessionId);
    previous?.attachedBindings.delete(binding);
    if (previous && previous.attachedBindings.size === 0 && sessionStates.get(binding.sessionId) === previous) {
      sessionStates.delete(binding.sessionId);
    }
  }

  let state = sessionStates.get(sessionId);
  if (!state) {
    state = emptyState();
    sessionStates.set(sessionId, state);
  }

  // Different extensions receive distinct ExtensionAPI objects for the same
  // Pi session. Merge their declarations into shared session state before
  // resetting defaults, so permission reconciliation and loaders see one view.
  for (const definition of binding.definitions.values()) addDefinitionToState(state, definition);
  if (binding.reconciler) state.reconciler = binding.reconciler;
  state.attachedBindings.add(binding);
  binding.state = state;
  binding.sessionId = sessionId;
  resetState(state);
}

function detachSessionState(binding: ActivationBinding, context: unknown): void {
  const sessionId = sessionIdFrom(context) ?? binding.sessionId;
  const sessionStates = globalActivationRegistry().sessionStates;
  const state = binding.state;
  if (sessionId && sessionStates.get(sessionId) === state) {
    state.attachedBindings.delete(binding);
    if (state.attachedBindings.size === 0) sessionStates.delete(sessionId);
  }

  binding.sessionId = undefined;
  binding.state = emptyState();
  for (const definition of binding.definitions.values()) addDefinitionToState(binding.state, definition);
  if (binding.reconciler) binding.state.reconciler = binding.reconciler;
}

function installLifecycleHandlers(pi: ToolHost, binding: ActivationBinding): void {
  if (binding.lifecycleHandlersInstalled) return;
  binding.lifecycleHandlersInstalled = true;
  pi.on("session_start", (_event, context) => attachSessionState(binding, context));
  pi.on("session_shutdown", (_event, context) => detachSessionState(binding, context));
}

function validateGroup(group: ToolActivationGroup): GroupDefinition {
  if (typeof group.id !== "string" || group.id.trim() === "") {
    throw new Error("Tool activation group id must not be empty.");
  }
  if (typeof group.owner !== "string" || group.owner.trim() === "") {
    throw new Error(`Tool activation group ${group.id} requires an owner.`);
  }
  const tools = [...new Set(group.tools)];
  if (tools.length === 0 || tools.some((name) => typeof name !== "string" || name.trim() === "")) {
    throw new Error(`Tool activation group ${group.id} requires non-empty tool names.`);
  }
  return {
    id: group.id,
    owner: group.owner,
    tools,
    defaultActive: group.defaultActive === true,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reconciliationUnavailable(): Error {
  return new Error("Tool activation unavailable: pi-permission-system reconciliation is not registered.");
}

function reconcileIfReady(state: ActivationState): void {
  if (!state.reconciler || !state.permissionAllowedTools) return;
  state.reconciler.reconcile([...state.permissionAllowedTools]);
}

function readyReconciler(state: ActivationState): ToolActivationReconciler {
  if (!state.reconciler || !state.permissionAllowedTools) throw reconciliationUnavailable();
  return state.reconciler;
}

export function registerToolActivationGroup(pi: ToolHost, definition: ToolActivationGroup): void {
  const binding = bindingFor(pi);
  const group = validateGroup(definition);
  const existing = binding.definitions.get(group.id);
  if (existing) {
    addDefinitionToState(binding.state, group);
    return;
  }

  binding.definitions.set(group.id, group);
  try {
    addDefinitionToState(binding.state, group);
    // This matters when the bridge is hot-reloaded after permission has already
    // produced its allowed set, and when permission loaded before the bridge.
    reconcileIfReady(binding.state);
  } catch (error) {
    binding.definitions.delete(group.id);
    removeDefinitionFromState(binding.state, group.id);
    throw new Error(`Tool activation group ${group.id} could not be registered: ${errorText(error)}`);
  }
}

export function registerToolActivationReconciler(
  pi: ToolHost,
  owner: string,
  reconcile: (permissionAllowedTools: readonly string[]) => void,
): void {
  if (typeof owner !== "string" || owner.trim() === "") throw new Error("Tool activation reconciler owner must not be empty.");
  const binding = bindingFor(pi);
  const state = binding.state;
  if (state.reconciler && state.reconciler.owner !== owner) {
    throw new Error(`Tool activation reconciler is already owned by ${state.reconciler.owner}.`);
  }

  const previousBindingReconciler = binding.reconciler;
  const previousStateReconciler = state.reconciler;
  const next: ToolActivationReconciler = {
    owner,
    generation: ++binding.nextReconcilerGeneration,
    reconcile,
  };
  binding.reconciler = next;
  state.reconciler = next;
  try {
    // A late/hot registration must immediately apply the current activation
    // state instead of waiting for another model turn.
    reconcileIfReady(state);
  } catch (error) {
    binding.reconciler = previousBindingReconciler;
    state.reconciler = previousStateReconciler;
    throw new Error(`Tool activation reconciler ${owner} could not be registered: ${errorText(error)}`);
  }
}

export function resetToolActivationGroups(pi: ToolHost): void {
  resetState(bindingFor(pi).state);
}

export function setPermissionAllowedTools(pi: ToolHost, names: readonly string[]): string[] {
  const state = bindingFor(pi).state;
  state.permissionAllowedTools = new Set(names);
  return filterToolNamesForActivation(pi, names);
}

export function getPermissionAllowedTools(pi: ToolHost): readonly string[] | undefined {
  const allowed = bindingFor(pi).state.permissionAllowedTools;
  return allowed ? [...allowed] : undefined;
}

export function isToolActivationActive(pi: ToolHost, name: string): boolean {
  const state = bindingFor(pi).state;
  const groupId = state.ownerByTool.get(name);
  if (!groupId) return true;
  return state.groups.get(groupId)?.active === true;
}

export function filterToolNamesForActivation(pi: ToolHost, names: readonly string[]): string[] {
  const state = bindingFor(pi).state;
  return names.filter((name) => {
    const groupId = state.ownerByTool.get(name);
    return !groupId || state.groups.get(groupId)?.active === true;
  });
}

export function assertToolActivationReady(pi: ToolHost): void {
  const state = bindingFor(pi).state;
  readyReconciler(state);
  const allowed = state.permissionAllowedTools!;
  const leaked = pi.getActiveTools().filter((name) => {
    const groupId = state.ownerByTool.get(name);
    return !allowed.has(name) || (groupId !== undefined && state.groups.get(groupId)?.active !== true);
  });
  if (leaked.length > 0) {
    throw new Error(`Tool activation unavailable: active tools were not reconciled (${leaked.join(", ")}).`);
  }
}

export function activateToolActivationGroup(pi: ToolHost, id: string): string[] {
  const state = bindingFor(pi).state;
  const group = state.groups.get(id);
  if (!group) throw new Error(`Unknown tool activation group ${id}.`);
  const reconciler = readyReconciler(state);
  const allowed = state.permissionAllowedTools!;
  const previousActive = group.active;
  const before = pi.getActiveTools();
  group.active = true;

  try {
    reconciler.reconcile([...allowed]);
    const after = pi.getActiveTools();
    const expected = group.tools.filter((name) => allowed.has(name));
    const missing = expected.filter((name) => !after.includes(name));
    const leaked = after.filter((name) => {
      const groupId = state.ownerByTool.get(name);
      return !allowed.has(name) || (groupId !== undefined && state.groups.get(groupId)?.active !== true);
    });
    if (missing.length > 0) throw new Error(`reconciler did not activate ${missing.join(", ")}`);
    if (leaked.length > 0) throw new Error(`reconciler left unauthorized tools active (${leaked.join(", ")})`);
    return group.tools.filter((name) => !before.includes(name) && after.includes(name));
  } catch (error) {
    // The group state is transactional. A failing/stale permission callback
    // cannot leave a capability marked active for a later provider request.
    group.active = previousActive;
    try {
      reconciler.reconcile([...allowed]);
    } catch {
      // The deterministic error below is more useful than masking it with a
      // second failure from a broken setter.
    }
    throw new Error(`Tool activation failed for ${id}: ${errorText(error)}`);
  }
}

export function registeredToolActivationGroups(pi: ToolHost): readonly {
  id: string;
  owner: string;
  tools: readonly string[];
  defaultActive: boolean;
  active: boolean;
}[] {
  const state = bindingFor(pi).state;
  return [...state.groups.values()].map((group) => ({
    id: group.id,
    owner: group.owner,
    tools: group.tools,
    defaultActive: group.defaultActive,
    active: group.active,
  }));
}
