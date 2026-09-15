import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  LINTED_PLAN_ENTRY_TYPE,
  LINTED_PLAN_RESET_ENTRY_TYPE,
  PLAN_FORMAT_VERSION,
  PLAN_HARD_MAX_EXECUTION_UNITS,
  PLAN_INTAKE_COMPLETE_ENTRY_TYPE,
  PLAN_SOFT_MAX_EXECUTION_UNITS,
  SAVED_PLAN_ENTRY_TYPE,
  SAVED_PLANS_DIRECTORY,
  buildLintCorrectionPrompt,
  buildLintPlanPrompt,
  buildLoadPlanPrompt,
  extractAssistantText,
  findLatestLintedPlan,
  parsePlanFrontmatter,
  parseSavedPlanDocument,
  preparePlanSave,
  rankPlanCandidates,
  slugifyPlanTitle,
  validateStructuredPlan,
  type LintedPlanRecord,
  type ParsedSavedPlan,
  type PlanCandidate,
  type PlanSessionEntry,
  type PreparedPlanSave,
} from "../lib/save-plan-logic.ts";
import {
  beginPlanIntake,
  clearPlanIntake,
  getPlanIntake,
  recordPlanIntakeProgress,
  type PlanIntakeState,
} from "../lib/plan-workflow-state.ts";

export type PlanDispatcher = (prompt: string) => void;

export interface SavePlanContext {
  hasUI: boolean;
  ui: {
    notify(message: string, level: "error" | "info" | "warning"): void;
    confirm?(title: string, message: string): Promise<boolean>;
    select?(title: string, options: string[]): Promise<string | undefined>;
  };
  sessionManager: {
    getBranch(): readonly PlanSessionEntry[];
    getSessionName?: () => string | undefined;
    getSessionId?: () => string | undefined;
  };
}

export interface PlanFileSystem {
  access(path: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, content: string, encoding: "utf8"): Promise<void>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Array<string | { name: string; isFile(): boolean }>>;
  stat(path: string): Promise<{ mtimeMs: number }>;
}

const nodeFileSystem: PlanFileSystem = {
  access,
  mkdir,
  readFile: readFile as PlanFileSystem["readFile"],
  writeFile: writeFile as PlanFileSystem["writeFile"],
  readdir: readdir as unknown as PlanFileSystem["readdir"],
  stat: stat as PlanFileSystem["stat"],
};

const DEFAULT_VAULT_ROOT = join(homedir(), "Dropbox", "Sam-Obsidian-Vault");
const INTAKE_METADATA_SOURCE = "plan_source";
const INTAKE_METADATA_STEP = "plan_step_id";

interface SavePlanOptions {
  fileSystem?: PlanFileSystem;
  vaultRoot?: string;
  now?: Date;
  sourceModel?: string;
  sourceEffort?: string;
}

interface ParsedCommandArgs {
  value: string;
  overwrite: boolean;
  allowMany: boolean;
}

export interface SavedPlanFile {
  absolutePath: string;
  candidate: PlanCandidate;
  plan: ParsedSavedPlan;
}

function notify(ctx: SavePlanContext, message: string, level: "error" | "info" | "warning"): void {
  if (ctx.hasUI) ctx.ui.notify(message, level);
}

function sessionId(ctx: SavePlanContext | undefined): string | undefined {
  try {
    return ctx?.sessionManager.getSessionId?.();
  } catch {
    return undefined;
  }
}

function parseCommandArgs(args: string, flags: readonly string[]): ParsedCommandArgs {
  let value = args.trim();
  const parsed: ParsedCommandArgs = { value: "", overwrite: false, allowMany: false };
  for (const flag of flags) {
    const pattern = new RegExp(`(?:^|\\s)${flag}(?=\\s|$)`, "g");
    if (pattern.test(value)) {
      if (flag === "--overwrite") parsed.overwrite = true;
      if (flag === "--allow-many") parsed.allowMany = true;
      value = value.replace(pattern, " ").trim();
    }
  }
  parsed.value = value;
  return parsed;
}

export function resolveVaultRoot(): string {
  const configured = process.env.OBSIDIAN_VAULT_PATH?.trim();
  return configured || DEFAULT_VAULT_ROOT;
}

function savedPlansRoot(vaultRoot: string): string {
  return resolve(vaultRoot, SAVED_PLANS_DIRECTORY);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT");
}

