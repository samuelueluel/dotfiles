import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { piCoreUrl } from "./helpers/pi-test-runtime.mjs";

const agentDir = join(process.env.HOME, ".pi/agent");
const repair = join(agentDir, "scripts/fix-host-typebox-peers.mjs");
const npmNames = ["pi-agent-extensions", "@juicesharp/rpiv-todo"];
const roots = [
  ...npmNames.map(name => join(agentDir, "npm/node_modules", name)),
  join(agentDir, "local-packages/pi-subagents"),
  join(agentDir, "local-packages/rpiv-advisor-lean"),
];

for (const root of roots) {
  test(`${root}: TypeBox is a wildcard peer, not a runtime dependency`, () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(manifest.peerDependencies.typebox, "*");
    for (const name of ["typebox", "@sinclair/typebox"]) {
      assert.equal(manifest.dependencies?.[name], undefined);
      if (manifest.peerDependencies[name]) assert.equal(manifest.peerDependencies[name], "*");
    }
  });
}

test("npm repair preserves unrelated fields, removes private copies, and is idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-typebox-repair-"));
  try {
    for (const name of npmNames) {
      const packageRoot = join(root, "node_modules", name);
      mkdirSync(join(packageRoot, "node_modules/typebox"), { recursive: true });
      writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
        name, version: "test", dependencies: { typebox: "^1.0.0", other: "1.2.3" },
        peerDependencies: { "@sinclair/typebox": "^0.34.0" }, pi: { extensions: ["index.ts"] },
      }));
    }
    assert.equal(spawnSync(process.execPath, [repair, "--npm-root", root, "--check"]).status, 1);
    execFileSync(process.execPath, [repair, "--npm-root", root]);
    const snapshots = npmNames.map(name => readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));
    for (const snapshot of snapshots) {
      const manifest = JSON.parse(snapshot);
      assert.deepEqual(manifest.dependencies, { other: "1.2.3" });
      assert.deepEqual(manifest.peerDependencies, { "@sinclair/typebox": "*", typebox: "*" });
      assert.equal(manifest.version, "test");
      assert.deepEqual(manifest.pi, { extensions: ["index.ts"] });
    }
    execFileSync(process.execPath, [repair, "--npm-root", root, "--check"]);
    execFileSync(process.execPath, [repair, "--npm-root", root]);
    assert.deepEqual(npmNames.map(name => readFileSync(join(root, "node_modules", name, "package.json"), "utf8")), snapshots);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Pi loads the seven affected extension entrypoints without host-package warnings", async () => {
  const { DefaultResourceLoader, SettingsManager } = await import(piCoreUrl);
  const isolated = mkdtempSync(join(tmpdir(), "pi-typebox-loader-"));
  try {
    const settingsManager = SettingsManager.inMemory({ packages: [
      { source: roots[0], extensions: ["extensions/answer/index.ts", "extensions/btw/index.ts", "extensions/files/index.ts", "extensions/loop/index.ts"] },
      ...roots.slice(1),
    ] });
    const loader = new DefaultResourceLoader({
      cwd: isolated, agentDir: isolated, settingsManager,
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    assert.deepEqual((result.warnings ?? []).filter(item => item.warning.includes("Host-provided extension packages")), []);
    assert.equal(result.extensions.filter(item => roots.some(root => item.path.startsWith(root + "/"))).length, 7);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});
