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
import { dirname, join } from "node:path";

const RUNTIME_OWNER_PID_ENV = "PI_SESSION_RUNTIME_OWNER_PID";
const RUNTIME_ID_ENV = "PI_SESSION_RUNTIME_ID";
const PERMISSION_CONFIG_PATH_ENV = "PI_PERMISSION_SYSTEM_CONFIG_PATH";
const PERMISSION_LOGS_DIR_ENV = "PI_PERMISSION_SYSTEM_LOGS_DIR";

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
// of accidentally sharing its parent's permission files.
process.env[RUNTIME_OWNER_PID_ENV] = CURRENT_PID;
process.env[RUNTIME_ID_ENV] = runtimeId;
// A long-running Pi process from the retired advisor setup can pass
// its process-local override into child sessions. rpiv-advisor does not use
// it, so remove the legacy variable at the process boundary.
delete process.env.PI_ADVISOR_FLOW_CONFIG_PATH;

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

const permissionDefaultsPath = join(
  BASE_AGENT_DIR,
  "npm",
  "node_modules",
  "pi-permission-system",
  "config.json",
);

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