function modelKey(model: unknown): string | undefined {
  if (!model || typeof model !== "object") return undefined;
  const provider = (model as { provider?: unknown }).provider;
  const id = (model as { id?: unknown }).id;
  if (typeof provider === "string" && typeof id === "string") return `${provider}/${id}`;
  return typeof id === "string" ? id : undefined;
}

function currentLintedPlan(ctx: SavePlanContext): LintedPlanRecord | undefined {
  return findLatestLintedPlan(ctx.sessionManager.getBranch());
}

/** Save the most recent successful /lint-plan result directly to the vault. */
export async function savePlan(
  args: string,
  ctx: SavePlanContext,
  options: SavePlanOptions = {},
): Promise<PreparedPlanSave | undefined> {
  const command = parseCommandArgs(args, ["--overwrite"]);
  if (getPlanIntake(sessionId(ctx))) {
    notify(ctx, "Cannot save a plan while plan intake is active.", "error");
    return undefined;
  }
  const linted = currentLintedPlan(ctx);
  if (!linted) {
    notify(ctx, "No successful /lint-plan result in the active branch. Run /lint-plan before /save-plan.", "error");
    return undefined;
  }
  if (command.value && slugifyPlanTitle(command.value) !== slugifyPlanTitle(linted.title)) {
    notify(ctx, "The save title differs from the linted plan title. Use the linted title or lint the desired plan scope first.", "error");
    return undefined;
  }

  let prepared = preparePlanSave({
    markdown: linted.markdown,
    title: command.value || linted.title,
    sessionName: ctx.sessionManager.getSessionName?.(),
    sessionId: linted.sourceSession || sessionId(ctx),
    sourceModel: options.sourceModel,
    sourceEffort: options.sourceEffort,
    qualification: linted.qualification,
    now: options.now,
  });
  if (!prepared) {
    notify(ctx, "The linted plan could not be prepared for saving.", "error");
    return undefined;
  }

  const fsApi = options.fileSystem ?? nodeFileSystem;
  const absolutePath = resolve(options.vaultRoot ?? resolveVaultRoot(), prepared.path);
  try {
    await fsApi.mkdir(dirname(absolutePath), { recursive: true });

    let alreadyExists = false;
    try {
      await fsApi.access(absolutePath);
      alreadyExists = true;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }

    if (alreadyExists && !command.overwrite) {
      if (!ctx.hasUI || !ctx.ui.confirm) {
        notify(ctx, `Plan already exists at ${prepared.path}; use /save-plan --overwrite to replace it.`, "error");
        return undefined;
      }
      const approved = await ctx.ui.confirm(
        "Replace saved plan?",
        `${prepared.path} already exists. Replace it with this canonical plan?`,
      );
      if (!approved) {
        notify(ctx, "Saved plan unchanged.", "info");
        return undefined;
      }
    }

    // Stable filenames make a saved plan a revision of the same artifact. Keep
    // its original creation time while advancing updated on replacement.
    if (alreadyExists) {
      const existing = parsePlanFrontmatter(await fsApi.readFile(absolutePath, "utf8"));
      const createdAt = typeof existing.metadata.created === "string" ? existing.metadata.created : undefined;
      if (createdAt) {
        const revised = preparePlanSave({
          markdown: linted.markdown,
          title: command.value || linted.title,
          sessionName: ctx.sessionManager.getSessionName?.(),
          sessionId: linted.sourceSession || sessionId(ctx),
          sourceModel: options.sourceModel,
          sourceEffort: options.sourceEffort,
          qualification: linted.qualification,
          createdAt,
          now: options.now,
        });
        if (revised) prepared = revised;
      }
    }

    await fsApi.writeFile(absolutePath, prepared.content, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    notify(ctx, `Could not save plan to ${prepared.path}: ${detail}`, "error");
    return undefined;
  }

  notify(ctx, `Saved plan: ${prepared.path}`, "info");
  return prepared;
}

function candidateDate(candidate: PlanCandidate): number {
  const parsed = candidate.updatedAt ? Date.parse(candidate.updatedAt) : NaN;
  return Number.isFinite(parsed) ? parsed : candidate.modifiedAt;
}

function planDisplayLabel(file: SavedPlanFile): string {
  const date = new Date(candidateDate(file.candidate));
  const dateLabel = Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16).replace("T", " ") : "unknown date";
  const validity = file.plan.ok ? "" : "  [invalid]";
  return `${dateLabel}  ${file.plan.title || file.candidate.title}${validity}  (${file.candidate.path})`;
}

