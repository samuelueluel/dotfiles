import * as os from "node:os";
import * as path from "node:path";

/** One state file per Pi session, independent of launch directory and other windows. */
export const STATE_DIRECTORY = path.join(os.homedir(), ".pi", "agent", "working-state");
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_STALENESS_THRESHOLD = 15;
export const MAX_STALENESS_THRESHOLD = 100;
export const DEFAULT_MAX_NUDGES_PER_CYCLE = 2;
export const MAX_NUDGES_PER_CYCLE = 10;
export const DEFAULT_PRE_COMPACT_TRIGGER_TOKENS = 230000;
export const DEFAULT_PRE_COMPACT_MARGIN_TOKENS = 40000;
export const MAX_PRE_COMPACT_MARGIN_TOKENS = 200000;
export const PRE_COMPACT_HYSTERESIS_TOKENS = 5000;

export interface WorkingStateConfig {
	readonly stalenessThreshold: number;
	readonly maxNudgesPerCycle: number;
	readonly preCompactMarginTokens: number;
	readonly preCompactTriggerTokens: number;
}

/** Narrow fs surface the tracker needs; injectable so logic tests run without a real filesystem. */
export interface WorkingStateFs {
	existsSync(path: string): boolean;
	statSync(path: string): { mtimeMs: number };
}

export interface WorkingStateDiagnostics {
	readonly sessionId: string | undefined;
	readonly stateFileExists: boolean;
	readonly actionsSinceWrite: number;
	readonly nudgesThisCycle: number;
	readonly compactionDue: boolean;
	readonly stalenessDue: boolean;
	readonly preCompactState: "idle" | "armed" | "fired";
}

export function stateFilePath(sessionId: string): string | undefined {
	return SESSION_ID_PATTERN.test(sessionId) ? path.join(STATE_DIRECTORY, `${sessionId}.md`) : undefined;
}

/**
 * Post-compaction / tree-restore nudge. Text forks on file existence:
 * - File exists: the agent must re-read and restore working state before continuing.
 * - File absent: creation is still prompted, because post-compaction is exactly
 *   where a forcing function must not depend on prior discipline.
 */
export function compactionNudgeText(stateFileExists: boolean, file: string): string {
	return stateFileExists
		? `[Working State] Post-compaction: re-read ${file} and restore working state — exact outcomes, decisions, open checks — before continuing.`
		: `[Working State] Post-compaction: if this session has state worth preserving (decisions, outcomes, ruled-out paths), create ${file} per the working-state skill.`;
}

export function stalenessNudgeText(actionsSinceWrite: number, file: string): string {
	return (
		`[Working State] ${file} hasn't been updated in ~${actionsSinceWrite} successful actions — ` +
		"record recent outcomes, decisions, or ruled-out paths while the details are fresh."
	);
}

function roundK(tokens: number): number {
	return Math.round(tokens / 1000);
}

/**
 * Pre-compaction warning nudge: fired while there is still runway before the
 * compaction trigger, so the agent writes the state file BEFORE the cut rather
 * than reconstructing from the preserved tail after it. Both texts are
 * deliberate: an existing file gets an update directive, an absent file gets a
 * creation directive — the last chance to capture decisions pre-compaction.
 */
export function preCompactNudgeText(
	tokens: number,
	triggerTokens: number,
	stateFileExists: boolean,
	file: string,
): string {
	const frame = `Context ≈${roundK(tokens)}k tokens, compaction trigger ≈${roundK(triggerTokens)}k`;
	return stateFileExists
		? `[Working State] ${frame}: update ${file} NOW — record decisions, outcomes, and open items from this stretch before compaction summarizes it away.`
		: `[Working State] ${frame}: if this session has state worth preserving (decisions, outcomes, ruled-out paths), create ${file} per the working-state skill before compaction.`;
}

/** chars/4 estimate over the LLM-bound message array; same estimator family blackhole uses on branches. */
export function estimateTokens(messages: unknown): number {
	let json: string;
	try {
		json = JSON.stringify(messages ?? []);
	} catch {
		return 0;
	}
	return Math.ceil(json.length / 4);
}

