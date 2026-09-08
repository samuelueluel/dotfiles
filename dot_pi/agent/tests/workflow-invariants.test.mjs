import assert from "node:assert/strict";
import test from "node:test";
import * as path from "node:path";
import * as os from "node:os";

import {
  isVaultNotePath,
  isDotfilesStaticPath,
  isSecretFilePath,
  checkPrivilegedOrHostMutation,
  checkDestructiveCommand,
  checkVaultShellAccess,
  isChezmoiManaged,
  shouldRunPostToolChecks,
  autoHealSedCommand,
  validateFileSyntax,
  checkExplorePrompt,
  healZoteroWorkerInput,
  checkExploreMutatingCommand,
  VAULT_ROOT,
  DOTFILES_ROOT,
} from "../lib/workflow-invariants-logic.ts";

test("isVaultNotePath blocks vault notes but permits .obsidian config, snippets, and plugins", () => {
  const notePath = path.join(VAULT_ROOT, "00_Inbox", "test.md");
  const rootNote = path.join(VAULT_ROOT, "README.md");
  const snippetPath = path.join(VAULT_ROOT, ".obsidian", "snippets", "custom.css");
  const pluginPath = path.join(VAULT_ROOT, ".obsidian", "plugins", "my-plugin", "main.js");
  const configPath = path.join(VAULT_ROOT, ".obsidian", "app.json");
  const nonVaultPath = path.join(os.homedir(), "projects", "script.py");

  assert.equal(isVaultNotePath(notePath), true);
  assert.equal(isVaultNotePath(rootNote), true);
  assert.equal(isVaultNotePath(snippetPath), false);
  assert.equal(isVaultNotePath(pluginPath), false);
  assert.equal(isVaultNotePath(configPath), false);
  assert.equal(isVaultNotePath(nonVaultPath), false);
});

test("isDotfilesStaticPath blocks direct repo edits but permits .tmpl source templates", () => {
  const staticFile = path.join(DOTFILES_ROOT, "dot_pi", "agent", "settings.json");
  const templateFile = path.join(DOTFILES_ROOT, "dot_gitconfig.tmpl");
  const liveFile = path.join(os.homedir(), ".pi", "agent", "settings.json");

  assert.equal(isDotfilesStaticPath(staticFile), true);
  assert.equal(isDotfilesStaticPath(templateFile), false);
  assert.equal(isDotfilesStaticPath(liveFile), false);
});

test("isSecretFilePath detects private credentials and SSH keys", () => {
  assert.equal(isSecretFilePath(path.join(os.homedir(), ".ssh", "id_ed25519")), true);
  assert.equal(isSecretFilePath(path.join(os.homedir(), ".ssh", "id_rsa")), true);
  assert.equal(isSecretFilePath(path.join(os.homedir(), ".aws", "credentials")), true);
  assert.equal(isSecretFilePath(path.join(os.homedir(), ".gnupg", "secring.gpg")), true);
  assert.equal(isSecretFilePath(path.join(os.homedir(), ".config", "ghostty", "config")), false);
});

test("checkPrivilegedOrHostMutation blocks sudo, package managers, and chezmoi apply", () => {
  assert.equal(checkPrivilegedOrHostMutation("sudo systemctl restart foo").blocked, true);
  assert.equal(checkPrivilegedOrHostMutation("sudo dnf install ripgrep").blocked, true);
  assert.equal(checkPrivilegedOrHostMutation("rpm-ostree install htop").blocked, true);
  assert.equal(checkPrivilegedOrHostMutation("flatpak install flathub app").blocked, true);
  assert.equal(checkPrivilegedOrHostMutation("chezmoi apply").blocked, true);

  // Allowed safe Chezmoi commands
  assert.equal(checkPrivilegedOrHostMutation("chezmoi status").blocked, false);
  assert.equal(checkPrivilegedOrHostMutation("chezmoi diff").blocked, false);
  assert.equal(checkPrivilegedOrHostMutation("chezmoi add ~/.bashrc").blocked, false);
});

