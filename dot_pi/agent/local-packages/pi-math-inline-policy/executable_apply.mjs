#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const piDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const target = join(
  piDir,
  "npm",
  "node_modules",
  "@monotykamary",
  "pi-math",
  "src",
  "markdown-patch.ts",
);
const before = 'if (inline && protocol !== "kitty") return undefined;';
const after = "if (inline) return undefined;";

try {
  const source = await readFile(target, "utf8");
  if (source.includes(after)) {
    console.log(`pi-math inline policy already applied: ${target}`);
    process.exit(0);
  }

  const matches = source.split(before).length - 1;
  if (matches !== 1) {
    throw new Error(
      `Expected exactly one upstream inline-rendering line in ${target}; found ${matches}. Inspect the package before patching.`,
    );
  }

  await writeFile(target, source.replace(before, after));
  console.log(`Disabled pi-math inline rasters: ${target}`);
  console.log("Run /reload in Pi to load the patched extension.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
