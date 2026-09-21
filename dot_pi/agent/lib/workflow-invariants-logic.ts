import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { isSensitiveShellCommand } from "./bash-policy.ts";

const require = createRequire(import.meta.url);

export const VAULT_ROOT = path.join(os.homedir(), "Dropbox", "Sam-Obsidian-Vault");
export const VAULT_OBSIDIAN_DIR = path.join(VAULT_ROOT, ".obsidian");
export const DOTFILES_ROOT = path.join(os.homedir(), "dotfiles");
export const SESSION_SUMMARY_STORE = path.join(os.homedir(), ".pi", "agent", "session-summaries.json");

/**
 * Checks whether a path targets an Obsidian vault note rather than internal
 * configuration (.obsidian/ containing CSS snippets, plugins, or themes).
 */
export function isVaultNotePath(targetPath: string, vaultRoot = VAULT_ROOT): boolean {
  if (!targetPath) return false;
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(vaultRoot)) return false;

  // Exception: files inside .obsidian/ (e.g. .obsidian/snippets/*.css, plugins)
  const obsidianConfigDir = path.join(vaultRoot, ".obsidian");
  if (resolved === obsidianConfigDir || resolved.startsWith(obsidianConfigDir + path.sep)) {
    return false;
  }

  return true;
}

/**
 * Checks whether a path targets static source files inside ~/dotfiles directly,
 * which should be edited via the live path followed by `chezmoi add`.
 * Template files (*.tmpl) are exempt and must be edited directly.
 */
export function isDotfilesStaticPath(targetPath: string, dotfilesRoot = DOTFILES_ROOT): boolean {
  if (!targetPath) return false;
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(dotfilesRoot)) return false;

  // Exception: .tmpl files must be edited directly in the dotfiles repository
  if (resolved.endsWith(".tmpl")) return false;

  return true;
}

/**
 * Checks whether a path targets sensitive credentials that should not be exposed.
 */
export function isSecretFilePath(targetPath: string): boolean {
  if (!targetPath) return false;
  const resolved = path.resolve(targetPath);
  return (
    /\/\.ssh\/id_[^\/]+$/.test(resolved) ||
    /\/\.gnupg\//.test(resolved) ||
    /\/\.aws\/credentials$/.test(resolved) ||
    /\/\.config\/op\//.test(resolved)
  );
}

/**
 * Protects the curated session-summary store from direct writes. The piwork
 * persistence layer remains the only supported mutation route.
 */
export function isSessionSummaryStorePath(targetPath: string): boolean {
  if (!targetPath) return false;
  const expanded = targetPath.startsWith("~/")
    ? path.join(os.homedir(), targetPath.slice(2))
    : targetPath;
  return path.resolve(expanded) === SESSION_SUMMARY_STORE;
}

export type CommandCheckResult = {
  blocked: boolean;
  reason?: string;
};

/**
 * Blocks shell references to private credential locations. The Bash classifier
 * also rejects these in plan/manual safe mode; this invariant covers automatic
 * modes and stale/forged calls before they reach the shell.
 */
export function checkSecretShellAccess(command: string): CommandCheckResult {
  if (!isSensitiveShellCommand(command)) return { blocked: false };
  return {
    blocked: true,
    reason: "Access to private SSH, GPG, cloud, or password-manager credentials is prohibited.",
  };
}

/**
 * Checks whether a shell command attempts host-level package management,
 * unauthorized sudo, or session-clobbering chezmoi apply.
 */
export function checkPrivilegedOrHostMutation(command: string): CommandCheckResult {
  if (!command) return { blocked: false };

  if (/\bchezmoi\s+apply\b/.test(command)) {
    return {
      blocked: true,
      reason: "Running 'chezmoi apply' inside an agent session is prohibited. Ask Samuel to run it if needed.",
    };
  }

  if (/\bsudo\b/.test(command)) {
    return {
      blocked: true,
      reason: "Privileged 'sudo' commands are prohibited. Write multi-step commands to ~/sudo_temp.sh or ask Samuel to run them.",
    };
  }

  if (/\b(rpm-ostree|dnf|flatpak\s+install)\b/.test(command)) {
    return {
      blocked: true,
      reason: "Native package installations are prohibited on the immutable host.",
    };
  }

  return { blocked: false };
}

/**
 * Checks whether a shell command executes unrecoverable/destructive operations
 * on Git repositories or filesystems.
 */
export function checkDestructiveCommand(command: string): CommandCheckResult {
  if (!command) return { blocked: false };

  // 1. Destructive Git checks
  if (/git\s+reset\s+--hard\b/.test(command)) {
    return {
      blocked: true,
      reason: "Destructive Git reset ('git reset --hard') will discard uncommitted changes.",
    };
  }

  if (/git\s+clean\s+-[a-zA-Z]*f[a-zA-Z]*/.test(command)) {
    return {
      blocked: true,
      reason: "Destructive Git clean ('git clean -f') will permanently delete untracked files.",
    };
  }

  if (/git\s+(checkout|restore)\s+(?:--\s+)?\.(?:\s|$)/.test(command)) {
    return {
      blocked: true,
      reason: "Destructive Git checkout/restore on '.' will discard all unstaged working tree changes.",
    };
  }

  if (/git\s+push\s+.*(?:--force\b|-f\b)/.test(command)) {
    return {
      blocked: true,
      reason: "Force-pushing ('git push --force') can overwrite remote Git repository history.",
    };
  }

  if (/git\s+branch\s+-[a-zA-Z]*D[a-zA-Z]*/.test(command)) {
    return {
      blocked: true,
      reason: "Force-deleting a branch ('git branch -D') can permanently destroy unmerged work.",
    };
  }

  // 2. Destructive Filesystem checks
  if (
    /rm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+([\/\~]|(?:\.\.?[\/\\])|(?:\*))(?:\s|$)/.test(command) ||
    /rm\s+-[a-zA-Z]*f[a-zA-Z]*r?\s+([\/\~]|(?:\.\.?[\/\\])|(?:\*))(?:\s|$)/.test(command)
  ) {
    return {
      blocked: true,
      reason: "Recursive root, home, or wildcard deletion ('rm -rf') is prohibited.",
    };
  }

  if (/\bmkfs(?:\.[a-z0-9]+)?\b/.test(command)) {
    return {
      blocked: true,
      reason: "Disk formatting command ('mkfs') is prohibited.",
    };
  }

  if (/\bdd\s+if=/.test(command)) {
    return {
      blocked: true,
      reason: "Raw block device writing ('dd') is prohibited.",
    };
  }

  return { blocked: false };
}

/**
 * Blocks direct shell access to the curated session-summary store. Normal
 * `piwork summary` commands do not name this implementation file and remain
 * unaffected.
 */
export function checkSessionSummaryStoreShellAccess(command: string): CommandCheckResult {
  if (!command || !command.includes("session-summaries.json")) return { blocked: false };
  return {
    blocked: true,
    reason:
      "Direct shell access to session-summaries.json is prohibited. Use the 'piwork summary' commands so validation and atomic persistence are preserved.",
  };
}

/**
 * Blocks raw destructive Zotero index operations. The maintained skill
 * helpers provide dry-run and exact-confirmation gates for these workflows.
 */
