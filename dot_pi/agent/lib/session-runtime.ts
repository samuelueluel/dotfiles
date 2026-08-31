import { randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";

const RUNTIME_OWNER_PID_ENV = "PI_SESSION_RUNTIME_OWNER_PID";
const RUNTIME_ID_ENV = "PI_SESSION_RUNTIME_ID";
const PERMISSION_CONFIG_PATH_ENV = "PI_PERMISSION_SYSTEM_CONFIG_PATH";
const PERMISSION_LOGS_DIR_ENV = "PI_PERMISSION_SYSTEM_LOGS_DIR";
export const ADVISOR_CONFIG_PATH_ENV = "PI_ADVISOR_FLOW_CONFIG_PATH";

const BASE_AGENT_DIR = getAgentDir();
const CURRENT_PID = String(process.pid);
const inheritedRuntimeOwner = process.env[RUNTIME_OWNER_PID_ENV];
const isInheritedRuntime = Boolean(inheritedRuntimeOwner && inheritedRuntimeOwner !== CURRENT_PID);
const RUNTIME_ID_PATTERN = /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inheritedRuntimeId = process.env[RUNTIME_ID_ENV]?.trim();
const hasValidRuntimeId = Boolean(inheritedRuntimeId && RUNTIME_ID_PATTERN.test(inheritedRuntimeId));

const runtimeId = isInheritedRuntime || !hasValidRuntimeId
  ? `${process.pid}-${randomUUID()}`
  : inheritedRuntimeId!;

// Environment variables are process-local, but child Pi processes inherit them.
// Keep the owner PID alongside the ID so a child gets a fresh runtime instead
// of accidentally sharing its parent's permission/advisor files.
process.env[RUNTIME_OWNER_PID_ENV] = CURRENT_PID;
process.env[RUNTIME_ID_ENV] = runtimeId;

const SESSION_RUNTIME_ROOT = join(BASE_AGENT_DIR, "runtime", "sessions");
export const SESSION_RUNTIME_DIR = join(SESSION_RUNTIME_ROOT, runtimeId);
export const SESSION_PERMISSION_CONFIG_PATH = join(
  SESSION_RUNTIME_DIR,
  "permission-system.json",
);
export const SESSION_PERMISSION_LOGS_DIR = join(
  SESSION_RUNTIME_DIR,
  "permission-logs",
);
export const SESSION_ADVISOR_DIR = join(SESSION_RUNTIME_DIR, "advisor");
export const SESSION_ADVISOR_CONFIG_PATH = join(SESSION_ADVISOR_DIR, "advisor.json");

const permissionDefaultsPath = join(
  BASE_AGENT_DIR,
  "npm",
  "node_modules",
  "pi-permission-system",
  "config.json",
);
const advisorDefaultsPath = join(BASE_AGENT_DIR, "advisor.json");
const advisorPackageRoot = join(
  BASE_AGENT_DIR,
  "npm",
  "node_modules",
  "pi-advisor-flow",
);
const advisorPackageConfigPath = join(advisorPackageRoot, "src", "config.ts");
const advisorPackageManifestPath = join(advisorPackageRoot, "package.json");

const ADVISOR_CONFIG_PATCH_MARKER = "PI_ADVISOR_FLOW_CONFIG_PATH";
const ADVISOR_CONFIG_PATH_CALL = "getAdvisorConfigPath()";
const ADVISOR_CONFIG_PATH_COUNT = 4;
// Keep this in lockstep with the exact package source pinned in settings.json.
const ADVISOR_PACKAGE_VERSION = "0.5.0";
const ADVISOR_PATCH_LOCK_SUFFIX = ".pi-isolation-lock";
const ADVISOR_PATCH_LOCK_ATTEMPTS = 200;
const ADVISOR_PATCH_LOCK_WAIT_MS = 25;
const ADVISOR_PATCH_STALE_LOCK_MS = 30_000;

function ensureDirectory(path: string): boolean {
  try {
    const existing = lstatSync(path);
    if (existing.isSymbolicLink() || !existing.isDirectory()) return false;
  } catch {
    // The directory may not exist yet; mkdirSync below handles that case.
  }

  try {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
    return true;
  } catch {
    return false;
  }
}

function copyFileIfMissing(sourcePath: string, destinationPath: string, fallback: string): void {
  try {
    const existing = lstatSync(destinationPath);
    if (existing.isSymbolicLink()) {
      unlinkSync(destinationPath);
    } else {
      return;
    }
  } catch {
    // The destination is absent or not yet accessible; the atomic write below
    // will fail closed if the path cannot be created safely.
  }

  if (!ensureDirectory(dirname(destinationPath))) return;
  const temporaryPath = `${destinationPath}.tmp-${process.pid}`;
  try {
    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, temporaryPath);
    } else {
      writeFileSync(temporaryPath, fallback, { encoding: "utf8", mode: 0o600 });
    }
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, destinationPath);
  } catch {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Best-effort cleanup.
    }
  }
}