/** Read and sort all saved plan notes, newest first. */
export async function listSavedPlans(
  vaultRoot = resolveVaultRoot(),
  fileSystem: PlanFileSystem = nodeFileSystem,
): Promise<SavedPlanFile[]> {
  const directory = savedPlansRoot(vaultRoot);
  let entries: Array<string | { name: string; isFile(): boolean }>;
  try {
    entries = await fileSystem.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }

  const plans: SavedPlanFile[] = [];
  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry.name;
    if (!name.endsWith(".md") || (typeof entry !== "string" && !entry.isFile())) continue;

    const absolutePath = join(directory, name);
    try {
      const [content, stats] = await Promise.all([
        fileSystem.readFile(absolutePath, "utf8"),
        fileSystem.stat(absolutePath),
      ]);
      const relativePath = `${SAVED_PLANS_DIRECTORY}/${name}`;
      const plan = parseSavedPlanDocument(content, relativePath);
      const fallbackTitle = basename(name, ".md").replace(/-/g, " ");
      plans.push({
        absolutePath,
        plan,
        candidate: {
          path: relativePath,
          title: plan.title || fallbackTitle,
          updatedAt: plan.updatedAt,
          modifiedAt: stats.mtimeMs,
          status: plan.status,
          valid: plan.ok,
        },
      });
    } catch {
      // A partially synced or unreadable note should not prevent the picker from
      // showing the other plans. It is represented as absent until it is readable.
    }
  }

  plans.sort((a, b) => candidateDate(b.candidate) - candidateDate(a.candidate));
  return plans;
}

async function chooseSavedPlan(
  args: string,
  ctx: SavePlanContext,
  options: { fileSystem?: PlanFileSystem; vaultRoot?: string } = {},
): Promise<SavedPlanFile | undefined> {
  const command = parseCommandArgs(args, ["--allow-many"]);
  const plans = await listSavedPlans(options.vaultRoot, options.fileSystem);
  if (plans.length === 0) {
    notify(ctx, `No saved plans found under ${SAVED_PLANS_DIRECTORY}.`, "error");
    return undefined;
  }

  const ranked = rankPlanCandidates(plans.map((plan) => plan.candidate), command.value);
  if (ranked.length === 0) {
    notify(ctx, `No saved plans match '${command.value}'.`, "error");
    return undefined;
  }
  const byPath = new Map(plans.map((plan) => [plan.candidate.path, plan]));
  const candidates = ranked.map((candidate) => byPath.get(candidate.path)!).filter(Boolean);

  if (!ctx.hasUI || !ctx.ui.select) {
    if (candidates.length === 1) return candidates[0];
    notify(ctx, "An interactive picker is required when more than one saved plan matches.", "error");
    return undefined;
  }

  const labels = candidates.map(planDisplayLabel);
  const selectedLabel = await ctx.ui.select("Load plan", labels);
  if (!selectedLabel) {
    notify(ctx, "Plan loading cancelled.", "info");
    return undefined;
  }
  const selectedIndex = labels.indexOf(selectedLabel);
  return selectedIndex >= 0 ? candidates[selectedIndex] : undefined;
}

