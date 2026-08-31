import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createJiti } = require(`${process.env.HOME}/.pi/agent/npm/node_modules/.jiti-vMeKVizl/lib/jiti.cjs`);
const jiti = createJiti(`${process.env.HOME}/.pi/agent/npm`);
const extension = await jiti.import(`${process.env.HOME}/.pi/agent/extensions/todo-reminders.ts`);

function makeHarness({ threshold = 15, branch = [] } = {}) {
  process.env.PI_TODO_DRIFT_THRESHOLD = String(threshold);
  const handlers = new Map();
  const pi = {
    on(name, handler) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
  };
  extension.default(pi);
  assert.equal(handlers.get("context").length, 1);
  const ctx = {
    sessionManager: { getBranch: () => branch },
    hasPendingMessages: () => false,
  };

  return {
    handlers,
    ctx,
    async emit(name, event = {}) {
      let result;
      for (const handler of handlers.get(name) ?? []) result = await handler(event, ctx) ?? result;
      return result;
    },
  };
}

const openTasks = [{ id: 1, subject: "test", status: "pending" }];
const todoCreateResult = {
  details: { action: "create", params: {}, tasks: openTasks, nextId: 2 },
};

function messagesWithToolTail() {
  return [
    { role: "user", content: "work" },
    { role: "toolResult", toolName: "bash", isError: false, content: [] },
  ];
}

test("injects after a tool-result tail and consumes the due reminder once", async () => {
  const harness = makeHarness({ threshold: 2 });
  await harness.emit("session_start");
  await harness.emit("agent_start");
  await harness.emit("tool_execution_end", {
    toolName: "todo",
    isError: false,
    result: todoCreateResult,
  });
  await harness.emit("tool_execution_end", { toolName: "read", isError: false, result: {} });
  await harness.emit("tool_execution_end", { toolName: "bash", isError: false, result: {} });

  const contextHandler = harness.handlers.get("context")[0];
  const injected = await contextHandler({ messages: messagesWithToolTail() }, harness.ctx);
  const reminder = injected.messages.at(-1);
  assert.equal(reminder.customType, "pi-system-reminders");
  assert.equal(reminder.details.placement, "after-tail");
  assert.match(reminder.content[0].text, /2 successful tool actions/);
  assert.equal(await contextHandler({ messages: messagesWithToolTail() }, harness.ctx), undefined);
});

test("reconstructs open work from the active branch", async () => {
  const branch = [
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "todo",
        details: todoCreateResult.details,
      },
    },
  ];
  const harness = makeHarness({ threshold: 1, branch });
  await harness.emit("session_start");
  await harness.emit("agent_start");
  await harness.emit("tool_execution_end", { toolName: "read", isError: false, result: {} });

  const contextHandler = harness.handlers.get("context")[0];
  const injected = await contextHandler({ messages: messagesWithToolTail() }, harness.ctx);
  assert.match(injected.messages.at(-1).content[0].text, /1 successful tool action/);
});

test("settled guard schedules one soft reminder without auto-continuing", async () => {
  const branch = [
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "I will continue." }] } },
  ];
  const harness = makeHarness({ threshold: 99, branch });
  await harness.emit("session_start");
  await harness.emit("agent_start");
  await harness.emit("tool_execution_end", {
    toolName: "todo",
    isError: false,
    result: todoCreateResult,
  });
  await harness.emit("agent_settled");
  await harness.emit("agent_start");

  const contextHandler = harness.handlers.get("context")[0];
  const injected = await contextHandler({ messages: [{ role: "user", content: "next" }] }, harness.ctx);
  const reminder = injected.messages.find((message) => message.customType === "pi-system-reminders");
  assert.match(reminder.content[0].text, /previous agent run settled/);
  assert.equal(await contextHandler({ messages: [{ role: "user", content: "next" }] }, harness.ctx), undefined);
});
