import { randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const RUNTIME_OWNER_PID_ENV = "PI_SESSION_RUNTIME_OWNER_PID";
const RUNTIME_ID_ENV = "PI_SESSION_RUNTIME_ID";
const PERMISSION_CONFIG_PATH_ENV = "PI_PERMISSION_SYSTEM_CONFIG_PATH";
const PERMISSION_LOGS_DIR_ENV = "PI_PERMISSION_SYSTEM_LOGS_DIR";

const BASE_AGENT_DIR = getAgentDir();
const RUNTIME_BASE_DIR = join(BASE_AGENT_DIR, "runtime");
const SESSION_RUNTIME_ROOT = join(RUNTIME_BASE_DIR, "sessions");
const CURRENT_PID = String(process.pid);
const inheritedRuntimeOwner = process.env[RUNTIME_OWNER_PID_ENV]?.trim();
const configuredPermissionConfigPath = process.env[PERMISSION_CONFIG_PATH_ENV]?.trim();
const inheritedRuntimeId = process.env[RUNTIME_ID_ENV]?.trim();
const RUNTIME_ID_PATTERN = /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hasValidRuntimeId = Boolean(inheritedRuntimeId && RUNTIME_ID_PATTERN.test(inheritedRuntimeId));
const isInheritedRuntime = Boolean(inheritedRuntimeOwner && inheritedRuntimeOwner !== CURRENT_PID);
const expectedInheritedConfigPath = hasValidRuntimeId
  ? join(SESSION_RUNTIME_ROOT, inheritedRuntimeId!, "permission-system.json")
  : undefined;

function existingRuntimePathIsSafe(path: string): boolean {
  for (const candidate of [BASE_AGENT_DIR, RUNTIME_BASE_DIR, SESSION_RUNTIME_ROOT, path]) {
    try {
      const stats = lstatSync(candidate);
      if (stats.isSymbolicLink() || !stats.isDirectory()) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }
  }
  return true;
}

const reusesOwnedRuntime = Boolean(
  inheritedRuntimeOwner === CURRENT_PID
    && hasValidRuntimeId
    && configuredPermissionConfigPath === expectedInheritedConfigPath
    && existingRuntimePathIsSafe(join(SESSION_RUNTIME_ROOT, inheritedRuntimeId!)),
);
const hasRuntimeMetadata = Boolean(inheritedRuntimeOwner || inheritedRuntimeId);
const createsFreshRuntime = isInheritedRuntime
  || !configuredPermissionConfigPath
  || (hasRuntimeMetadata && !reusesOwnedRuntime);
const runtimeId = reusesOwnedRuntime || createsFreshRuntime
  ? (reusesOwnedRuntime ? inheritedRuntimeId! : `${process.pid}-${randomUUID()}`)
  : `${process.pid}-${randomUUID()}`;
const ownsSessionRuntime = reusesOwnedRuntime || createsFreshRuntime;

// Environment variables are process-local, but child Pi processes inherit them.
// A child never owns the inherited path: it gets a fresh generated ID and owns
// only that new path. A same-process reload may reuse the path whose owner PID
// and generated ID already match this process.
if (ownsSessionRuntime) {
  process.env[RUNTIME_OWNER_PID_ENV] = CURRENT_PID;
  process.env[RUNTIME_ID_ENV] = runtimeId;
}
// A long-running Pi process from the retired advisor setup can pass
// its process-local override into child sessions. rpiv-advisor does not use
// it, so remove the legacy variable at the process boundary.
delete process.env.PI_ADVISOR_FLOW_CONFIG_PATH;

export const SESSION_RUNTIME_DIR = join(SESSION_RUNTIME_ROOT, runtimeId);
export const SESSION_PERMISSION_CONFIG_PATH = join(
  SESSION_RUNTIME_DIR,
  "permission-system.json",
);
export const SESSION_PERMISSION_LOGS_DIR = join(
  SESSION_RUNTIME_DIR,
  "permission-logs",
);
export const SESSION_RUNTIME_OWNED = ownsSessionRuntime;

const permissionDefaultsPath = join(
  BASE_AGENT_DIR,
  "npm",
  "node_modules",
  "pi-permission-system",
  "config.json",
);

function ensureDirectory(path: string, mode = 0o700): boolean {
  try {
    const parent = dirname(path);
    const parentStats = lstatSync(parent);
    if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) return false;
  } catch {
    return false;
  }

  try {
    const existing = lstatSync(path);
    if (existing.isSymbolicLink() || !existing.isDirectory()) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    try {
      mkdirSync(path, { mode });
    } catch {
      return false;
    }
  }

  try {
    chmodSync(path, mode);
    const verified = lstatSync(path);
    return !verified.isSymbolicLink() && verified.isDirectory();
  } catch {
    return false;
  }
}

