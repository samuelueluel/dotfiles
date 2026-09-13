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
const { isSafeBashCommand, isSensitiveShellCommand } = bashPolicy;

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

test("Bash policy allows only literal /dev/null output redirection", () => {
  for (const command of [
    "cat input >/dev/null",
    "cat input >>/dev/null",
    "cat input 1> /dev/null",
    "cat input 2>/dev/null | wc -l",
    "2>/dev/null cat input",
  ]) {
    assert.equal(isSafeBashCommand(command), true, command);
    assert.equal(isSafeBashCommand(command, true), true, `${command} (headless)`);
  }

  for (const command of [
    "cat input >/tmp/output",
    "cat input 2>>$TMPDIR/errors",
    "cat input 3>/dev/null",
    "cat input 2>&1",
    "cat input &>/dev/null",
    "cat input >/dev/null2",
    "cat input < /dev/null",
  ]) {
    assert.equal(isSafeBashCommand(command), false, command);
    assert.equal(isSafeBashCommand(command, true), false, `${command} (headless)`);
  }
});

test("Bash policy composes only independently safe commands with && and ||", () => {
  for (const command of [
    "pwd && cat README.md",
    "cat README.md || true",
    "cat README.md | wc -l && echo done",
    "cat README.md 2>/dev/null && wc -l README.md",
  ]) {
    assert.equal(isSafeBashCommand(command), true, command);
    assert.equal(isSafeBashCommand(command, true), true, `${command} (headless)`);
  }

  for (const command of [
    "pwd; cat README.md",
    "pwd & cat README.md",
    "pwd && sort --output=/tmp/result input.txt",
    "pwd || /tmp/cat README.md",
    "pwd && $(cat README.md)",
    "pwd && cat ~/.ssh/id_ed25519",
    "pwd &&",
    "|| cat README.md",
  ]) {
    assert.equal(isSafeBashCommand(command), false, command);
    assert.equal(isSafeBashCommand(command, true), false, `${command} (headless)`);
  }
});

test("Bash policy rejects write aliases, executable paths, wrappers, and secret paths", () => {
  for (const command of [
    "sort -o /tmp/result input.txt",
    "sort -o/tmp/result input.txt",
    "sort --output /tmp/result input.txt",
    "sort --output=/tmp/result input.txt",
    "sort --compress-program=/tmp/helper input.txt",
    "/tmp/cat README.md",
    "./cat README.md",
    "PATH=/tmp cat README.md",
    "LD_PRELOAD=/tmp/evil.so cat README.md",
    "time cat README.md",
    "env cat README.md",
    "cat ~/.ssh/id_ed25519",
    "cat \"$HOME\"/.aws/credentials",
  ]) {
    assert.equal(isSafeBashCommand(command), false, command);
    assert.equal(isSafeBashCommand(command, true), false, `${command} (headless)`);
  }

  for (const command of [
    "cat ~/.ssh/id_ed25519",
    "cat \"$HOME\"/.gnupg/secring.gpg",
    "cat ${HOME}/.config/op/item",
  ]) {
    assert.equal(isSensitiveShellCommand(command), true, command);
  }

  assert.equal(isSensitiveShellCommand("cat ~/.config/ghostty/config"), false);
});