export function checkZoteroIndexMutation(command: string): CommandCheckResult {
  if (!command) return { blocked: false };

  const massRebuild =
    /\bupdate-db\b[^\n;&|]*--allow-mass-deletion\b/.test(command) ||
    /--allow-mass-deletion\b[^\n;&|]*\bupdate-db\b/.test(command);
  const directChunkDeletion = /\bdelete_item_chunks\s*\(/.test(command);
  const rawProcessKill =
    /\bpkill\b[^\n;&|]*-f\b[^\n;&|]*(?:zotero-backfill-watchdog|zotero-sidecar-watch|update-db|mineru)/.test(
      command
    );
  const rawChromaMove =
    /\bmv\b[^\n;&|]*(?:\.config\/zotero-mcp\/chroma_db|\$HOME\/\.config\/zotero-mcp\/chroma_db)/.test(
      command
    );

  if (!massRebuild && !directChunkDeletion && !rawProcessKill && !rawChromaMove) {
    return { blocked: false };
  }
  return {
    blocked: true,
    reason:
      "Raw destructive Zotero index maintenance is prohibited. Use the reviewed helpers under ~/.agents/skills/zotero-pipeline/scripts/ and their dry-run/confirmation gates.",
  };
}

/**
 * Checks whether a shell command attempts direct operations on vault notes
 * (while allowing operations targeting .obsidian/ config/snippets/plugins).
 */
export function checkVaultShellAccess(command: string, vaultRoot = VAULT_ROOT): boolean {
  if (!command) return false;
  if (!command.includes("Dropbox/Sam-Obsidian-Vault") && !command.includes(vaultRoot)) {
    return false;
  }

  // If command specifically and only targets .obsidian/, allow it
  const hasVaultRef = command.includes("Dropbox/Sam-Obsidian-Vault") || command.includes(vaultRoot);
  const hasObsidianConfigRef =
    command.includes("Dropbox/Sam-Obsidian-Vault/.obsidian") ||
    command.includes(path.join(vaultRoot, ".obsidian"));

  // If it references the vault but not .obsidian, it's accessing notes
  if (hasVaultRef && !hasObsidianConfigRef) {
    return true;
  }

  return false;
}

/**
 * Determines if a file path is managed by Chezmoi.
 * Uses `chezmoi source-path <file>` synchronously; returns true if exit 0.
 */
export function isChezmoiManaged(filePath: string): boolean {
  if (!filePath) return false;
  try {
    execFileSync("chezmoi", ["source-path", filePath], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Automatically heals macOS/BSD sed invocations on GNU sed Linux systems.
 * GNU sed interprets `sed -i ''` as taking '' as the script and fails.
 * Rewrites `sed -i ''` and `sed -i ""` to `sed -i`.
 */
export function autoHealSedCommand(command: string): string {
  if (!command || !command.includes("sed")) return command;
  return command.replace(/\b(sed\b(?:\s+-[a-zA-Z]+)*\s+)-i\s+['"]{2}\s+/g, "$1-i ");
}

export type SyntaxCheckResult = {
  valid: boolean;
  error?: string;
  skipped?: boolean;
};

/**
 * Returns whether a tool result represents a successful write/edit operation
 * that should receive post-tool validation and Chezmoi staging checks.
 */
export function shouldRunPostToolChecks(toolName: unknown, isError: unknown): boolean {
  if (toolName !== "write" && toolName !== "edit") return false;
  return isError !== true;
}

/**
 * Validates configuration and code syntax across Python, Bash, JSON, JSONC,
 * TOML, YAML, and KDL without external npm bloat.
 * Skips Chezmoi .tmpl template files and unhandled extensions.
 */
export function validateFileSyntax(filePath: string): SyntaxCheckResult {
  if (!filePath) return { valid: true, skipped: true };
  const resolved = path.resolve(filePath);

  // Skip Chezmoi template files (*.tmpl) as they contain Go template tags
  if (resolved.endsWith(".tmpl")) return { valid: true, skipped: true };

  if (!fs.existsSync(resolved)) return { valid: true, skipped: true };

  const ext = path.extname(resolved).toLowerCase();
  const basename = path.basename(resolved).toLowerCase();

  try {
    // 1. Python (.py)
    if (ext === ".py") {
      execFileSync("python3", ["-m", "py_compile", resolved], {
        stdio: "pipe",
        timeout: 2000,
      });
      return { valid: true };
    }

    // 2. Shell script (.sh, .bash)
    if (ext === ".sh" || ext === ".bash") {
      execFileSync("bash", ["-n", resolved], {
        stdio: "pipe",
        timeout: 2000,
      });
      return { valid: true };
    }

    // 3. JSON (.json)
    if (ext === ".json") {
      const content = fs.readFileSync(resolved, "utf8");
      JSON.parse(content);
      return { valid: true };
    }

    // 4. JSONC (.jsonc)
    if (ext === ".jsonc") {
      const content = fs.readFileSync(resolved, "utf8");
      const stripped = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      JSON.parse(stripped);
      return { valid: true };
    }

    // 5. TOML (.toml)
    if (ext === ".toml") {
      execFileSync(
        "python3",
        ["-c", "import tomllib, pathlib, sys; tomllib.loads(pathlib.Path(sys.argv[1]).read_text())", resolved],
        { stdio: "pipe", timeout: 2000 }
      );
      return { valid: true };
    }

    // 6. YAML (.yaml, .yml)
    if (ext === ".yaml" || ext === ".yml") {
      try {
        const YAML = require("/var/home/samuel/.pi/agent/npm/node_modules/yaml");
        const content = fs.readFileSync(resolved, "utf8");
        YAML.parse(content);
      } catch (yamlErr: any) {
        // If YAML module isn't loaded, return syntax error if it threw parse error
        if (yamlErr && yamlErr.name === "YAMLParseError") {
          return { valid: false, error: yamlErr.message };
        }
        if (yamlErr && yamlErr.code !== "MODULE_NOT_FOUND") {
          return { valid: false, error: yamlErr.message };
        }
      }
      return { valid: true };
    }

    // 7. KDL (.kdl / config.kdl) via Niri
    if (ext === ".kdl" || basename === "config.kdl") {
      if (fs.existsSync("/usr/bin/niri")) {
        execFileSync("niri", ["validate", "--config", resolved], {
          stdio: "pipe",
          timeout: 2000,
        });
      }
      return { valid: true };
    }

    // 8. Justfile (justfile, Justfile, *.just) via just
    if (basename === "justfile" || basename === "Justfile" || ext === ".just" || basename.endsWith(".just")) {
      if (fs.existsSync("/usr/bin/just")) {
        execFileSync("just", ["--dump", "--justfile", resolved], {
          stdio: "pipe",
          timeout: 2000,
        });
      }
      return { valid: true };
    }
  } catch (err: any) {
    const errorMsg =
      err?.stderr?.toString()?.trim() ||
      err?.stdout?.toString()?.trim() ||
      err?.message ||
      "Unknown syntax error";
    return { valid: false, error: errorMsg };
  }

  return { valid: true, skipped: true };
}

/**
 * Checks whether an Agent prompt to Explore violates the read-only invariant
 * by asking it to edit, write, or refactor code.
 */
export function checkExplorePrompt(prompt: string): CommandCheckResult {
  if (!prompt) return { blocked: false };

  // Explicit carve-out: Zotero full-document extraction workers are authorized Explore runs
  if (prompt.includes("ZOTERO_EXTRACT_WORKER: FULL_DOCUMENT")) {
    return { blocked: false };
  }

  if (
    /\b(edit|modify|rewrite|refactor|update|delete|create)\b.*\b(file|script|code|note|module|function)\b/i.test(
      prompt
    ) ||
    /\brun\b.*\b(stata|do-?file|regression)\b/i.test(prompt)
  ) {
    return {
      blocked: true,
      reason:
        "Explore subagents are strictly read-only. File edits, refactorings, and Stata execution must be performed inline in the main session per Subagents.md.",
    };
  }

  return { blocked: false };
}

/**
 * Ensures Zotero extraction workers have unlimited turns by removing max_turns.
 */
export function healZoteroWorkerInput(input: Record<string, unknown>): {
  healedInput: Record<string, unknown>;
  wasHealed: boolean;
} {
  const result = { ...input };
  let wasHealed = false;
  const prompt = typeof result.prompt === "string" ? result.prompt : "";

  if (prompt.includes("ZOTERO_EXTRACT_WORKER: FULL_DOCUMENT")) {
    if (result.max_turns !== undefined) {
      delete result.max_turns;
      wasHealed = true;
    }
    if (result.subagent_type !== "Explore") {
      result.subagent_type = "Explore";
      wasHealed = true;
    }
  }

  return { healedInput: result, wasHealed };
}

/**
 * Removes parenthetical citation years (e.g. "(2015)", "(2019a)") from
 * `zotero_audit_claims` claim text. The audit's deterministic numeric gate
 * treats every numeric token in claim text as requiring literal presence in
 * evidence quotes, so conventional "Author (Year)" prose fails with
 * NUMBER_MISMATCH even when all material numbers verify. Bare years
 * ("1999 levels", "2010 to 2014"), parenthesized ranges ("(2010-2014)"),
 * and statistics ("(n = 343)") are preserved; evidence quotes are never
 * touched. Deletion-only: cannot manufacture a false `supported` verdict.
 */
const AUDIT_CITATION_YEAR_RE = /\(\d{4}[a-z]?\)/g;

export function stripAuditClaimCitationYears(claims: unknown): {
  claims: unknown;
  changed: number;
} {
  const cleanOne = (text: string): string =>
    text.replace(AUDIT_CITATION_YEAR_RE, "").replace(/[ \t]{2,}/g, " ").trim();
  if (typeof claims === "string") {
    try {
      const parsed: unknown = JSON.parse(claims);
      if (!Array.isArray(parsed)) return { claims, changed: 0 };
      const inner = stripAuditClaimCitationYears(parsed);
      if (inner.changed === 0) return { claims, changed: 0 };
      return { claims: JSON.stringify(inner.claims), changed: inner.changed };
    } catch {
      return { claims, changed: 0 };
    }
  }
  if (!Array.isArray(claims)) return { claims, changed: 0 };
  let changed = 0;
  const out = claims.map((claim) => {
    if (!isRecord(claim) || typeof claim.text !== "string") return claim;
    const cleaned = cleanOne(claim.text);
    if (cleaned === claim.text) return claim;
    changed += 1;
    return { ...claim, text: cleaned };
  });
  return { claims: out, changed };
}

/**
 * Pre-dispatch shape check for `zotero_audit_claims` payloads.
 * Client-side schema errors echo the entire claims array plus the full tool
 * schema (tens of KB), so catching mechanical defects here replaces a giant
 * failure with a one-line fix. Only enforces rules that caused real retries:
 * entry counts, string length caps, enum membership, item-key shape, and the
 * p_threshold operator requirement. Anything unrecognized passes through
 * (`{ok:true}`) so normal server validation owns genuinely novel shapes.
 */
const AUDIT_ROLES = new Set([
  "estimate",
  "se",
  "ci_lower",
  "ci_upper",
  "p_value",
  "p_threshold",
  "sample_size",
  "other",
]);
const AUDIT_OPERATORS = new Set(["<", "<=", "=", ">=", ">"]);
const AUDIT_RISK_TAGS = new Set([
  "numeric",
  "quotation",
  "causal",
  "comparison",
  "within_item_comparison",
  "attribution",
  "other",
]);
const AUDIT_ROUTES = new Set(["semantic", "pdf_page", "mineru_sidecar"]);
const AUDIT_ITEM_KEY_RE = /^[A-Za-z0-9]{8}$/;

export function checkAuditClaimsPayload(
  claims: unknown
): { ok: true } | { ok: false; reason: string } {
  const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  let list: unknown = claims;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return { ok: true };
    }
  }
  if (!Array.isArray(list)) return { ok: true };
  if (list.length < 1 || list.length > 8) {
    return fail(`claims must contain 1-8 entries (got ${list.length})`);
  }
  for (let i = 0; i < list.length; i++) {
    const tag = `claims[${i}]`;
    const claim = list[i];
    if (!isRecord(claim)) return fail(`${tag} must be an object`);
    if (
      typeof claim.claim_id !== "string" ||
      !claim.claim_id ||
      claim.claim_id.length > 80
    ) {
      return fail(`${tag}.claim_id must be a non-empty string of max 80 chars`);
    }
    if (typeof claim.text !== "string" || !claim.text || claim.text.length > 1000) {
      return fail(`${tag}.text must be a non-empty string of max 1000 chars`);
    }
    if (claim.risk_tags !== undefined) {
      if (!Array.isArray(claim.risk_tags) || claim.risk_tags.length > 6) {
        return fail(`${tag}.risk_tags must be an array of max 6 tags`);
      }
      for (const t of claim.risk_tags) {
        if (typeof t !== "string" || !AUDIT_RISK_TAGS.has(t)) {
          return fail(`${tag}.risk_tags holds unknown tag ${JSON.stringify(t)}`);
        }
      }
    }
    if (claim.expected_values !== undefined) {
      if (!Array.isArray(claim.expected_values) || claim.expected_values.length > 16) {
        return fail(`${tag}.expected_values must be an array of max 16 entries`);
      }
      for (let j = 0; j < claim.expected_values.length; j++) {
        const ev = claim.expected_values[j];
        const etag = `${tag}.expected_values[${j}]`;
        if (!isRecord(ev)) return fail(`${etag} must be an object`);
        if (typeof ev.role !== "string" || !AUDIT_ROLES.has(ev.role)) {
          return fail(`${etag}.role must be one of ${[...AUDIT_ROLES].join(", ")}`);
        }
        if (typeof ev.value !== "string" || !ev.value || ev.value.length > 64) {
          return fail(`${etag}.value must be a non-empty string of max 64 chars`);
        }
        if (ev.operator !== undefined && ev.operator !== null) {
          if (typeof ev.operator !== "string" || !AUDIT_OPERATORS.has(ev.operator)) {
            return fail(`${etag}.operator must be one of <, <=, =, >=, >`);
          }
        } else if (ev.role === "p_threshold") {
          return fail(`${etag}: p_threshold requires operator "<" (e.g. value "0.001")`);
        }
      }
    }
    if (
      !Array.isArray(claim.evidence) ||
      claim.evidence.length < 1 ||
      claim.evidence.length > 4
    ) {
      return fail(`${tag}.evidence must contain 1-4 entries`);
    }
    for (let k = 0; k < claim.evidence.length; k++) {
      const ref = claim.evidence[k];
      const rtag = `${tag}.evidence[${k}]`;
      if (!isRecord(ref)) return fail(`${rtag} must be an object`);
      if (typeof ref.route !== "string" || !AUDIT_ROUTES.has(ref.route)) {
        return fail(`${rtag}.route must be semantic, pdf_page, or mineru_sidecar`);
      }
      if (typeof ref.item_key !== "string" || !AUDIT_ITEM_KEY_RE.test(ref.item_key)) {
        return fail(`${rtag}.item_key must be an 8-character key`);
      }
      if (typeof ref.quote !== "string" || !ref.quote || ref.quote.length > 1600) {
        return fail(`${rtag}.quote must be a non-empty string of max 1600 chars`);
      }
    }
  }
  return { ok: true };
}

/**
 * Repairs common Zotero MCP argument-shape mistakes before dispatch.
 * Silent self-healing: only rewrites when the canonical argument is absent
 * and the alias value parses cleanly; otherwise returns the input untouched
 * so normal tool validation surfaces the error. Never mutates the caller
 * object. Currently handles:
 * - `collection` -> `collection_key` on list_collection_items and
 *   search_bibliography_entries (semantic_search canonically uses
 *   `collection` and is never touched).
 * - `pages: "4-6"` / `pages: 4` -> `start_page` / `end_page` on
 *   read_pdf_pages.
 * - Parenthetical citation years in `zotero_audit_claims` claim text
 *   (see `stripAuditClaimCitationYears`).
 * - String-serialized `args`/`arguments` objects parsed in place: the MCP
 *   proxy requires an object and rejects a JSON string before dispatch.
 *   Malformed strings pass through to normal validation untouched.
 */
export function healZoteroMcpArgs(
  toolName: unknown,
  input: unknown
): {
  healedInput: Record<string, unknown>;
  wasHealed: boolean;
} {
  const record: Record<string, unknown> =
    input && typeof input === "object" ? { ...(input as Record<string, unknown>) } : {};
  const noHeal = { healedInput: record, wasHealed: false };
  const { server, operation, args } = parseMcpCall(toolName, record);
  if (server !== "zotero") return noHeal;
  // String-serialized args slots: the MCP proxy requires an object and
  // rejects a JSON string before dispatch. Parse cleanly-serialized objects
  // in place; malformed strings pass through to normal validation untouched.
  let wasHealed = false;
  for (const slot of ["args", "arguments"] as const) {
    const raw = record[slot];
    if (typeof raw !== "string") continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        record[slot] = parsed;
        wasHealed = true;
      }
    } catch {
      // Leave malformed strings for normal tool validation.
    }
  }
  const healed = { ...args };

  if (
    (operation === "list_collection_items" || operation === "search_bibliography_entries") &&
    healed.collection_key === undefined &&
    typeof healed.collection === "string" &&
    healed.collection.trim() !== ""
  ) {
    healed.collection_key = healed.collection;
    delete healed.collection;
    wasHealed = true;
  }

  if (
    operation === "read_pdf_pages" &&
    healed.start_page === undefined &&
    healed.end_page === undefined &&
    (typeof healed.pages === "string" || typeof healed.pages === "number")
  ) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(String(healed.pages));
    if (match) {
      const start = Number(match[1]);
      const end = match[2] === undefined ? start : Number(match[2]);
      if (Number.isSafeInteger(start) && start >= 1 && Number.isSafeInteger(end) && end >= start) {
        healed.start_page = start;
        if (match[2] !== undefined) healed.end_page = end;
        delete healed.pages;
        wasHealed = true;
      }
    }
  }

  if (operation === "audit_claims") {
    const stripped = stripAuditClaimCitationYears(healed.claims);
    if (stripped.changed > 0) {
      healed.claims = stripped.claims;
      wasHealed = true;
    }
  }

  if (!wasHealed) return noHeal;
  // Write the healed args back into the same slot parseMcpCall read from.
  if (isRecord(record.args)) {
    record.args = healed;
  } else if (isRecord(record.arguments)) {
    record.arguments = healed;
  } else if (typeof record.args === "string") {
    record.args = JSON.stringify(healed);
  } else {
    // Bare `zotero_*` tool path (the record itself is the args container)
    // or malformed-arg fallback: replace wholesale to drop stale aliases.
    for (const key of ["collection", "collection_key", "pages", "start_page", "end_page"]) {
      delete record[key];
    }
    Object.assign(record, healed);
  }
  return { healedInput: record, wasHealed: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * TurboVault operations whose `query` string reaches Tantivy's query grammar.
 */
const TURBOVAULT_QUERY_OPERATIONS = new Set([
  "search",
  "advanced_search",
  "semantic_search",
]);

/**
 * Rewrites the apostrophes that Tantivy's query grammar rejects.
 *
 * The grammar reserves `'` as a quoted-phrase delimiter, so an intra-word
 * apostrophe opens a phrase that never closes and the whole query is refused:
 * `dad's birthday` becomes an unterminated `'...'`. Replacing only the
 * apostrophe between word characters preserves deliberate phrase queries
 * (a leading `'` is untouched) and leaves `*`, field prefixes, and operators
 * alone. Whitespace is collapsed so multi-line queries survive as one term list.
 */
function repairTantivyQuery(query: string): string {
  return query
    .replace(/([\p{L}\p{N}])'([\p{L}\p{N}])/gu, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Silent self-healing for TurboVault search arguments. Never blocks; anything
 * it cannot parse cleanly is returned untouched so normal tool validation
 * reports it.
 *
 * This mirrors the server-side sanitizer added in the TurboVault fork, so a
 * natural-language query behaves identically even when the running binary
 * predates that fix (a rolled-back pin, or another MCP client on the same
 * host). It is defence in depth, not the primary fix.
 *
 * Handles:
 * - Intra-word apostrophes in `query` on search, advanced_search, and
 *   semantic_search (see `repairTantivyQuery`).
 * - String-serialized `args`/`arguments` objects parsed in place: the MCP
 *   proxy requires an object and rejects a JSON string before dispatch.
 */
export function healTurbovaultMcpArgs(
  toolName: unknown,
  input: unknown
): {
  healedInput: Record<string, unknown>;
  wasHealed: boolean;
} {
  const record: Record<string, unknown> =
    input && typeof input === "object" ? { ...(input as Record<string, unknown>) } : {};
  const noHeal = { healedInput: record, wasHealed: false };
  const { server, operation, args } = parseMcpCall(toolName, record);
  if (server !== "turbovault") return noHeal;

  let wasHealed = false;
  for (const slot of ["args", "arguments"] as const) {
    const raw = record[slot];
    if (typeof raw !== "string") continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        record[slot] = parsed;
        wasHealed = true;
      }
    } catch {
      // Leave malformed strings for normal tool validation.
    }
  }

  const healed = { ...args };
  if (TURBOVAULT_QUERY_OPERATIONS.has(operation) && typeof healed.query === "string") {
    const repaired = repairTantivyQuery(healed.query);
    if (repaired !== healed.query && repaired !== "") {
      healed.query = repaired;
      wasHealed = true;
    }
  }

  if (!wasHealed) return noHeal;
  // Write the healed args back into the same slot parseMcpCall read from.
  if (isRecord(record.args)) {
    record.args = healed;
  } else if (isRecord(record.arguments)) {
    record.arguments = healed;
  } else if (typeof record.args === "string") {
    record.args = JSON.stringify(healed);
  } else {
    Object.assign(record, healed);
  }
  return { healedInput: record, wasHealed: true };
}

/**
 * Checks whether a shell command executed from within an Explore subagent
 * attempts filesystem mutation or redirection.
 */
export function checkExploreMutatingCommand(command: string): CommandCheckResult {
  if (!command) return { blocked: false };

  // File redirection: >, >>
  if (/[^0-9\s]\s*>{1,2}\s*[^&]/.test(command) || /\s+>{1,2}\s+/.test(command)) {
    return {
      blocked: true,
      reason: "Explore subagents are strictly read-only. Shell output redirection to files is prohibited.",
    };
  }

  // Mutating commands
  if (
    /\b(rm|touch|mkdir|mv|cp|chmod|chown)\b/.test(command) ||
    /\bgit\s+(commit|add|checkout|restore|merge|rebase|pull|push|branch|tag|stash|cherry-pick)\b/.test(command)
  ) {
    return {
      blocked: true,
      reason: "Explore subagents are strictly read-only. Mutating shell commands are prohibited per Explore.md.",
    };
  }

  return { blocked: false };
}

/**
 * Normalizes an MCP invocation into a (server, operation, args) triple
 * across the flattened (`zotero_*`), gateway (`mcp` with {tool, args}),
 * and namespaced-proxy (`mcp__zotero` with {tool, args}) call shapes.
 * Non-MCP calls yield an empty server and operation.
 */
export function parseMcpCall(
  toolName: unknown,
  input: unknown
): { server: string; operation: string; args: Record<string, unknown> } {
  const empty = { server: "", operation: "", args: {} as Record<string, unknown> };
  if (typeof toolName !== "string" || !toolName) return empty;
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  // Namespace proxies: `mcp__<server>` carrying `{ tool, args }`. Resolved
  // generically so a newly proxied server cannot silently bypass hook logic.
  // `mcp__turbovault` was previously unmatched here, which made every
  // TurboVault call made through the namespace proxy invisible to all callers.
  if (toolName.startsWith("mcp__")) {
    const server = toolName.slice("mcp__".length);
    const op = typeof record.tool === "string" ? record.tool : "";
    return { server, operation: stripServerPrefix(op, server), args: mcpArgs(record) };
  }
  if (toolName === "mcp") {
    const op = typeof record.tool === "string" ? record.tool : "";
    const server =
      typeof record.server === "string" && record.server.trim()
        ? record.server.trim()
        : op.startsWith("zotero_")
          ? "zotero"
          : op.startsWith("turbovault_")
            ? "turbovault"
            : "";
    return { server, operation: stripServerPrefix(op, server), args: mcpArgs(record) };
  }
  if (toolName.startsWith("zotero_")) {
    return { server: "zotero", operation: stripServerPrefix(toolName, "zotero"), args: record };
  }
  if (toolName.startsWith("turbovault_")) {
    return { server: "turbovault", operation: stripServerPrefix(toolName, "turbovault"), args: record };
  }
  return empty;
}

function stripServerPrefix(operation: string, server: string): string {
  let op = operation.trim();
  if (!server) return op;
  const prefix = `${server}_`;
  while (op.startsWith(prefix)) op = op.slice(prefix.length);
  return op;
}

function mcpArgs(record: Record<string, unknown>): Record<string, unknown> {
  const nested = record.args ?? record.arguments;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  if (typeof nested === "string") {
    try {
      const parsed: unknown = JSON.parse(nested);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to the outer record for malformed proxy arguments.
    }
  }
  return record;
}

const ZOTERO_DOCUMENT_EXTENSIONS = /\.(pdf|epub|djvu|doc|docx|odt|rtf|bib|bibtex)\s*$/i;

/**
 * Enforces the zero-cloud-bytes policy: blocks `attach_file` outright (its
 * sole purpose is uploading file bytes) and blocks `add_item` only for file
 * ingestion (explicit `source_type: 'file'` or an auto-detected absolute
 * local document path). DOI/URL/ISBN/BibTeX ingestion is unaffected.
 */
export function checkZoteroCloudUpload(toolName: unknown, input: unknown): CommandCheckResult {
  const { server, operation, args } = parseMcpCall(toolName, input);
  if (server !== "zotero") return { blocked: false };

  if (operation === "attach_file") {
    return {
      blocked: true,
      reason:
        "Uploading files to Zotero Cloud is prohibited (zero-cloud-bytes policy). " +
        "Attach local PDFs with ~/.local/bin/zotero-link <item_key> <pdf_path> or ingest via zotero-auto-ingest.",
    };
  }

  if (operation === "add_item") {
    const sourceType = typeof args.source_type === "string" ? args.source_type.toLowerCase() : "auto";
    if (sourceType === "file") {
      return {
        blocked: true,
        reason:
          "Ingesting a local file via zotero_add_item uploads its bytes to Zotero Cloud. " +
          "Create the metadata record without the file, then attach it locally with ~/.local/bin/zotero-link <item_key> <pdf_path>.",
      };
    }
    const source = typeof args.source === "string" ? args.source.trim() : "";
    if (
      (sourceType === "auto" || sourceType === "") &&
      /^([/~]|(?:[A-Za-z]:)?[\\/])/.test(source) &&
      ZOTERO_DOCUMENT_EXTENSIONS.test(source)
    ) {
      return {
        blocked: true,
        reason:
          "This looks like local-file ingestion via zotero_add_item, which uploads file bytes to Zotero Cloud. " +
          "Create the metadata record without the file, then attach it locally with ~/.local/bin/zotero-link <item_key> <pdf_path>.",
      };
    }
  }

  return { blocked: false };
}

/**
 * Flags the all-non-positive rerank footgun: when a zotero_semantic_search
 * result carries ≥1 Rerank score and every score is ≤ 0, the result reads as
 * no supporting evidence. Returns annotation text, or null to stay silent
 * (success path, mixed/positive scores, errors, and non-search calls).
 */
export function checkZoteroSemanticResult(
  toolName: unknown,
  input: unknown,
  isError: unknown,
  content: unknown
): string | null {
  if (isError === true) return null;
  const { server, operation } = parseMcpCall(toolName, input);
  if (server !== "zotero" || operation !== "semantic_search") return null;
  const text = resultText(content);
  if (!text) return null;
  const scores: number[] = [];
  const re = /\*{0,2}Rerank:\*{0,2}\s*([+-]?\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) scores.push(Number(match[1]));
  if (scores.length === 0) return null;
  if (scores.some((score) => score > 0)) return null;
  return (
    `\n\n[Rerank Gate] All ${scores.length} returned passage(s) scored Rerank \u2264 0 — ` +
    `treat this result as no supporting evidence. Do not cite these passages and do not use Relevance scores as substitutes; ` +
    `narrow the query, bind an exact item filter, or verify directly.`
  );
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string"
          ? String((item as Record<string, unknown>).text)
          : ""
      )
      .join("\n");
  }
  return "";
}

/* ----------------------------------------------------------------------- */
/* Zotero research-workflow payload preflight and retrieval policy          */
/*                                                                         */
/* Client-side schema errors on the large validator payloads echo the whole */
/* payload plus the tool schema (tens of KB). The checks below mirror the   */
/* deployed pydantic contracts in the fork (research_workflows.py) so that  */
/* mechanical defects surface as a one-line reason instead. Unrecognized    */
/* shapes pass through; the server owns genuinely novel input.              */
/* ----------------------------------------------------------------------- */

const BUNDLE_RISK_TAGS = new Set(["numeric", "comparison", "calculated", "causal", "attribution"]);
const BUNDLE_ROUTES = new Set(["indexed_passage", "mineru_sidecar", "pdf_extraction", "pdf_rendering"]);
const BUNDLE_UNCERTAINTY = new Set([
  "reported",
  "threshold_only",
  "not_reported_in_checked_result",
  "not_retrieved",
  "ambiguous",
]);
const AUDIT_VALUE_ROLES = new Set([
  "estimate",
  "se",
  "ci_lower",
  "ci_upper",
  "p_value",
  "p_threshold",
  "sample_size",
  "other",
]);
const AUDIT_VALUE_OPERATORS = new Set(["<", "<=", "=", ">=", ">"]);
const COMPARISON_RESULT_CLASSES = new Set([
  "main",
  "subgroup",
  "dosage",
  "dynamic",
  "supplemental",
  "robustness",
  "model_based",
]);
const COMPARISON_CARD_STATUSES = new Set(["eligible", "no_eligible_result", "unresolved"]);
const WINNER_STATUSES = new Set(["clear", "not_clear"]);
const ELIGIBILITY_POLICIES = new Set(["primary_only", "substantive_all", "custom"]);
const MANIFEST_ITEM_KEY_RE = /^[A-Za-z0-9]{8}$/;
const MANIFEST_LOCATOR_RE = /^(?:zr\d*|pdf|pdf_page|pdfpage|mineru|mineru_sidecar|sidecar|semantic|passage|locator):\S+/i;

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value; // Malformed JSON passes through to normal tool validation.
  }
}