/** Trigger resolution: the launcher env owns the live threshold; the fallback is the lowest samuel-preset anchor. */
export function readPreCompactTriggerTokens(
	env: Readonly<Record<string, string | undefined>> = process.env,
): number {
	const raw = env.PI_BLACKHOLE_COMPACT_AFTER_TOKENS;
	if (raw !== undefined) {
		const parsed = Number(raw);
		if (Number.isSafeInteger(parsed) && parsed >= 1000) return parsed;
	}
	return DEFAULT_PRE_COMPACT_TRIGGER_TOKENS;
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

export function readWorkingStateConfig(
	env: Readonly<Record<string, string | undefined>> = process.env,
): WorkingStateConfig {
	return {
		stalenessThreshold: parseBoundedInteger(
			env.PI_WORKING_STATE_STALE_THRESHOLD,
			DEFAULT_STALENESS_THRESHOLD,
			MAX_STALENESS_THRESHOLD,
		),
		maxNudgesPerCycle: parseBoundedInteger(
			env.PI_WORKING_STATE_MAX_NUDGES,
			DEFAULT_MAX_NUDGES_PER_CYCLE,
			MAX_NUDGES_PER_CYCLE,
		),
		preCompactMarginTokens: parseBoundedInteger(
			env.PI_WORKING_STATE_PRE_COMPACT_MARGIN,
			DEFAULT_PRE_COMPACT_MARGIN_TOKENS,
			MAX_PRE_COMPACT_MARGIN_TOKENS,
		),
		preCompactTriggerTokens: readPreCompactTriggerTokens(env),
	};
}

/**
 * State, cadence, and caps for the working-state reminders. Pure logic: no
 * event bus, no reminder package. fs access is injected.
 *
 * Two independent one-shot nudges:
 * - Restore nudge: armed on session_compact / session_tree (always) and on
 *   session_start (only when a state file already exists — the resume case).
 *   Consumed on the next evaluation; never re-armed by action traffic.
 * - Staleness nudge: armed when successful actions accumulate against an
 *   unchanged state-file mtime. Strictly silent when no state file exists —
 *   creation pressure comes from the restore nudge and the skill, never from
 *   a timer.
 * - Pre-compaction nudge: edge-triggered on the estimated context size. Arms
 *   when tokens cross trigger−margin, fires once, and only re-arms after the
 *   estimate falls below trigger−margin−hysteresis (i.e. after a real
 *   compaction shrank the context). Independent of file existence — both
 *   text variants are meaningful.
 */
export class WorkingStateTracker {
	private readonly config: WorkingStateConfig;
	private readonly fsAdapter: WorkingStateFs;
	private sessionId: string | undefined;
	private lastMtimeMs: number | undefined;
	private actionsSinceWrite = 0;
	private actionsSinceNudge = 0;
	private nudgesThisCycle = 0;
	private compactionDue = false;
	private stalenessDue = false;
	private preCompactState: "idle" | "armed" | "fired" = "idle";
	private tokensAtArm: number | undefined;

	public constructor(config: WorkingStateConfig, fsAdapter: WorkingStateFs) {
		this.config = config;
		this.fsAdapter = fsAdapter;
	}

	public setSessionId(sessionId: string): void {
		const nextId = stateFilePath(sessionId) ? sessionId : undefined;
		if (this.sessionId === nextId) return;
		this.sessionId = nextId;
		this.lastMtimeMs = undefined;
		this.actionsSinceWrite = 0;
		this.actionsSinceNudge = 0;
		this.nudgesThisCycle = 0;
		this.compactionDue = false;
		this.stalenessDue = false;
		this.resetPreCompact();
	}

	public getStateFilePath(): string | undefined {
		return this.sessionId ? stateFilePath(this.sessionId) : undefined;
	}

	/** Compaction and tree forks destroy in-context state: always arm; the text forks at consumption. */
	public armRestore(): void {
		this.compactionDue = true;
	}

	/** Fresh session start: arm only when a leftover state file exists, i.e. the agent is resuming work. */
	public armSessionStart(): void {
		const file = this.getStateFilePath();
		if (file && this.fsAdapter.existsSync(file)) this.compactionDue = true;
	}

	public consumeCompactionNudge(): string | undefined {
		if (!this.compactionDue) return undefined;
		this.compactionDue = false;
		const file = this.getStateFilePath();
		if (!file) return undefined;
		return compactionNudgeText(this.fsAdapter.existsSync(file), file);
	}

	/** Compaction / session start shrinks context and must re-open the pre-compaction warning cycle. */
	public resetPreCompact(): void {
		this.preCompactState = "idle";
		this.tokensAtArm = undefined;
	}

	public observeContextTokens(tokens: number): void {
		const armThreshold = this.config.preCompactTriggerTokens - this.config.preCompactMarginTokens;
		const disarmThreshold = armThreshold - PRE_COMPACT_HYSTERESIS_TOKENS;
		if (tokens >= armThreshold) {
			if (this.preCompactState === "idle") {
				this.preCompactState = "armed";
				this.tokensAtArm = tokens;
			}
		} else if (tokens < disarmThreshold) {
			this.preCompactState = "idle";
			this.tokensAtArm = undefined;
		}
	}

	public consumePreCompactNudge(): string | undefined {
		if (this.preCompactState !== "armed") return undefined;
		this.preCompactState = "fired";
		const file = this.getStateFilePath();
		if (!file || this.tokensAtArm === undefined) return undefined;
		return preCompactNudgeText(
			this.tokensAtArm,
			this.config.preCompactTriggerTokens,
			this.fsAdapter.existsSync(file),
			file,
		);
	}

	public observeSuccessfulAction(): void {
		const file = this.getStateFilePath();
		if (!file) return;
		if (!this.fsAdapter.existsSync(file)) {
			// No state file: strictly silent. Nothing accumulates, nothing ever fires.
			this.actionsSinceWrite = 0;
			this.actionsSinceNudge = 0;
			this.lastMtimeMs = undefined;
			this.stalenessDue = false;
			return;
		}

		let mtimeMs: number;
		try {
			mtimeMs = this.fsAdapter.statSync(file).mtimeMs;
		} catch {
			return;
		}

		if (this.lastMtimeMs !== undefined && mtimeMs !== this.lastMtimeMs) {
			// Rewritten since the last observed action: the agent is current.
			this.lastMtimeMs = mtimeMs;
			this.actionsSinceWrite = 0;
			this.actionsSinceNudge = 0;
			this.stalenessDue = false;
			return;
		}

		// First observation only anchors the baseline; the action still counts —
		// the file was not written by this action, so staleness is real.
		this.lastMtimeMs = mtimeMs;
		this.actionsSinceWrite += 1;
		this.actionsSinceNudge += 1;
		if (
			this.actionsSinceNudge >= this.config.stalenessThreshold &&
			this.nudgesThisCycle < this.config.maxNudgesPerCycle
		) {
			this.stalenessDue = true;
		}
	}

	public consumeStalenessNudge(): string | undefined {
		if (!this.stalenessDue) return undefined;
		this.stalenessDue = false;
		if (this.nudgesThisCycle >= this.config.maxNudgesPerCycle) return undefined;

		// A queued nudge may outlive a write or deletion before the next call.
		// Recheck at delivery so a freshly updated/missing file stays silent.
		const file = this.getStateFilePath();
		if (!file || !this.fsAdapter.existsSync(file)) return undefined;
		try {
			if (this.fsAdapter.statSync(file).mtimeMs !== this.lastMtimeMs) return undefined;
		} catch {
			return undefined;
		}
		const payload = this.actionsSinceWrite;
		this.nudgesThisCycle += 1;
		this.actionsSinceNudge = 0;
		return stalenessNudgeText(payload, file);
	}

	public resetRequestCycle(): void {
		this.nudgesThisCycle = 0;
	}

	public getDiagnostics(): WorkingStateDiagnostics {
		const file = this.getStateFilePath();
		return {
			sessionId: this.sessionId,
			stateFileExists: file !== undefined && this.fsAdapter.existsSync(file),
			actionsSinceWrite: this.actionsSinceWrite,
			nudgesThisCycle: this.nudgesThisCycle,
			compactionDue: this.compactionDue,
			stalenessDue: this.stalenessDue,
			preCompactState: this.preCompactState,
		};
	}
}