/**
 * Add the small config-path seam that pi-advisor-flow does not currently
 * expose. The package is still installed and updated by Pi; this idempotent
 * atomic patch is reapplied after an update before the package is loaded.
 */
function advisorSourceError(configPath: string, source: string): string | undefined {
  if (source.includes(ADVISOR_CONFIG_PATCH_MARKER)) {
    const patchedOccurrences = source.split(ADVISOR_CONFIG_PATH_CALL).length - 1;
    return patchedOccurrences === ADVISOR_CONFIG_PATH_COUNT
      ? undefined
      : `Unsupported pi-advisor-flow config module at '${configPath}': its local config-path patch is incomplete.`;
  }

  const oldCall = 'join(getAgentDir(), "advisor.json")';
  const occurrences = source.split(oldCall).length - 1;
  if (occurrences !== ADVISOR_CONFIG_PATH_COUNT) {
    return `Unsupported pi-advisor-flow config module at '${configPath}': expected ${ADVISOR_CONFIG_PATH_COUNT} advisor.json path sites, found ${occurrences}.`;
  }

  return source.includes("export const configPaths = (ctx: ExtensionContext) => [")
    ? undefined
    : `Unsupported pi-advisor-flow config module at '${configPath}': configPaths export not found.`;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function advisorPackageVersionError(configPath: string): string | undefined {
  if (configPath !== advisorPackageConfigPath) return undefined;

  try {
    const manifest = JSON.parse(readFileSync(advisorPackageManifestPath, "utf8")) as {
      version?: unknown;
    };
    if (manifest.version === ADVISOR_PACKAGE_VERSION) return undefined;
    return `Unsupported pi-advisor-flow version at '${advisorPackageManifestPath}': expected ${ADVISOR_PACKAGE_VERSION}, found ${String(manifest.version)}.`;
  } catch (error) {
    return `Cannot read pi-advisor-flow package manifest '${advisorPackageManifestPath}': ${String(error)}`;
  }
}

function advisorPatchTargetError(configPath: string): string | undefined {
  try {
    const stats = lstatSync(configPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      return `Cannot patch pi-advisor-flow config module '${configPath}': the target is not a regular file.`;
    }
  } catch (error) {
    return `Cannot inspect pi-advisor-flow config module '${configPath}': ${String(error)}`;
  }
  return undefined;
}

const advisorPatchWaitCell = new Int32Array(new SharedArrayBuffer(4));

function releaseAdvisorPatchLock(lockPath: string): void {
  try {
    const stats = lstatSync(lockPath);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      rmSync(lockPath, { recursive: true, force: true });
    }
  } catch {
    // Best-effort lock cleanup.
  }
}

function removeStaleAdvisorPatchLock(lockPath: string): boolean {
  try {
    const stats = lstatSync(lockPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) return false;

    let ownerPid: number | undefined;
    try {
      const parsed = Number.parseInt(readFileSync(join(lockPath, "owner"), "utf8"), 10);
      if (Number.isSafeInteger(parsed) && parsed > 0) ownerPid = parsed;
    } catch {
      // A just-created lock may not have published its owner yet.
    }

    const stale = ownerPid === undefined
      ? Date.now() - stats.mtimeMs >= ADVISOR_PATCH_STALE_LOCK_MS
      : !isProcessAlive(ownerPid);
    if (!stale) return false;
    releaseAdvisorPatchLock(lockPath);
    return true;
  } catch {
    return false;
  }
}

function acquireAdvisorPatchLock(lockPath: string): string | undefined {
  for (let attempt = 0; attempt < ADVISOR_PATCH_LOCK_ATTEMPTS; attempt += 1) {
    let created = false;
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      created = true;
      writeFileSync(join(lockPath, "owner"), CURRENT_PID, { encoding: "utf8", mode: 0o600 });
      return undefined;
    } catch (error) {
      if (created) releaseAdvisorPatchLock(lockPath);
      if (errorCode(error) !== "EEXIST") {
        return `Cannot lock pi-advisor-flow config module '${lockPath}': ${String(error)}`;
      }
      if (!removeStaleAdvisorPatchLock(lockPath)) {
        Atomics.wait(advisorPatchWaitCell, 0, 0, ADVISOR_PATCH_LOCK_WAIT_MS);
      }
    }
  }

  return `Timed out waiting for the pi-advisor-flow config patch lock '${lockPath}'.`;
}