function isNonEmptyString(value: unknown, max: number): boolean {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
}

/**
 * Pre-dispatch shape check for `zotero_validate_evidence_bundle` payloads.
 * Mirrors EvidenceBundleValidationRequest in the fork: entry counts, item-key
 * shape, evidence-id distinctness, route enum, locator bounds, and enum
 * membership. Unrecognized shapes pass through.
 */
export function checkEvidenceBundlePayload(
  claims: unknown,
  evidence: unknown,
  allowedItemKeys: unknown
): { ok: true } | { ok: false; reason: string } {
  const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  const claimRaw = parseMaybeJson(claims);
  const evidenceRaw = parseMaybeJson(evidence);
  // Unparseable JSON strings pass through so the server owns that error.
  const claimList = typeof claims === "string" && claimRaw === claims ? undefined : claimRaw;
  const evidenceList = typeof evidence === "string" && evidenceRaw === evidence ? undefined : evidenceRaw;
  if (!Array.isArray(claimList)) {
    return fail("claims must be an array of 1-20 entries");
  }
  if (claimList.length < 1 || claimList.length > 20) {
    return fail(`claims must contain 1-20 entries (got ${claimList.length})`);
  }
  if (!Array.isArray(evidenceList)) {
    return fail("evidence must be an array of 1-40 entries");
  }
  if (evidenceList.length < 1 || evidenceList.length > 40) {
    return fail(`evidence must contain 1-40 entries (got ${evidenceList.length})`);
  }
  const claimIds = new Set<string>();
  for (let i = 0; i < claimList.length; i++) {
    const tag = `claims[${i}]`;
    const claim = claimList[i];
    if (!isRecord(claim)) return fail(`${tag} must be an object`);
    if (!isNonEmptyString(claim.claim_id, 80)) {
      return fail(`${tag}.claim_id must be a non-empty string of max 80 chars`);
    }
    if (claimIds.has(claim.claim_id)) return fail(`claim_id values must be distinct (duplicate ${claim.claim_id})`);
    claimIds.add(claim.claim_id);
    if (!isNonEmptyString(claim.text, 1500)) {
      return fail(`${tag}.text must be a non-empty string of max 1500 chars`);
    }
    if (!Array.isArray(claim.evidence_ids) || claim.evidence_ids.length < 1 || claim.evidence_ids.length > 8) {
      return fail(`${tag}.evidence_ids must contain 1-8 entries`);
    }
    if (new Set(claim.evidence_ids).size !== claim.evidence_ids.length) {
      return fail(`${tag}.evidence_ids must be distinct`);
    }
    if (claim.risk_tags !== undefined && claim.risk_tags !== null) {
      if (!Array.isArray(claim.risk_tags) || claim.risk_tags.length > 5) {
        return fail(`${tag}.risk_tags must be an array of max 5 tags`);
      }
      for (const t of claim.risk_tags) {
        if (typeof t !== "string" || !BUNDLE_RISK_TAGS.has(t)) {
          return fail(`${tag}.risk_tags holds unknown tag ${JSON.stringify(t)}`);
        }
      }
    }
    if (claim.expected_values !== undefined && claim.expected_values !== null) {
      if (!Array.isArray(claim.expected_values) || claim.expected_values.length > 16) {
        return fail(`${tag}.expected_values must be an array of max 16 entries`);
      }
      for (let j = 0; j < claim.expected_values.length; j++) {
        const ev = claim.expected_values[j];
        const etag = `${tag}.expected_values[${j}]`;
        if (!isRecord(ev)) return fail(`${etag} must be an object`);
        if (typeof ev.role !== "string" || !AUDIT_VALUE_ROLES.has(ev.role)) {
          return fail(`${etag}.role must be one of ${[...AUDIT_VALUE_ROLES].join(", ")}`);
        }
        if (!isNonEmptyString(ev.value, 64)) {
          return fail(`${etag}.value must be a non-empty string of max 64 chars`);
        }
        if (ev.operator !== undefined && ev.operator !== null) {
          if (typeof ev.operator !== "string" || !AUDIT_VALUE_OPERATORS.has(ev.operator)) {
            return fail(`${etag}.operator must be one of <, <=, =, >=, >`);
          }
        } else if (ev.role === "p_threshold") {
          return fail(`${etag}: p_threshold requires operator "<" (e.g. value "0.001")`);
        }
      }
    }
    if (claim.context !== undefined && claim.context !== null && !isRecord(claim.context)) {
      return fail(`${tag}.context must be an object`);
    }
  }
  const evidenceIds = new Set<string>();
  for (let i = 0; i < evidenceList.length; i++) {
    const tag = `evidence[${i}]`;
    const record = evidenceList[i];
    if (!isRecord(record)) return fail(`${tag} must be an object`);
    if (!isNonEmptyString(record.evidence_id, 200)) {
      return fail(`${tag}.evidence_id must be a non-empty string of max 200 chars`);
    }
    if (evidenceIds.has(record.evidence_id)) {
      return fail(`evidence_id values must be distinct (duplicate ${record.evidence_id})`);
    }
    evidenceIds.add(record.evidence_id);
    if (typeof record.item_key !== "string" || !MANIFEST_ITEM_KEY_RE.test(record.item_key)) {
      return fail(`${tag}.item_key must be an 8-character key`);
    }
    if (typeof record.route !== "string" || !BUNDLE_ROUTES.has(record.route)) {
      return fail(`${tag}.route must be one of ${[...BUNDLE_ROUTES].join(", ")}`);
    }
    if (!isNonEmptyString(record.locator, 500)) {
      return fail(`${tag}.locator must be a non-empty string of max 500 chars`);
    }
    if (record.page !== undefined && record.page !== null) {
      if (!Number.isInteger(record.page) || (record.page as number) < 1) {
        return fail(`${tag}.page must be a one-based integer when present`);
      }
    }
    if (record.quote !== undefined && record.quote !== null && typeof record.quote !== "string") {
      return fail(`${tag}.quote must be a string`);
    }
    if (typeof record.quote === "string" && record.quote.length > 2000) {
      return fail(`${tag}.quote must be at most 2000 chars`);
    }
    for (const hashField of ["content_hash", "source_hash"] as const) {
      const hash = record[hashField];
      if (hash !== undefined && hash !== null && !(typeof hash === "string" && /^[0-9a-fA-F]{64}$/.test(hash))) {
        return fail(`${tag}.${hashField} must be a 64-char hex hash`);
      }
    }
  }
  if (allowedItemKeys !== undefined && allowedItemKeys !== null) {
    const allowedList = parseMaybeJson(allowedItemKeys);
    if (!Array.isArray(allowedList) || allowedList.length > 20) {
      return fail("allowed_item_keys must be an array of max 20 keys");
    }
    const normalized = allowedList.map((key) => String(key ?? "").toUpperCase());
    if (new Set(normalized).size !== normalized.length) {
      return fail("allowed_item_keys must be distinct");
    }
    for (const key of normalized) {
      if (!MANIFEST_ITEM_KEY_RE.test(key)) {
        return fail(`allowed_item_keys must contain exact parent item keys (bad: ${JSON.stringify(key)})`);
      }
    }
  }
  return { ok: true };
}

