import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createJiti } = require(`${process.env.HOME}/.pi/agent/npm/node_modules/.jiti-vMeKVizl/lib/jiti.cjs`);
const jiti = createJiti(`${process.env.HOME}/.pi/agent/npm`);
const bashPolicy = await jiti.import(
  resolve(new URL("../lib/bash-policy.ts", import.meta.url).pathname),
);
const { isSafeBashCommand } = bashPolicy;

test("manual Bash policy allows read-only date formatting and pipelines", async () => {
  for (const command of [
    "date",
    "date '+%Y-%m-%dT%H:%M:%S'",
    "date -Iseconds",
    "date '+%Y-%m-%dT%H:%M:%S' | cat",
  ]) {
    assert.equal(isSafeBashCommand(command), true, command);
    assert.equal(isSafeBashCommand(command, true), true, `${command} (headless)`);
  }
});

test("manual Bash policy rejects date clock-setting options", async () => {
  for (const command of [
    "date -s '2026-09-02 21:47:55'",
    "date --set '2026-09-02 21:47:55'",
    "date --set='2026-09-02 21:47:55'",
    "date -us '2026-09-02 21:47:55'",
  ]) {
    assert.equal(isSafeBashCommand(command), false, command);
    assert.equal(isSafeBashCommand(command, true), false, `${command} (headless)`);
  }
});
