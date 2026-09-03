import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createJiti } = require(`${process.env.HOME}/.pi/agent/npm/node_modules/.jiti-vMeKVizl/lib/jiti.cjs`);
const jiti = createJiti(`${process.env.HOME}/.pi/agent/npm`);
const bridgeLogic = await jiti.import(
  resolve(new URL("../lib/document-analysis-bridge-logic.ts", import.meta.url).pathname),
);
const bridgePolicy = await jiti.import(
  resolve(new URL("../lib/document-analysis-bridge-policy.ts", import.meta.url).pathname),
);
const permissionSource = await readFile(
  resolve(new URL("../extensions/permission-mode.ts", import.meta.url).pathname),
  "utf8",
);

const localRoute = {
  classification: "local",
  provider: "local",
  model: "Qwen3.6-MoE-35B-Q8",
  baseUrl: "http://127.0.0.1:13305/api/v1",
};

function sessionContext(sessionId = "session-a") {
  return { sessionManager: { getSessionId: () => sessionId } };
}


test("classifies local, loopback, cloud, and unknown routes conservatively", () => {
  assert.equal(bridgeLogic.routeFor({ model: localRoute }).classification, "local");
  assert.equal(
    bridgeLogic.routeFor({ model: { provider: "openai", baseUrl: "http://localhost:8080/v1" } }).classification,
    "local",
  );
  assert.equal(
    bridgeLogic.routeFor({ model: { provider: "openai", baseUrl: "https://api.openai.com/v1" } }).classification,
    "nonlocal",
  );
  assert.equal(
    bridgeLogic.routeFor({ model: { provider: "local", baseUrl: "https://cloud.example/v1" } }).classification,
    "nonlocal",
  );
  assert.equal(bridgeLogic.routeFor({ model: {} }).classification, "unknown");
  assert.throws(() => bridgeLogic.requireKnownRoute({ model: {} }), /cannot verify/);
  assert.throws(
    () => bridgeLogic.requireLocalRoute({ model: { provider: "openai", baseUrl: "https://api.openai.com/v1" } }),
    /non-local route/,
  );
});


test("blocks alternate document-root reads on non-local routes", async () => {
  const root = bridgeLogic.DOCUMENT_ANALYSIS_ROOT;
  assert.equal(bridgeLogic.documentRootAccess("read", { path: `${root}/jobs/job-123/normalized/document.md` }, "/tmp"), true);
  assert.equal(bridgeLogic.documentRootAccess("bash", { command: `cat ${root}/jobs/job-123/normalized/document.md` }, "/tmp"), true);
  assert.equal(bridgeLogic.documentRootAccess("bash", { command: "find /var/home/samuel/OpenWebUI-Access-Folder -type f" }, "/tmp"), true);
  assert.equal(bridgeLogic.documentRootAccess("openwebui_filesystem_read_file", { path: "document-analysis/jobs/job-123/manifest.json" }, "/tmp"), true);
  assert.equal(bridgeLogic.documentRootAccess("read", { path: "." }, root), true);
  assert.equal(bridgeLogic.documentRootAccess("read", { path: "/tmp/public.txt" }, "/tmp"), false);
  assert.equal(bridgeLogic.documentRootAccess("bash", { command: "ls" }, "/tmp"), false);

  const aliasParent = await mkdtemp(join(tmpdir(), "document-analysis-alias-"));
  try {
    const alias = join(aliasParent, "alias");
    await symlink(root, alias);
    assert.equal(
      bridgeLogic.documentRootAccess("read", { path: join(alias, "jobs", "job-123", "manifest.json") }, aliasParent),
      true,
    );
  } finally {
    await rm(aliasParent, { recursive: true, force: true });
  }
  assert.match(permissionSource, /documentRootAccess\(event\.toolName, event\.input, ctx\.cwd\)/);
  assert.match(permissionSource, /event\.toolName === "bash"/);
});


test("requires a reliable session identity and rejects unsafe identifiers", () => {
  assert.equal(bridgeLogic.requireSessionId(sessionContext()), "session-a");
  assert.throws(
    () => bridgeLogic.requireSessionId({ sessionManager: {} }),
    /cannot verify the current Pi\/cptr session/,
  );

  assert.equal(bridgeLogic.validJobId("20260902T000000Z-a-document"), "20260902T000000Z-a-document");
  for (const value of ["", "a", "../escape", "job;touch", "job name", "job/$HOME"]) {
    assert.throws(() => bridgeLogic.validJobId(value), /invalid job ID/);
  }

  const inbox = "/var/home/samuel/OpenWebUI-Access-Folder/document-analysis/inbox";
  assert.equal(bridgeLogic.inboxFilename("report.pdf", inbox), "report.pdf");
  assert.equal(bridgeLogic.inboxFilename("@report.pdf", inbox), "report.pdf");
  for (const value of ["../report.pdf", "sub/report.pdf", "sub\\report.pdf", "/tmp/report.pdf", ""]) {
    assert.throws(() => bridgeLogic.inboxFilename(value, inbox), /direct child filename/);
  }
});


