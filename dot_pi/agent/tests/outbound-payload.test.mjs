import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const AGENT_DIR = resolve(process.env.HOME, ".pi/agent");
const PI_BIN = "/home/linuxbrew/.linuxbrew/bin/pi";
const OPERATION_NAMES = [
  "document_analysis_list",
  "document_analysis_status",
  "document_analysis_attach",
  "document_analysis_show",
  "document_analysis_ingest",
  "document_analysis_enrich",
  "document_analysis_archive",
  "document_analysis_delete",
];

async function runPayloadProbe(outputPath) {
  const temp = await mkdtemp(join(tmpdir(), "pi-outbound-payload-"));
  const extension = join(temp, "probe.mjs");
  await writeFile(extension, `
import { writeFileSync } from "node:fs";
const payloads = [];
export default function (pi) {
  pi.on("before_provider_request", (event) => {
    payloads.push({ activeTools: pi.getActiveTools(), payload: event.payload });
    writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({ payloads }));
  });
}
`, "utf8");

  const env = { ...process.env, PI_CPTR_HEADLESS: "1" };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const child = spawn(
    PI_BIN,
    ["--no-session", "--mode", "json", "-e", extension, "-p", "First call the document_analysis_load tool. After it succeeds, reply with OK."],
    { cwd: "/var/home/samuel", env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  try {
    const exit = await new Promise((resolveExit, rejectExit) => {
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        rejectExit(new Error(`Pi outbound-payload probe timed out.\nstderr:\n${stderr}`));
      }, 60_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        rejectExit(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolveExit({ code, signal });
      });
    });
    assert.equal(exit.code, 0, `Pi outbound-payload probe failed (${exit.signal}).\nstderr:\n${stderr}\nstdout:\n${stdout}`);
    await access(outputPath);
    return JSON.parse(await readFile(outputPath, "utf8"));
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await rm(temp, { recursive: true, force: true });
  }
}

test("first provider payload omits retired workflows and deferred document operations", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "pi-outbound-payload-result-"));
  const outputPath = join(outputDir, "payload.json");
  try {
    const result = await runPayloadProbe(outputPath);
    assert.ok(result.payloads?.length >= 2, "probe did not capture fresh payloads before and after loading");
    const first = result.payloads[0];
    const second = result.payloads[1];
    const firstPayload = first.payload ?? {};
    const secondPayload = second.payload ?? {};
    const toolNamesInPayload = (payload) => {
      const names = new Set();
      const visit = (value) => {
        if (Array.isArray(value)) {
          for (const item of value) visit(item);
          return;
        }
        if (!value || typeof value !== "object") return;
        const record = value;
        if ((record.type === "function" || record.type === "custom") && typeof record.name === "string") {
          names.add(record.name);
        }
        if (record.function && typeof record.function === "object" && typeof record.function.name === "string") {
          names.add(record.function.name);
        }
        for (const child of Object.values(record)) visit(child);
      };
      visit(payload);
      return names;
    };
    const firstNames = toolNamesInPayload(firstPayload);
    const secondNames = toolNamesInPayload(secondPayload);
    const firstImmediateNames = new Set(
      (Array.isArray(firstPayload.tools) ? firstPayload.tools : [])
        .map((tool) => tool?.name ?? tool?.function?.name)
        .filter(Boolean),
    );

    assert.ok(firstNames.has("document_analysis_load"));
    for (const name of OPERATION_NAMES) assert.equal(firstNames.has(name), false, name);
    assert.equal(JSON.stringify(firstPayload).includes("SubagentWorkflow"), false);
    assert.ok(secondNames.has("document_analysis_load"));
    for (const name of OPERATION_NAMES) {
      assert.ok(secondNames.has(name), `loader did not expose ${name} in the provider payload`);
    }
    assert.equal(JSON.stringify(secondPayload).includes("SubagentWorkflow"), false);

    const missingUnrelated = [...firstNames].filter((name) => !secondNames.has(name));
    assert.deepEqual(missingUnrelated, [], "loading document tools removed unrelated provider tools");
    const addedNames = [...secondNames].filter((name) => !firstNames.has(name)).sort();
    assert.deepEqual(addedNames, [...OPERATION_NAMES].sort(), "only document operations should be added after loading");

    for (const name of ["read", "bash", "grep", "find", "ls", "ask_user", "todo"]) {
      assert.ok(firstImmediateNames.has(name), `core tool missing from first payload: ${name}`);
    }
    assert.deepEqual(
      first.activeTools.filter((name) => OPERATION_NAMES.includes(name)),
      [],
    );
    assert.ok(
      second.activeTools.some((name) => OPERATION_NAMES.includes(name)),
      "loader did not activate document operations",
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("activation ownership keeps the bridge and registry from bypassing permission", async () => {
  const bridgeSource = await readFile(join(AGENT_DIR, "extensions/document-analysis-bridge.ts"), "utf8");
  const activationSource = await readFile(join(AGENT_DIR, "lib/tool-activation.ts"), "utf8");
  const permissionSource = await readFile(join(AGENT_DIR, "local-packages/pi-permission-system/src/index.ts"), "utf8");
  assert.doesNotMatch(bridgeSource, /setActiveTools/);
  assert.doesNotMatch(activationSource, /setActiveTools/);
  assert.match(permissionSource, /originalSetActiveTools/);
  assert.match(permissionSource, /registerToolActivationReconciler/);
});

test("workflow retirement is enforced at the registration boundary", async () => {
  const source = await readFile(join(AGENT_DIR, "local-packages/pi-subagents/src/index.ts"), "utf8");
  assert.doesNotMatch(source, /WORKFLOWS_RETIRED|workflowTool|WORKFLOW_FILE_FLAG/);
  assert.doesNotMatch(source, /registerEntryRenderer<.*Workflow|showWorkflowsMenu|setWorkflowSource/);
});
