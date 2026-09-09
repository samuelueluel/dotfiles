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
  checkZoteroCloudUpload,
  checkZoteroSemanticResult,
  healZoteroMcpArgs,
  stripAuditClaimCitationYears,
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

  // JSON-string args are re-serialized, not dropped.
  const stringy = healZoteroMcpArgs("mcp__zotero", {
    tool: "zotero_list_collection_items",
    args: JSON.stringify({ collection: "TRGBCDX5" }),
  });
  assert.equal(stringy.wasHealed, true);
  assert.deepEqual(JSON.parse(stringy.healedInput.args), { collection_key: "TRGBCDX5" });

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
