import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createJiti } = require(`${process.env.HOME}/.pi/agent/npm/node_modules/.jiti-vMeKVizl/lib/jiti.cjs`);
const jiti = createJiti(`${process.env.HOME}/.pi/agent/npm`, {
  virtualModules: {
    "@earendil-works/pi-coding-agent": {
      getAgentDir: () => `${process.env.HOME}/.pi/agent`,
    },
  },
});
const modeModule = await jiti.import(
  resolve(new URL("../extensions/permission-mode.ts", import.meta.url).pathname),
);

function createHarness(initialTools = ["read", "ask_user", "bash"]) {
  const previousRuntime = globalThis.__piPermissionSystem;
  let yoloMode = false;
  let activeTools = [...initialTools];
  const handlers = new Map();
  const commands = new Map();

  const runtime = {
    getYoloMode: () => yoloMode,
    setYoloMode: (enabled) => {
      yoloMode = enabled;
      return { yoloMode, changed: true, persisted: false };
    },
  };
  globalThis.__piPermissionSystem = runtime;

  const pi = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerCommand(name, options) {
      commands.set(name, options);
    },
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(names) {
      activeTools = [...new Set(names)];
    },
  };

  modeModule.default(pi);

  return {
    handlers,
    commands,
    runtime,
    context: {
      cwd: process.cwd(),
      hasUI: false,
      ui: {},
      sessionManager: {
        getEntries: () => [],
        getSessionId: () => "mode-enforcement-test",
      },
    },
    activeTools: () => [...activeTools],
    async command(name, args = "") {
      const command = commands.get(name);
      assert.ok(command, `/${name} should be registered`);
      await command.handler(args, this.context);
    },
    async settle() {
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
    cleanup() {
      if (previousRuntime === undefined) {
        delete globalThis.__piPermissionSystem;
      } else {
        globalThis.__piPermissionSystem = previousRuntime;
      }
    },
  };
}

test("auto hides and runtime-blocks ask_user while injecting fallback guidance", async () => {
  const harness = createHarness();
  try {
    await harness.command("auto");

    assert.equal(harness.runtime.getYoloMode(), true);
    assert.deepEqual(harness.activeTools(), ["read", "bash"]);

    const beforeAgentStart = await harness.handlers.get("before_agent_start")(
      { systemPrompt: "BASE PROMPT" },
      harness.context,
    );
    assert.match(beforeAgentStart.systemPrompt, /AUTO mode overrides general or bundled skill instructions/);
    assert.match(beforeAgentStart.systemPrompt, /AUTO mode is non-interactive/);
    assert.match(beforeAgentStart.systemPrompt, /safest reversible assumption/);
    assert.match(beforeAgentStart.systemPrompt, /stop and report the specific blocker/);

    const blocked = await harness.handlers.get("tool_call")(
      { toolName: "ask_user", toolCallId: "stale-call", input: {} },
      harness.context,
    );
    assert.equal(blocked.block, true);
    assert.match(blocked.reason, /Do not retry `ask_user`/);
  } finally {
    await harness.settle();
    harness.cleanup();
  }
});

test("autoask keeps ask_user available while auto-approving permissions", async () => {
  const harness = createHarness();
  try {
    await harness.command("autoask");

    assert.equal(harness.runtime.getYoloMode(), true);
    assert.ok(harness.activeTools().includes("ask_user"));

    const askResult = await harness.handlers.get("tool_call")(
      { toolName: "ask_user", toolCallId: "interactive-call", input: {} },
      harness.context,
    );
    assert.equal(askResult, undefined);

    const mcpResult = await harness.handlers.get("tool_call")(
      {
        toolName: "mcp",
        toolCallId: "automatic-mcp-call",
        input: { tool: "turbovault_write_note", args: { path: "note.md" } },
      },
      harness.context,
    );
    assert.notEqual(mcpResult?.block, true);

    const bashResult = await harness.handlers.get("tool_call")(
      {
        toolName: "bash",
        toolCallId: "automatic-bash-call",
        input: { command: "rm -rf /tmp/permission-mode-test" },
      },
      harness.context,
    );
    assert.notEqual(bashResult?.block, true);
  } finally {
    await harness.settle();
    harness.cleanup();
  }
});

test("manual restores ask_user and disables YOLO", async () => {
  const harness = createHarness();
  try {
    await harness.command("auto");
    await harness.command("manual");

    assert.equal(harness.runtime.getYoloMode(), false);
    assert.ok(harness.activeTools().includes("ask_user"));

    const result = await harness.handlers.get("tool_call")(
      { toolName: "ask_user", toolCallId: "manual-call", input: {} },
      harness.context,
    );
    assert.equal(result, undefined);
  } finally {
    await harness.settle();
    harness.cleanup();
  }
});

test("mode command accepts autoask and switches the tool surface", async () => {
  const harness = createHarness();
  try {
    await harness.command("mode", "auto");
    assert.equal(harness.activeTools().includes("ask_user"), false);

    await harness.command("mode", "autoask");
    assert.equal(harness.runtime.getYoloMode(), true);
    assert.equal(harness.activeTools().includes("ask_user"), true);
  } finally {
    await harness.settle();
    harness.cleanup();
  }
});

test("mode switching does not re-enable a policy-filtered ask_user tool", async () => {
  const harness = createHarness(["read", "bash"]);
  try {
    await harness.command("auto");
    await harness.command("autoask");
    await harness.command("manual");

    assert.equal(harness.activeTools().includes("ask_user"), false);
  } finally {
    await harness.settle();
    harness.cleanup();
  }
});

assert.match(modeModule.AUTO_MODE_GUIDANCE, /do not call `ask_user`/);
