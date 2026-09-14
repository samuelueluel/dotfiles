import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createJiti } = require(`${process.env.HOME}/.pi/agent/npm/node_modules/.jiti-vMeKVizl/lib/jiti.cjs`);
const jiti = createJiti(`${process.env.HOME}/.pi/agent/npm`);
const logic = await jiti.import(resolve(new URL("../lib/save-plan-logic.ts", import.meta.url).pathname));
const state = await jiti.import(resolve(new URL("../lib/plan-workflow-state.ts", import.meta.url).pathname));
const commandModule = await jiti.import(resolve(new URL("../extensions/save-plan.ts", import.meta.url).pathname));

function planEntry(text) {
  return {
    type: "message",
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

const structuredPlan = `# Plan: Advisor Workflow

## Objective
Make planning and execution explicit.

## Scope and constraints
- Keep planning read-only.

## Decisions
- Use one bounded todo item per execution unit.

## Execution units

### U1 — Inspect the workflow
- **Action:** Inspect the relevant files.
- **Verify:** The required files and current behavior are documented.
- **Depends on:** None
- **Substeps:**
  1. Read the extension.
  2. Record the result.

### U2 — Execute the change
- **Action:** Apply the approved change.
- **Verify:** Focused tests pass.
- **Depends on:** U1

## Stop conditions
- Stop when a required file is missing.

## Completion criteria
- The change and tests are complete.

## Open questions
- None
`;

function context(entries, notifications = [], options = {}) {
  return {
    hasUI: options.hasUI ?? true,
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      confirm: options.confirm ?? (async () => true),
      select: options.select ?? (async (title, choices) => choices[0]),
    },
    sessionManager: {
      getBranch: () => entries,
      getSessionName: () => options.sessionName,
      getSessionId: () => options.sessionId ?? "abc12345-session",
    },
  };
}

function lintedEntry(markdown = structuredPlan, title = "Advisor Workflow") {
  return {
    type: "custom",
    customType: logic.LINTED_PLAN_ENTRY_TYPE,
    data: {
      format: logic.PLAN_FORMAT_VERSION,
      title,
      markdown,
      lintedAt: "2026-01-02T03:04:05.000Z",
      sourceSession: "source-session",
    },
  };
}

test("extension registers /lint-plan, /save-plan, and /load-plan", () => {
  const registrations = new Map();
  const handlers = new Map();
  commandModule.default({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, options) => registrations.set(name, options),
    appendEntry: () => {},
    sendUserMessage: () => {},
    getModel: () => undefined,
    getThinkingLevel: () => "high",
  });

  assert.deepEqual([...registrations.keys()], ["lint-plan", "save-plan", "load-plan"]);
  assert.match(registrations.get("lint-plan").description, /Plan Format v1/);
  assert.match(registrations.get("save-plan").description, /successful \/lint-plan/);
  assert.match(registrations.get("load-plan").description, /structured saved plan/);
  assert.ok(handlers.has("message_end"));
  assert.ok(handlers.has("agent_settled"));
  assert.ok(handlers.has("tool_execution_end"));
});

test("findLatestAssistantResponse uses the newest non-empty assistant response", () => {
  const entries = [
    planEntry("A detailed plan."),
    { type: "message", message: { role: "toolResult", content: "tool output" } },
    planEntry("This is the latest Markdown response."),
  ];

  assert.equal(logic.findLatestAssistantResponse(entries), "This is the latest Markdown response.");
});

test("validateStructuredPlan parses bounded execution units and dependencies", () => {
  const parsed = logic.validateStructuredPlan(structuredPlan);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.title, "Advisor Workflow");
  assert.deepEqual(parsed.units.map((unit) => unit.id), ["U1", "U2"]);
  assert.deepEqual(parsed.units[1].dependsOn, ["U1"]);
  assert.match(parsed.units[0].substeps, /Read the extension/);
});

test("validateStructuredPlan rejects commentary and malformed units", () => {
  const parsed = logic.validateStructuredPlan(`Here is the plan.\n\n${structuredPlan.replace("- **Verify:** Focused tests pass.", "- **Check:** Focused tests pass.")}`);

  assert.equal(parsed.ok, false);
  assert.match(parsed.issues.join(" "), /must begin|commentary|unrecognized field/i);
});

