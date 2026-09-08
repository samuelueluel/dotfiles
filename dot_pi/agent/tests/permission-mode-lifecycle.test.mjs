import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const home = process.env.HOME;
const npmRoot = resolve(home, ".pi/agent/npm");
const jitiPath = resolve(npmRoot, "node_modules/.jiti-vMeKVizl/lib/jiti.cjs");
const permissionPath = resolve(npmRoot, "node_modules/pi-permission-system/index.ts");
const permissionSourcePath = resolve(npmRoot, "node_modules/pi-permission-system/src/index.ts");
const wrapperPath = resolve(new URL("../local-packages/pi-permission-system/src/index.ts", import.meta.url).pathname);
const modePath = resolve(new URL("../extensions/permission-mode.ts", import.meta.url).pathname);
const corePath = resolve(
  "/var/home/linuxbrew/.linuxbrew/Cellar/pi-coding-agent/0.85.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
);

const CHILD_SCRIPT = ({ order, coreUrl, jitiPath: childJitiPath, npmRoot: childNpmRoot, wrapperPath: childWrapperPath, modePath: childModePath }) => `
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const order = ${JSON.stringify(order)};
const require = createRequire(import.meta.url);
const { createJiti } = require(${JSON.stringify(childJitiPath)});
const core = await import(${JSON.stringify(coreUrl)});
const jiti = createJiti(${JSON.stringify(childNpmRoot)}, {
  virtualModules: {
    "@earendil-works/pi-coding-agent": {
      ...core,
      getAgentDir: () => process.env.PI_CODING_AGENT_DIR,
    },
  },
});
const childContext = await jiti.import(join(process.env.PI_CODING_AGENT_DIR, "npm/node_modules/@tintinweb/pi-subagents/src/child-context.ts"));
// Import the mode module first so its process-local runtime exists before the
// compatibility wrapper loads the installed package, just as the live Pi
// process does before its first mode lifecycle event.
const mode = await jiti.import(${JSON.stringify(childModePath)});
const permission = await jiti.import(${JSON.stringify(childWrapperPath)});

function makePi() {
  const handlers = new Map();
  const commands = new Map();
  let activeTools = ["read", "ask_user", "bash", "Agent", "custom_extension_tool"];\n  const toolNames = ["read", "ask_user", "bash", "Agent", "custom_extension_tool"];
  const pi = {
    on(event, handler) {
      const registered = handlers.get(event) ?? [];
      registered.push(handler);
      handlers.set(event, registered);
    },
    registerCommand(name, options) { commands.set(name, options); },
    registerTool() {},
    getActiveTools() { return [...activeTools]; },
    setActiveTools(names) { activeTools = [...new Set(names)]; },
    getAllTools() {
      return toolNames.map((name) => ({ name }));
    },
  };
  return { pi, handlers, commands, activeTools: () => [...activeTools] };
}

let promptCount = 0;
function context(id) {
  return {
    cwd: process.cwd(),
    hasUI: true,
    sessionManager: {
      getEntries: () => [],
      getSessionId: () => id,
      getSessionDir: () => process.cwd(),
    },
    ui: {
      theme: { fg: (_color, text) => text },
      notify() {},
      setStatus() {},
      select: async () => {
        promptCount += 1;
        return "Allow Once";
      },
      input: async () => undefined,
    },
    getSystemPrompt: () => "",
  };
}

async function emit(session, event, ctx) {
  let result;
  for (const handler of session.handlers.get(event.type) ?? []) {
    const handlerResult = await handler(event, ctx);
    if (handlerResult) result = handlerResult;
    if (handlerResult?.block) return handlerResult;
  }
  return result;
}

const parent = makePi();
const child = makePi();
const child2 = makePi();
const install = order === "local-first"
  ? async () => { mode.default(parent.pi); await permission.default(parent.pi); }
  : async () => { await permission.default(parent.pi); mode.default(parent.pi); };
await install();
const configPath = process.env.PI_PERMISSION_SYSTEM_CONFIG_PATH;
const runtimeDir = dirname(configPath);

await emit(parent, { type: "session_start", reason: "startup" }, context("parent"));
await parent.commands.get("autoask").handler("", context("parent"));
const autoaskGeneric = await emit(
  parent,
  { type: "tool_call", toolName: "Agent", toolCallId: "parent-autoask-agent", input: {} },
  context("parent"),
);
const autoaskOtherGeneric = await emit(
  parent,
  { type: "tool_call", toolName: "custom_extension_tool", toolCallId: "parent-autoask-custom", input: {} },
  context("parent"),
);
const autoaskQuestion = await emit(
  parent,
  { type: "tool_call", toolName: "ask_user", toolCallId: "parent-autoask-question", input: {} },
  context("parent"),
);
const promptsAfterAutoask = promptCount;
const globalRuntimeBeforeChild = globalThis.__piPermissionSystem;

const childInstall = order === "local-first"
  ? async () => { mode.default(child.pi); await permission.default(child.pi); }
  : async () => { await permission.default(child.pi); mode.default(child.pi); };
const child2Install = order === "local-first"
  ? async () => { mode.default(child2.pi); await permission.default(child2.pi); }
  : async () => { await permission.default(child2.pi); mode.default(child2.pi); };
await childContext.runInChildSessionContext(async () => {
  await childInstall();
  await childContext.runInChildSessionContext(child2Install);
});
await emit(child, { type: "session_start", reason: "startup" }, context("child"));
await emit(child2, { type: "session_start", reason: "startup" }, context("child2"));
await emit(parent, { type: "session_shutdown", reason: "quit" }, context("parent"));
const globalRuntimeAfterRootWithChild = globalThis.__piPermissionSystem;
// Shut down the second/nested child first, then the first child. This is an
// intentional out-of-order teardown while the process root is already gone.
await emit(child2, { type: "session_shutdown", reason: "quit" }, context("child2"));
await emit(child, { type: "session_shutdown", reason: "quit" }, context("child"));
const configAfterChild = JSON.parse(readFileSync(configPath, "utf8"));
const globalRuntimeAfterChild = globalThis.__piPermissionSystem;
await emit(parent, { type: "session_start", reason: "startup" }, context("parent-replacement"));
await emit(parent, { type: "before_agent_start", systemPrompt: "BASE PROMPT" }, context("parent"));
const autoaskAfterChild = await emit(
  parent,
  { type: "tool_call", toolName: "Agent", toolCallId: "parent-after-child-agent", input: {} },
  context("parent"),
);
const autoaskOtherAfterChild = await emit(
  parent,
  { type: "tool_call", toolName: "custom_extension_tool", toolCallId: "parent-after-child-custom", input: {} },
  context("parent"),
);

await parent.commands.get("manual").handler("", context("parent"));
const manualGeneric = await emit(
  parent,
  { type: "tool_call", toolName: "Agent", toolCallId: "parent-manual-agent", input: {} },
  context("parent"),
);
const manualPrompts = promptCount - promptsAfterAutoask;
const configYoloAfterManual = JSON.parse(readFileSync(configPath, "utf8")).yoloMode;

await parent.commands.get("auto").handler("", context("parent"));
const autoQuestion = await emit(
  parent,
  { type: "tool_call", toolName: "ask_user", toolCallId: "parent-auto-question", input: {} },
  context("parent"),
);
await emit(parent, { type: "session_shutdown", reason: "quit" }, context("parent"));
const globalRuntimeAfterRootShutdown = Boolean(globalThis.__piPermissionSystem);

console.log("RESULT " + JSON.stringify({
  order,
  configPath,
  runtimeDir,
  runtimeConfigExistsAfterChild: existsSync(configPath),
  configYoloAfterChild: configAfterChild.yoloMode,
  globalRuntimeAfterRootWithChild: Boolean(globalRuntimeAfterRootWithChild),
  globalRuntimeAfterChild: Boolean(globalRuntimeAfterChild),
  globalRuntimeSameAfterRootWithChild: globalRuntimeAfterRootWithChild === globalRuntimeBeforeChild,
  globalRuntimeSameAfterChild: globalRuntimeAfterChild === globalRuntimeBeforeChild,
  globalYoloAfterChild: globalRuntimeAfterChild?.getYoloMode?.(),
  globalRuntimeAfterRootShutdown,
  autoaskGenericBlocked: autoaskGeneric?.block === true,
  autoaskOtherGenericBlocked: autoaskOtherGeneric?.block === true,
  autoaskQuestionBlocked: autoaskQuestion?.block === true,
  autoaskPrompts: promptsAfterAutoask,
  autoaskAfterChildBlocked: autoaskAfterChild?.block === true,
  autoaskOtherAfterChildBlocked: autoaskOtherAfterChild?.block === true,
  manualGenericBlocked: manualGeneric?.block === true,
  manualPrompts,
  configYoloAfterManual,
  autoQuestionBlocked: autoQuestion?.block === true,
  askUserActiveAfterAuto: parent.activeTools().includes("ask_user"),
}));
`;

