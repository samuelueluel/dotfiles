import { registerReminder } from "@kennyfrc/pi-system-reminders";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	assistantAppearsToAwaitUserInput,
	extractLatestTodoSnapshot,
	readTodoReminderConfig,
	renderTodoReminder,
	TodoReminderTracker,
} from "../lib/todo-reminder-logic.js";

export const TODO_REMINDER_ID = "todo-drift-guard";

function detailsFromToolResult(result: unknown): unknown {
	if (!result || typeof result !== "object") return undefined;
	return (result as { details?: unknown }).details;
}

export default function todoRemindersExtension(pi: ExtensionAPI): void {
	const tracker = new TodoReminderTracker(readTodoReminderConfig());

	const restoreFromBranch = (
		ctx: { sessionManager: { getBranch(): Iterable<unknown> } },
		options?: { resetCycle?: boolean },
	): void => {
		tracker.restore(extractLatestTodoSnapshot(ctx.sessionManager.getBranch()), options);
	};

	pi.on("session_start", (_event, ctx) => {
		restoreFromBranch(ctx, { resetCycle: true });
	});

	pi.on("session_compact", (_event, ctx) => {
		restoreFromBranch(ctx, { resetCycle: false });
	});

	pi.on("session_tree", (_event, ctx) => {
		restoreFromBranch(ctx, { resetCycle: false });
	});

	// A request cycle starts when Pi begins an agent run. Preserve the action
	// counter across user turns, but bound reminders per cycle.
	pi.on("agent_start", () => {
		tracker.resetRequestCycle();
	});

	// Count completed tool executions, not preflight attempts. In particular,
	// reducer errors from rpiv-todo are in-band details.error values, while
	// blocked/failed non-todo calls should not advance the drift counter.
	pi.on("tool_execution_end", (event: any) => {
		if (event.toolName === "todo") {
			tracker.observeTodoResult(detailsFromToolResult(event.result), event.isError === true);
			return;
		}

		if (event.isError !== true) tracker.observeSuccessfulAction();
	});

	// This is deliberately a bounded, non-continuing completion check. It is
	// delivered on the next provider call (normally the next user prompt) rather
	// than automatically starting another run and risking a continuation loop.
	pi.on("agent_settled", (_event, ctx) => {
		let hasPendingMessages = false;
		let awaitingUserInput = false;
		try {
			hasPendingMessages = ctx.hasPendingMessages();
			awaitingUserInput = assistantAppearsToAwaitUserInput(ctx.sessionManager.getBranch());
		} catch {
			// A stale or minimal context should not make the guard fail closed into
			// an automatic continuation. The transient reminder remains optional.
			return;
		}
		tracker.markSettled({ hasPendingMessages, awaitingUserInput });
	});

	// The package owns transient context placement and the call:every clock. The
	// tracker owns state, cadence, and caps; returning null is a no-op.
	registerReminder(pi, {
		id: TODO_REMINDER_ID,
		label: "todo-guard",
		lifetime: "transient",
		on: "call:every",
		priority: 65,
		content: () => {
			const payload = tracker.consumeReminder();
			return payload ? renderTodoReminder(payload) : null;
		},
	});
}
