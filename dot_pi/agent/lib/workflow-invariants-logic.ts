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

  if (toolName === "mcp__zotero") {
    const op = typeof record.tool === "string" ? record.tool : "";
    return { server: "zotero", operation: stripServerPrefix(op, "zotero"), args: mcpArgs(record) };
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