/**
 * Pre-dispatch shape check for `zotero_validate_comparison_manifest`
 * payloads. Mirrors ComparisonManifestRequest in the fork: key distinctness,
 * card coverage shape, result-role fields, route-prefixed evidence_ids, and
 * winner/policy enums. Unrecognized shapes pass through.
 */
export function checkComparisonManifestPayload(manifest: unknown): { ok: true } | { ok: false; reason: string } {
  const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  const parsed = parseMaybeJson(manifest);
  // Unparseable JSON strings pass through so the server owns that error.
  if (typeof manifest === "string" && parsed === manifest) return { ok: true };
  const m = parsed;
  if (!isRecord(m)) return fail("manifest must be an object");
  if (!Array.isArray(m.frozen_item_keys) || m.frozen_item_keys.length < 1 || m.frozen_item_keys.length > 500) {
    return fail("frozen_item_keys must contain 1-500 keys");
  }
  const frozenKeys = m.frozen_item_keys.map((key) => String(key ?? "").toUpperCase());
  if (new Set(frozenKeys).size !== frozenKeys.length) return fail("frozen_item_keys must be distinct");
  for (const key of frozenKeys) {
    if (!MANIFEST_ITEM_KEY_RE.test(key)) return fail(`frozen_item_keys must be 8-character keys (bad: ${key})`);
  }
  if (!Array.isArray(m.cards) || m.cards.length < 1 || m.cards.length > 500) {
    return fail("cards must contain 1-500 entries");
  }
  const cardKeys = new Set<string>();
  for (let i = 0; i < m.cards.length; i++) {
    const tag = `cards[${i}]`;
    const card = m.cards[i];
    if (!isRecord(card)) return fail(`${tag} must be an object`);
    if (typeof card.item_key !== "string" || !MANIFEST_ITEM_KEY_RE.test(card.item_key)) {
      return fail(`${tag}.item_key must be an 8-character key`);
    }
    const upper = card.item_key.toUpperCase();
    if (cardKeys.has(upper)) return fail(`cards must contain one entry per item_key (duplicate ${upper})`);
    cardKeys.add(upper);
    if (typeof card.status !== "string" || !COMPARISON_CARD_STATUSES.has(card.status)) {
      return fail(`${tag}.status must be one of ${[...COMPARISON_CARD_STATUSES].join(", ")}`);
    }
    if (card.results !== undefined && card.results !== null) {
      if (!Array.isArray(card.results) || card.results.length > 100) {
        return fail(`${tag}.results must be an array of max 100 records`);
      }
      const resultIds = new Set<string>();
      for (let j = 0; j < card.results.length; j++) {
        const rtag = `${tag}.results[${j}]`;
        const result = card.results[j];
        if (!isRecord(result)) return fail(`${rtag} must be an object`);
        if (!isNonEmptyString(result.result_id, 100)) {
          return fail(`${rtag}.result_id must be a non-empty string of max 100 chars`);
        }
        if (resultIds.has(result.result_id)) {
          return fail(`${tag} result_id values must be distinct (duplicate ${result.result_id})`);
        }
        resultIds.add(result.result_id);
        if (typeof result.result_class !== "string" || !COMPARISON_RESULT_CLASSES.has(result.result_class)) {
          return fail(`${rtag}.result_class must be one of ${[...COMPARISON_RESULT_CLASSES].join(", ")}`);
        }
        for (const field of [
          "outcome",
          "point_estimate",
          "scale",
          "uncertainty",
          "treatment",
          "dose",
          "denominator",
          "population",
          "geography",
          "time_horizon",
          "specification",
        ] as const) {
          const max = field === "outcome" || field === "treatment" || field === "dose" || field === "denominator" || field === "population" ? 500 : 300;
          if (!isNonEmptyString(result[field], max)) {
            return fail(`${rtag}.${field} must be a non-empty string`);
          }
        }
        if (!Array.isArray(result.evidence_ids) || result.evidence_ids.length < 1 || result.evidence_ids.length > 8) {
          return fail(`${rtag}.evidence_ids must contain 1-8 entries`);
        }
        if (new Set(result.evidence_ids).size !== result.evidence_ids.length) {
          return fail(`${rtag}.evidence_ids must be distinct`);
        }
        const invalid = result.evidence_ids.filter(
          (id) => typeof id !== "string" || !MANIFEST_LOCATOR_RE.test(id)
        );
        if (invalid.length) {
          return fail(
            `${rtag}.evidence_ids entries must be route-prefixed retained-evidence IDs or locators ` +
              `(e.g. 'zr1:0:KEY#12:<hash>', 'pdf:KEY:p12:label', 'mineru:KEY:line7'); rejected: ${invalid.slice(0, 5).join(", ")}`
          );
        }
      }
    }
    for (const field of ["primary_result_id", "maximum_substantive_result_id", "selected_result_id"] as const) {
      if (card[field] !== undefined && card[field] !== null && !isNonEmptyString(card[field], 100)) {
        return fail(`${tag}.${field} must be a string of max 100 chars`);
      }
    }
    if (card.inventory_locators !== undefined && card.inventory_locators !== null) {
      if (!Array.isArray(card.inventory_locators) || card.inventory_locators.length > 20) {
        return fail(`${tag}.inventory_locators must be an array of max 20 entries`);
      }
      if (new Set(card.inventory_locators).size !== card.inventory_locators.length) {
        return fail(`${tag}.inventory_locators must be distinct`);
      }
      for (const locator of card.inventory_locators) {
        if (!isNonEmptyString(locator, 500)) {
          return fail(`${tag}.inventory_locators must be non-empty strings of at most 500 chars`);
        }
      }
    }
    if (card.reason !== undefined && card.reason !== null && !isNonEmptyString(card.reason, 1000)) {
      return fail(`${tag}.reason must be a non-empty string of max 1000 chars`);
    }
  }
  if (!isNonEmptyString(m.ranking_rule, 1500)) {
    return fail("ranking_rule must be a non-empty string of max 1500 chars");
  }
  if (typeof m.eligible_result_policy !== "string" || !ELIGIBILITY_POLICIES.has(m.eligible_result_policy)) {
    return fail(`eligible_result_policy must be one of ${[...ELIGIBILITY_POLICIES].join(", ")}`);
  }
  if (m.conclusion_scope !== undefined && m.conclusion_scope !== "complete" && m.conclusion_scope !== "verified_only") {
    return fail('conclusion_scope must be "complete" or "verified_only"');
  }
  if (m.winner_type !== undefined && m.winner_type !== "clear_winner" && m.winner_type !== "top_k") {
    return fail('winner_type must be "clear_winner" or "top_k"');
  }
  for (const field of ["numerical_winner_status", "substantive_winner_status"] as const) {
    if (typeof m[field] !== "string" || !WINNER_STATUSES.has(m[field])) {
      return fail(`${field} must be one of clear, not_clear`);
    }
  }
  if (typeof m.alternative_policy_changes_top_k !== "boolean") {
    return fail("alternative_policy_changes_top_k must be a boolean");
  }
  if (m.max_reported_items !== undefined && m.max_reported_items !== null) {
    if (!Number.isInteger(m.max_reported_items) || (m.max_reported_items as number) < 1 || (m.max_reported_items as number) > 3) {
      return fail("max_reported_items must be an integer 1-3");
    }
  }
  if (!Array.isArray(m.selected_item_keys) || m.selected_item_keys.length < 1 || m.selected_item_keys.length > 3) {
    return fail("selected_item_keys must contain 1-3 keys");
  }
  const selected = m.selected_item_keys.map((key) => String(key ?? "").toUpperCase());
  if (new Set(selected).size !== selected.length) return fail("item keys must be distinct (selected_item_keys)");
  if (m.reported_item_keys !== undefined && m.reported_item_keys !== null) {
    if (!Array.isArray(m.reported_item_keys) || m.reported_item_keys.length > 3) {
      return fail("reported_item_keys must be an array of max 3 keys");
    }
    const reported = m.reported_item_keys.map((key) => String(key ?? "").toUpperCase());
    if (new Set(reported).size !== reported.length) return fail("item keys must be distinct (reported_item_keys)");
  }
  return { ok: true };
}

