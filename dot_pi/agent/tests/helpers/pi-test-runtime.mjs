import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const piCommand = execFileSync("which", ["pi"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
if (!piCommand) throw new Error("Could not locate the installed pi executable on PATH");

const piExecutable = realpathSync(piCommand);
const piVersionRoot = resolve(dirname(piExecutable), "..");
export const piPackageRoot = resolve(
  piVersionRoot,
  "libexec/lib/node_modules/@earendil-works/pi-coding-agent",
);
export const piModulesRoot = resolve(piPackageRoot, "../..");
export const piCorePath = resolve(piPackageRoot, "dist/index.js");
export const piCoreUrl = pathToFileURL(piCorePath).href;
export const piJitiPath = resolve(piPackageRoot, "node_modules/jiti/lib/jiti.cjs");

for (const [label, path] of [
  ["pi core package", resolve(piPackageRoot, "package.json")],
  ["pi core entry", piCorePath],
  ["pi-bundled jiti", piJitiPath],
]) {
  if (!existsSync(path)) throw new Error(`Could not resolve ${label}: ${path}`);
}

const require = createRequire(import.meta.url);
export const { createJiti } = require(piJitiPath);
