import assert from "node:assert/strict";
import test from "node:test";
import * as path from "node:path";
import * as os from "node:os";

import {
  isVaultNotePath,
  isDotfilesStaticPath,
  isSecretFilePath,
  checkSecretShellAccess,
  checkPrivilegedOrHostMutation,
  checkDestructiveCommand,
  checkSessionSummaryStoreShellAccess,
  checkVaultShellAccess,
  checkZoteroIndexMutation,
  isChezmoiManaged,
  shouldRunPostToolChecks,
  autoHealSedCommand,
  validateFileSyntax,
  checkAuditClaimsPayload,
  checkExplorePrompt,
  checkZoteroCloudUpload,
  checkZoteroSemanticResult,
  healZoteroMcpArgs,
  healTurbovaultMcpArgs,
  parseMcpCall,
  stripAuditClaimCitationYears,
  healZoteroWorkerInput,
  checkExploreMutatingCommand,
  isSessionSummaryStorePath,
  VAULT_ROOT,
  DOTFILES_ROOT,
  SESSION_SUMMARY_STORE,
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

test("checkSecretShellAccess blocks private credential paths in Bash", () => {
  for (const command of [
    "cat ~/.ssh/id_ed25519",
    `cat ${os.homedir()}/.ssh/id_rsa`,
    'cat "$HOME"/.gnupg/secring.gpg',
    "cat ${HOME}/.aws/credentials",
    "cat ~/.config/op/item",
    "cat ./.ssh/id_ed25519",
  ]) {
    assert.equal(checkSecretShellAccess(command).blocked, true, command);
  }

  for (const command of ["cat ~/.config/ghostty/config", "cat /tmp/input.txt"]) {
    assert.equal(checkSecretShellAccess(command).blocked, false, command);
  }
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

test("session summary store guard blocks direct mutation routes", () => {
  assert.equal(isSessionSummaryStorePath(SESSION_SUMMARY_STORE), true);
  assert.equal(isSessionSummaryStorePath("~/.pi/agent/session-summaries.json"), true);
  assert.equal(isSessionSummaryStorePath("~/.pi/agent/session-log.sqlite"), false);
  assert.equal(
    checkSessionSummaryStoreShellAccess("cat ~/.pi/agent/session-summaries.json").blocked,
    true
  );
  assert.equal(
    checkSessionSummaryStoreShellAccess("jq . ~/.pi/agent/session-summaries.json > /tmp/summaries.json").blocked,
    true
  );
  assert.equal(checkSessionSummaryStoreShellAccess("piwork summary recent --json").blocked, false);
});

test("Zotero index mutation guard requires reviewed helper routes", () => {
  assert.equal(
    checkZoteroIndexMutation("zotero-mcp-server update-db --force-rebuild --allow-mass-deletion").blocked,
    true
  );
  assert.equal(checkZoteroIndexMutation("cc.delete_item_chunks('ABCD2345')").blocked, true);
  assert.equal(checkZoteroIndexMutation('pkill -f "mineru"').blocked, true);
  assert.equal(
    checkZoteroIndexMutation("mv ~/.config/zotero-mcp/chroma_db ~/.config/zotero-mcp/chroma_db.old").blocked,
    true
  );
  assert.equal(
    checkZoteroIndexMutation("~/.agents/skills/zotero/scripts/recover-chroma.sh --confirm").blocked,
    false
  );
  assert.equal(
    checkZoteroIndexMutation("~/.agents/skills/zotero/scripts/delete-item-chunks.py ABCD2345 --confirm-key ABCD2345").blocked,
    false
  );
  assert.equal(checkZoteroIndexMutation("zotero-sidecar.sh embed TRGBCDX5").blocked, false);
  assert.equal(checkZoteroIndexMutation("podman exec lemonade pkill -9 llama-server").blocked, false);
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

test("checkZoteroCloudUpload blocks cloud file uploads across MCP call shapes", () => {
  // attach_file is blocked outright in every call shape
  assert.equal(
    checkZoteroCloudUpload("zotero_attach_file", { item_key: "ABCD2345", file_path: "/tmp/x.pdf" }).blocked,
    true
  );
  assert.equal(
    checkZoteroCloudUpload("mcp", { tool: "zotero_attach_file", args: { item_key: "ABCD2345", url: "https://x/y.pdf" } })
      .blocked,
    true
  );
  assert.equal(
    checkZoteroCloudUpload("mcp__zotero", { tool: "attach_file", args: { item_key: "ABCD2345", file_path: "/tmp/x.pdf" } })
      .blocked,
    true
  );

  // add_item is blocked only for file ingestion
  assert.equal(
    checkZoteroCloudUpload("zotero_add_item", { source: "/tmp/paper.pdf", source_type: "file" }).blocked,
    true
  );
  assert.equal(
    checkZoteroCloudUpload("mcp", { tool: "zotero_add_item", args: { source: "/home/samuel/papers/paper.pdf" } }).blocked,
    true
  );

  // DOI / URL / ISBN / inline BibTeX ingestion stays permitted
  assert.equal(checkZoteroCloudUpload("zotero_add_item", { source: "10.1145/3708319" }).blocked, false);
  assert.equal(
    checkZoteroCloudUpload("mcp", { tool: "zotero_add_item", args: { source: "https://arxiv.org/abs/1234" } }).blocked,
    false
  );
  assert.equal(
    checkZoteroCloudUpload("zotero_add_item", { source: "@article{key, author={A}}", source_type: "bibtex" }).blocked,
    false
  );

  // Non-zotero tools are untouched
  assert.equal(checkZoteroCloudUpload("bash", { command: "ls" }).blocked, false);
  assert.equal(
    checkZoteroCloudUpload("mcp", { tool: "turbovault_read_note", args: { path: "x.md" } }).blocked,
    false
  );
  assert.equal(checkZoteroCloudUpload("zotero_semantic_search", { query: "tax" }).blocked, false);
});

test("checkZoteroSemanticResult annotates only all-non-positive rerank results", () => {
  const searchInput = { query: "tax" };
  const allNegative = [
    { type: "text", text: "## 1. Paper A\n**Rerank:** -6.77\n**Relevance:** 0.3" },
    { type: "text", text: "## 2. Paper B\n**Rerank:** -8.44" },
  ];
  const note = checkZoteroSemanticResult("zotero_semantic_search", searchInput, false, allNegative);
  assert.match(note ?? "", /Rerank Gate/);
  assert.match(note ?? "", /All 2 returned/);

  // Mixed and positive results stay silent
  const mixed = [{ type: "text", text: "**Rerank:** +3.04\n**Rerank:** -0.32" }];
  assert.equal(checkZoteroSemanticResult("zotero_semantic_search", searchInput, false, mixed), null);
  const positive = [{ type: "text", text: "**Rerank:** +0.09" }];
  assert.equal(checkZoteroSemanticResult("zotero_semantic_search", searchInput, false, positive), null);

  // No rerank fields, errors, and non-search tools stay silent
  assert.equal(
    checkZoteroSemanticResult("zotero_semantic_search", searchInput, false, [{ type: "text", text: "No items found" }]),
    null
  );
  assert.equal(checkZoteroSemanticResult("zotero_semantic_search", searchInput, true, allNegative), null);
  assert.equal(
    checkZoteroSemanticResult("zotero_resolve_exact_source", { source: "x" }, false, allNegative),
    null
  );
  assert.equal(checkZoteroSemanticResult("mcp", { tool: "zotero_semantic_search", args: searchInput }, false, mixed), null);
});


test("healZoteroMcpArgs remaps collection alias on collection_key tools only", () => {
  const input = { tool: "zotero_list_collection_items", args: { collection: "TRGBCDX5" } };
  const { healedInput, wasHealed } = healZoteroMcpArgs("mcp__zotero", input);
  assert.equal(wasHealed, true);
  assert.deepEqual(healedInput.args, { collection_key: "TRGBCDX5" });
  // Caller object is not mutated.
  assert.deepEqual(input, { tool: "zotero_list_collection_items", args: { collection: "TRGBCDX5" } });

  // search_bibliography_entries shares the collection_key schema.
  const bib = healZoteroMcpArgs("mcp__zotero", { tool: "zotero_search_bibliography_entries", args: { collection: "TRGBCDX5" } });
  assert.equal(bib.wasHealed, true);
  assert.deepEqual(bib.healedInput.args, { collection_key: "TRGBCDX5" });

  // semantic_search canonically uses `collection`: never touch it.
  const sem = healZoteroMcpArgs("mcp__zotero", {
    tool: "zotero_semantic_search",
    args: { query: "demolitions", collection: "TRGBCDX5" },
  });
  assert.equal(sem.wasHealed, false);
  assert.deepEqual(sem.healedInput.args, { query: "demolitions", collection: "TRGBCDX5" });

  // Canonical present wins over the alias; blank aliases stay silent.
  const canon = healZoteroMcpArgs("mcp__zotero", {
    tool: "zotero_list_collection_items",
    args: { collection_key: "A", collection: "B" },
  });
  assert.equal(canon.wasHealed, false);
  const blank = healZoteroMcpArgs("mcp__zotero", {
    tool: "zotero_list_collection_items",
    args: { collection: "  " },
  });
  assert.equal(blank.wasHealed, false);
});

test("parseMcpCall resolves the mcp__turbovault namespace proxy", () => {
  // Lazily-loaded MCP tools surface to extensions under the proxy name, not the
  // underlying tool name. mcp__turbovault previously fell through to an empty
  // server, hiding every TurboVault call from hook logic.
  const call = parseMcpCall("mcp__turbovault", {
    tool: "turbovault_semantic_search",
    args: { query: "dad's birthday" },
  });
  assert.equal(call.server, "turbovault");
  assert.equal(call.operation, "semantic_search");
  assert.deepEqual(call.args, { query: "dad's birthday" });

  // Zotero keeps its existing resolution through the same generic branch.
  const zot = parseMcpCall("mcp__zotero", { tool: "zotero_semantic_search", args: {} });
  assert.equal(zot.server, "zotero");
  assert.equal(zot.operation, "semantic_search");

  // Gateway shape and flattened shape are unchanged.
  assert.equal(parseMcpCall("mcp", { tool: "turbovault_search", args: {} }).server, "turbovault");
  assert.equal(parseMcpCall("turbovault_read_note", { path: "a.md" }).server, "turbovault");
  assert.equal(parseMcpCall("bash", { command: "ls" }).server, "");
});

test("healTurbovaultMcpArgs repairs apostrophes that Tantivy's grammar rejects", () => {
  const input = {
    tool: "turbovault_semantic_search",
    args: { query: "what is my dad's birthday", limit: 3 },
  };
  const { healedInput, wasHealed } = healTurbovaultMcpArgs("mcp__turbovault", input);
  assert.equal(wasHealed, true);
  assert.deepEqual(healedInput.args, {
    query: "what is my dad s birthday",
    limit: 3,
  });
  // Caller object is not mutated.
  assert.deepEqual(input.args, { query: "what is my dad's birthday", limit: 3 });

  // Every query-bearing operation is covered.
  for (const tool of ["turbovault_search", "turbovault_advanced_search"]) {
    const healed = healTurbovaultMcpArgs("mcp__turbovault", {
      tool,
      args: { query: "mom's name" },
    });
    assert.equal(healed.wasHealed, true);
    assert.deepEqual(healed.healedInput.args, { query: "mom s name" });
  }

  // Digits before the apostrophe (1990's) are covered too.
  const year = healTurbovaultMcpArgs("mcp__turbovault", {
    tool: "turbovault_search",
    args: { query: "the 1990's" },
  });
  assert.equal(year.wasHealed, true);
  assert.deepEqual(year.healedInput.args, { query: "the 1990 s" });
});

test("healTurbovaultMcpArgs leaves clean and deliberate queries untouched", () => {
  // No apostrophe: silent.
  const clean = healTurbovaultMcpArgs("mcp__turbovault", {
    tool: "turbovault_search",
    args: { query: "dad birthday" },
  });
  assert.equal(clean.wasHealed, false);

  // A leading apostrophe opens a deliberate phrase query: leave it alone.
  const phrase = healTurbovaultMcpArgs("mcp__turbovault", {
    tool: "turbovault_search",
    args: { query: "'quoted phrase'" },
  });
  assert.equal(phrase.wasHealed, false);

  // Match-all and field syntax must survive; only intra-word apostrophes change.
  const mixed = healTurbovaultMcpArgs("mcp__turbovault", {
    tool: "turbovault_search",
    args: { query: "title:foo* dad's" },
  });
  assert.equal(mixed.wasHealed, true);
  assert.deepEqual(mixed.healedInput.args, { query: "title:foo* dad s" });

  // Non-query operations and non-TurboVault servers are out of scope.
  const note = healTurbovaultMcpArgs("mcp__turbovault", {
    tool: "turbovault_read_note",
    args: { path: "a.md" },
  });
  assert.equal(note.wasHealed, false);
  const zot = healTurbovaultMcpArgs("mcp__zotero", {
    tool: "zotero_semantic_search",
    args: { query: "dad's" },
  });
  assert.equal(zot.wasHealed, false);

  // A query of only apostrophes repairs to empty: refuse rather than send "".
  const blank = healTurbovaultMcpArgs("mcp__turbovault", {
    tool: "turbovault_search",
    args: { query: "''" },
  });
  assert.equal(blank.wasHealed, false);
});

test("healTurbovaultMcpArgs parses string-serialized proxy args", () => {
  const { healedInput, wasHealed } = healTurbovaultMcpArgs("mcp", {
    tool: "turbovault_semantic_search",
    args: JSON.stringify({ query: "dad's birthday" }),
  });
  assert.equal(wasHealed, true);
  assert.deepEqual(healedInput.args, { query: "dad s birthday" });

  const malformed = healTurbovaultMcpArgs("mcp", {
    tool: "turbovault_search",
    args: "{not json",
  });
  assert.equal(malformed.wasHealed, false);
});

test("healZoteroMcpArgs parses pages ranges into start_page/end_page", () => {
  const range = healZoteroMcpArgs("mcp__zotero", {
    tool: "zotero_read_pdf_pages",
    args: { item_key: "AZM6IY9A", pages: "4-6" },
  });
  assert.equal(range.wasHealed, true);
  assert.deepEqual(range.healedInput.args, { item_key: "AZM6IY9A", start_page: 4, end_page: 6 });

  const single = healZoteroMcpArgs("mcp__zotero", {
    tool: "zotero_read_pdf_pages",
    args: { item_key: "AZM6IY9A", pages: "4" },
  });
  assert.equal(single.wasHealed, true);
  assert.deepEqual(single.healedInput.args, { item_key: "AZM6IY9A", start_page: 4 });

  const numeric = healZoteroMcpArgs("mcp__zotero", {
    tool: "zotero_read_pdf_pages",
    args: { item_key: "AZM6IY9A", pages: 7 },
  });
  assert.equal(numeric.wasHealed, true);
  assert.deepEqual(numeric.healedInput.args, { item_key: "AZM6IY9A", start_page: 7 });

  // Unparseable, inverted, and zero ranges pass through to normal validation.
  for (const pages of ["abc", "4-2", "0", "", "4-", "-6", 4.5]) {
    const untouched = healZoteroMcpArgs("mcp__zotero", {
      tool: "zotero_read_pdf_pages",
      args: { item_key: "AZM6IY9A", pages },
    });
    assert.equal(untouched.wasHealed, false, `pages=${JSON.stringify(pages)} should not heal`);
  }

  // Explicit start_page wins over the alias.
  const explicit = healZoteroMcpArgs("mcp__zotero", {
    tool: "zotero_read_pdf_pages",
    args: { item_key: "AZM6IY9A", start_page: 2, pages: "4-6" },
  });
  assert.equal(explicit.wasHealed, false);
});

test("healZoteroMcpArgs handles alternate call shapes and ignores other servers", () => {
  // Non-namespaced mcp call with explicit server.
  const viaMcp = healZoteroMcpArgs("mcp", {
    tool: "zotero_list_collection_items",
    server: "zotero",
    args: { collection: "TRGBCDX5" },
  });
  assert.equal(viaMcp.wasHealed, true);
  assert.deepEqual(viaMcp.healedInput.args, { collection_key: "TRGBCDX5" });

  // Bare zotero_* tool name: the record itself is the args container.
  const bare = healZoteroMcpArgs("zotero_read_pdf_pages", { item_key: "AZM6IY9A", pages: "4-6" });
  assert.equal(bare.wasHealed, true);
  assert.deepEqual(bare.healedInput, { item_key: "AZM6IY9A", start_page: 4, end_page: 6 });

  // JSON-string args are parsed to objects in place: the MCP proxy requires
  // an object and rejects a JSON string before dispatch.
  const stringy = healZoteroMcpArgs("mcp__zotero", {
    tool: "zotero_list_collection_items",
    args: JSON.stringify({ collection: "TRGBCDX5" }),
  });
  assert.equal(stringy.wasHealed, true);
  assert.deepEqual(stringy.healedInput.args, { collection_key: "TRGBCDX5" });

  // Other servers and tools pass through untouched.
  const vault = healZoteroMcpArgs("mcp__turbovault", {
    tool: "turbovault_read_note",
    args: { path: "note.md" },
  });
  assert.equal(vault.wasHealed, false);
  const other = healZoteroMcpArgs("bash", { command: "ls" });
  assert.equal(other.wasHealed, false);
  const empty = healZoteroMcpArgs("mcp__zotero", null);
  assert.equal(empty.wasHealed, false);
});

test("healZoteroMcpArgs strips parenthetical citation years from audit claim text", () => {
  const input = {
    tool: "zotero_audit_claims",
    args: {
      claims: [
        {
          claim_id: "ah_local",
          text: "Aliprantis and Hartley (2015) estimate reductions of 33% (theft) to 86% (shots fired), relative to 1999 crime levels.",
          risk_tags: ["numeric"],
          evidence: [
            {
              route: "pdf_page",
              item_key: "TF4M6WXS",
              page: 11,
              quote: "ranging from a 33% reduction in theft to an 86% reduction in shots fired",
            },
          ],
        },
        {
          claim_id: "larson",
          text: "Larson et al. (2019a) estimate IRR 0.997 per demolition over 2010 to 2014 (n = 343 block groups).",
          evidence: [],
        },
      ],
    },
  };
  const { healedInput, wasHealed } = healZoteroMcpArgs("mcp__zotero", input);
  assert.equal(wasHealed, true);
  assert.equal(
    healedInput.args.claims[0].text,
    "Aliprantis and Hartley estimate reductions of 33% (theft) to 86% (shots fired), relative to 1999 crime levels."
  );
  assert.equal(
    healedInput.args.claims[1].text,
    "Larson et al. estimate IRR 0.997 per demolition over 2010 to 2014 (n = 343 block groups)."
  );
  // Evidence quotes are byte-identical; caller object is not mutated.
  assert.equal(
    healedInput.args.claims[0].evidence[0].quote,
    "ranging from a 33% reduction in theft to an 86% reduction in shots fired"
  );
  assert.match(input.args.claims[0].text, /\(2015\)/);

  // Bare years, parenthesized ranges, and statistics are preserved.
  const clean = healZoteroMcpArgs("mcp__zotero", {
    tool: "zotero_audit_claims",
    args: {
      claims: [
        { claim_id: "k", text: "Crime fell 8.5% relative to 1999 levels over (2010-2014) (n = 343).", evidence: [] },
      ],
    },
  });
  assert.equal(clean.wasHealed, false);
  assert.equal(
    clean.healedInput.args.claims[0].text,
    "Crime fell 8.5% relative to 1999 levels over (2010-2014) (n = 343)."
  );

  // Pure function reports per-claim change counts and skips non-records.
  const direct = stripAuditClaimCitationYears([
    { claim_id: "a", text: "Stacy (2018) finds 7.5%." },
    { claim_id: "b", text: "No years here, just 7.5%." },
    "not-a-record",
  ]);
  assert.equal(direct.changed, 1);
  assert.equal(direct.claims[0].text, "Stacy finds 7.5%.");
  assert.equal(direct.claims[1].text, "No years here, just 7.5%.");
  assert.equal(direct.claims[2], "not-a-record");

  // Gateway shape heals identically; JSON-string claims round-trip.
  const viaMcp = healZoteroMcpArgs("mcp", {
    tool: "zotero_audit_claims",
    server: "zotero",
    args: { claims: [{ claim_id: "k", text: "Sandler (2017) finds a decrease.", evidence: [] }] },
  });
  assert.equal(viaMcp.wasHealed, true);
  assert.equal(viaMcp.healedInput.args.claims[0].text, "Sandler finds a decrease.");

  const stringy = healZoteroMcpArgs("mcp__zotero", {
    tool: "zotero_audit_claims",
    args: {
      claims: JSON.stringify([{ claim_id: "k", text: "Jay et al. (2019) find 11%.", evidence: [] }]),
    },
  });
  assert.equal(stringy.wasHealed, true);
  assert.deepEqual(JSON.parse(stringy.healedInput.args.claims), [
    { claim_id: "k", text: "Jay et al. find 11%.", evidence: [] },
  ]);

  // Missing, non-array, and unparseable claims pass through untouched.
  for (const claims of [undefined, null, "not-json{", { text: "x (2020)" }]) {
    const untouched = healZoteroMcpArgs("mcp__zotero", { tool: "zotero_audit_claims", args: { claims } });
    assert.equal(untouched.wasHealed, false);
  }
});
test("healZoteroMcpArgs parses string-serialized args objects in place", () => {
  const input = {
    tool: "zotero_read_pdf_pages",
    args: JSON.stringify({ item_key: "AZM6IY9A", start_page: 4, end_page: 6 }),
  };
  const { healedInput, wasHealed } = healZoteroMcpArgs("mcp__zotero", input);
  assert.equal(wasHealed, true);
  assert.deepEqual(healedInput.args, { item_key: "AZM6IY9A", start_page: 4, end_page: 6 });
  // Caller object is not mutated.
  assert.equal(typeof input.args, "string");

  // Malformed strings pass through untouched for normal validation.
  const bad = healZoteroMcpArgs("mcp__zotero", {
    tool: "zotero_read_pdf_pages",
    args: "{not json",
  });
  assert.equal(bad.wasHealed, false);
  assert.equal(bad.healedInput.args, "{not json");

  // Non-zotero servers are never touched.
  const tv = healZoteroMcpArgs("mcp__turbovault", {
    tool: "turbovault_read_note",
    args: JSON.stringify({ path: "a.md" }),
  });
  assert.equal(tv.wasHealed, false);
});
test("checkAuditClaimsPayload accepts minimal valid payloads and JSON strings", () => {
  const good = [{
    claim_id: "c1",
    text: "Effect is 14%.",
    risk_tags: ["numeric"],
    expected_values: [{ role: "estimate", value: "14", unit: "percent" }],
    evidence: [{ route: "pdf_page", item_key: "AZM6IY9A", page: 6, quote: "a 14% reduction" }],
  }];
  assert.deepEqual(checkAuditClaimsPayload(good), { ok: true });
  assert.deepEqual(checkAuditClaimsPayload(JSON.stringify(good)), { ok: true });
});
test("checkAuditClaimsPayload rejects retry-class defects with short reasons", () => {
  const base = {
    claim_id: "c1",
    text: "x",
    evidence: [{ route: "pdf_page", item_key: "AZM6IY9A", page: 1, quote: "q" }],
  };
  // p_threshold without operator: the observed live failure.
  let r = checkAuditClaimsPayload([{ ...base, expected_values: [{ role: "p_threshold", value: "0.001" }] }]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /p_threshold requires operator/);
  // Unknown role, malformed key, unknown route, oversized batch.
  r = checkAuditClaimsPayload([{ ...base, expected_values: [{ role: "p_magic", value: "1" }] }]);
  assert.equal(r.ok, false);
  r = checkAuditClaimsPayload([{ ...base, evidence: [{ route: "pdf_page", item_key: " Vader ", quote: "q" }] }]);
  assert.equal(r.ok, false);
  r = checkAuditClaimsPayload([{ ...base, evidence: [{ route: "smoke_signal", item_key: "AZM6IY9A", quote: "q" }] }]);
  assert.equal(r.ok, false);
  r = checkAuditClaimsPayload(new Array(9).fill(base));
  assert.equal(r.ok, false);
});
test("checkAuditClaimsPayload passes through unrecognized shapes", () => {
  for (const claims of [undefined, null, 42, "not-json{", { claims: [] }]) {
    assert.deepEqual(checkAuditClaimsPayload(claims), { ok: true });
  }
});

/* ------- Zotero research-workflow preflight and retrieval policy ------- */

import {
  checkComparisonManifestPayload,
  checkEvidenceBundlePayload,
  checkResultEvidenceBudget,
  duplicateRetrievalNote,
  estimateResultEvidenceChars,
  resultEvidenceConflictNote,
  retrievalSignature,
  DEFAULT_EVIDENCE_BUDGET_CHARS,
} from "../lib/workflow-invariants-logic.ts";

function bundleEvidenceRecord(extra = {}) {
  return {
    evidence_id: "e1",
    item_key: "AZM6IY9A",
    route: "pdf_extraction",
    locator: "Table 5, PDF p. 6",
    page: 6,
    quote: "reduced crime by 11% (95% CI 7-15%)",
    ...extra,
  };
}

function bundleClaim(extra = {}) {
  return {
    claim_id: "c1",
    text: "The treatment reduced crime by 11%.",
    evidence_ids: ["e1"],
    risk_tags: ["numeric"],
    ...extra,
  };
}

test("checkEvidenceBundlePayload accepts a valid bundle", () => {
  assert.deepEqual(
    checkEvidenceBundlePayload([bundleClaim()], [bundleEvidenceRecord()], ["AZM6IY9A"]),
    { ok: true }
  );
  assert.deepEqual(
    checkEvidenceBundlePayload(JSON.stringify([bundleClaim()]), JSON.stringify([bundleEvidenceRecord()]), null),
    { ok: true }
  );
});

test("checkEvidenceBundlePayload rejects retry-class defects with short reasons", () => {
  let r = checkEvidenceBundlePayload(new Array(21).fill(bundleClaim()), [bundleEvidenceRecord()], null);
  assert.equal(r.ok, false);
  assert.match(r.reason, /claims must contain 1-20/);

  r = checkEvidenceBundlePayload([bundleClaim()], [bundleEvidenceRecord({ item_key: "BADKEY" })], null);
  assert.equal(r.ok, false);
  assert.match(r.reason, /item_key must be an 8-character key/);

  r = checkEvidenceBundlePayload([bundleClaim()], [bundleEvidenceRecord({ route: "smoke_signal" })], null);
  assert.equal(r.ok, false);
  assert.match(r.reason, /route must be one of/);

  r = checkEvidenceBundlePayload(
    [bundleClaim()],
    [bundleEvidenceRecord(), bundleEvidenceRecord()],
    null
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /evidence_id values must be distinct/);

  r = checkEvidenceBundlePayload(
    [bundleClaim({ expected_values: [{ role: "p_threshold", value: "0.001" }] })],
    [bundleEvidenceRecord()],
    null
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /p_threshold requires operator/);

  r = checkEvidenceBundlePayload([bundleClaim({ evidence_ids: ["e1", "e1"] })], [bundleEvidenceRecord()], null);
  assert.equal(r.ok, false);
  assert.match(r.reason, /evidence_ids must be distinct/);

  r = checkEvidenceBundlePayload([bundleClaim()], [bundleEvidenceRecord({ page: 0 })], null);
  assert.equal(r.ok, false);
  assert.match(r.reason, /one-based integer/);
});

test("checkComparisonManifestPayload accepts a valid manifest", () => {
  const manifest = {
    frozen_item_keys: ["AZM6IY9A", "BB22CC33"],
    cards: [
      {
        item_key: "AZM6IY9A",
        status: "eligible",
        results: [
          {
            result_id: "r1",
            result_class: "main",
            outcome: "burglary",
            point_estimate: "-0.072",
            scale: "log points",
            uncertainty: "SE 0.020",
            treatment: "demolition",
            dose: "one unit",
            denominator: "blocks",
            population: "city",
            geography: "Detroit",
            time_horizon: "1 year",
            specification: "TWFE",
            evidence_ids: ["pdf:AZM6IY9A:p12:t2"],
          },
        ],
        primary_result_id: "r1",
        maximum_substantive_result_id: "r1",
        selected_result_id: "r1",
        inventory_locators: ["Table 2, PDF p. 12"],
      },
      { item_key: "BB22CC33", status: "no_eligible_result", reason: "no relevant outcomes" },
    ],
    ranking_rule: "largest significant percentage reduction in property crime",
    eligible_result_policy: "substantive_all",
    numerical_winner_status: "clear",
    substantive_winner_status: "clear",
    alternative_policy_changes_top_k: false,
    max_reported_items: 1,
    selected_item_keys: ["AZM6IY9A"],
  };
  assert.deepEqual(checkComparisonManifestPayload(manifest), { ok: true });
  assert.deepEqual(checkComparisonManifestPayload(JSON.stringify(manifest)), { ok: true });
});

test("checkComparisonManifestPayload rejects retry-class defects with short reasons", () => {
  const base = {
    frozen_item_keys: ["AZM6IY9A"],
    cards: [
      {
        item_key: "AZM6IY9A",
        status: "eligible",
        results: [
          {
            result_id: "r1",
            result_class: "main",
            outcome: "burglary",
            point_estimate: "-0.072",
            scale: "log points",
            uncertainty: "SE 0.020",
            treatment: "demolition",
            dose: "one unit",
            denominator: "blocks",
            population: "city",
            geography: "Detroit",
            time_horizon: "1 year",
            specification: "TWFE",
            evidence_ids: ["zr1:0:AZM6IY9A#25:" + "a".repeat(64)],
          },
        ],
        primary_result_id: "r1",
        maximum_substantive_result_id: "r1",
        selected_result_id: "r1",
        inventory_locators: ["Table 2, PDF p. 12"],
      },
    ],
    ranking_rule: "largest reduction",
    eligible_result_policy: "substantive_all",
    numerical_winner_status: "clear",
    substantive_winner_status: "clear",
    alternative_policy_changes_top_k: false,
    selected_item_keys: ["AZM6IY9A"],
  };
  // Bare item key instead of a route-prefixed locator: the live failure mode.
  let m = JSON.parse(JSON.stringify(base));
  m.cards[0].results[0].evidence_ids = ["AZM6IY9A"];
  let r = checkComparisonManifestPayload(m);
  assert.equal(r.ok, false);
  assert.match(r.reason, /route-prefixed retained-evidence IDs/);

  m = JSON.parse(JSON.stringify(base));
  m.cards[0].status = "not-a-status";
  r = checkComparisonManifestPayload(m);
  assert.equal(r.ok, false);
  assert.match(r.reason, /status must be one of/);

  m = JSON.parse(JSON.stringify(base));
  m.numerical_winner_status = "unclear";
  r = checkComparisonManifestPayload(m);
  assert.equal(r.ok, false);
  assert.match(r.reason, /numerical_winner_status/);

  m = JSON.parse(JSON.stringify(base));
  m.alternative_policy_changes_top_k = "no";
  r = checkComparisonManifestPayload(m);
  assert.equal(r.ok, false);
  assert.match(r.reason, /alternative_policy_changes_top_k must be a boolean/);

  m = JSON.parse(JSON.stringify(base));
  m.cards = JSON.parse(JSON.stringify(base.cards)).concat(JSON.parse(JSON.stringify(base.cards)));
  r = checkComparisonManifestPayload(m);
  assert.equal(r.ok, false);
  assert.match(r.reason, /one entry per item_key/);

  m = JSON.parse(JSON.stringify(base));
  delete m.selected_item_keys;
  r = checkComparisonManifestPayload(m);
  assert.equal(r.ok, false);
  assert.match(r.reason, /selected_item_keys/);

  // Unparseable JSON strings pass through to normal validation; non-object
  // manifests fail fast with a one-line reason.
  assert.deepEqual(checkComparisonManifestPayload("not-json{"), { ok: true });
  r = checkComparisonManifestPayload(42);
  assert.equal(r.ok, false);
  assert.match(r.reason, /manifest must be an object/);
});

test("estimateResultEvidenceChars bounds the worst-case composite response", () => {
  const oneOfEach = {
    requests: [
      {
        item_key: "AZM6IY9A",
        evidence_id: "zr1:0:AZM6IY9A#1:" + "a".repeat(64),
        sidecar_queries: ["Table 5"],
        pdf_queries: ["Table 5"],
      },
    ],
  };
  // One passage read + 2 sidecar reads (primary + continuation) + 1 pdf read
  // = 4 route reads x 8000 x 1.3 overhead.
  assert.equal(estimateResultEvidenceChars(oneOfEach), Math.ceil(4 * 8000 * 1.3));
  // Compact caps route reads at 1200.
  const compact = { requests: oneOfEach.requests, compact: true };
  assert.equal(estimateResultEvidenceChars(compact), Math.ceil(4 * 1200 * 1.3));
  // Lower max_chars_per_route scales the estimate.
  const narrow = { requests: oneOfEach.requests, max_chars_per_route: 2000 };
  assert.equal(estimateResultEvidenceChars(narrow), Math.ceil(4 * 2000 * 1.3));
});

test("checkResultEvidenceBudget blocks oversized batches and passes bounded ones", () => {
  const oneFull = { item_key: "AZM6IY9A", evidence_id: "zr1:0:AZM6IY9A#1:" + "a".repeat(64), sidecar_queries: ["Table 5"], pdf_queries: ["Table 5"] };
  const heavy = {
    requests: [
      oneFull,
      { ...oneFull, item_key: "BB22CC33", evidence_id: "zr1:0:BB22CC33#1:" + "a".repeat(64) },
      { ...oneFull, item_key: "CC33DD44", evidence_id: "zr1:0:CC33DD44#1:" + "a".repeat(64) },
      { ...oneFull, item_key: "DD44EE55", evidence_id: "zr1:0:DD44EE55#1:" + "a".repeat(64) },
    ],
  };
  // A two-item full stack estimates ~83k and stays under the default budget.
  assert.equal(checkResultEvidenceBudget({ requests: [oneFull, { ...oneFull, item_key: "BB22CC33" }] }).blocked, false);
  let r = checkResultEvidenceBudget(heavy, DEFAULT_EVIDENCE_BUDGET_CHARS);
  assert.equal(r.blocked, true);
  assert.match(r.reason, /Split the batch/);
  assert.match(r.reason, /max_total_chars/);

  // Server-side budget is the escape hatch: the hook stands down.
  r = checkResultEvidenceBudget({ ...heavy, max_total_chars: 40000 }, DEFAULT_EVIDENCE_BUDGET_CHARS);
  assert.equal(r.blocked, false);

  // Compact halves the route read size and passes the same batch.
  r = checkResultEvidenceBudget({ ...heavy, compact: true }, DEFAULT_EVIDENCE_BUDGET_CHARS);
  assert.equal(r.blocked, false);

  // A small single-item call passes.
  r = checkResultEvidenceBudget({ requests: [{ item_key: "AZM6IY9A", pdf_queries: ["Table 5"] }] });
  assert.equal(r.blocked, false);
});

test("retrievalSignature normalizes identity across call shapes", () => {
  const flat = retrievalSignature("zotero_find_in_item", { item_key: "AZM6IY9A", query: "Table 5" });
  const proxy = retrievalSignature("mcp__zotero", { tool: "zotero_find_in_item", args: { item_key: "AZM6IY9A", query: "Table 5" } });
  const gateway = retrievalSignature("mcp", { tool: "zotero_find_in_item", args: { item_key: "AZM6IY9A", query: "Table 5" } });
  assert.equal(flat, proxy);
  assert.equal(proxy, gateway);

  // Case and whitespace differences do not change identity.
  assert.equal(flat, retrievalSignature("zotero_find_in_item", { item_key: "azm6iy9a", query: "  table  5 " }));
  // Continuation coordinates and expected hashes do.
  assert.notEqual(flat, retrievalSignature("zotero_find_in_item", { item_key: "AZM6IY9A", query: "Table 5", start_char: 500 }));
  assert.notEqual(flat, retrievalSignature("zotero_find_in_item", { item_key: "AZM6IY9A", query: "Table 5", expected_hash: "a".repeat(64) }));

  // semantic_search identity is insensitive to item_keys order.
  const a = retrievalSignature("zotero_semantic_search", { query: "crime", item_keys: ["AZM6IY9A", "BB22CC33"] });
  const b = retrievalSignature("zotero_semantic_search", { query: "crime", item_keys: ["BB22CC33", "AZM6IY9A"] });
  assert.equal(a, b);

  // Resumed evidence calls carry their own identity.
  const token = "evc1.abc";
  assert.equal(
    retrievalSignature("zotero_collect_result_evidence", { continuation_token: token }),
    `collect_result_evidence|token:${token}`
  );

  // Non-retrieval calls have no signature.
  assert.equal(retrievalSignature("zotero_resolve_exact_source", { title: "x" }), null);
  assert.equal(retrievalSignature("bash", { command: "ls" }), null);
});

test("duplicateRetrievalNote warns on 2nd and 3rd identical read then falls silent", () => {
  const seen = new Map();
  const sig = retrievalSignature("zotero_find_in_item", { item_key: "AZM6IY9A", query: "Table 5" });
  assert.equal(duplicateRetrievalNote(sig, seen), null); // 1st: silent, recorded
  assert.match(duplicateRetrievalNote(sig, seen), /Duplicate Retrieval/); // 2nd
  assert.match(duplicateRetrievalNote(sig, seen), /Duplicate Retrieval/); // 3rd
  assert.equal(duplicateRetrievalNote(sig, seen), null); // 4th: bounded backoff
  assert.equal(duplicateRetrievalNote(null, seen), null);
});

test("resultEvidenceConflictNote surfaces conflict flags as one compact line", () => {
  const collectInput = { tool: "zotero_collect_result_evidence", args: { requests: [] } };
  const conflicted = JSON.stringify({
    items: [
      {
        item_key: "AZM6IY9A",
        conflict_flags: [{ code: "NUMERIC_SIGNATURE_MISMATCH" }],
        requires_visual_review: true,
        requires_follow_up: false,
      },
    ],
  });
  const note = resultEvidenceConflictNote("mcp__zotero", collectInput, false, [{ type: "text", text: conflicted }]);
  assert.match(note, /\[Evidence Conflicts\]/);
  assert.match(note, /AZM6IY9A/);
  assert.match(note, /NUMERIC_SIGNATURE_MISMATCH/);
  assert.match(note, /before any ranking/);
  // One line only.
  assert.equal(note.split("\n").length, 1);

  const clean = JSON.stringify({ items: [{ item_key: "AZM6IY9A", conflict_flags: [], requires_follow_up: false }] });
  assert.equal(resultEvidenceConflictNote("mcp__zotero", collectInput, false, [{ type: "text", text: clean }]), null);
  assert.equal(resultEvidenceConflictNote("mcp__zotero", collectInput, true, [{ type: "text", text: conflicted }]), null);
  assert.equal(resultEvidenceConflictNote("zotero_semantic_search", { query: "x" }, false, [{ type: "text", text: conflicted }]), null);
});
