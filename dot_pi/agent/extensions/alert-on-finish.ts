import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";

const COMPLETE_SOUND = "/usr/share/sounds/freedesktop/stereo/complete.oga";
const WARNING_SOUND = "/usr/share/sounds/freedesktop/stereo/dialog-warning.oga";
const SETTLE_GRACE_MS = 250;

type AlertTimer = ReturnType<typeof setTimeout>;

function playAlert(sound: string): void {
	// Use execFile rather than a shell so this notification path cannot interpret
	// session text as a command. Ignore playback errors; the terminal bell below
	// still provides a signal if paplay is unavailable.
	execFile("paplay", [sound], () => {});
	process.stderr.write("\x07");
}

function isInteractiveTui(ctx: ExtensionContext): boolean {
	try {
		return ctx.hasUI && ctx.mode === "tui";
	} catch {
		return false;
	}
}

function lastAssistantStopReason(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i -= 1) {
		const entry = branch[i];
		if (entry.type === "message" && entry.message?.role === "assistant") {
			return entry.message.stopReason;
		}
	}
	return undefined;
}

export default function (pi: ExtensionAPI): void {
	let pendingAlert: AlertTimer | undefined;

	const cancelPendingAlert = (): void => {
		if (pendingAlert === undefined) return;
		clearTimeout(pendingAlert);
		pendingAlert = undefined;
	};

	const scheduleFinishAlert = (ctx: ExtensionContext): void => {
		cancelPendingAlert();
		if (!isInteractiveTui(ctx)) return;

		pendingAlert = setTimeout(() => {
			pendingAlert = undefined;
			try {
				// A low-level run can settle just before a queued continuation starts.
				// Re-check after a short grace period so only a genuinely idle TUI rings.
				if (!isInteractiveTui(ctx) || !ctx.isIdle() || ctx.hasPendingMessages()) return;

				const stopReason = lastAssistantStopReason(ctx);
				if (!stopReason) return;
				playAlert(stopReason === "error" ? WARNING_SOUND : COMPLETE_SOUND);
			} catch {
				// The session may have been reloaded or switched while the timer ran.
			}
		}, SETTLE_GRACE_MS);
	};

	// Cancel a queued completion sound as soon as another run begins.
	pi.on("agent_start", async () => cancelPendingAlert());
	pi.on("turn_start", async () => cancelPendingAlert());
	pi.on("session_shutdown", async () => cancelPendingAlert());
	pi.on("agent_settled", async (_event, ctx) => scheduleFinishAlert(ctx));
}