test("checkDestructiveCommand blocks unrecoverable Git and filesystem mutations", () => {
  // Destructive Git
  assert.equal(checkDestructiveCommand("git reset --hard HEAD~1").blocked, true);
  assert.equal(checkDestructiveCommand("git clean -fd").blocked, true);
  assert.equal(checkDestructiveCommand("git clean -f").blocked, true);
  assert.equal(checkDestructiveCommand("git checkout .").blocked, true);
  assert.equal(checkDestructiveCommand("git checkout -- .").blocked, true);
  assert.equal(checkDestructiveCommand("git restore .").blocked, true);
  assert.equal(checkDestructiveCommand("git push origin main --force").blocked, true);
  assert.equal(checkDestructiveCommand("git push -f").blocked, true);
  assert.equal(checkDestructiveCommand("git branch -D stale-branch").blocked, true);

  // Normal safe Git
  assert.equal(checkDestructiveCommand("git commit -m 'update'").blocked, false);
  assert.equal(checkDestructiveCommand("git checkout -b new-feature").blocked, false);
  assert.equal(checkDestructiveCommand("git branch -d old-merged-branch").blocked, false);
  assert.equal(checkDestructiveCommand("git push origin main").blocked, false);
  assert.equal(checkDestructiveCommand("git status").blocked, false);

  // Destructive Filesystem
  assert.equal(checkDestructiveCommand("rm -rf /").blocked, true);
  assert.equal(checkDestructiveCommand("rm -rf ~").blocked, true);
  assert.equal(checkDestructiveCommand("rm -rf *").blocked, true);
  assert.equal(checkDestructiveCommand("mkfs.ext4 /dev/sda1").blocked, true);
  assert.equal(checkDestructiveCommand("dd if=/dev/zero of=/dev/sda").blocked, true);

  // Safe file removals
  assert.equal(checkDestructiveCommand("rm temp.log").blocked, false);
  assert.equal(checkDestructiveCommand("rm -f scratch.txt").blocked, false);
});

test("checkVaultShellAccess blocks shell note access while permitting .obsidian config", () => {
  const noteCmd = `cat "${path.join(VAULT_ROOT, "note.md")}"`;
  const snippetCmd = `ls "${path.join(VAULT_ROOT, ".obsidian", "snippets")}"`;
  const normalCmd = "git status";

  assert.equal(checkVaultShellAccess(noteCmd), true);
  assert.equal(checkVaultShellAccess(snippetCmd), false);
  assert.equal(checkVaultShellAccess(normalCmd), false);
});

test("isChezmoiManaged correctly identifies tracked vs untracked files", () => {
  const managedFile = path.join(os.homedir(), ".pi", "agent", "settings.json");
  const unmanagedFile = path.join(os.homedir(), "nonexistent_unmanaged_scratch_file.txt");

  assert.equal(isChezmoiManaged(managedFile), true);
  assert.equal(isChezmoiManaged(unmanagedFile), false);
});

test("post-tool checks only run for successful write and edit results", () => {
  assert.equal(shouldRunPostToolChecks("edit", true), false);
  assert.equal(shouldRunPostToolChecks("write", true), false);
  assert.equal(shouldRunPostToolChecks("edit", false), true);
  assert.equal(shouldRunPostToolChecks("write", undefined), true);
  assert.equal(shouldRunPostToolChecks("read", false), false);
});

test("autoHealSedCommand rewrites macOS/BSD sed -i '' to GNU sed -i", () => {
  assert.equal(autoHealSedCommand("sed -i '' 's/foo/bar/g' file.txt"), "sed -i 's/foo/bar/g' file.txt");
  assert.equal(autoHealSedCommand("sed -i \"\" 's/foo/bar/g' file.txt"), "sed -i 's/foo/bar/g' file.txt");
  assert.equal(autoHealSedCommand("sed -E -i '' 's/foo/bar/g' file.txt"), "sed -E -i 's/foo/bar/g' file.txt");
  assert.equal(autoHealSedCommand("sed -i '' -e 's/foo/bar/g' file.txt"), "sed -i -e 's/foo/bar/g' file.txt");
  assert.equal(autoHealSedCommand("sed -i.bak 's/foo/bar/g' file.txt"), "sed -i.bak 's/foo/bar/g' file.txt");
  assert.equal(autoHealSedCommand("grep foo file.txt"), "grep foo file.txt");
});

