import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAN_WORKFLOW_REMINDER,
  TodoReminderTracker,
  allOpenTodoWorkBlocked,
  assistantAppearsToAwaitUserInput,
  extractLatestTodoSnapshot,
  hasOpenTodoWork,
  hasPlanSourcedOpenWork,
  isRealTodoMutation,
  parseTodoSnapshot,
  readTodoReminderConfig,
  renderTodoReminder,
} from "../lib/todo-reminder-logic.ts";

const task = (id, status, extra = {}) => ({ id, subject: `task ${id}`, status, ...extra });
const details = (action, tasks, nextId = tasks.length + 1, extra = {}) => ({
  action,
  params: {},
  tasks,
  nextId,
  ...extra,
});

const openSnapshot = [task(1, "pending")];
const completedSnapshot = [task(1, "completed")];

function createTracker(threshold = 3, maxNudgesPerCycle = 2) {
  const tracker = new TodoReminderTracker({ threshold, maxNudgesPerCycle });
  tracker.observeTodoResult(details("create", openSnapshot));
  return tracker;
}

test("parses and validates todo snapshots", () => {
  const snapshot = parseTodoSnapshot(details("list", openSnapshot));
  assert.deepEqual(snapshot.tasks, openSnapshot);
  assert.equal(snapshot.nextId, 2);
  assert.equal(parseTodoSnapshot({ tasks: [], nextId: 0 }), undefined);
  assert.equal(parseTodoSnapshot({ tasks: ["bad"], nextId: 2 }), undefined);
});

test("replays the latest valid todo snapshot from a branch", () => {
  const branch = [
    { type: "message", message: { role: "toolResult", toolName: "todo", details: details("create", openSnapshot) } },
    { type: "message", message: { role: "toolResult", toolName: "todo", details: details("update", completedSnapshot) } },
  ];
  assert.deepEqual(extractLatestTodoSnapshot(branch).tasks, completedSnapshot);
  assert.equal(hasOpenTodoWork(extractLatestTodoSnapshot(branch)), false);
});

test("recognizes blocked open work but not completed dependencies", () => {
  const blocked = {
    tasks: [task(1, "pending", { blockedBy: [2] })],
    nextId: 2,
  };
  assert.equal(allOpenTodoWorkBlocked(blocked), true);
  assert.equal(
    allOpenTodoWorkBlocked({
      tasks: [task(1, "pending", { blockedBy: [2] }), task(2, "completed")],
      nextId: 3,
    }),
    false,
  );
});

test("uses safe defaults for malformed environment values", () => {
  assert.deepEqual(
    readTodoReminderConfig({ PI_TODO_DRIFT_THRESHOLD: "-1", PI_TODO_DRIFT_MAX_NUDGES: "999" }),
    { threshold: 15, maxNudgesPerCycle: 2 },
  );
  assert.deepEqual(
    readTodoReminderConfig({ PI_TODO_DRIFT_THRESHOLD: "12", PI_TODO_DRIFT_MAX_NUDGES: "1" }),
    { threshold: 12, maxNudgesPerCycle: 1 },
  );
});

test("counts successful actions only while open work remains", () => {
  const tracker = new TodoReminderTracker({ threshold: 2, maxNudgesPerCycle: 2 });
  assert.equal(tracker.getDiagnostics().hasOpenWork, false);
  tracker.observeSuccessfulAction();
  assert.equal(tracker.getDiagnostics().actionsSinceMutation, 0);
  tracker.observeTodoResult(details("create", openSnapshot));
  tracker.observeSuccessfulAction();
  tracker.observeSuccessfulAction();
  assert.equal(tracker.consumeReminder().reason, "drift");
});

test("list, get, errors, and no-op updates do not reset cadence", () => {
  const tracker = createTracker(3);
  tracker.observeSuccessfulAction();
  tracker.observeSuccessfulAction();
  tracker.observeTodoResult(details("list", openSnapshot));
  tracker.observeTodoResult(details("get", openSnapshot));
  tracker.observeTodoResult(details("update", openSnapshot, 2, { error: "no change" }));
  tracker.observeTodoResult(details("update", openSnapshot));
  tracker.observeSuccessfulAction();
  assert.equal(tracker.consumeReminder().reason, "drift");
});

test("a real mutation resets cadence and completion disarms reminders", () => {
  const tracker = createTracker(2);
  tracker.observeSuccessfulAction();
  tracker.observeTodoResult(details("update", [{ ...openSnapshot[0], status: "in_progress" }]));
  tracker.observeSuccessfulAction();
  assert.equal(tracker.consumeReminder(), undefined);

  tracker.observeTodoResult(details("update", completedSnapshot));
  tracker.observeSuccessfulAction();
  assert.equal(tracker.getDiagnostics().hasOpenWork, false);
  assert.equal(tracker.consumeReminder(), undefined);
});

test("reminders are capped and require a new request cycle", () => {
  const tracker = createTracker(1, 2);
  tracker.observeSuccessfulAction();
  assert.equal(tracker.consumeReminder().reason, "drift");
  tracker.observeSuccessfulAction();
  assert.equal(tracker.consumeReminder().reason, "drift");
  tracker.observeSuccessfulAction();
  assert.equal(tracker.consumeReminder(), undefined);

  tracker.resetRequestCycle();
  tracker.observeSuccessfulAction();
  assert.equal(tracker.consumeReminder().reason, "drift");
});

