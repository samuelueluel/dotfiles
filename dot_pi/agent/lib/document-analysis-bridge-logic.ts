import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const DOCUMENT_ANALYSIS_ROOT = "/var/home/samuel/OpenWebUI-Access-Folder/document-analysis";
export const DOCUMENT_ANALYSIS_PARENT = "/var/home/samuel/OpenWebUI-Access-Folder";
export const JOB_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$";
const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const BINDING_SCHEMA_VERSION = 1;
const BINDING_LOCK_TTL_MS = 60_000;
const CLI_OPERATIONS = new Set(["list", "status", "show", "ingest", "enrich", "archive", "delete"]);

type ModelLike = {
  provider?: unknown;
  id?: unknown;
  baseUrl?: unknown;
};

export type Route = {
  classification: "local" | "nonlocal" | "unknown";
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
};

export type Binding = {
  schema_version: number;
  job_id: string;
  session_id: string;
  bound_at: string;
  provider: string;
  model: string;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function routeFor(ctx: Pick<ExtensionContext, "model">): Route {
  const model = (ctx.model ?? {}) as ModelLike;
  const provider = text(model.provider);
  const modelId = text(model.id);
  const baseUrl = text(model.baseUrl);
  if (!provider && !baseUrl) {
    return { classification: "unknown", provider, model: modelId, baseUrl };
  }

  const loopback = Boolean(
    baseUrl && /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(baseUrl),
  );
  const explicitLocalProvider = provider === "local" || provider === "llama.cpp";
  // A configured endpoint is authoritative. A provider name alone is only
  // enough for the explicitly local provider names; a local-looking provider
  // must not be able to disguise a cloud URL.
  const classification = baseUrl
    ? (loopback ? "local" : "nonlocal")
    : (explicitLocalProvider ? "local" : "nonlocal");
  return {
    classification,
    provider,
    model: modelId,
    baseUrl,
  };
}

export function buildCliArgs(root: string, operation: string, args: string[]): string[] {
  if (!CLI_OPERATIONS.has(operation)) throw new Error("unsupported document-analysis bridge operation.");
  return ["--root", root, operation, ...args];
}

function collectStrings(value: unknown, output: string[] = [], depth = 0): string[] {
  if (output.length >= 128 || depth > 5) return output;
  if (typeof value === "string") {
    output.push(value.slice(0, 4096));
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
    return output;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, output, depth + 1);
  }
  return output;
}

