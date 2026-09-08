import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const home = process.env.HOME;
const npmRoot = resolve(home, ".pi/agent/npm");
const jitiPath = resolve(npmRoot, "node_modules/.jiti-vMeKVizl/lib/jiti.cjs");
const corePath = resolve(
  "/var/home/linuxbrew/.linuxbrew/Cellar/pi-coding-agent/0.85.1/libexec/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
);
const modePath = resolve(new URL("../extensions/permission-mode.ts", import.meta.url).pathname);
const runtimePath = resolve(new URL("../lib/session-runtime.ts", import.meta.url).pathname);

const CHILD_SCRIPT = ({ coreUrl, jitiPath: childJitiPath, npmRoot: childNpmRoot, modePath: childModePath, runtimePath: childRuntimePath }) => `
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";

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
const runtime = await jiti.import(${JSON.stringify(childRuntimePath)});
const inheritedConfigPath = process.env.PI_TEST_PARENT_CONFIG;
const inheritedConfigBefore = readFileSync(inheritedConfigPath, "utf8");
const childConfigPath = runtime.SESSION_PERMISSION_CONFIG_PATH;
const childRuntimeDir = runtime.SESSION_RUNTIME_DIR;
const childConfigBefore = JSON.parse(readFileSync(childConfigPath, "utf8"));

const mode = await jiti.import(${JSON.stringify(childModePath)});
const shutdownHandlers = [];
mode.default({
  on(event, handler) {
    if (event === "session_shutdown") shutdownHandlers.push(handler);
  },
  registerCommand() {},
  getActiveTools() { return ["read", "ask_user"]; },
  setActiveTools() {},
});
for (const handler of shutdownHandlers) {
  await handler({ type: "session_shutdown", reason: "quit" }, {});
}

console.log("RESULT " + JSON.stringify({
  inheritedConfigPath,
  childConfigPath,
  childRuntimeDir,
  childRuntimeDirIsDistinct: childRuntimeDir !== process.env.PI_TEST_PARENT_RUNTIME_DIR,
  childConfigBefore,
  childConfigExistsAfterShutdown: existsSync(childConfigPath),
  childRuntimeDirExistsAfterShutdown: existsSync(childRuntimeDir),
  parentConfigExistsAfterShutdown: existsSync(inheritedConfigPath),
  parentConfigUnchangedAfterShutdown: readFileSync(inheritedConfigPath, "utf8") === inheritedConfigBefore,
  childRuntimeDirMode: (statSync(childRuntimeDir).mode & 0o777).toString(8),
  childConfigMode: (statSync(childConfigPath).mode & 0o777).toString(8),
}));
`;

const OWNER_SCRIPT = ({ coreUrl, jitiPath: ownerJitiPath, npmRoot: ownerNpmRoot, modePath: ownerModePath, runtimePath: ownerRuntimePath, childScript }) => `
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { createJiti } = require(${JSON.stringify(ownerJitiPath)});
const core = await import(${JSON.stringify(coreUrl)});
const jiti = createJiti(${JSON.stringify(ownerNpmRoot)}, {
  virtualModules: {
    "@earendil-works/pi-coding-agent": {
      ...core,
      getAgentDir: () => process.env.PI_CODING_AGENT_DIR,
    },
  },
});
const runtime = await jiti.import(${JSON.stringify(ownerRuntimePath)});
const parentConfigPath = runtime.SESSION_PERMISSION_CONFIG_PATH;
const parentRuntimeDir = runtime.SESSION_RUNTIME_DIR;
writeFileSync(parentConfigPath, JSON.stringify({
  enabled: true,
  debug: false,
  yoloMode: true,
  forwardedPromptTimeoutSeconds: 30,
  parentSentinel: "must-survive-child",
}, null, 2) + "\\n");
const parentConfigBefore = readFileSync(parentConfigPath, "utf8");
const childEnv = {
  ...process.env,
  PI_TEST_PARENT_CONFIG: parentConfigPath,
  PI_TEST_PARENT_RUNTIME_DIR: parentRuntimeDir,
};
const child = spawnSync(
  process.execPath,
  ["--input-type=module", "--eval", ${JSON.stringify(childScript)}],
  { env: childEnv, encoding: "utf8" },
);
if (child.status !== 0) {
  throw new Error(
    "nested runtime child failed\\nstdout:\\n" + child.stdout + "\\nstderr:\\n" + child.stderr,
  );
}
const childLine = child.stdout.trim().split(/\\r?\\n/).findLast((line) => line.startsWith("RESULT "));
if (!childLine) throw new Error("nested runtime child emitted no result: " + child.stdout);
const childResult = JSON.parse(childLine.slice("RESULT ".length));

console.log("RESULT " + JSON.stringify({
  parentConfigPath,
  parentRuntimeDir,
  parentConfigBefore,
  parentConfigExistsAfterChild: existsSync(parentConfigPath),
  parentConfigUnchangedAfterChild: readFileSync(parentConfigPath, "utf8") === parentConfigBefore,
  parentRuntimeDirMode: (statSync(parentRuntimeDir).mode & 0o777).toString(8),
  parentConfigMode: (statSync(parentConfigPath).mode & 0o777).toString(8),
  parentLogsDirMode: (statSync(runtime.SESSION_PERMISSION_LOGS_DIR).mode & 0o777).toString(8),
  childResult,
}));
`;