function copyFileIfMissing(sourcePath: string, destinationPath: string, fallback: string): boolean {
  try {
    const existing = lstatSync(destinationPath);
    if (existing.isSymbolicLink()) {
      unlinkSync(destinationPath);
    } else {
      if (!existing.isFile()) return false;
      try {
        chmodSync(destinationPath, 0o600);
      } catch {
        return false;
      }
      return true;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    // The destination is absent; the atomic write below will create it safely.
  }

  if (!ensureDirectory(dirname(destinationPath))) return false;
  const temporaryPath = `${destinationPath}.tmp-${process.pid}`;
  try {
    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, temporaryPath);
    } else {
      writeFileSync(temporaryPath, fallback, { encoding: "utf8", mode: 0o600 });
    }
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, destinationPath);
    return true;
  } catch {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Best-effort cleanup.
    }
    return false;
  }
}

const STALE_RUNTIME_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function cleanupStaleSessionRuntimes(): void {
  try {
    for (const directory of [BASE_AGENT_DIR, RUNTIME_BASE_DIR, SESSION_RUNTIME_ROOT]) {
      const stats = lstatSync(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) return;
    }

    for (const entry of readdirSync(SESSION_RUNTIME_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === runtimeId) continue;
      const match = /^(\d+)-[0-9a-f-]+$/i.exec(entry.name);
      if (!match || isProcessAlive(Number(match[1]))) continue;

      const candidate = join(SESSION_RUNTIME_ROOT, entry.name);
      const stats = lstatSync(candidate);
      if (stats.isSymbolicLink() || !stats.isDirectory()) continue;
      if (Date.now() - stats.mtimeMs < STALE_RUNTIME_RETENTION_MS) continue;
      rmSync(candidate, { recursive: true, force: true });
    }
  } catch {
    // Stale-state collection is best effort and must never block Pi startup.
  }
}

cleanupStaleSessionRuntimes();

// Establish all per-process paths before package extensions are imported.
if (ownsSessionRuntime) {
  const runtimeDirectoriesReady = ensureDirectory(RUNTIME_BASE_DIR)
    && ensureDirectory(SESSION_RUNTIME_ROOT)
    && ensureDirectory(SESSION_RUNTIME_DIR)
    && ensureDirectory(SESSION_PERMISSION_LOGS_DIR);

  const runtimeConfigReady = runtimeDirectoriesReady && copyFileIfMissing(
    permissionDefaultsPath,
    SESSION_PERMISSION_CONFIG_PATH,
    `${JSON.stringify({
      enabled: true,
      debug: false,
      yoloMode: false,
      forwardedPromptTimeoutSeconds: 30,
    }, null, 2)}\n`,
  );

  if (runtimeConfigReady) {
    process.env[PERMISSION_CONFIG_PATH_ENV] = SESSION_PERMISSION_CONFIG_PATH;
    process.env[PERMISSION_LOGS_DIR_ENV] = SESSION_PERMISSION_LOGS_DIR;
  } else {
    // Never leave inherited paths active when the private runtime could not be
    // established safely (for example, because a path component is a symlink).
    delete process.env[PERMISSION_CONFIG_PATH_ENV];
    delete process.env[PERMISSION_LOGS_DIR_ENV];
  }
}

function isOwnedRuntimePath(): boolean {
  if (!SESSION_RUNTIME_OWNED) return false;
  if (process.env[RUNTIME_OWNER_PID_ENV]?.trim() !== CURRENT_PID) return false;
  if (process.env[RUNTIME_ID_ENV]?.trim() !== runtimeId) return false;
  if (process.env[PERMISSION_CONFIG_PATH_ENV]?.trim() !== SESSION_PERMISSION_CONFIG_PATH) return false;

  const root = resolve(SESSION_RUNTIME_ROOT);
  const candidate = resolve(SESSION_RUNTIME_DIR);
  const relativeCandidate = relative(root, candidate);
  if (!relativeCandidate || relativeCandidate.startsWith("..") || isAbsolute(relativeCandidate)) return false;

  try {
    const agentStats = lstatSync(resolve(BASE_AGENT_DIR));
    const baseStats = lstatSync(resolve(RUNTIME_BASE_DIR));
    const rootStats = lstatSync(root);
    const candidateStats = lstatSync(candidate);
    if (agentStats.isSymbolicLink() || !agentStats.isDirectory()) return false;
    if (baseStats.isSymbolicLink() || !baseStats.isDirectory()) return false;
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) return false;
    if (candidateStats.isSymbolicLink() || !candidateStats.isDirectory()) return false;
    if ((baseStats.mode & 0o077) !== 0 || (rootStats.mode & 0o077) !== 0 || (candidateStats.mode & 0o077) !== 0) return false;
  } catch {
    return false;
  }

  return true;
}

export function cleanupSessionRuntime(): void {
  // Runtime files intentionally survive session replacement/reload and child
  // Agent session shutdowns. Only the owning OS process may remove them.
  if (!isOwnedRuntimePath()) return;

  try {
    rmSync(SESSION_RUNTIME_DIR, { recursive: true, force: true });
  } catch {
    // Cleanup must never prevent Pi from shutting down.
  }
}

// `session_shutdown(reason: "quit")` is also emitted for in-process child
// Agent sessions. Process exit is the only lifecycle signal that unambiguously
// owns this process-local directory.
if (SESSION_RUNTIME_OWNED) {
  process.once("exit", cleanupSessionRuntime);
}
