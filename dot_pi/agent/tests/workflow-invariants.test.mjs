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