const INVALID_METADATA_SCRIPT = ({ coreUrl, jitiPath: probeJitiPath, npmRoot: probeNpmRoot, runtimePath: probeRuntimePath }) => `
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { createJiti } = require(${JSON.stringify(probeJitiPath)});
const core = await import(${JSON.stringify(coreUrl)});
const jiti = createJiti(${JSON.stringify(probeNpmRoot)}, {
  virtualModules: {
    "@earendil-works/pi-coding-agent": {
      ...core,
      getAgentDir: () => process.env.PI_CODING_AGENT_DIR,
    },
  },
});

const explicitConfigPath = resolve(process.env.PI_CODING_AGENT_DIR, "explicit-config.json");
const explicitConfig = JSON.stringify({ yoloMode: true, sentinel: "must-survive" }) + "\\n";
writeFileSync(explicitConfigPath, explicitConfig);
process.env.PI_SESSION_RUNTIME_OWNER_PID = String(process.pid);
process.env.PI_SESSION_RUNTIME_ID = "invalid-runtime-id";
process.env.PI_PERMISSION_SYSTEM_CONFIG_PATH = explicitConfigPath;
process.env.PI_PERMISSION_SYSTEM_LOGS_DIR = resolve(process.env.PI_CODING_AGENT_DIR, "external-logs");

const runtime = await jiti.import(${JSON.stringify(probeRuntimePath)});
const runtimeConfigPath = runtime.SESSION_PERMISSION_CONFIG_PATH;
console.log("RESULT " + JSON.stringify({
  ownsFreshRuntime: runtime.SESSION_RUNTIME_OWNED === true,
  runtimeConfigPath,
  runtimeConfigIsPrivate: (statSync(runtimeConfigPath).mode & 0o777).toString(8) === "600",
  explicitConfigUnchanged: readFileSync(explicitConfigPath, "utf8") === explicitConfig,
  explicitConfigStillExists: existsSync(explicitConfigPath),
}));
`;

const SYMLINK_SCRIPT = ({ coreUrl, jitiPath: probeJitiPath, npmRoot: probeNpmRoot, runtimePath: probeRuntimePath }) => `
import { createRequire } from "node:module";
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createJiti } = require(${JSON.stringify(probeJitiPath)});
const core = await import(${JSON.stringify(coreUrl)});
const jiti = createJiti(${JSON.stringify(probeNpmRoot)}, {
  virtualModules: {
    "@earendil-works/pi-coding-agent": {
      ...core,
      getAgentDir: () => process.env.PI_CODING_AGENT_DIR,
    },
  },
});

const agentDir = process.env.PI_CODING_AGENT_DIR;
const runtimeRoot = join(agentDir, "runtime", "sessions");
const outsideTarget = join(agentDir, "outside-target");
const outsideSentinelPath = join(outsideTarget, "sentinel.txt");
const staleId = String(process.pid) + "-123e4567-e89b-12d3-a456-426614174000";
const symlinkPath = join(runtimeRoot, staleId);
mkdirSync(runtimeRoot, { recursive: true });
mkdirSync(outsideTarget, { recursive: true });
writeFileSync(outsideSentinelPath, "do-not-touch\\n");
symlinkSync(outsideTarget, symlinkPath, "dir");
process.env.PI_SESSION_RUNTIME_OWNER_PID = String(process.pid);
process.env.PI_SESSION_RUNTIME_ID = staleId;
process.env.PI_PERMISSION_SYSTEM_CONFIG_PATH = join(symlinkPath, "permission-system.json");
process.env.PI_PERMISSION_SYSTEM_LOGS_DIR = join(symlinkPath, "permission-logs");

const runtime = await jiti.import(${JSON.stringify(probeRuntimePath)});
const freshRuntimeConfigPath = runtime.SESSION_PERMISSION_CONFIG_PATH;
console.log("RESULT " + JSON.stringify({
  allocatedFreshPath: runtime.SESSION_RUNTIME_DIR !== symlinkPath,
  symlinkStillPresent: lstatSync(symlinkPath).isSymbolicLink(),
  outsideSentinelUnchanged: readFileSync(outsideSentinelPath, "utf8") === "do-not-touch\\n",
  outsideConfigWasNotCreated: !existsSync(join(outsideTarget, "permission-system.json")),
  freshConfigIsPrivate: (lstatSync(freshRuntimeConfigPath).mode & 0o777).toString(8) === "600",
  freshRuntimeDirIsPrivate: (lstatSync(runtime.SESSION_RUNTIME_DIR).mode & 0o777).toString(8) === "700",
}));
`;

