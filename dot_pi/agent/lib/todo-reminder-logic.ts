export const DEFAULT_DRIFT_TOOL_THRESHOLD = 15;
export const MAX_DRIFT_TOOL_THRESHOLD = 100;
export const DEFAULT_MAX_NUDGES_PER_CYCLE = 2;
export const MAX_NUDGES_PER_CYCLE = 10;

export type TodoStatus = "pending" | "in_progress" | "completed" | "deleted";
export type ReminderReason = "drift" | "settled";

export interface TodoTaskRecord {
	readonly [key: string]: unknown;
	readonly id?: unknown;
	readonly status?: unknown;
	readonly blockedBy?: unknown;
}

export interface TodoSnapshot {
	readonly tasks: readonly TodoTaskRecord[];
	readonly nextId: number;
}

export interface TodoReminderConfig {
	readonly threshold: number;
	readonly maxNudgesPerCycle: number;
}

export interface ReminderPayload {
	readonly reason: ReminderReason;
	readonly actionCount: number;
}

export interface TodoReminderDiagnostics {
	readonly hasOpenWork: boolean;
	readonly actionsSinceMutation: number;
	readonly actionsSinceReminder: number;
	readonly nudgesThisCycle: number;
	readonly dueReason?: ReminderReason;
}

const READ_ONLY_TODO_ACTIONS = new Set(["list", "get"]);
const OPEN_STATUSES = new Set<TodoStatus>(["pending", "in_progress"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function cloneTask(value: unknown): TodoTaskRecord | undefined {
	const record = asRecord(value);
	return record ? { ...record } : undefined;
}

/** Parse the stable snapshot emitted by @juicesharp/rpiv-todo. */
export function parseTodoSnapshot(details: unknown): TodoSnapshot | undefined {
	const record = asRecord(details);
	if (!record || !Array.isArray(record.tasks)) return undefined;
	if (!Number.isSafeInteger(record.nextId) || (record.nextId as number) < 1) return undefined;

	const tasks: TodoTaskRecord[] = [];
	for (const task of record.tasks) {
		const cloned = cloneTask(task);
		if (!cloned) return undefined;
		tasks.push(cloned);
	}

	return { tasks, nextId: record.nextId as number };
}

/** Recover the latest valid todo snapshot from the active session branch. */
export function extractLatestTodoSnapshot(branch: Iterable<unknown>): TodoSnapshot | undefined {
	let latest: TodoSnapshot | undefined;

	for (const entry of branch) {
		const entryRecord = asRecord(entry);
		const message = asRecord(entryRecord?.message);
		if (message?.role !== "toolResult" || message.toolName !== "todo") continue;

		const snapshot = parseTodoSnapshot(message.details);
		if (snapshot) latest = snapshot;
	}

	return latest;
}

export function hasOpenTodoWork(snapshot: TodoSnapshot | undefined): boolean {
	return snapshot?.tasks.some((task) => OPEN_STATUSES.has(task.status as TodoStatus)) ?? false;
}

/**
 * Return true only when every open task is waiting on an unfinished dependency.
 * Missing dependencies are treated as blocking defensively; rpiv-todo normally
 * rejects dangling dependency references before they reach a snapshot.
 */
export function allOpenTodoWorkBlocked(snapshot: TodoSnapshot | undefined): boolean {
	if (!snapshot) return false;

	const openTasks = snapshot.tasks.filter((task) => OPEN_STATUSES.has(task.status as TodoStatus));
	if (openTasks.length === 0) return false;

	const byId = new Map<number, TodoTaskRecord>();
	for (const task of snapshot.tasks) {
		if (Number.isSafeInteger(task.id)) byId.set(task.id as number, task);
	}

	return openTasks.every((task) => {
		if (!Array.isArray(task.blockedBy) || task.blockedBy.length === 0) return false;
		return task.blockedBy.some((dependencyId) => {
			if (!Number.isSafeInteger(dependencyId)) return true;
			const dependency = byId.get(dependencyId as number);
			return !dependency || !["completed", "deleted"].includes(String(dependency.status));
		});
	});
}

export function todoSnapshotKey(snapshot: TodoSnapshot | undefined): string | undefined {
	return snapshot ? JSON.stringify(snapshot) : undefined;
}

export function todoSnapshotsDiffer(before: TodoSnapshot | undefined, after: TodoSnapshot): boolean {
	if (!before) return after.tasks.length > 0 || after.nextId !== 1;
	return todoSnapshotKey(before) !== todoSnapshotKey(after);
}

/**
 * Detect a real todo mutation. rpiv-todo reports reducer failures inside
 * details.error while still returning a normal tool result, so isError alone
 * is not sufficient. Snapshot comparison also filters no-op updates.
 */
export function isRealTodoMutation(
	before: TodoSnapshot | undefined,
	after: TodoSnapshot,
	details: unknown,
	toolFailed = false,
): boolean {
	if (toolFailed) return false;
	const record = asRecord(details);
	if (record && record.error !== undefined) return false;
	if (typeof record?.action === "string" && READ_ONLY_TODO_ACTIONS.has(record.action)) return false;
	return todoSnapshotsDiffer(before, after);
}

export function parseBoundedInteger(
	value: string | undefined,
	fallback: number,
	maximum: number,
): number {
	if (value === undefined || value.trim() === "") return fallback;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback;
}

export function readTodoReminderConfig(
	env: Readonly<Record<string, string | undefined>> = process.env,
): TodoReminderConfig {
	return {
		threshold: parseBoundedInteger(
			env.PI_TODO_DRIFT_THRESHOLD,
			DEFAULT_DRIFT_TOOL_THRESHOLD,
			MAX_DRIFT_TOOL_THRESHOLD,
		),
		maxNudgesPerCycle: parseBoundedInteger(
			env.PI_TODO_DRIFT_MAX_NUDGES,
			DEFAULT_MAX_NUDGES_PER_CYCLE,
			MAX_NUDGES_PER_CYCLE,
		),
	};
}

function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.map((part) => {
			const record = asRecord(part);
			return typeof record?.text === "string" ? record.text : "";
		})
		.filter(Boolean)
		.join("\n");
}

/** Conservative heuristic used only to suppress a settled reminder. */
export function assistantAppearsToAwaitUserInput(branch: Iterable<unknown>): boolean {
	const entries = Array.from(branch);
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = asRecord(entries[index]);
		const message = asRecord(entry?.message);
		if (message?.role !== "assistant") continue;

		const text = contentToText(message.content).trim();
		if (!text) return false;
		return (
			/\?\s*$/.test(text) ||
			/\b(?:waiting for|need (?:your|user)|please (?:provide|confirm|choose|tell)|let me know)\b/i.test(text)
		);
	}
	return false;
}

