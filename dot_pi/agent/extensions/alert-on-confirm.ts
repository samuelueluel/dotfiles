import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";

const COMPLETE_SOUND = "/usr/share/sounds/freedesktop/stereo/complete.oga";
const PROMPT_ALERT_COOLDOWN_MS = 250;
const USER_PROMPT_KINDS = new Set(["select", "confirm", "input", "editor"]);

type AlertPayload = { active?: unknown };

function playAlert(): void {
	// Use execFile rather than a shell so this notification path cannot interpret
	// terminal or prompt text as a command. Ignore playback errors: the terminal
	// bell below is the fallback signal.
	execFile("paplay", [COMPLETE_SOUND], () => {});
	process.stderr.write("\x07");
}

function isInteractiveTui(ctx: ExtensionContext): boolean {
	try {
		return ctx.hasUI && ctx.mode === "tui";
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI): void {
	let interactiveTui = false;
	let lastAlertAt = Number.NEGATIVE_INFINITY;

	const playPromptAlert = (): void => {
		const now = Date.now();
		if (now - lastAlertAt < PROMPT_ALERT_COOLDOWN_MS) return;
		lastAlertAt = now;
		playAlert();
	};

	pi.on("session_start", async (_event, ctx) => {
		interactiveTui = isInteractiveTui(ctx);
	});

	// Pi emits this around blocking UI, but generic custom() overlays can also be
	// progress viewers or menus. Ring only for the dialog kinds that directly ask
	// for a user response; ask_user's custom overlay is handled by herdr:blocked.
	pi.on("ui_prompt_start", async (event, ctx) => {
		if (isInteractiveTui(ctx) && USER_PROMPT_KINDS.has(event.kind)) {
			playPromptAlert();
		}
	});

	// pi-ask-user uses a custom TUI for its rich question prompt, so its explicit
	// event bus signal is the precise way to cover that case without ringing for
	// every unrelated custom overlay. The cooldown coalesces its freeform input,
	// which emits both herdr:blocked and a normal input prompt event.
	pi.events.on("herdr:blocked", (raw: unknown) => {
		if (!interactiveTui || !raw || typeof raw !== "object") return;
		if ((raw as AlertPayload).active === true) playPromptAlert();
	});
}