function runProbe(label, script) {
  const runtimeRoot = resolve(`/tmp/session-runtime-${label}-${process.pid}`);
  const packageRoot = resolve(runtimeRoot, "npm/node_modules/pi-permission-system");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    resolve(runtimeRoot, "npm/node_modules/pi-permission-system/config.json"),
    JSON.stringify({
      enabled: true,
      debug: false,
      yoloMode: false,
      forwardedPromptTimeoutSeconds: 30,
    }),
  );

  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: runtimeRoot,
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
        script({
          coreUrl: pathToFileURL(corePath).href,
          jitiPath,
          npmRoot,
          runtimePath,
        }),
      ],
      { env, encoding: "utf8" },
    );
    const line = output.trim().split(/\r?\n/).findLast((entry) => entry.startsWith("RESULT "));
    assert.ok(line, `${label} probe emitted no result:\n${output}`);
    return { result: JSON.parse(line.slice("RESULT ".length)), runtimeRoot };
  } catch (error) {
    rmSync(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}

function runOwnershipProbe() {
  const runtimeRoot = resolve(`/tmp/session-runtime-ownership-${process.pid}`);
  mkdirSync(resolve(runtimeRoot, "npm/node_modules/pi-permission-system"), { recursive: true });
  writeFileSync(
    resolve(runtimeRoot, "npm/node_modules/pi-permission-system/config.json"),
    JSON.stringify({
      enabled: true,
      debug: false,
      yoloMode: false,
      forwardedPromptTimeoutSeconds: 30,
    }),
  );

  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: runtimeRoot,
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
        OWNER_SCRIPT({
          coreUrl: pathToFileURL(corePath).href,
          jitiPath,
          npmRoot,
          modePath,
          runtimePath,
          childScript: CHILD_SCRIPT({
            coreUrl: pathToFileURL(corePath).href,
            jitiPath,
            npmRoot,
            modePath,
            runtimePath,
          }),
        }),
      ],
      { env, encoding: "utf8" },
    );
    const line = output.trim().split(/\r?\n/).findLast((entry) => entry.startsWith("RESULT "));
    assert.ok(line, `owner did not emit a runtime result:\n${output}`);
    return { result: JSON.parse(line.slice("RESULT ".length)), runtimeRoot };
  } catch (error) {
    rmSync(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}

test("session runtime isolates nested OS children and cleans only on process exit", () => {
  const { result, runtimeRoot } = runOwnershipProbe();
  try {
    const child = result.childResult;

    assert.equal(child.childRuntimeDirIsDistinct, true);
    assert.equal(child.childConfigBefore.yoloMode, false);
    assert.equal(child.childConfigExistsAfterShutdown, true);
    assert.equal(child.childRuntimeDirExistsAfterShutdown, true);
    assert.equal(child.parentConfigExistsAfterShutdown, true);
    assert.equal(child.parentConfigUnchangedAfterShutdown, true);
    assert.equal(child.childRuntimeDirMode, "700");
    assert.equal(child.childConfigMode, "600");

    assert.equal(result.parentConfigExistsAfterChild, true);
    assert.equal(result.parentConfigUnchangedAfterChild, true);
    assert.equal(result.parentRuntimeDirMode, "700");
    assert.equal(result.parentConfigMode, "600");
    assert.equal(result.parentLogsDirMode, "700");

    // The owner process's exit handler runs after its final RESULT is emitted.
    assert.equal(existsSync(result.parentRuntimeDir), false);
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("session runtime repairs invalid ownership metadata instead of reusing an explicit path", () => {
  const { result, runtimeRoot } = runProbe("invalid-metadata", INVALID_METADATA_SCRIPT);
  try {
    assert.equal(result.ownsFreshRuntime, true);
    assert.equal(result.runtimeConfigIsPrivate, true);
    assert.equal(result.explicitConfigUnchanged, true);
    assert.equal(result.explicitConfigStillExists, true);
    assert.equal(existsSync(result.runtimeConfigPath), false);
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("session runtime fails closed on an inherited runtime symlink", () => {
  const { result, runtimeRoot } = runProbe("symlink", SYMLINK_SCRIPT);
  try {
    assert.equal(result.allocatedFreshPath, true);
    assert.equal(result.symlinkStillPresent, true);
    assert.equal(result.outsideSentinelUnchanged, true);
    assert.equal(result.outsideConfigWasNotCreated, true);
    assert.equal(result.freshConfigIsPrivate, true);
    assert.equal(result.freshRuntimeDirIsPrivate, true);
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
});