function canonicalExistingPath(candidate: string): string | undefined {
  let current = candidate;
  while (true) {
    try {
      const canonical = realpathSync(current);
      return current === candidate
        ? canonical
        : resolve(canonical, candidate.slice(current.length).replace(/^[/\\]+/, ""));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
      const parent = dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}

export function documentRootAccess(toolName: unknown, input: unknown, cwd: unknown): boolean {
  const name = typeof toolName === "string" ? toolName : "";
  const normalizedName = name.toLowerCase().replace(/-/g, "_");
  const filesystemTool = normalizedName.includes("filesystem");
  const values = collectStrings(input);
  if (typeof cwd === "string") values.push(cwd);
  const root = resolve(DOCUMENT_ANALYSIS_ROOT);
  for (const raw of values) {
    const value = raw.replace(/\\/g, "/");
    if (
      value.includes(DOCUMENT_ANALYSIS_ROOT)
      || value.includes(DOCUMENT_ANALYSIS_PARENT)
      || value.includes("OpenWebUI-Access-Folder/document-analysis")
      || (filesystemTool && /(?:^|\/)document-analysis(?:\/|$)/.test(value))
    ) {
      return true;
    }
    if (typeof cwd === "string") {
      const pathValue = value.replace(/^@(?=[/~])/, "");
      const candidate = pathValue.startsWith("/") ? resolve(pathValue) : resolve(cwd, pathValue);
      const canonical = canonicalExistingPath(candidate);
      if (
        candidate === root
        || candidate.startsWith(`${root}/`)
        || canonical === root
        || canonical?.startsWith(`${root}/`)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function requireKnownRoute(ctx: Pick<ExtensionContext, "model">): Route {
  const route = routeFor(ctx);
  if (route.classification === "unknown") {
    throw new Error(
      "document-analysis bridge cannot verify the active provider or endpoint; refusing to proceed.",
    );
  }
  return route;
}

export function requireSessionId(ctx: Pick<ExtensionContext, "sessionManager">): string {
  const manager = ctx.sessionManager as ExtensionContext["sessionManager"] & {
    getSessionId?: () => string | undefined;
  };
  const sessionId = typeof manager.getSessionId === "function" ? text(manager.getSessionId()) : null;
  if (!sessionId) {
    throw new Error("document-analysis bridge cannot verify the current Pi/cptr session; refusing to proceed.");
  }
  return sessionId;
}

export function validJobId(jobId: unknown): string {
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) {
    throw new Error("invalid job ID; use the exact returned document-analysis job ID.");
  }
  return jobId;
}

export function inboxFilename(value: unknown, inboxDir: string): string {
  if (typeof value !== "string") throw new Error("inbox_filename is required.");
  const candidate = value.trim().replace(/^@/, "");
  if (
    !candidate
    || candidate === "."
    || candidate === ".."
    || candidate.includes("\0")
    || candidate.includes("/")
    || candidate.includes("\\")
    || candidate.length > 255
  ) {
    throw new Error("inbox_filename must be one direct child filename in the canonical inbox.");
  }
  const resolved = resolve(inboxDir, candidate);
  if (resolved !== join(resolve(inboxDir), candidate)) {
    throw new Error("inbox_filename must be one direct child filename in the canonical inbox.");
  }
  return candidate;
}

async function candidateKind(path: string): Promise<"missing" | "directory" | "symlink" | "other"> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return "symlink";
    if (info.isDirectory()) return "directory";
    return "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

export function confinedJobPath(parent: string, jobIdInput: unknown): string {
  const jobId = validJobId(jobIdInput);
  const path = resolve(parent, jobId);
  const parentPath = resolve(parent);
  if (!path.startsWith(`${parentPath}/`) || path !== join(parentPath, jobId)) {
    throw new Error("job path is outside the canonical document-analysis workspace.");
  }
  return path;
}

export async function findJobDir(root: string, jobIdInput: unknown): Promise<string> {
  const jobId = validJobId(jobIdInput);
  const jobs = join(root, "jobs");
  const archive = join(root, "archive");
  const candidates = [confinedJobPath(jobs, jobId), confinedJobPath(archive, jobId)];
  const found: string[] = [];
  for (const candidate of candidates) {
    const kind = await candidateKind(candidate);
    if (kind === "symlink") throw new Error("refusing a job path that is a symlink.");
    if (kind === "other") throw new Error("job path is not a directory.");
    if (kind === "directory") found.push(candidate);
  }
  if (found.length === 0) throw new Error(`job not found: ${jobId}`);
  if (found.length !== 1) throw new Error("job ID exists in more than one canonical location.");
  return found[0];
}

async function analysisDirectory(jobDir: string, create: boolean): Promise<string | undefined> {
  const analysis = join(jobDir, "analysis");
  const analysisKind = await candidateKind(analysis);
  if (analysisKind === "symlink" || analysisKind === "other") {
    throw new Error("refusing a job with an unsafe analysis directory.");
  }
  if (analysisKind === "missing") {
    if (!create) return undefined;
    await mkdir(analysis, { recursive: true, mode: 0o700 });
  }
  const finalKind = await candidateKind(analysis);
  if (finalKind !== "directory") throw new Error("refusing an unsafe analysis directory.");
  return analysis;
}

async function existingBindingPath(root: string, jobIdInput: unknown): Promise<string | undefined> {
  const jobDir = await findJobDir(root, jobIdInput);
  const analysis = await analysisDirectory(jobDir, false);
  return analysis ? join(analysis, "cptr-session.json") : undefined;
}

async function ensureBindingPath(root: string, jobIdInput: unknown): Promise<string> {
  const jobDir = await findJobDir(root, jobIdInput);
  const analysis = await analysisDirectory(jobDir, true);
  if (!analysis) throw new Error("could not create the job analysis directory.");
  return join(analysis, "cptr-session.json");
}

async function acquireBindingLock(analysis: string): Promise<() => Promise<void>> {
  const lockPath = join(analysis, ".cptr-session.lock");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`);
      return async () => {
        try {
          await handle?.close();
        } finally {
          try {
            await unlink(lockPath);
          } catch {
            // The lock may already have been removed during shutdown.
          }
        }
      };
    } catch (error) {
      try {
        await handle?.close();
      } catch {
        // Continue with the original lock error.
      }
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt > 0) throw error;

      // A contender can observe the lock between O_EXCL creation and the
      // owner's metadata write. Fresh or unreadable metadata is busy, never
      // stale. Only an old lock with no live owner may be reclaimed.
      let stale = false;
      try {
        const info = await lstat(lockPath);
        if (Date.now() - info.mtimeMs > BINDING_LOCK_TTL_MS) {
          let pid = 0;
          try {
            const lock = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: unknown };
            pid = typeof lock.pid === "number" ? lock.pid : 0;
          } catch {
            pid = 0;
          }
          if (pid <= 0) {
            stale = true;
          } else {
            try {
              process.kill(pid, 0);
            } catch (probeError) {
              stale = (probeError as NodeJS.ErrnoException).code === "ESRCH";
            }
          }
        }
      } catch {
        // If the lock disappeared, the next attempt can acquire it. Any
        // other inspection failure remains fail-closed as busy.
        stale = false;
      }
      if (!stale) throw new Error("job session binding is busy; retry the operation.");
      try {
        await unlink(lockPath);
      } catch {
        throw new Error("job session binding is busy; retry the operation.");
      }
    }
  }
  throw new Error("job session binding is busy; retry the operation.");
}

export async function readBinding(root: string, jobIdInput: unknown): Promise<Binding | undefined> {
  const path = await existingBindingPath(root, jobIdInput);
  if (!path) return undefined;
  const kind = await candidateKind(path);
  if (kind === "missing") return undefined;
  if (kind !== "other") throw new Error("refusing an unsafe cptr session binding artifact.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("cptr session binding is missing or malformed.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("cptr session binding is malformed.");
  const value = parsed as Partial<Binding>;
  if (
    value.schema_version !== BINDING_SCHEMA_VERSION
    || typeof value.job_id !== "string"
    || typeof value.session_id !== "string"
    || typeof value.bound_at !== "string"
    || typeof value.provider !== "string"
    || typeof value.model !== "string"
  ) {
    throw new Error("cptr session binding is malformed.");
  }
  if (value.job_id !== validJobId(jobIdInput)) throw new Error("cptr session binding belongs to another job.");
  return value as Binding;
}

export async function bindJob(
  root: string,
  jobIdInput: unknown,
  sessionId: string,
  route: Route,
  allowRebind = false,
): Promise<{ jobId: string; sessionId: string; rebound: boolean }> {
  const jobId = validJobId(jobIdInput);
  if (!text(sessionId)) throw new Error("document-analysis bridge cannot verify the current Pi/cptr session; refusing to proceed.");
  const jobDir = await findJobDir(root, jobId);
  const analysis = await analysisDirectory(jobDir, true);
  if (!analysis) throw new Error("could not create the job analysis directory.");
  const release = await acquireBindingLock(analysis);
  try {
    const current = await readBinding(root, jobId);
    if (current && current.session_id !== sessionId && !allowRebind) {
      throw new Error(
        "job is bound to a different Pi/cptr session; use document_analysis_attach with rebind=true and the exact job ID.",
      );
    }
    if (current && current.session_id === sessionId) {
      return { jobId, sessionId, rebound: false };
    }

    const path = join(analysis, "cptr-session.json");
    const binding: Binding = {
      schema_version: BINDING_SCHEMA_VERSION,
      job_id: jobId,
      session_id: sessionId,
      bound_at: new Date().toISOString(),
      provider: route.provider ?? "unknown",
      model: route.model ?? "unknown",
    };
    const temporary = join(analysis, `.cptr-session-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, path);
    } finally {
      try {
        await unlink(temporary);
      } catch {
        // The atomic rename either completed or there was no temporary artifact.
      }
    }
    return { jobId, sessionId, rebound: Boolean(current) };
  } finally {
    await release();
  }
}

export function deleteCliArgs(
  jobIdInput: unknown,
  dryRun: boolean,
  confirmation: unknown,
): { jobId: string; args: string[] } {
  const jobId = validJobId(jobIdInput);
  if (!dryRun && confirmation !== jobId) {
    throw new Error("destructive deletion requires dry_run=true for a preview or confirm_job_id equal to the exact job_id.");
  }
  return { jobId, args: dryRun ? [jobId, "--dry-run"] : [jobId, "--confirm", jobId] };
}

export async function requireBound(
  root: string,
  jobIdInput: unknown,
  sessionId: string,
): Promise<string> {
  const jobId = validJobId(jobIdInput);
  if (!text(sessionId)) throw new Error("document-analysis bridge cannot verify the current Pi/cptr session; refusing to proceed.");
  const binding = await readBinding(root, jobId);
  if (!binding) {
    throw new Error("job is not bound to this Pi/cptr session; use document_analysis_attach first.");
  }
  if (binding.session_id !== sessionId) {
    throw new Error(
      "job is bound to a different Pi/cptr session; use document_analysis_attach with rebind=true and the exact job ID.",
    );
  }
  return jobId;
}