test("validateFileSyntax correctly validates py, sh, json, jsonc, toml, yaml, kdl", () => {
  import("node:fs").then((fs) => {
    // 1. Python
    const pyValid = "/tmp/test_valid.py";
    const pyInvalid = "/tmp/test_invalid.py";
    fs.writeFileSync(pyValid, "def hello():\n    return 'world'\n");
    fs.writeFileSync(pyInvalid, "def hello(\n");

    assert.equal(validateFileSyntax(pyValid).valid, true);
    assert.equal(validateFileSyntax(pyInvalid).valid, false);

    // 2. Shell
    const shValid = "/tmp/test_valid.sh";
    const shInvalid = "/tmp/test_invalid.sh";
    fs.writeFileSync(shValid, "#!/bin/bash\nif [ -f foo ]; then echo bar; fi\n");
    fs.writeFileSync(shInvalid, "#!/bin/bash\nif [ -f foo ]; then\n");

    assert.equal(validateFileSyntax(shValid).valid, true);
    assert.equal(validateFileSyntax(shInvalid).valid, false);

    // 3. JSON & JSONC
    const jsonValid = "/tmp/test_valid.json";
    const jsonInvalid = "/tmp/test_invalid.json";
    const jsoncValid = "/tmp/test_valid.jsonc";
    fs.writeFileSync(jsonValid, '{"status": "ok", "value": 42}');
    fs.writeFileSync(jsonInvalid, '{"status": "ok", "value": 42,');
    fs.writeFileSync(jsoncValid, '// Header comment\n{"status": "ok" /* inline */}');

    assert.equal(validateFileSyntax(jsonValid).valid, true);
    assert.equal(validateFileSyntax(jsonInvalid).valid, false);
    assert.equal(validateFileSyntax(jsoncValid).valid, true);

    // 4. TOML
    const tomlValid = "/tmp/test_valid.toml";
    const tomlInvalid = "/tmp/test_invalid.toml";
    fs.writeFileSync(tomlValid, '[section]\nkey = "value"\n');
    fs.writeFileSync(tomlInvalid, '[section\nkey = "value"\n');

    assert.equal(validateFileSyntax(tomlValid).valid, true);
    assert.equal(validateFileSyntax(tomlInvalid).valid, false);

    // 5. YAML
    const yamlValid = "/tmp/test_valid.yaml";
    const yamlInvalid = "/tmp/test_invalid.yaml";
    fs.writeFileSync(yamlValid, "name: Test\nitems:\n  - one\n  - two\n");
    fs.writeFileSync(yamlInvalid, "name: Test\nitems:\n  - one\n broken: mapping");

    assert.equal(validateFileSyntax(yamlValid).valid, true);
    assert.equal(validateFileSyntax(yamlInvalid).valid, false);

    // 6. KDL (Niri)
    const kdlValid = "/tmp/test_valid.kdl";
    const kdlInvalid = "/tmp/test_invalid.kdl";
    fs.writeFileSync(kdlValid, 'input { keyboard { xkb { layout "us"; }; }; }\n');
    fs.writeFileSync(kdlInvalid, 'input { keyboard {\n');

    assert.equal(validateFileSyntax(kdlValid).valid, true);
    assert.equal(validateFileSyntax(kdlInvalid).valid, false);

    // 7. Justfile (justfile, *.just)
    const justValid = "/tmp/test_valid.just";
    const justInvalid = "/tmp/test_invalid.just";
    fs.writeFileSync(justValid, "default:\n\techo hello\n");
    fs.writeFileSync(justInvalid, 'foo := "unclosed string\n');

    assert.equal(validateFileSyntax(justValid).valid, true);
    assert.equal(validateFileSyntax(justInvalid).valid, false);

    // 8. Chezmoi template (.tmpl) is skipped
    const tmplFile = "/tmp/dot_file.sh.tmpl";
    fs.writeFileSync(tmplFile, "{{ .chezmoi.homeDir }}/broken bash syntax");
    assert.equal(validateFileSyntax(tmplFile).skipped, true);
    assert.equal(validateFileSyntax(tmplFile).valid, true);

    // Cleanup
    [
      pyValid, pyInvalid, shValid, shInvalid,
      jsonValid, jsonInvalid, jsoncValid,
      tomlValid, tomlInvalid, yamlValid, yamlInvalid,
      kdlValid, kdlInvalid, justValid, justInvalid, tmplFile,
    ].forEach((f) => {
      try { fs.unlinkSync(f); } catch {}
    });
  });
});