test("preparePlanSave uses a stable title filename and generated frontmatter", () => {
  const now = new Date(2026, 0, 2, 3, 4, 5);
  const prepared = logic.preparePlanSave({
    markdown: structuredPlan,
    title: "../../Advisor workflow / safely",
    sessionId: "abc12345-session",
    sourceModel: "openai-codex/gpt-5.6-sol",
    sourceEffort: "xhigh",
    now,
  });

  assert.ok(prepared);
  assert.equal(prepared.path, "02_Memories/Saved-Plans/Advisor-Workflow-Safely.md");
  assert.match(prepared.content, /^---\ncreated: 2026-01-02T03:04:05\nupdated: 2026-01-02T03:04:05/);
  assert.match(prepared.content, /plan_format: 1/);
  assert.match(prepared.content, /status: canonical/);
  assert.match(prepared.content, /source_model: "openai-codex\/gpt-5.6-sol"/);
  assert.match(prepared.content, /# Plan: Advisor Workflow/);
  assert.equal(prepared.commitMessage, "Save plan memory: Advisor-Workflow-Safely");
});

test("findLatestLintedPlan reads the latest branch marker and respects a later reset", () => {
  const latest = { ...lintedEntry(structuredPlan, "Latest"), timestamp: "2026-01-02T03:04:05.000Z" };
  const result = logic.findLatestLintedPlan([lintedEntry(structuredPlan, "Old"), latest]);

  assert.equal(result.title, "Latest");
  assert.equal(result.markdown, structuredPlan);

  const reset = { type: "custom", customType: logic.LINTED_PLAN_RESET_ENTRY_TYPE, data: { format: 1 } };
  assert.equal(logic.findLatestLintedPlan([latest, reset]), undefined);
});

function extensionHarness() {
  const registrations = new Map();
  const handlers = new Map();
  const sent = [];
  const appended = [];
  const pi = {
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, options) => registrations.set(name, options),
    sendUserMessage: (prompt) => sent.push(prompt),
    appendEntry: (customType, data) => appended.push({ customType, data }),
    getModel: () => ({ provider: "openai-codex", id: "gpt-5.6-sol" }),
    getThinkingLevel: () => "xhigh",
  };
  commandModule.default(pi);
  return { registrations, handlers, sent, appended };
}

test("/lint-plan captures a strict response and records it as the canonical plan", async () => {
  state.clearAllPlanIntakes();
  const harness = extensionHarness();
  const notifications = [];
  const ctx = context([], notifications);

  await harness.registrations.get("lint-plan").handler("Advisor Workflow", ctx);
  assert.equal(harness.sent.length, 1);
  assert.match(harness.sent[0], /entire active planning branch/);

  await harness.handlers.get("message_end")({
    message: { role: "assistant", content: [{ type: "text", text: structuredPlan }] },
  });
  await harness.handlers.get("agent_settled")({}, ctx);

  assert.equal(harness.appended.length, 2);
  assert.equal(harness.appended[0].customType, logic.LINTED_PLAN_RESET_ENTRY_TYPE);
  assert.equal(harness.appended[1].customType, logic.LINTED_PLAN_ENTRY_TYPE);
  assert.equal(harness.appended[1].data.markdown, structuredPlan.trim());
  assert.match(notifications.at(-1).message, /Plan linted: Advisor Workflow/);
});