test("builds argv without a shell and rejects unknown bridge operations", () => {
  assert.deepEqual(
    bridgeLogic.buildCliArgs("/safe/root", "list", ["--status", "ready"]),
    ["--root", "/safe/root", "list", "--status", "ready"],
  );
  const argv = bridgeLogic.buildCliArgs("/safe/root", "ingest", ["a;touch", "--stability-wait", "0.25"]);
  assert.deepEqual(argv, ["--root", "/safe/root", "ingest", "a;touch", "--stability-wait", "0.25"]);
  assert.throws(() => bridgeLogic.buildCliArgs("/safe/root", "shell", []), /unsupported/);
  assert.deepEqual(bridgeLogic.deleteCliArgs("job-123", true, undefined), {
    jobId: "job-123",
    args: ["job-123", "--dry-run"],
  });
  assert.deepEqual(bridgeLogic.deleteCliArgs("job-123", false, "job-123"), {
    jobId: "job-123",
    args: ["job-123", "--confirm", "job-123"],
  });
  assert.throws(() => bridgeLogic.deleteCliArgs("job-123", false, "job-12x"), /confirm_job_id/);
});


test("binds jobs atomically and rejects session mismatches, duplicates, and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "document-analysis-bridge-"));
  try {
    const noAnalysis = "job-no-analysis";
    await mkdir(join(root, "jobs", noAnalysis), { recursive: true });
    assert.equal(await bridgeLogic.readBinding(root, noAnalysis), undefined);
    await assert.rejects(readdir(join(root, "jobs", noAnalysis, "analysis")), { code: "ENOENT" });

    const jobId = "job-123";
    await mkdir(join(root, "jobs", jobId, "analysis"), { recursive: true });
    const first = await bridgeLogic.bindJob(root, jobId, "session-a", localRoute);
    assert.deepEqual(first, { jobId, sessionId: "session-a", rebound: false });
    assert.equal(await bridgeLogic.requireBound(root, jobId, "session-a", localRoute), jobId);
    assert.equal((await readdir(join(root, "jobs", jobId, "analysis"))).length, 1);
    const binding = JSON.parse(await readFile(join(root, "jobs", jobId, "analysis", "cptr-session.json"), "utf8"));
    assert.deepEqual(
      { schema_version: binding.schema_version, job_id: binding.job_id, session_id: binding.session_id },
      { schema_version: 1, job_id: jobId, session_id: "session-a" },
    );

    await assert.rejects(
      bridgeLogic.requireBound(root, jobId, "session-b", localRoute),
      /different Pi\/cptr session/,
    );
    await assert.rejects(
      bridgeLogic.bindJob(root, jobId, "session-b", localRoute),
      /different Pi\/cptr session/,
    );
    const rebound = await bridgeLogic.bindJob(root, jobId, "session-b", localRoute, true);
    assert.deepEqual(rebound, { jobId, sessionId: "session-b", rebound: true });

    const race = "job-race";
    const raceAnalysis = join(root, "jobs", race, "analysis");
    await mkdir(raceAnalysis, { recursive: true });
    const freshMalformedLock = join(raceAnalysis, ".cptr-session.lock");
    await writeFile(freshMalformedLock, "", "utf8");
    await assert.rejects(
      bridgeLogic.bindJob(root, race, "session-race-a", localRoute),
      /job session binding is busy/,
    );
    assert.equal(await readFile(freshMalformedLock, "utf8"), "");
    await unlink(freshMalformedLock);
    const outcomes = await Promise.allSettled([
      bridgeLogic.bindJob(root, race, "session-race-a", localRoute),
      bridgeLogic.bindJob(root, race, "session-race-b", localRoute),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const raceBinding = await bridgeLogic.readBinding(root, race);
    assert.ok(raceBinding && ["session-race-a", "session-race-b"].includes(raceBinding.session_id));
    assert.equal(
      (await readdir(join(root, "jobs", race, "analysis"))).some((name) => name.endsWith(".tmp")),
      false,
    );

    const duplicate = "job-dup";
    await mkdir(join(root, "jobs", duplicate, "analysis"), { recursive: true });
    await mkdir(join(root, "archive", duplicate, "analysis"), { recursive: true });
    await assert.rejects(bridgeLogic.findJobDir(root, duplicate), /more than one canonical location/);

    const symlinkId = "job-link";
    await symlink(join(root, "jobs", jobId), join(root, "jobs", symlinkId));
    await assert.rejects(bridgeLogic.findJobDir(root, symlinkId), /symlink/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("headless policy names only the exact document bridge tools", () => {
  const names = [...bridgePolicy.DOCUMENT_ANALYSIS_TOOL_NAMES];
  assert.equal(names.length, 8);
  for (const name of names) assert.equal(bridgePolicy.isDocumentAnalysisBridgeTool(name), true);
  assert.equal(bridgePolicy.isDocumentAnalysisBridgeTool("document_analysis_evil"), false);
  assert.equal(bridgePolicy.isDocumentAnalysisBridgeTool("bash"), false);
  assert.match(permissionSource, /\.\.\.DOCUMENT_ANALYSIS_TOOL_NAMES/);
  assert.match(permissionSource, /isSafeBashCommand\(command, true\)/);
});


test("registered bridge tools use fixed argv and fail closed before execution", async () => {
  const temp = await mkdtemp(join(tmpdir(), "document-analysis-bridge-harness-"));
  const wrapper = join(temp, "bridge-harness.ts");
  const bridgePath = resolve(new URL("../extensions/document-analysis-bridge.ts", import.meta.url).pathname);
  const permissionPath = resolve(new URL("../extensions/permission-mode.ts", import.meta.url).pathname);
  const wrapperSource = `
import bridge from ${JSON.stringify(bridgePath)};
import permission from ${JSON.stringify(permissionPath)};

export default function (pi) {
  const tools = new Map();
  const calls = [];
  const toolCallHandlers = [];
  const fakePi = {
    registerTool(definition) { tools.set(definition.name, definition); },
    on(name, handler) { if (name === "tool_call") toolCallHandlers.push(handler); },
    registerCommand() {},
    async exec(...args) {
      calls.push(args);
      const operation = args[1][2];
      return { code: 0, stdout: operation === "status" ? "{}\\n" : "[]\\n", stderr: "" };
    },
  };
  bridge(fakePi);
  permission(fakePi);
  pi.registerCommand("bridge-harness", {
    handler: async (_args, ctx) => {
      const local = {
        model: { provider: "local", id: "Qwen3.6-MoE-35B-Q8", baseUrl: "http://127.0.0.1:13305/api/v1" },
        sessionManager: { getSessionId: () => "harness-session" },
      };
      const status = await tools.get("document_analysis_status").execute("status-call", { job_id: "job-123" }, undefined, undefined, local);
      const list = await tools.get("document_analysis_list").execute("list-call", { status: "ready" }, undefined, undefined, local);
      const cloud = {
        model: { provider: "openai", id: "cloud-model", baseUrl: "https://cloud.example/v1" },
        sessionManager: { getSessionId: () => "harness-session" },
      };
      let cloudListBlocked = false;
      try { await tools.get("document_analysis_list").execute("cloud-list", {}, undefined, undefined, cloud); } catch (error) { cloudListBlocked = String(error).includes("non-local route"); }
      let cloudStatusBlocked = false;
      try { await tools.get("document_analysis_status").execute("cloud-status", { job_id: "job-123" }, undefined, undefined, cloud); } catch (error) { cloudStatusBlocked = String(error).includes("non-local route"); }
      let cloudBlocked = false;
      try {
        await tools.get("document_analysis_show").execute("cloud-call", { job_id: "job-123", artifact: "normalized" }, undefined, undefined, {
          model: { provider: "local", id: "spoofed", baseUrl: "https://cloud.example/v1" },
          sessionManager: { getSessionId: () => "harness-session" },
        });
      } catch (error) {
        cloudBlocked = String(error).includes("non-local route");
      }
      let invalidIngestBlocked = false;
      try {
        await tools.get("document_analysis_ingest").execute("ingest-call", { inbox_filename: "../escape.pdf" }, undefined, undefined, local);
      } catch (error) {
        invalidIngestBlocked = String(error).includes("direct child filename");
      }
      let deleteConfirmationBlocked = false;
      try {
        await tools.get("document_analysis_delete").execute("delete-call", { job_id: "job-123", dry_run: false, confirm_job_id: "job-12x" }, undefined, undefined, local);
      } catch (error) {
        deleteConfirmationBlocked = String(error).includes("confirm_job_id");
      }
      const policy = toolCallHandlers[0];
      const cloudPolicyContext = {
        model: { provider: "openai", id: "cloud-model", baseUrl: "https://cloud.example/v1" },
        cwd: "/tmp",
        hasUI: false,
      };
      const readGuard = await policy({ toolName: "read", input: { path: "/var/home/samuel/OpenWebUI-Access-Folder/document-analysis/jobs/job-123/normalized/document.md" } }, cloudPolicyContext);
      const bashGuard = await policy({ toolName: "bash", input: { command: "cat /var/home/samuel/OpenWebUI-Access-Folder/document-analysis/jobs/job-123/normalized/document.md" } }, cloudPolicyContext);
      const bashSafeGuard = await policy({ toolName: "bash", input: { command: "ls" } }, cloudPolicyContext);
      const filesystemGuard = await policy({ toolName: "openwebui_filesystem_read_file", input: { path: "document-analysis/jobs/job-123/manifest.json" } }, cloudPolicyContext);
      const bridgeAllowed = await policy({ toolName: "document_analysis_list", input: {} }, cloudPolicyContext);
      ctx.ui.notify("DOCUMENT_BRIDGE_HARNESS:" + JSON.stringify({
        names: [...tools.keys()].sort(),
        calls: calls.map(([command, args]) => ({ command, args })),
        status_ok: Boolean(status && list),
        cloudListBlocked,
        cloudStatusBlocked,
        cloudBlocked,
        invalidIngestBlocked,
        deleteConfirmationBlocked,
        readGuarded: Boolean(readGuard?.block),
        bashGuarded: Boolean(bashGuard?.block),
        bashAllGuarded: Boolean(bashSafeGuard?.block),
        filesystemGuarded: Boolean(filesystemGuard?.block),
        bridgeAllowed: bridgeAllowed === undefined || Object.keys(bridgeAllowed).length === 0,
      }), "info");
    },
  });
}
`;
  await writeFile(wrapper, wrapperSource, "utf8");
  const childEnv = { ...process.env, PI_CPTR_HEADLESS: "1" };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_OPTIONS;
  const child = spawn(
    "/home/linuxbrew/.linuxbrew/bin/pi",
    ["--mode", "rpc", "--no-session", "--no-extensions", "-e", wrapper],
    { cwd: "/var/home/samuel", env: childEnv, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.write(JSON.stringify({ type: "prompt", message: "/bridge-harness" }) + "\n");
  let result;
  try {
    result = await new Promise((resolveResult, rejectResult) => {
      const timeout = setTimeout(() => rejectResult(new Error(`bridge harness timed out: ${stderr}`)), 30_000);
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        try {
          const event = JSON.parse(line);
          if (event.type === "extension_ui_request" && typeof event.message === "string" && event.message.startsWith("DOCUMENT_BRIDGE_HARNESS:")) {
            clearTimeout(timeout);
            lines.close();
            resolveResult(JSON.parse(event.message.slice("DOCUMENT_BRIDGE_HARNESS:".length)));
          } else if (event.type === "extension_error") {
            clearTimeout(timeout);
            lines.close();
            rejectResult(new Error(`bridge extension error: ${event.error ?? "unknown"}`));
          }
        } catch {}
      });
      child.once("error", (error) => { clearTimeout(timeout); lines.close(); rejectResult(error); });
      child.once("exit", (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout);
          lines.close();
          rejectResult(new Error(`bridge harness exited ${code}: ${stderr}`));
        }
      });
    });
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await rm(temp, { recursive: true, force: true });
  }

  assert.deepEqual(result.names, [...bridgePolicy.DOCUMENT_ANALYSIS_TOOL_NAMES].sort());
  assert.equal(result.status_ok, true);
  assert.equal(result.cloudListBlocked, true);
  assert.equal(result.cloudStatusBlocked, true);
  assert.equal(result.cloudBlocked, true);
  assert.equal(result.invalidIngestBlocked, true);
  assert.equal(result.deleteConfirmationBlocked, true);
  assert.equal(result.readGuarded, true);
  assert.equal(result.bashGuarded, true);
  assert.equal(result.bashAllGuarded, true);
  assert.equal(result.filesystemGuarded, true);
  assert.equal(result.bridgeAllowed, true);
  assert.deepEqual(result.calls, [
    { command: "/var/home/samuel/.local/bin/document-analysis", args: ["--root", "/var/home/samuel/OpenWebUI-Access-Folder/document-analysis", "status", "job-123"] },
    { command: "/var/home/samuel/.local/bin/document-analysis", args: ["--root", "/var/home/samuel/OpenWebUI-Access-Folder/document-analysis", "list", "--status", "ready"] },
  ]);
});