function todoTasksFromResult(result: unknown): Array<{ status?: string; metadata?: Record<string, unknown> }> {
  if (!result || typeof result !== "object") return [];
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return [];
  const tasks = (details as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks.filter((task): task is { status?: string; metadata?: Record<string, unknown> } => Boolean(task) && typeof task === "object");
}

function loadedStepIds(state: PlanIntakeState, result: unknown): Set<string> {
  const expected = new Set(state.expectedStepIds);
  const loaded = new Set<string>();
  for (const task of todoTasksFromResult(result)) {
    if (task.status === "deleted") continue;
    const metadata = task.metadata;
    if (!metadata || metadata[INTAKE_METADATA_SOURCE] !== state.planPath) continue;
    const stepId = metadata[INTAKE_METADATA_STEP];
    if (typeof stepId === "string" && expected.has(stepId)) loaded.add(stepId);
  }
  return loaded;
}

export async function loadPlan(
  args: string,
  ctx: SavePlanContext,
  dispatch: PlanDispatcher,
  options: { fileSystem?: PlanFileSystem; vaultRoot?: string } = {},
): Promise<ParsedSavedPlan | undefined> {
  const command = parseCommandArgs(args, ["--allow-many"]);
  const existingIntake = getPlanIntake(sessionId(ctx));
  if (existingIntake) {
    notify(ctx, `Plan intake is already active for ${existingIntake.planPath}.`, "error");
    return undefined;
  }

  let selected: SavedPlanFile | undefined;
  try {
    selected = await chooseSavedPlan(command.value, ctx, options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    notify(ctx, `Could not list saved plans: ${detail}`, "error");
    return undefined;
  }
  if (!selected) return undefined;

  const plan = selected.plan;
  if (!plan.ok) {
    const details = plan.issues.slice(0, 6).join(" ");
    notify(ctx, `Cannot load ${plan.path}: it is not a valid structured saved plan. ${details}`, "error");
    return undefined;
  }
  if (plan.units.length > PLAN_HARD_MAX_EXECUTION_UNITS) {
    notify(ctx, `Cannot load ${plan.path}: it exceeds the hard execution-unit limit.`, "error");
    return undefined;
  }

  const warnings = [...plan.warnings];
  if (plan.units.length > PLAN_SOFT_MAX_EXECUTION_UNITS) {
    warnings.push(`it contains ${plan.units.length} execution units; the recommended maximum is ${PLAN_SOFT_MAX_EXECUTION_UNITS}`);
  }
  if (warnings.length > 0 && !command.allowMany) {
    if (!ctx.hasUI || !ctx.ui.confirm) {
      notify(ctx, `Plan requires confirmation before loading: ${warnings.join("; ")}`, "error");
      return undefined;
    }
    const approved = await ctx.ui.confirm(
      "Load a large or granular plan?",
      `${plan.path}: ${warnings.join("; ")}. Load it into todo anyway?`,
    );
    if (!approved) {
      notify(ctx, "Plan loading cancelled.", "info");
      return undefined;
    }
  }

  const state = beginPlanIntake({
    sessionId: sessionId(ctx),
    planPath: plan.path,
    planTitle: plan.title,
    expectedStepIds: plan.units.map((unit) => unit.id),
  });
  try {
    dispatch(buildLoadPlanPrompt(plan));
  } catch (error) {
    clearPlanIntake(state.sessionId);
    const detail = error instanceof Error ? error.message : String(error);
    notify(ctx, `Could not start plan intake: ${detail}`, "error");
    return undefined;
  }

  notify(ctx, `Loading ${plan.path} into todo; execution is blocked until intake completes.`, "info");
  return plan;
}

export default function savePlanExtension(pi: ExtensionAPI): void {
  let pendingLint: {
    sourceSession?: string;
    qualification: string;
    candidate?: string;
    retryCount: number;
  } | undefined;

  pi.on("message_end", (event: any) => {
    if (!pendingLint) return;
    if (event?.message?.role !== "assistant") return;
    const text = extractAssistantText({ type: "message", message: event.message });
    if (text) pendingLint.candidate = text;
  });

  pi.on("agent_settled", async (_event: any, ctx: any) => {
    if (pendingLint) {
      const current = pendingLint;
      const candidate = current.candidate?.trim();
      if (!candidate) {
        pendingLint = undefined;
        notify(ctx, "No planner response was captured for /lint-plan.", "error");
      } else {
        const parsed = validateStructuredPlan(candidate);
        if (!parsed.ok && current.retryCount < 1) {
          pendingLint = { ...current, candidate: undefined, retryCount: current.retryCount + 1 };
          try {
            pi.sendUserMessage(buildLintCorrectionPrompt(parsed.issues, parsed.warnings, current.qualification), { deliverAs: "followUp" });
            notify(ctx, "The planner response failed the plan format check; requesting one correction.", "warning");
          } catch (error) {
            pendingLint = undefined;
            const detail = error instanceof Error ? error.message : String(error);
            notify(ctx, `Could not request a corrected plan: ${detail}`, "error");
          }
        } else if (!parsed.ok) {
          pendingLint = undefined;
          notify(ctx, `Plan lint failed: ${parsed.issues.slice(0, 6).join(" ")}`, "error");
        } else {
          const record: LintedPlanRecord = {
            format: PLAN_FORMAT_VERSION,
            title: parsed.title,
            markdown: candidate,
            lintedAt: new Date().toISOString(),
            sourceSession: current.sourceSession,
            qualification: current.qualification || undefined,
            warnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
          };
          pendingLint = undefined;
          try {
            pi.appendEntry(LINTED_PLAN_ENTRY_TYPE, record);
            const warningSuffix = parsed.warnings.length > 0 ? ` Warnings: ${parsed.warnings.join("; ")}` : "";
            notify(ctx, `Plan linted: ${parsed.title} (${parsed.units.length} execution units).${warningSuffix}`, "info");
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            notify(ctx, `Plan passed linting but could not be recorded: ${detail}`, "error");
          }
        }
      }
    }

    const intake = getPlanIntake(sessionId(ctx));
    if (intake) {
      if (intake.complete) {
        clearPlanIntake(intake.sessionId);
        try {
          pi.appendEntry(PLAN_INTAKE_COMPLETE_ENTRY_TYPE, {
            format: PLAN_FORMAT_VERSION,
            path: intake.planPath,
            title: intake.planTitle,
            stepIds: [...intake.expectedStepIds],
          });
        } catch {
          // The todo state is already loaded; the custom audit marker is best effort.
        }
        notify(ctx, `Loaded ${intake.expectedStepIds.length} plan units into todo. No execution was started.`, "info");
      } else {
        const missing = intake.expectedStepIds.filter((stepId) => !intake.loadedStepIds.includes(stepId));
        clearPlanIntake(intake.sessionId);
        notify(ctx, `Plan intake stopped before all units were represented in todo. Missing: ${missing.join(", ")}.`, "error");
      }
    }
  });

  pi.on("tool_execution_end", (event: any, ctx: any) => {
    if (event?.toolName !== "todo" || event?.isError === true) return;
    const intake = getPlanIntake(sessionId(ctx));
    if (!intake) return;

    const observed = loadedStepIds(intake, event.result);
    recordPlanIntakeProgress(sessionId(ctx), [...observed]);
    // Keep the intake guard active until agent_settled. In automatic modes the
    // model could otherwise receive the final todo result and immediately start
    // executing before this turn has ended.
  });

  pi.registerCommand("lint-plan", {
    description: "Lint a selected plan edition or conversation scope into a strict structured plan document (usage: /lint-plan [qualification])",
    handler: async (args, ctx) => {
      if (getPlanIntake(sessionId(ctx))) {
        notify(ctx, "Cannot lint while plan intake is active.", "error");
        return;
      }
      if (pendingLint) {
        notify(ctx, "A /lint-plan request is already waiting for a planner response.", "error");
        return;
      }
      try {
        pi.appendEntry(LINTED_PLAN_RESET_ENTRY_TYPE, {
          format: PLAN_FORMAT_VERSION,
          sourceSession: sessionId(ctx),
          qualification: args.trim() || undefined,
          requestedAt: new Date().toISOString(),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        notify(ctx, `Could not invalidate the previous canonical plan: ${detail}`, "error");
        return;
      }
      pendingLint = {
        sourceSession: sessionId(ctx),
        qualification: args.trim(),
        retryCount: 0,
      };
      try {
        pi.sendUserMessage(buildLintPlanPrompt(args), { deliverAs: "followUp" });
        notify(ctx, "Requested a scoped canonical plan; waiting for the planner response.", "info");
      } catch (error) {
        pendingLint = undefined;
        const detail = error instanceof Error ? error.message : String(error);
        notify(ctx, `Could not start /lint-plan: ${detail}`, "error");
      }
    },
  });

  pi.registerCommand("save-plan", {
    description: "Save the last successful /lint-plan result to Obsidian (usage: /save-plan [--overwrite]; title comes from /lint-plan)",
    handler: async (args, ctx) => {
      const prepared = await savePlan(args, ctx, {
        sourceModel: modelKey(ctx.model),
        sourceEffort: String(ctx.thinkingLevel ?? ""),
      });
      if (!prepared) return;
      try {
        pi.appendEntry(SAVED_PLAN_ENTRY_TYPE, {
          format: PLAN_FORMAT_VERSION,
          path: prepared.path,
          title: prepared.title,
          sourceSession: sessionId(ctx),
        });
      } catch {
        // The note is already saved; the session audit marker is best effort.
      }
    },
  });

  pi.registerCommand("load-plan", {
    description: "Pick, validate, and intake a structured saved plan into todo (usage: /load-plan [query] [--allow-many])",
    handler: async (args, ctx) => {
      await loadPlan(args, ctx, (prompt) => {
        pi.sendUserMessage(prompt, { deliverAs: "followUp" });
      });
    },
  });
}