test("checkExplorePrompt blocks file mutation/edit prompts but permits extraction and read-only searches", () => {
  // Blocked mutating prompts
  assert.equal(checkExplorePrompt("Edit the script in ~/.pi/agent/settings.json").blocked, true);
  assert.equal(checkExplorePrompt("Refactor the python module and save changes").blocked, true);
  assert.equal(checkExplorePrompt("Run the Stata do-file to generate regressions").blocked, true);
  assert.equal(checkExplorePrompt("Create the file /tmp/scratch.py").blocked, true);

  // Allowed read-only search prompts
  assert.equal(checkExplorePrompt("Find where KEY_MAP is defined in turquoise repo").blocked, false);
  assert.equal(checkExplorePrompt("Search Obsidian vault notes for references to Stata").blocked, false);

  // Allowed full-document Zotero extraction worker
  assert.equal(
    checkExplorePrompt("ZOTERO_EXTRACT_WORKER: FULL_DOCUMENT\nExtract data from source item ABC123XYZ").blocked,
    false
  );
});

test("healZoteroWorkerInput auto-heals extraction worker turn limits and subagent type", () => {
  const badWorkerInput = {
    subagent_type: "Plan",
    prompt: "ZOTERO_EXTRACT_WORKER: FULL_DOCUMENT\nItem 123",
    max_turns: 6,
  };

  const { healedInput, wasHealed } = healZoteroWorkerInput(badWorkerInput);
  assert.equal(wasHealed, true);
  assert.equal(healedInput.subagent_type, "Explore");
  assert.equal(healedInput.max_turns, undefined);

  const normalInput = {
    subagent_type: "Explore",
    prompt: "Search for config.kdl",
    max_turns: 4,
  };
  const result = healZoteroWorkerInput(normalInput);
  assert.equal(result.wasHealed, false);
  assert.equal(result.healedInput.max_turns, 4);
});

test("checkExploreMutatingCommand blocks file redirection and mutating commands", () => {
  // Blocked redirection
  assert.equal(checkExploreMutatingCommand("echo 'foo' > test.txt").blocked, true);
  assert.equal(checkExploreMutatingCommand("ls >> output.log").blocked, true);

  // Blocked mutating commands
  assert.equal(checkExploreMutatingCommand("rm unwanted.txt").blocked, true);
  assert.equal(checkExploreMutatingCommand("mkdir -p /tmp/newdir").blocked, true);
  assert.equal(checkExploreMutatingCommand("mv old.txt new.txt").blocked, true);
  assert.equal(checkExploreMutatingCommand("git commit -m 'change'").blocked, true);
  assert.equal(checkExploreMutatingCommand("git checkout -b new-branch").blocked, true);

  // Allowed read-only commands
  assert.equal(checkExploreMutatingCommand("git status").blocked, false);
  assert.equal(checkExploreMutatingCommand("git log -n 5").blocked, false);
  assert.equal(checkExploreMutatingCommand("rg 'def foo' .").blocked, false);
  assert.equal(checkExploreMutatingCommand("fd -e kdl").blocked, false);
  assert.equal(checkExploreMutatingCommand("cat ~/.bashrc").blocked, false);
});

