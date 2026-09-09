import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const HOOK_SCRIPT = path.join(os.homedir(), ".gemini", "hooks", "agy-workflow-invariants.mjs");
const VAULT_ROOT = path.join(os.homedir(), "Dropbox", "Sam-Obsidian-Vault");
const DOTFILES_ROOT = path.join(os.homedir(), "dotfiles");

function runHook(mode, payload) {
  const stdout = execFileSync("node", [HOOK_SCRIPT, mode], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
  });
  return JSON.parse(stdout.trim());
}

test("PreToolUse: run_command blocks sudo", () => {
  const res = runHook("pre", {
    toolCall: { name: "run_command", args: { CommandLine: "sudo dnf install foo" } },
  });
  assert.equal(res.decision, "deny");
  assert.match(res.reason, /Privileged 'sudo' commands are prohibited/);
});

test("PreToolUse: run_command blocks chezmoi apply", () => {
  const res = runHook("pre", {
    toolCall: { name: "run_command", args: { CommandLine: "chezmoi apply" } },
  });
  assert.equal(res.decision, "deny");
  assert.match(res.reason, /chezmoi apply/);
});

test("PreToolUse: run_command blocks destructive git reset", () => {
  const res = runHook("pre", {
    toolCall: { name: "run_command", args: { CommandLine: "git reset --hard HEAD~1" } },
  });
  assert.equal(res.decision, "deny");
  assert.match(res.reason, /git reset --hard/);
});

test("PreToolUse: run_command blocks vault shell note access but permits .obsidian", () => {
  const blocked = runHook("pre", {
    toolCall: { name: "run_command", args: { CommandLine: `cat ${VAULT_ROOT}/10_Projects/test.md` } },
  });
  assert.equal(blocked.decision, "deny");
  assert.match(blocked.reason, /TurboVault/);

  const allowed = runHook("pre", {
    toolCall: { name: "run_command", args: { CommandLine: `cat ${VAULT_ROOT}/.obsidian/snippets/test.css` } },
  });
  assert.equal(allowed.decision, "allow");
});

test("PreToolUse: run_command auto-heals macOS sed -i '' to GNU sed -i", () => {
  const res = runHook("pre", {
    toolCall: { name: "run_command", args: { CommandLine: "sed -i '' 's/foo/bar/g' test.txt" } },
  });
  assert.equal(res.decision, "allow");
  assert.equal(res.overwrite?.CommandLine, "sed -i 's/foo/bar/g' test.txt");
});

test("PreToolUse: view_file blocks vault notes and private credentials", () => {
  const vaultRes = runHook("pre", {
    toolCall: { name: "view_file", args: { AbsolutePath: `${VAULT_ROOT}/note.md` } },
  });
  assert.equal(vaultRes.decision, "deny");

  const credRes = runHook("pre", {
    toolCall: { name: "view_file", args: { AbsolutePath: `${os.homedir()}/.ssh/id_ed25519` } },
  });
  assert.equal(credRes.decision, "deny");

  const normalRes = runHook("pre", {
    toolCall: { name: "view_file", args: { AbsolutePath: `${os.homedir()}/some_project/test.py` } },
  });
  assert.equal(normalRes.decision, "allow");
});

test("PreToolUse: write_to_file and replace_file_content block static dotfiles edits but allow .tmpl", () => {
  const staticWrite = runHook("pre", {
    toolCall: { name: "write_to_file", args: { TargetFile: `${DOTFILES_ROOT}/test.sh` } },
  });
  assert.equal(staticWrite.decision, "deny");
  assert.match(staticWrite.reason, /chezmoi add/);

  const tmplWrite = runHook("pre", {
    toolCall: { name: "write_to_file", args: { TargetFile: `${DOTFILES_ROOT}/test.tmpl` } },
  });
  assert.equal(tmplWrite.decision, "allow");

  const staticEdit = runHook("pre", {
    toolCall: { name: "replace_file_content", args: { TargetFile: `${DOTFILES_ROOT}/test.sh` } },
  });
  assert.equal(staticEdit.decision, "deny");
});

test("PreToolUse: invoke_subagent blocks mutating research subagent prompts", () => {
  const blocked = runHook("pre", {
    toolCall: {
      name: "invoke_subagent",
      args: { Subagents: [{ TypeName: "research", Prompt: "Edit the file foo.py and refactor" }] },
    },
  });
  assert.equal(blocked.decision, "deny");
  assert.match(blocked.reason, /read-only/);

  const allowed = runHook("pre", {
    toolCall: {
      name: "invoke_subagent",
      args: { Subagents: [{ TypeName: "research", Prompt: "Search for references to foo in the codebase" }] },
    },
  });
  assert.equal(allowed.decision, "allow");
});

test("PostToolUse and PreInvocation: syntax error queuing and ephemeral wire delivery", () => {
  const testConvId = `test-conv-${Date.now()}`;
  const tmpBadJson = path.join(os.tmpdir(), `bad-test-${Date.now()}.json`);
  fs.writeFileSync(tmpBadJson, "{ invalid json }");

  try {
    // Post tool execution
    const postRes = runHook("post", {
      conversationId: testConvId,
      toolCall: { name: "write_to_file", args: { TargetFile: tmpBadJson } },
    });
    assert.deepEqual(postRes, {});

    // PreInvocation should drain and emit the syntax error
    const preInvRes = runHook("pre-invocation", { conversationId: testConvId });
    assert.ok(preInvRes.injectSteps?.length > 0);
    assert.match(preInvRes.injectSteps[0].ephemeralMessage, /Syntax Error Detected/);

    // Second PreInvocation call should be empty (drained)
    const secondInv = runHook("pre-invocation", { conversationId: testConvId });
    assert.deepEqual(secondInv, {});
  } finally {
    try { fs.unlinkSync(tmpBadJson); } catch {}
  }
});