function runLifecycle(order) {
  const runtimeRoot = resolve(
    `/tmp/permission-mode-lifecycle-${process.pid}-${order}`,
  );
  const packageRoot = resolve(runtimeRoot, "npm/node_modules/pi-permission-system");
  const subagentsRoot = resolve(runtimeRoot, "npm/node_modules/@tintinweb/pi-subagents");
  mkdirSync(dirname(packageRoot), { recursive: true });
  mkdirSync(dirname(subagentsRoot), { recursive: true });
  symlinkSync(dirname(permissionPath), packageRoot, "dir");
  symlinkSync(resolve(npmRoot, "node_modules/@tintinweb/pi-subagents"), subagentsRoot, "dir");

  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: runtimeRoot,
    PI_DEFAULT_MODE: "",
    PI_PERMISSION_SYSTEM_CONFIG_PATH: "",
    PI_PERMISSION_SYSTEM_LOGS_DIR: "",
    PI_SESSION_RUNTIME_OWNER_PID: "",
    PI_SESSION_RUNTIME_ID: "",
  };

  try {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        CHILD_SCRIPT({
          order,
          coreUrl: pathToFileURL(corePath).href,
          jitiPath,
          npmRoot,
          wrapperPath,
          modePath,
        }),
      ],
      { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const resultLine = output
      .trim()
      .split(/\r?\n/)
      .findLast((line) => line.startsWith("RESULT "));
    assert.ok(resultLine, `child did not emit a lifecycle result:\n${output}`);
    return { result: JSON.parse(resultLine.slice("RESULT ".length)), runtimeRoot };
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? "";
    const stdout = error?.stdout?.toString?.() ?? "";
    throw new Error(`lifecycle child failed (${order})\nstdout:\n${stdout}\nstderr:\n${stderr}\n${error}`);
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

test("installed permission package has no child-specific shutdown semantics beyond global unregister", () => {
  const source = readFileSync(permissionSourcePath, "utf8");
  const shutdownStart = source.indexOf('pi.on("session_shutdown"');
  const beforeAgentStart = source.indexOf('pi.on("before_agent_start"', shutdownStart);
  assert.ok(shutdownStart >= 0);
  assert.ok(beforeAgentStart > shutdownStart);
  const shutdownHandler = source.slice(shutdownStart, beforeAgentStart);
  assert.equal((shutdownHandler.match(/event\??\.reason/g) ?? []).length, 1);
  assert.equal((shutdownHandler.match(/unregisterPiPermissionSystemRuntimeApi/g) ?? []).length, 1);
  assert.equal((shutdownHandler.match(/runtimeApi = null/g) ?? []).length, 1);
});

for (const order of ["package-first", "local-first"]) {
  test(`permission mode survives an in-process child Agent (${order})`, () => {
    const { result, runtimeRoot } = runLifecycle(order);

    assert.equal(result.runtimeConfigExistsAfterChild, true);
    assert.equal(result.configYoloAfterChild, true);
    assert.equal(result.autoaskGenericBlocked, false);
    assert.equal(result.autoaskOtherGenericBlocked, false);
    assert.equal(result.autoaskQuestionBlocked, false);
    assert.equal(result.autoaskPrompts, 0);
    assert.equal(result.autoaskAfterChildBlocked, false);
    assert.equal(result.autoaskOtherAfterChildBlocked, false);
    assert.equal(result.manualGenericBlocked, false);
    assert.equal(result.manualPrompts, 1);
    assert.equal(result.configYoloAfterManual, false);
    assert.equal(result.autoQuestionBlocked, true);
    assert.equal(result.askUserActiveAfterAuto, false);

    // The child process's exit handler, not child session_shutdown, owns this
    // directory. The parent-side cleanup also makes this assertion independent
    // of a failed child teardown.
    assert.equal(existsSync(runtimeRoot), false);

    assert.equal(result.globalRuntimeAfterRootWithChild, true);
    assert.equal(result.globalRuntimeAfterChild, true);
    assert.equal(result.globalRuntimeSameAfterRootWithChild, true);
    assert.equal(result.globalRuntimeSameAfterChild, true);
    assert.equal(result.globalYoloAfterChild, true);
    assert.equal(result.globalRuntimeAfterRootShutdown, false);
  });
}
