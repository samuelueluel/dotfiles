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

const PLAN_TOOL_SURFACE = [
  "read",
  "ask_user",
  "bash",
  "edit",
  "write",
  "todo",
  "advisor",
  "mcp",
  "mcp__turbovault",
  "mcpScript",
  "Agent",
  "smart_save_memory",
  "powershell",
  "preview_export",
  "smart_compact",
  "steer_subagent",
  "document_analysis_delete",
];

function createHarness(initialTools = ["read", "ask_user", "bash"]) {
  const previousRuntime = globalThis.__piPermissionSystem;
  const previousModeState = globalThis[modeModule.PERMISSION_MODE_STATE_KEY];
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
    setUpstreamTools(names) {
      // Stand in for pi-permission-system or a reload changing the surface
      // while plan mode is active.
      activeTools = [...names];
    },
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
      if (previousModeState === undefined) {
        delete globalThis[modeModule.PERMISSION_MODE_STATE_KEY];
      } else {
        globalThis[modeModule.PERMISSION_MODE_STATE_KEY] = previousModeState;
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

test("plan disables YOLO, keeps ask_user, and drops mutating tools from the surface", async () => {
  const harness = createHarness(PLAN_TOOL_SURFACE);
  try {
    await harness.command("plan");

    assert.equal(harness.runtime.getYoloMode(), false);
    assert.ok(harness.activeTools().includes("ask_user"));
    assert.ok(harness.activeTools().includes("read"));
    assert.ok(harness.activeTools().includes("bash"));
    assert.ok(harness.activeTools().includes("todo"));
    assert.ok(harness.activeTools().includes("smart_compact"), "compaction stays available in plan mode");
    assert.equal(harness.activeTools().includes("edit"), false);
    assert.equal(harness.activeTools().includes("write"), false);
    assert.equal(harness.activeTools().includes("smart_save_memory"), false);
    assert.equal(harness.activeTools().includes("powershell"), false);
    assert.equal(harness.activeTools().includes("document_analysis_delete"), false);
  } finally {
    await harness.settle();
    harness.cleanup();
  }
});

test("plan injects read-only guidance and does not inject auto guidance", async () => {
  const harness = createHarness(PLAN_TOOL_SURFACE);
  try {
    await harness.command("plan");

    const beforeAgentStart = await harness.handlers.get("before_agent_start")(
      { systemPrompt: "BASE PROMPT" },
      harness.context,
    );
    assert.match(beforeAgentStart.systemPrompt, /PLAN mode is read-only/);
    assert.match(beforeAgentStart.systemPrompt, /Never switch permission modes yourself/);
    assert.doesNotMatch(beforeAgentStart.systemPrompt, /AUTO mode is non-interactive/);
  } finally {
    await harness.settle();
    harness.cleanup();
  }
});

test("plan blocks mutating tools even when the model still calls them", async () => {
  const harness = createHarness(PLAN_TOOL_SURFACE);
  try {
    await harness.command("plan");
    const toolCall = harness.handlers.get("tool_call");

    for (const toolName of [
      "edit",
      "write",
      "mcpScript",
      "smart_save_memory",
      "powershell",
      "preview_export",
      "steer_subagent",
      "document_analysis_delete",
    ]) {
      const blocked = await toolCall({ toolName, toolCallId: `plan-${toolName}`, input: {} }, harness.context);
      assert.equal(blocked?.block, true, `${toolName} must be blocked in plan mode`);
      assert.match(blocked.reason, /PLAN mode is read-only/);
    }

    const allowed = await toolCall({ toolName: "read", toolCallId: "plan-read", input: { path: "x.md" } }, harness.context);
    assert.notEqual(allowed?.block, true);
  } finally {
    await harness.settle();
    harness.cleanup();
  }
});

test("plan allows only headless-strict read-only Bash and blocks exec wrappers", async () => {
  const harness = createHarness(PLAN_TOOL_SURFACE);
  try {
    await harness.command("plan");
    const toolCall = harness.handlers.get("tool_call");

    for (const command of ["ls -la", "rg permission /var/home/samuel/.pi/agent", "cat notes.md | wc -l"]) {
      const allowed = await toolCall({ toolName: "bash", toolCallId: `plan-${command}`, input: { command } }, harness.context);
      assert.notEqual(allowed?.block, true, `${command} should be allowed in plan mode`);
    }

    for (const command of ["rm -rf /tmp/plan-mode-test", "touch /tmp/plan-mode-marker", "time ls", "env whoami"]) {
      const blocked = await toolCall({ toolName: "bash", toolCallId: `plan-${command}`, input: { command } }, harness.context);
      assert.equal(blocked?.block, true, `${command} must be blocked in plan mode`);
      assert.match(blocked.reason, /PLAN mode is read-only/);
    }
  } finally {
    await harness.settle();
    harness.cleanup();
  }
});

test("plan gates MCP to read-only operations and Agent to Explore subagents", async () => {
  const harness = createHarness(PLAN_TOOL_SURFACE);
  try {
    await harness.command("plan");
    const toolCall = harness.handlers.get("tool_call");

    const readOnlyMcp = await toolCall(
      { toolName: "mcp", toolCallId: "plan-mcp-read", input: { tool: "turbovault_read_note", args: { path: "a.md" } } },
      harness.context,
    );
    assert.notEqual(readOnlyMcp?.block, true);

    const mutatingMcp = await toolCall(
      { toolName: "mcp", toolCallId: "plan-mcp-write", input: { tool: "turbovault_write_note", args: { path: "a.md" } } },
      harness.context,
    );
    assert.equal(mutatingMcp?.block, true);
    assert.match(mutatingMcp.reason, /PLAN mode is read-only/);

    const explore = await toolCall(
      { toolName: "Agent", toolCallId: "plan-agent-explore", input: { subagent_type: "Explore", prompt: "find it" } },
      harness.context,
    );
    assert.notEqual(explore?.block, true);

    const executor = await toolCall(
      { toolName: "Agent", toolCallId: "plan-agent-executor", input: { subagent_type: "Executor", prompt: "build it" } },
      harness.context,
    );
    assert.equal(executor?.block, true);
    assert.match(executor.reason, /PLAN mode is read-only/);

    const scheduled = await toolCall(
      { toolName: "Agent", toolCallId: "plan-agent-scheduled", input: { subagent_type: "Explore", schedule: "5m", prompt: "later" } },
      harness.context,
    );
    assert.equal(scheduled?.block, true, "scheduled delegation must be blocked in plan mode");

    const worktree = await toolCall(
      { toolName: "Agent", toolCallId: "plan-agent-worktree", input: { subagent_type: "Explore", isolation: "worktree", prompt: "checkout" } },
      harness.context,
    );
    assert.equal(worktree?.block, true, "worktree isolation must be blocked in plan mode");

    const resumed = await toolCall(
      { toolName: "Agent", toolCallId: "plan-agent-resume", input: { subagent_type: "Explore", resume: "a1b2c3d4e5f678901", prompt: "keep going" } },
      harness.context,
    );
    assert.equal(resumed?.block, true, "resuming an existing child must be blocked: the declared type is not authoritative");

    const install = await toolCall(
      { toolName: "mcp", toolCallId: "plan-mcp-install", input: { action: "install", url: "https://example.com/mcp" } },
      harness.context,
    );
    assert.equal(install?.block, true, "MCP install must be blocked in plan mode");

    const authStart = await toolCall(
      { toolName: "mcp", toolCallId: "plan-mcp-auth", input: { action: "auth-start", server: "turbovault" } },
      harness.context,
    );
    assert.equal(authStart?.block, true, "MCP auth must be blocked in plan mode");

    for (const input of [{ describe: "read_note" }, { search: "vault" }, { server: "turbovault" }, {}]) {
      const readOnlyShape = await toolCall({ toolName: "mcp", toolCallId: `plan-mcp-${JSON.stringify(input)}`, input }, harness.context);
      assert.notEqual(readOnlyShape?.block, true, `generic MCP read-only shape ${JSON.stringify(input)} should be allowed`);
    }
  } finally {
    await harness.settle();
    harness.cleanup();
  }
});

test("leaving plan restores the pre-plan tool surface exactly", async () => {
  const harness = createHarness(PLAN_TOOL_SURFACE);
  try {
    await harness.command("plan");
    assert.equal(harness.activeTools().includes("edit"), false);

    await harness.command("manual");
    assert.equal(harness.runtime.getYoloMode(), false);
    for (const toolName of PLAN_TOOL_SURFACE) {
      assert.ok(harness.activeTools().includes(toolName), `${toolName} should return after leaving plan`);
    }

    await harness.command("plan");
    assert.equal(harness.activeTools().includes("write"), false);

    await harness.command("autoask");
    assert.equal(harness.runtime.getYoloMode(), true);
    assert.ok(harness.activeTools().includes("write"));
    assert.ok(harness.activeTools().includes("ask_user"));

    await harness.command("auto");
    assert.equal(harness.activeTools().includes("write"), true);
    assert.equal(harness.activeTools().includes("ask_user"), false);
  } finally {
    await harness.settle();
    harness.cleanup();
  }
});

test("leaving plan restores the latest upstream surface, not the stale entry snapshot", async () => {
  const harness = createHarness(PLAN_TOOL_SURFACE);
  try {
    await harness.command("plan");
    assert.equal(harness.activeTools().includes("edit"), false);

    harness.setUpstreamTools([...PLAN_TOOL_SURFACE, "grep", "notebook_edit"]);
    await harness.handlers.get("before_agent_start")({ systemPrompt: "BASE PROMPT" }, harness.context);
    assert.ok(harness.activeTools().includes("grep"), "newly discovered read-only tools stay available");
    assert.equal(harness.activeTools().includes("notebook_edit"), false, "newly discovered mutating tools stay filtered");
    assert.equal(harness.activeTools().includes("edit"), false);

    await harness.command("manual");
    assert.ok(harness.activeTools().includes("grep"));
    assert.ok(harness.activeTools().includes("notebook_edit"), "exit restores the upstream surface, not the entry snapshot");
    assert.ok(harness.activeTools().includes("edit"));
  } finally {
    await harness.settle();
    harness.cleanup();
  }
});

test("mode command accepts plan and reports it", async () => {
  const harness = createHarness(PLAN_TOOL_SURFACE);
  try {
    await harness.command("mode", "plan");
    assert.equal(harness.runtime.getYoloMode(), false);
    assert.equal(harness.activeTools().includes("edit"), false);
    assert.ok(harness.activeTools().includes("ask_user"));
  } finally {
    await harness.settle();
    harness.cleanup();
  }
});

assert.match(modeModule.AUTO_MODE_GUIDANCE, /do not call `ask_user`/);
assert.match(modeModule.PLAN_MODE_GUIDANCE, /PLAN mode is read-only/);
assert.match(modeModule.PLAN_MODE_BLOCK_REASON("edit"), /switch to \/manual, \/autoask, or \/auto/);
assert.equal(modeModule.PLAN_ALLOWED_TOOLS.has("read"), true);
assert.equal(modeModule.PLAN_ALLOWED_TOOLS.has("edit"), false);
assert.equal(modeModule.PLAN_ALLOWED_TOOLS.has("mcpScript"), false);
assert.equal(modeModule.PLAN_ALLOWED_TOOLS.has("preview_export"), false);
assert.equal(modeModule.PLAN_ALLOWED_TOOLS.has("smart_compact"), true);
assert.equal(modeModule.PLAN_ALLOWED_TOOLS.has("steer_subagent"), false);
assert.equal(modeModule.PLAN_READONLY_MCP_ACTIONS.has("describe"), true);
assert.equal(modeModule.PLAN_READONLY_MCP_ACTIONS.has("install"), false);
assert.equal(modeModule.PLAN_READONLY_SUBAGENT_TYPES.has("explore"), true);
assert.equal(modeModule.PLAN_READONLY_SUBAGENT_TYPES.has("executor"), false);