/* ----------------------------- Budget guard ----------------------------- */

/** Default worst-case response estimate above which collect_result_evidence is blocked. */
export const DEFAULT_EVIDENCE_BUDGET_CHARS = 120000;
export const EVIDENCE_BUDGET_ENV_VAR = "PI_ZOTERO_EVIDENCE_BUDGET_CHARS";
/** Compact mode caps each route read at this many characters (fork constant). */
const COMPACT_ROUTE_CHARS = 1200;
/** JSON keys, provenance, and metadata add roughly this much over raw text. */
const RESPONSE_OVERHEAD = 1.3;

function intIn(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * Worst-case response estimate for a `zotero_collect_result_evidence` call.
 * Each route read is bounded by max_chars_per_route (1200 in compact mode);
 * sidecar queries may also chain one continuation read. The estimate is
 * intentionally the upper bound: actual responses are usually smaller, but a
 * blocked call costs one line while an oversized response costs the session.
 */
export function estimateResultEvidenceChars(args: Record<string, unknown>): number {
  const requestsRaw = parseMaybeJson(args.requests);
  if (!Array.isArray(requestsRaw)) return 0;
  const mcr = Math.min(Math.max(intIn(args.max_chars_per_route, 8000), 512), 16000);
  const routeChars = args.compact === true ? Math.min(mcr, COMPACT_ROUTE_CHARS) : mcr;
  let routeReads = 0;
  for (const request of requestsRaw) {
    if (!isRecord(request)) continue;
    if (typeof request.evidence_id === "string" && request.evidence_id) routeReads += 1;
    if (Array.isArray(request.sidecar_queries)) routeReads += 2 * request.sidecar_queries.length;
    if (Array.isArray(request.pdf_queries)) routeReads += request.pdf_queries.length;
  }
  return Math.ceil(routeReads * routeChars * RESPONSE_OVERHEAD);
}

/**
 * Pre-dispatch retrieval-budget guard for `zotero_collect_result_evidence`.
 * Skipped when the caller already set max_total_chars: the server then trims
 * deterministically and mints continuation tokens, which bounds the response
 * mechanically. Over-budget calls are blocked with a one-line split recipe.
 */
export function checkResultEvidenceBudget(
  args: Record<string, unknown>,
  budgetChars: number = DEFAULT_EVIDENCE_BUDGET_CHARS
): { blocked: boolean; reason?: string; estimate: number } {
  if (args.max_total_chars !== undefined && args.max_total_chars !== null) {
    return { blocked: false, estimate: 0 };
  }
  const estimate = estimateResultEvidenceChars(args);
  if (estimate <= budgetChars) return { blocked: false, estimate };
  return {
    blocked: true,
    estimate,
    reason:
      `zotero_collect_result_evidence estimate ${estimate} chars exceeds the ${budgetChars}-char budget. ` +
      `Split the batch: fewer items or queries per call, lower max_chars_per_route, compact=true, ` +
      `or set max_total_chars so the server trims and returns a continuation token.`,
  };
}

/* ----------------------- Duplicate-retrieval nudge ---------------------- */

function normalizeQueryPart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Normalized identity of one bounded retrieval: operation, item key,
 * attachment, query, page range/offset, and expected hash. Null for calls
 * that do not retrieve source text. Identical signatures across two calls
 * mean the second call re-read evidence the session already holds.
 */
export function retrievalSignature(toolName: unknown, input: unknown): string | null {
  const { server, operation, args } = parseMcpCall(toolName, input);
  if (server !== "zotero") return null;
  const key = normalizeQueryPart(args.item_key ?? args.source_key);
  switch (operation) {
    case "find_in_item":
      return `find_in_item|${key}|${normalizeQueryPart(args.query)}|${args.start_char ?? ""}|${args.expected_hash ?? ""}|${args.start_line ?? ""}|${args.end_line ?? ""}`;
    case "find_in_pdf":
      return `find_in_pdf|${key}|${normalizeQueryPart(args.attachment_key)}|${normalizeQueryPart(args.query)}|${args.start_page ?? ""}|${args.end_page ?? ""}|${args.offset ?? ""}`;
    case "read_passage":
      return `read_passage|${normalizeQueryPart(args.evidence_id)}|${intIn(args.neighbors, 1)}`;
    case "read_pdf_pages":
      return `read_pdf_pages|${key}|${normalizeQueryPart(args.attachment_key)}|${args.start_page ?? ""}|${args.end_page ?? ""}`;
    case "semantic_search": {
      const keys = Array.isArray(args.item_keys)
        ? args.item_keys.map(normalizeQueryPart).sort().join(",")
        : "";
      const collection = normalizeQueryPart(args.collection ?? args.collection_key);
      return `semantic_search|${normalizeQueryPart(args.query)}|${keys}|${collection}|${args.limit ?? ""}`;
    }
    case "collect_result_evidence": {
      const requestsRaw = parseMaybeJson(args.requests);
      const token = normalizeQueryPart(args.continuation_token);
      if (token) return `collect_result_evidence|token:${token}`;
      if (!Array.isArray(requestsRaw)) return null;
      const parts = requestsRaw.map((request) => {
        if (!isRecord(request)) return "?";
        const sidecar = Array.isArray(request.sidecar_queries)
          ? request.sidecar_queries.map(normalizeQueryPart).join("+")
          : "";
        const pdf = Array.isArray(request.pdf_queries) ? request.pdf_queries.map(normalizeQueryPart).join("+") : "";
        return `${normalizeQueryPart(request.item_key)}:${normalizeQueryPart(request.evidence_id)}:${sidecar}:${pdf}:${request.pdf_start_page ?? ""}-${request.pdf_end_page ?? ""}`;
      });
      return `collect_result_evidence|${parts.join("|")}`;
    }
    default:
      return null;
  }
}

export const RETRIEVAL_SIGNATURE_MAP_LIMIT = 300;
/** Emit the reuse nudge on the 2nd and 3rd identical read, then fall silent. */
export const RETRIEVAL_DUPLICATE_WARN_MAX = 2;

/**
 * One-line post-tool nudge when a retrieval repeats an identical earlier
 * read. Non-blocking: legitimate alternate routes are never blocked, and the
 * nudge falls silent after RETRIEVAL_DUPLICATE_WARN_MAX repeats.
 */
export function duplicateRetrievalNote(
  signature: string | null,
  seen: Map<string, number>
): string | null {
  if (!signature) return null;
  const count = seen.get(signature) ?? 0;
  seen.set(signature, count + 1);
  if (seen.size > RETRIEVAL_SIGNATURE_MAP_LIMIT) {
    const oldest = seen.keys().next().value;
    if (oldest !== undefined && oldest !== signature) seen.delete(oldest);
  }
  if (count < 1 || count > RETRIEVAL_DUPLICATE_WARN_MAX) return null;
  return (
    `[Duplicate Retrieval] This exact retrieval was already collected this session. ` +
    `Reuse the existing evidence (or expand the retained ID) instead of re-reading; ` +
    `repeat identical lookups spend calls without adding support.`
  );
}

/* ------------------------- Evidence-conflict note ----------------------- */

const EVIDENCE_CONFLICT_CODES = [
  "NUMERIC_SIGNATURE_MISMATCH",
  "SIGNIFICANCE_MARKER_MISMATCH",
  "REFERENCED_TABLE_NOT_READ",
  "PDF_SEARCH_INCOMPLETE",
  "INCOMPLETE_PDF_TEXT_NO_MATCH",
];

/**
 * Compact post-tool warning for `zotero_collect_result_evidence` responses
 * that carry conflict flags (signs, significance markers, unread result
 * tables, incomplete PDF coverage). The server reports these deep in the JSON
 * response; the hook surfaces one line so they are resolved with a rendered
 * page or source-page read before ranking. Silent when nothing conflicts.
 */
export function resultEvidenceConflictNote(
  toolName: unknown,
  input: unknown,
  isError: unknown,
  content: unknown
): string | null {
  if (isError === true) return null;
  const { server, operation } = parseMcpCall(toolName, input);
  if (server !== "zotero" || operation !== "collect_result_evidence") return null;
  const text = resultText(content);
  if (!text) return null;
  const found = EVIDENCE_CONFLICT_CODES.filter((code) => text.includes(code));
  const followUp = /"requires_follow_up"\s*:\s*true/.test(text) || /"requires_visual_review"\s*:\s*true/.test(text);
  if (found.length === 0 && !followUp) return null;
  const keys = new Set<string>();
  const keyRe = /"item_key"\s*:\s*"([A-Za-z0-9]{8})"/g;
  let match: RegExpExecArray | null;
  while ((match = keyRe.exec(text)) !== null) keys.add(match[1]);
  const scope = keys.size ? `item(s) ${[...keys].join(", ")}` : "this response";
  const codes = found.length ? ` ${found.join(", ")}` : "";
  return (
    `[Evidence Conflicts] ${scope}:${codes} route disagreement or an unread referenced table needs ` +
    `resolution (rendered page image or targeted source-page read) before any ranking; ` +
    `text-route agreement is not image inspection.`
  );
}