export function ensureAdvisorConfigPathSupport(
  configPath = advisorPackageConfigPath,
): string | undefined {
  const versionError = advisorPackageVersionError(configPath);
  if (versionError) return versionError;
  const targetError = advisorPatchTargetError(configPath);
  if (targetError) return targetError;

  let source: string;
  try {
    source = readFileSync(configPath, "utf8");
  } catch (error) {
    return `Cannot read pi-advisor-flow config module '${configPath}': ${String(error)}`;
  }

  const sourceError = advisorSourceError(configPath, source);
  if (sourceError) return sourceError;
  if (source.includes(ADVISOR_CONFIG_PATCH_MARKER)) return undefined;

  const lockPath = `${configPath}${ADVISOR_PATCH_LOCK_SUFFIX}`;
  const lockError = acquireAdvisorPatchLock(lockPath);
  if (lockError) return lockError;

  try {
    // Re-read after locking so a concurrent Pi process can finish the patch
    // while this process waits without either writer using stale source.
    const lockedTargetError = advisorPatchTargetError(configPath);
    if (lockedTargetError) return lockedTargetError;
    source = readFileSync(configPath, "utf8");
    const currentSourceError = advisorSourceError(configPath, source);
    if (currentSourceError) return currentSourceError;
    if (source.includes(ADVISOR_CONFIG_PATCH_MARKER)) return undefined;

    const insertionMarker = "export const configPaths = (ctx: ExtensionContext) => [";
    const insertionPoint = source.indexOf(insertionMarker);
    const helper = [
      `export const ADVISOR_CONFIG_PATH_ENV_KEY = ${JSON.stringify(ADVISOR_CONFIG_PATH_ENV)};`,
      `export const getAdvisorConfigPath = () =>`,
      `  process.env[ADVISOR_CONFIG_PATH_ENV_KEY]?.trim() || join(getAgentDir(), "advisor.json");`,
      "",
    ].join("\n");
    const oldCall = 'join(getAgentDir(), "advisor.json")';
    const patched =
      source.slice(0, insertionPoint) +
      helper +
      source.slice(insertionPoint).replaceAll(oldCall, ADVISOR_CONFIG_PATH_CALL);
    if (patched.split(oldCall).length - 1 !== 1 || patched.split(ADVISOR_CONFIG_PATH_CALL).length - 1 !== ADVISOR_CONFIG_PATH_COUNT) {
      return `Unsupported pi-advisor-flow config module at '${configPath}': the local config-path replacement was incomplete.`;
    }
    const mode = lstatSync(configPath).mode & 0o777;
    const temporaryPath = `${configPath}.tmp-${process.pid}-${runtimeId}`;

    try {
      writeFileSync(temporaryPath, patched, "utf8");
      chmodSync(temporaryPath, mode || 0o600);
      renameSync(temporaryPath, configPath);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Best-effort cleanup.
      }
      return `Cannot patch pi-advisor-flow config module '${configPath}': ${String(error)}`;
    }

    const verified = readFileSync(configPath, "utf8");
    return advisorSourceError(configPath, verified);
  } catch (error) {
    return `Cannot verify pi-advisor-flow config module '${configPath}': ${String(error)}`;
  } finally {
    releaseAdvisorPatchLock(lockPath);
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
if (isInheritedRuntime || !process.env[PERMISSION_CONFIG_PATH_ENV]?.trim()) {
  ensureDirectory(SESSION_RUNTIME_ROOT);
  ensureDirectory(SESSION_RUNTIME_DIR);
  copyFileIfMissing(
    permissionDefaultsPath,
    SESSION_PERMISSION_CONFIG_PATH,
    `${JSON.stringify({
      enabled: true,
      debug: false,
      yoloMode: false,
      forwardedPromptTimeoutSeconds: 30,
    }, null, 2)}\n`,
  );
  process.env[PERMISSION_CONFIG_PATH_ENV] = SESSION_PERMISSION_CONFIG_PATH;
}
if (isInheritedRuntime || !process.env[PERMISSION_LOGS_DIR_ENV]?.trim()) {
  ensureDirectory(SESSION_PERMISSION_LOGS_DIR);
  process.env[PERMISSION_LOGS_DIR_ENV] = SESSION_PERMISSION_LOGS_DIR;
}
if (isInheritedRuntime || !process.env[ADVISOR_CONFIG_PATH_ENV]?.trim()) {
  ensureDirectory(SESSION_ADVISOR_DIR);
  copyFileIfMissing(advisorDefaultsPath, SESSION_ADVISOR_CONFIG_PATH, "{}\n");
  process.env[ADVISOR_CONFIG_PATH_ENV] = SESSION_ADVISOR_CONFIG_PATH;
}

export const advisorConfigIsolationError = ensureAdvisorConfigPathSupport();

export function getAdvisorConfigPath(): string {
  return process.env[ADVISOR_CONFIG_PATH_ENV]?.trim() || SESSION_ADVISOR_CONFIG_PATH;
}

export function cleanupSessionRuntime(): void {
  // Runtime files intentionally survive session replacement/reload so the
  // current Pi window retains its local backend settings. Pi calls this only
  // when the process itself is quitting.
  try {
    const stats = lstatSync(SESSION_RUNTIME_DIR);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      rmSync(SESSION_RUNTIME_DIR, { recursive: true, force: true });
    }
  } catch {
    // Cleanup must never prevent Pi from shutting down.
  }
}