export class TodoReminderTracker {
	private readonly config: TodoReminderConfig;
	private snapshot: TodoSnapshot | undefined;
	private actionsSinceMutation = 0;
	private actionsSinceReminder = 0;
	private nudgesThisCycle = 0;
	private settledReminderUsed = false;
	private dueReason: ReminderReason | undefined;

	public constructor(config: TodoReminderConfig) {
		this.config = config;
	}

	public restore(snapshot: TodoSnapshot | undefined, options: { resetCycle?: boolean } = {}): void {
		this.snapshot = snapshot;
		this.actionsSinceMutation = 0;
		this.actionsSinceReminder = 0;
		this.dueReason = undefined;
		if (options.resetCycle !== false) {
			this.nudgesThisCycle = 0;
			this.settledReminderUsed = false;
		}
	}

	public resetRequestCycle(): void {
		this.nudgesThisCycle = 0;
		this.settledReminderUsed = false;
	}

	public observeTodoResult(details: unknown, toolFailed = false): boolean {
		const next = parseTodoSnapshot(details);
		if (!next) return false;

		const mutated = isRealTodoMutation(this.snapshot, next, details, toolFailed);
		this.snapshot = next;

		if (mutated) {
			this.actionsSinceMutation = 0;
			this.actionsSinceReminder = 0;
			this.dueReason = undefined;
		}

		if (!hasOpenTodoWork(this.snapshot)) {
			this.dueReason = undefined;
		}

		return mutated;
	}

	public observeSuccessfulAction(): void {
		if (!hasOpenTodoWork(this.snapshot)) return;

		this.actionsSinceMutation += 1;
		this.actionsSinceReminder += 1;
		if (
			this.actionsSinceReminder >= this.config.threshold &&
			this.nudgesThisCycle < this.config.maxNudgesPerCycle
		) {
			this.dueReason ??= "drift";
		}
	}

	public markSettled(options: { hasPendingMessages?: boolean; awaitingUserInput?: boolean } = {}): void {
		if (!hasOpenTodoWork(this.snapshot)) return;
		if (options.hasPendingMessages || options.awaitingUserInput) return;
		if (allOpenTodoWorkBlocked(this.snapshot)) return;
		if (this.settledReminderUsed || this.nudgesThisCycle >= this.config.maxNudgesPerCycle) return;

		this.dueReason ??= "settled";
	}

	public consumeReminder(): ReminderPayload | undefined {
		if (!this.dueReason || !hasOpenTodoWork(this.snapshot)) {
			this.dueReason = undefined;
			return undefined;
		}
		if (this.nudgesThisCycle >= this.config.maxNudgesPerCycle) {
			this.dueReason = undefined;
			return undefined;
		}

		const payload: ReminderPayload = {
			reason: this.dueReason,
			actionCount: this.actionsSinceMutation,
		};
		this.dueReason = undefined;
		this.nudgesThisCycle += 1;
		this.actionsSinceReminder = 0;
		if (payload.reason === "settled") this.settledReminderUsed = true;
		return payload;
	}

	public getDiagnostics(): TodoReminderDiagnostics {
		return {
			hasOpenWork: hasOpenTodoWork(this.snapshot),
			actionsSinceMutation: this.actionsSinceMutation,
			actionsSinceReminder: this.actionsSinceReminder,
			nudgesThisCycle: this.nudgesThisCycle,
			dueReason: this.dueReason,
		};
	}
}

export function renderTodoReminder(payload: ReminderPayload): string {
	if (payload.reason === "settled") {
		return (
			"[Todo Completion Check] The previous agent run settled while open todo work remains. " +
			"Before treating the request as complete, check the todo list; continue the active task " +
			"or update the plan if the scope has changed."
		);
	}

	return (
		`[Todo Alignment Check] You have completed ${payload.actionCount} successful tool actions since the last ` +
		"todo mutation. Verify that your current actions directly advance the active task and that you are not " +
		"caught in an unnecessary rabbit hole. Continue with your current step, or update your todo plan if the scope changed."
	);
}
