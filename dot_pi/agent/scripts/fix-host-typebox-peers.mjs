#!/usr/bin/env node
// Reapply after `pi update --extensions` or npm reinstalls, until upstream fixes
// these manifests. Do not edit package-lock.json: it describes upstream tarballs.
// Shared npm-root TypeBox copies are still required by other installed packages.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const check = args.includes("--check");
const rootIndex = args.indexOf("--npm-root");
if (rootIndex !== -1 && (!args[rootIndex + 1] || args[rootIndex + 1].startsWith("--"))) {
  throw new Error("--npm-root requires a directory");
}
const accepted = new Set(["--check", "--npm-root"]);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--npm-root") { i++; continue; }
  if (!accepted.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
}
const npmRoot = rootIndex === -1
  ? resolve(dirname(fileURLToPath(import.meta.url)), "../npm")
  : resolve(args[rootIndex + 1]);
const packages = ["pi-agent-extensions", "@juicesharp/rpiv-todo"];
const hostPackages = ["typebox", "@sinclair/typebox"];
let dirty = false;

for (const name of packages) {
  const root = join(npmRoot, "node_modules", name);
  const manifestPath = join(root, "package.json");
  const original = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(original);
  if (manifest.name !== name) throw new Error(`Unexpected package at ${manifestPath}`);
  let changed = false;
  for (const host of hostPackages) {
    const runtimeDependency = Object.hasOwn(manifest.dependencies ?? {}, host);
    const peerDependency = Object.hasOwn(manifest.peerDependencies ?? {}, host);
    if (!runtimeDependency && !peerDependency) continue;
    if (runtimeDependency) {
      delete manifest.dependencies[host];
      changed = true;
    }
    if (manifest.peerDependencies?.[host] !== "*") {
      (manifest.peerDependencies ??= {})[host] = "*";
      changed = true;
    }
  }
  const privateCopies = hostPackages
    .map(host => join(root, "node_modules", host))
    .filter(path => existsSync(path));
  const needsRepair = changed || privateCopies.length > 0;
  dirty ||= needsRepair;
  if (!check) {
    if (changed) {
      const indent = original.match(/^([\t ]+)"/m)?.[1] ?? "  ";
      writeFileSync(manifestPath, JSON.stringify(manifest, null, indent) + "\n");
    }
    for (const path of privateCopies) rmSync(path, { recursive: true });
  }
  console.log(`${name}: ${needsRepair ? (check ? "needs repair" : "repaired") : "already correct"}`);
}
if (check && dirty) process.exitCode = 1;