test("settled guard is bounded and suppressed for blocked or waiting work", () => {
  const tracker = createTracker(99, 2);
  tracker.markSettled({ awaitingUserInput: true });
  assert.equal(tracker.consumeReminder(), undefined);
  tracker.markSettled();
  assert.equal(tracker.consumeReminder().reason, "settled");
  tracker.markSettled();
  assert.equal(tracker.consumeReminder(), undefined);

  const blocked = new TodoReminderTracker({ threshold: 99, maxNudgesPerCycle: 2 });
  blocked.observeTodoResult(details("create", [task(1, "pending", { blockedBy: [2] })]));
  blocked.markSettled();
  assert.equal(blocked.consumeReminder(), undefined);
});

test("detects conservative assistant requests for user input", () => {
  assert.equal(
    assistantAppearsToAwaitUserInput([
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Which option should I use?" }] } },
    ]),
    true,
  );
  assert.equal(
    assistantAppearsToAwaitUserInput([
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "I will continue." }] } },
    ]),
    false,
  );
});

test("mutation detection uses details.error and snapshot comparison", () => {
  const before = parseTodoSnapshot(details("create", openSnapshot));
  const after = parseTodoSnapshot(details("update", [{ ...openSnapshot[0], status: "in_progress" }]));
  assert.equal(isRealTodoMutation(before, after, details("update", after.tasks)), true);
  assert.equal(isRealTodoMutation(before, before, details("update", before.tasks)), false);
  assert.equal(isRealTodoMutation(before, after, details("update", after.tasks, 2, { error: "rejected" })), false);
});

const planTask = (id, status, extra = {}) => ({
  id,
  subject: `unit ${id}`,
  status,
  metadata: { plan_source: "02_Memories/Saved-Plans/Advisor-Workflow.md", plan_step_id: "U1" },
  ...extra,
});

test("detects open plan-sourced work from task metadata", () => {
  assert.equal(hasPlanSourcedOpenWork({ tasks: [planTask(1, "pending")], nextId: 2 }), true);
  assert.equal(hasPlanSourcedOpenWork({ tasks: [planTask(1, "in_progress")], nextId: 2 }), true);
  assert.equal(hasPlanSourcedOpenWork({ tasks: [planTask(1, "completed")], nextId: 2 }), false);
  assert.equal(hasPlanSourcedOpenWork({ tasks: [task(1, "pending")], nextId: 2 }), false);
  assert.equal(hasPlanSourcedOpenWork({ tasks: [planTask(1, "pending", { metadata: {} })], nextId: 2 }), false);
  assert.equal(hasPlanSourcedOpenWork(undefined), false);
});

test("plan-sourced state rides drift and settled reminders and survives restore", () => {
  const tracker = new TodoReminderTracker({ threshold: 1, maxNudgesPerCycle: 2 });
  tracker.observeTodoResult(details("create", [planTask(1, "pending")]));
  tracker.observeSuccessfulAction();

  const payload = tracker.consumeReminder();
  assert.equal(payload.planSourced, true);
  const rendered = renderTodoReminder(payload);
  assert.match(rendered, /Todo Alignment Check/);
  assert.match(rendered, /\[Plan Note\]/);
  assert.match(rendered, /re-read it for a unit's full details or after compaction/);
  assert.match(rendered, /Objective, Decisions, or Stop conditions, stop and ask first/);

  const plain = new TodoReminderTracker({ threshold: 1, maxNudgesPerCycle: 2 });
  plain.observeTodoResult(details("create", openSnapshot));
  plain.observeSuccessfulAction();
  assert.equal(renderTodoReminder(plain.consumeReminder()).includes("[Plan Note]"), false);
});

test("one-shot plan reminder arms on restore and consumes once", () => {
  const snapshot = { tasks: [planTask(1, "pending")], nextId: 2 };
  const tracker = new TodoReminderTracker({ threshold: 1, maxNudgesPerCycle: 2 });
  tracker.restore(snapshot);
  assert.equal(tracker.consumePlanReminder(), PLAN_WORKFLOW_REMINDER);
  assert.equal(tracker.consumePlanReminder(), undefined);

  const withoutPlanWork = new TodoReminderTracker({ threshold: 1, maxNudgesPerCycle: 2 });
  withoutPlanWork.restore({ tasks: openSnapshot, nextId: 2 });
  assert.equal(withoutPlanWork.consumePlanReminder(), undefined);

  // Once all plan tasks complete, a restore must not re-arm the reminder.
  const settled = new TodoReminderTracker({ threshold: 1, maxNudgesPerCycle: 2 });
  settled.restore({ tasks: [planTask(1, "completed")], nextId: 2 });
  assert.equal(settled.consumePlanReminder(), undefined);

  // Completion between restore and consumption suppresses the one-shot.
  const completedAfterRestore = new TodoReminderTracker({ threshold: 1, maxNudgesPerCycle: 2 });
  completedAfterRestore.restore({ tasks: [planTask(1, "pending")], nextId: 2 });
  completedAfterRestore.observeTodoResult(details("update", [planTask(1, "completed")]));
  assert.equal(completedAfterRestore.consumePlanReminder(), undefined);
});

test("armed one-shot suppresses the plan suffix on a simultaneous drift reminder", () => {
  const tracker = new TodoReminderTracker({ threshold: 1, maxNudgesPerCycle: 2 });
  tracker.restore({ tasks: [planTask(1, "pending")], nextId: 2 });
  tracker.observeSuccessfulAction();

  const drift = tracker.consumeReminder();
  assert.equal(drift.planSourced, false);
  assert.equal(renderTodoReminder(drift).includes("[Plan Note]"), false);
  assert.match(tracker.consumePlanReminder(), /\[Plan Note\]/);

  // With no one-shot pending, drift carries the plan guidance again.
  tracker.observeSuccessfulAction();
  assert.equal(tracker.consumeReminder().planSourced, true);
});