test("savePlan writes the canonical plan directly and does not dispatch a model turn", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-save-plan-"));
  try {
    const notifications = [];
    const dispatched = [];
    const ctx = context([lintedEntry()], notifications);
    const result = await commandModule.savePlan("Advisor Workflow", ctx, {
      vaultRoot: root,
      now: new Date(2026, 0, 2, 3, 4, 5),
      sourceModel: "openai-codex/gpt-5.6-sol",
      sourceEffort: "high",
    });

    assert.ok(result);
    assert.equal(dispatched.length, 0);
    assert.equal(result.path, "02_Memories/Saved-Plans/Advisor-Workflow.md");
    const saved = await readFile(join(root, result.path), "utf8");
    assert.equal(saved, result.content);
    assert.match(saved, /status: canonical/);
    assert.match(saved, /### U1 — Inspect the workflow/);
    assert.deepEqual(notifications, [{ message: "Saved plan: 02_Memories/Saved-Plans/Advisor-Workflow.md", level: "info" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("savePlan asks before replacing a stable filename", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-save-plan-"));
  try {
    const relativePath = "02_Memories/Saved-Plans/Advisor-Workflow.md";
    await mkdir(join(root, "02_Memories/Saved-Plans"), { recursive: true });
    await writeFile(join(root, relativePath), "old", "utf8");

    const notifications = [];
    let confirmations = 0;
    const ctx = context([lintedEntry()], notifications, {
      confirm: async () => {
        confirmations += 1;
        return false;
      },
    });
    const result = await commandModule.savePlan("Advisor Workflow", ctx, { vaultRoot: root });

    assert.equal(result, undefined);
    assert.equal(confirmations, 1);
    assert.deepEqual(notifications, [{ message: "Saved plan unchanged.", level: "info" }]);
    assert.equal(await readFile(join(root, relativePath), "utf8"), "old");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("savePlan requires a successful lint result", async () => {
  const notifications = [];
  const result = await commandModule.savePlan(
    "",
    context([planEntry(structuredPlan)], notifications),
    { vaultRoot: "/tmp/does-not-matter" },
  );

  assert.equal(result, undefined);
  assert.deepEqual(notifications, [{
    message: "No successful /lint-plan result in the active branch. Run /lint-plan before /save-plan.",
    level: "error",
  }]);
});

test("buildLintPlanPrompt explicitly handles scattered context and bounded units", () => {
  const prompt = logic.buildLintPlanPrompt("Advisor Workflow");

  assert.match(prompt, /entire active planning branch/);
  assert.match(prompt, /no preamble, no postscript, no commentary/);
  assert.match(prompt, /Use this title exactly/);
  assert.match(prompt, /Target 8 or fewer execution units/);
  assert.match(prompt, /never produce more than 12/);
  assert.match(prompt, /do not make each command or minor check a separate execution unit/i);
});

test("listSavedPlans sorts by updated frontmatter and rankPlanCandidates fuzzy-matches titles", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-save-plan-"));
  try {
    await mkdir(join(root, "02_Memories/Saved-Plans"), { recursive: true });
    const first = logic.buildPlanNote(structuredPlan, "Older Plan", new Date(2026, 0, 1, 1, 0, 0));
    const second = logic.buildPlanNote(structuredPlan.replace("Advisor Workflow", "Advisor Workflow New"), "Advisor Workflow New", new Date(2026, 0, 2, 1, 0, 0));
    await writeFile(join(root, "02_Memories/Saved-Plans/Older-Plan.md"), first);
    await writeFile(join(root, "02_Memories/Saved-Plans/Advisor-Workflow-New.md"), second);

    const files = await commandModule.listSavedPlans(root);
    assert.deepEqual(files.map((file) => file.plan.title), ["Advisor Workflow New", "Older Plan"]);
    const ranked = logic.rankPlanCandidates(files.map((file) => file.candidate), "adv wf");
    assert.equal(ranked[0].title, "Advisor Workflow New");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildLoadPlanPrompt requests one todo per bounded execution unit and no execution", () => {
  const plan = logic.parseSavedPlanDocument(
    logic.buildPlanNote(structuredPlan, "Advisor Workflow", new Date(2026, 0, 2, 3, 4, 5)),
    "02_Memories/Saved-Plans/Advisor-Workflow.md",
  );
  const prompt = logic.buildLoadPlanPrompt(plan);

  assert.match(prompt, /INTAKE ONLY/);
  assert.match(prompt, /exactly one pending todo item for each supplied execution unit/);
  assert.match(prompt, /not one item per substep/);
  assert.match(prompt, /plan_step_id/);
  assert.match(prompt, /U1/);
  assert.match(prompt, /do not execute/i);
});

test("loadPlan uses the picker and starts a todo-only intake", async () => {
  state.clearAllPlanIntakes();
  const root = await mkdtemp(join(tmpdir(), "pi-load-plan-"));
  try {
    await mkdir(join(root, "02_Memories/Saved-Plans"), { recursive: true });
    const content = logic.buildPlanNote(structuredPlan, "Advisor Workflow", new Date(2026, 0, 2, 3, 4, 5));
    await writeFile(join(root, "02_Memories/Saved-Plans/Advisor-Workflow.md"), content);

    const notifications = [];
    const prompts = [];
    let choices;
    const ctx = context([], notifications, {
      select: async (_title, options) => {
        choices = options;
        return options[0];
      },
    });
    const result = await commandModule.loadPlan("", ctx, (prompt) => prompts.push(prompt), { vaultRoot: root });

    assert.equal(result.title, "Advisor Workflow");
    assert.equal(choices.length, 1);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /INTAKE ONLY/);
    assert.equal(state.getPlanIntake("abc12345-session").planPath, "02_Memories/Saved-Plans/Advisor-Workflow.md");
    assert.match(notifications[0].message, /Loading .* into todo/);
  } finally {
    state.clearAllPlanIntakes();
    await rm(root, { recursive: true, force: true });
  }
});

test("plan intake remains active until settlement after all todo units arrive", async () => {
  state.clearAllPlanIntakes();
  const harness = extensionHarness();
  const notifications = [];
  const ctx = context([], notifications);
  const root = await mkdtemp(join(tmpdir(), "pi-load-plan-"));
  try {
    await mkdir(join(root, "02_Memories/Saved-Plans"), { recursive: true });
    const content = logic.buildPlanNote(structuredPlan, "Advisor Workflow", new Date(2026, 0, 2, 3, 4, 5));
    await writeFile(join(root, "02_Memories/Saved-Plans/Advisor-Workflow.md"), content);
    await commandModule.loadPlan("", ctx, () => {}, { vaultRoot: root });

    const sourcePath = "02_Memories/Saved-Plans/Advisor-Workflow.md";
    const result = {
      details: {
        tasks: ["U1", "U2"].map((id, index) => ({
          id: index + 1,
          subject: `${id} task`,
          status: "pending",
          metadata: { plan_source: sourcePath, plan_step_id: id },
        })),
      },
    };
    await harness.handlers.get("tool_execution_end")({ toolName: "todo", isError: false, result }, ctx);

    assert.equal(state.getPlanIntake("abc12345-session").complete, true);
    await harness.handlers.get("agent_settled")({}, ctx);
    assert.equal(state.getPlanIntake("abc12345-session"), undefined);
    assert.match(notifications.at(-1).message, /No execution was started/);
  } finally {
    state.clearAllPlanIntakes();
    await rm(root, { recursive: true, force: true });
  }
});
