import { registerReminder } from "@kennyfrc/pi-system-reminders";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import {
	estimateTokens,
	readWorkingStateConfig,
	WorkingStateTracker,
} from "../lib/working-state-logic.js";

export const WORKING_STATE_RESTORE_REMINDER_ID = "working-state-restore";
export const WORKING_STATE_STALENESS_REMINDER_ID = "working-state-staleness";
export const WORKING_STATE_PRE_COMPACT_REMINDER_ID = "working-state-pre-compact";

export default function workingStateRemindersExtension(pi: ExtensionAPI): void {
	const tracker = new WorkingStateTracker(readWorkingStateConfig(), {
		existsSync: fs.existsSync,
		statSync: (target: string) => fs.statSync(target),
	});

	const syncSession = (ctx: { sessionManager: { getSessionId(): string } }): void => {
		tracker.setSessionId(ctx.sessionManager.getSessionId());
	};

	// Existing state for this UUID means the agent is resuming earlier
	// work in this session: arm the re-read nudge. Fresh sessions with no file
	// stay silent — creation pressure belongs to compaction and the skill.
	pi.on("session_start", (_event, ctx) => {
		syncSession(ctx);
		tracker.armSessionStart();
	});

	// Compaction and tree forks destroy in-context state. Arm unconditionally;
	// the reminder text forks on file existence at consumption time. The cut also
	// re-opens the pre-compaction warning cycle (context shrank).
	pi.on("session_compact", (_event, ctx) => {
		syncSession(ctx);
		tracker.armRestore();
		tracker.resetPreCompact();
	});

	// Manual /blackhole is an explicit context cut, even below the automatic
	// warning threshold. Give the user a chance to save working state first,
	// without adding a model turn. `__pi_vcc__` is pi-blackhole's instruction marker.
	pi.on("session_before_compact", async (event, ctx) => {
		if (event.reason !== "manual" || event.customInstructions !== "__pi_vcc__" || !ctx.hasUI) return;
		syncSession(ctx);
		const file = tracker.getStateFilePath();
		if (!file) {
			ctx.ui.notify("Session ID unavailable; Blackhole compaction cancelled to protect working state.", "warning");
			return { cancel: true };
		}
		const stateFileExists = fs.existsSync(file);
		const stateAction = stateFileExists ? "update" : "create";
		const stateActionTitle = stateFileExists ? "Update" : "Create";
		let confirmed: boolean;
		try {
			confirmed = await ctx.ui.confirm(
				"Before Blackhole compaction",
				`The session is about to be summarized. If ${file} needs to be ${stateAction}d, choose No to cancel, make the change, then rerun /blackhole. Continue?`,
				{ signal: event.signal },
			);
		} catch {
			ctx.ui.notify("Could not show the working-state confirmation; Blackhole compaction cancelled.", "warning");
			return { cancel: true };
		}
		if (!confirmed) {
			ctx.ui.notify(
				`Blackhole compaction cancelled. ${stateActionTitle} ${file} if needed, then rerun /blackhole.`,
				"info",
			);
			return { cancel: true };
		}
	});

	pi.on("session_tree", (_event, ctx) => {
		syncSession(ctx);
		tracker.armRestore();
		tracker.resetPreCompact();
	});

	// Each model turn reports the full LLM-bound context; chars/4 over it drives
	// the pre-compaction early warning. Fires while runway remains, so the state
	// file is written before the cut instead of reconstructed after it.
	pi.on("turn_end", (event: any) => {
		tracker.observeContextTokens(estimateTokens(event?.context?.llmMessages ?? []));
	});

	// Run boundaries carry the whole message array; same estimate, last-writer-wins.
	pi.on("agent_end", (event: any) => {
		tracker.observeContextTokens(estimateTokens(event?.messages ?? []));
	});

	// A request cycle starts when Pi begins an agent run. Bounded backoff:
	// at most maxNudgesPerCycle staleness nudges per cycle.
	pi.on("agent_start", () => {
		tracker.resetRequestCycle();
	});

	// Count completed tool executions, not preflight attempts; errored calls do
	// not advance the staleness counter. Todo mutations are their own signal and
	// the todo list is not the state file, so they are skipped here.
	pi.on("tool_execution_end", (event: any) => {
		if (event?.isError === true) return;
		if (event?.toolName === "todo") return;
		tracker.observeSuccessfulAction();
	});

	// One-shot post-compaction restore nudge on the call:every clock (fires on
	// any non-empty tail — mid-turn compactions included), mirroring the
	// plan-note guard's re-arm-on-restore contract.
	registerReminder(pi, {
		id: WORKING_STATE_RESTORE_REMINDER_ID,
		label: "working-state-restore",
		lifetime: "transient",
		on: "call:every",
		priority: 66,
		content: () => tracker.consumeCompactionNudge() ?? null,
	});

	// Bounded staleness drift nudge, file-gated: silent whenever no state file
	// exists for the current session UUID.
	registerReminder(pi, {
		id: WORKING_STATE_STALENESS_REMINDER_ID,
		label: "working-state-staleness",
		lifetime: "transient",
		on: "call:every",
		priority: 64,
		content: () => tracker.consumeStalenessNudge() ?? null,
	});

	// Pre-compaction early warning: one-shot per context-growth cycle, above the
	// post-cut restore nudge so the write happens before the cut when possible.
	registerReminder(pi, {
		id: WORKING_STATE_PRE_COMPACT_REMINDER_ID,
		label: "working-state-pre-compact",
		lifetime: "transient",
		on: "call:every",
		priority: 68,
		content: () => tracker.consumePreCompactNudge() ?? null,
	});
}
