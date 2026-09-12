import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const agentRoot = resolve(new URL("..", import.meta.url).pathname);
const settingsPath = resolve(agentRoot, "settings.json");
const packagePath = resolve(agentRoot, "local-packages/pi-smart-compact");

const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
const bundledRuntime = readFileSync(resolve(packagePath, "dist/index.js"), "utf8");


test("automatic compaction uses the version-controlled local fork", () => {
  assert.equal(
    settings.packages.find((entry) => entry === "local-packages/pi-smart-compact"),
    "local-packages/pi-smart-compact",
  );
  assert.equal(settings.smartCompact.autoTriggerTimeoutMs, 300000);
  assert.equal(settings.smartCompact.codexMaxCallMs, 300000);
  assert.equal(settings.smartCompact.maxLatencyMs, 0);
});

test("local fork does not reintroduce the upstream 60-second auto-trigger clamp", () => {
  assert.doesNotMatch(bundledRuntime, /AUTO_TRIGGER_TIMEOUT_CAP_MS/);
  assert.match(
    bundledRuntime,
    /const effectiveTimeoutMs = Math\.round\(config\.autoTriggerTimeoutMs \* caps\.timeoutMultiplier\);/,
  );
});

test("local fork removes the synthetic visible-output watchdog cap on Codex streams", () => {
  assert.doesNotMatch(bundledRuntime, /controller\.abort\("codex-visible-output-cap"\)/);
});

test("local fork does not clamp automatic compaction call budget to 4 calls", () => {
  assert.doesNotMatch(bundledRuntime, /Math\.min\(budget, AUTO_TRIGGER_MAX_LLM_CALLS\)/);
});

