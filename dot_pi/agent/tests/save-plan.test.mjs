import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createJiti } = require(`${process.env.HOME}/.pi/agent/npm/node_modules/.jiti-vMeKVizl/lib/jiti.cjs`);
const jiti = createJiti(`${process.env.HOME}/.pi/agent/npm`, {
  virtualModules: {
    "@earendil-works/pi-coding-agent": {},
  },
});
const logic = await jiti.import(resolve(new URL("../lib/save-plan-logic.ts", import.meta.url).pathname));
const commandModule = await jiti.import(resolve(new URL("../extensions/save-plan.ts", import.meta.url).pathname));

function planEntry(text) {
  return {
    type: "message",
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

test("extension registers the /save-plan command", () => {
  let registration;
  commandModule.default({
    registerCommand: (name, options) => {
      registration = { name, options };
    },
  });

  assert.equal(registration.name, "save-plan");
  assert.match(registration.options.description, /latest Markdown response/);
});

function context(entries, notifications = []) {
  return {
    hasUI: true,
    ui: { notify: (message, level) => notifications.push({ message, level }) },
    sessionManager: {
      getBranch: () => entries,
      getSessionName: () => undefined,
      getSessionId: () => "abc12345-session",
    },
  };
}

test("findLatestAssistantResponse uses the newest non-empty assistant response", () => {
  const entries = [
    planEntry("A detailed plan without a required header."),
    planEntry("This is the latest Markdown response."),
  ];

  assert.equal(logic.findLatestAssistantResponse(entries), "This is the latest Markdown response.");
});

test("preparePlanSave creates a frontmatter note under Saved-Plans without unsafe path components", () => {
  const now = new Date(2026, 0, 2, 3, 4, 5, 6);
  const prepared = logic.preparePlanSave({
    args: "../../Implement auth / safely",
    entries: [planEntry("I would make these changes:\n\n1. Read the module\n2. Update the tests")],
    sessionId: "abc12345-session",
    now,
  });

  assert.ok(prepared);
  assert.match(prepared.path, /^02_Memories\/Saved-Plans\/Implement-Auth-Safely-2026-01-02-030405-006-abc12345\.md$/);
  assert.match(prepared.content, /^---\ncreated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\ndescription: /);
  assert.match(prepared.content, /tags:\n  - plan\n/);
  assert.match(prepared.content, /I would make these changes:\n\n1\. Read the module\n2\. Update the tests/);
  assert.equal(prepared.writeRequest.mode, "overwrite");
  assert.equal(prepared.writeRequest.path, prepared.path);
  assert.equal(prepared.writeRequest.content, prepared.content);
  assert.equal(prepared.writeRequest.commit_message, "Save plan memory: Implement-Auth-Safely");
});

test("savePlan tells the active agent to write the exact prepared note", async () => {
  const notifications = [];
  const prompts = [];
  const ctx = context([planEntry("Inspect the code, then update the tests.")], notifications);

  const result = await commandModule.savePlan("Review rollout", ctx, (prompt) => {
    prompts.push(prompt);
  });

  assert.ok(result);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /explicit \/save-plan command/);
  assert.match(prompts[0], /turbovault_write_note/);
  assert.ok(prompts[0].includes(result.path));
  assert.match(prompts[0], /Inspect the code, then update the tests\./);
  assert.deepEqual(notifications, [{ message: `Asked the active agent to save plan memory: ${result.path}`, level: "info" }]);
});

test("savePlan does not write when the session has no assistant response", async () => {
  const notifications = [];
  let writes = 0;
  const result = await commandModule.savePlan(
    "",
    context([{ type: "message", message: { role: "user", content: "A user request" } }], notifications),
    () => {
      writes += 1;
    },
  );

  assert.equal(result, undefined);
  assert.equal(writes, 0);
  assert.deepEqual(notifications, [{ message: "No non-empty assistant response found in the current session.", level: "error" }]);
});
