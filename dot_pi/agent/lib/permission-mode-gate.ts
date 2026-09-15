export type PlanModeGateDecision =
  | { mode: "other" }
  | { mode: "plan"; allowed: true }
  | { mode: "plan"; allowed: false; reason: string };

export type PlanModeGate = (toolName: string, input: unknown) => PlanModeGateDecision;

export const PLAN_MODE_GATE_KEY = Symbol.for("samuel.pi.permission-mode.plan-gate");

type GlobalWithPlanModeGate = typeof globalThis & {
  [PLAN_MODE_GATE_KEY]?: PlanModeGate;
};

export function registerPlanModeGate(gate: PlanModeGate): void {
  (globalThis as GlobalWithPlanModeGate)[PLAN_MODE_GATE_KEY] = gate;
}

export function getPlanModeGate(): PlanModeGate | undefined {
  return (globalThis as GlobalWithPlanModeGate)[PLAN_MODE_GATE_KEY];
}
