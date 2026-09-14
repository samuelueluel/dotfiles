export interface PlanIntakeState {
  sessionId: string;
  planPath: string;
  planTitle: string;
  expectedStepIds: readonly string[];
  loadedStepIds: string[];
  complete: boolean;
  startedAt: number;
}

const PLAN_INTAKE_STATE_KEY = Symbol.for("samuel.pi.plan-workflow.intake-state");

type PlanIntakeRegistry = {
  sessions: Map<string, PlanIntakeState>;
};

function registry(): PlanIntakeRegistry {
  const scope = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  const existing = scope[PLAN_INTAKE_STATE_KEY];
  if (existing && typeof existing === "object") return existing as PlanIntakeRegistry;

  const created: PlanIntakeRegistry = { sessions: new Map() };
  Object.defineProperty(scope, PLAN_INTAKE_STATE_KEY, {
    configurable: true,
    enumerable: false,
    value: created,
    writable: true,
  });
  return created;
}

function sessionKey(sessionId: string | undefined): string {
  return sessionId?.trim() || "__foreground__";
}

export function beginPlanIntake(options: {
  sessionId?: string;
  planPath: string;
  planTitle: string;
  expectedStepIds: readonly string[];
}): PlanIntakeState {
  const state: PlanIntakeState = {
    sessionId: sessionKey(options.sessionId),
    planPath: options.planPath,
    planTitle: options.planTitle,
    expectedStepIds: [...options.expectedStepIds],
    loadedStepIds: [],
    complete: false,
    startedAt: Date.now(),
  };
  registry().sessions.set(state.sessionId, state);
  return state;
}

export function getPlanIntake(sessionId?: string): PlanIntakeState | undefined {
  return registry().sessions.get(sessionKey(sessionId));
}

export function clearPlanIntake(sessionId?: string): PlanIntakeState | undefined {
  const key = sessionKey(sessionId);
  const state = registry().sessions.get(key);
  registry().sessions.delete(key);
  return state;
}

export function recordPlanIntakeProgress(sessionId: string | undefined, stepIds: readonly string[]): PlanIntakeState | undefined {
  const state = getPlanIntake(sessionId);
  if (!state) return undefined;

  const expected = new Set(state.expectedStepIds);
  const loaded = new Set(state.loadedStepIds);
  for (const stepId of stepIds) {
    if (expected.has(stepId)) loaded.add(stepId);
  }
  state.loadedStepIds = [...loaded];
  state.complete = state.expectedStepIds.every((stepId) => loaded.has(stepId));
  return state;
}

export function clearAllPlanIntakes(): void {
  registry().sessions.clear();
}
