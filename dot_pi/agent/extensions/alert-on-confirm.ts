import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { exec } from "node:child_process";

function playAlert() {
	exec("paplay /usr/share/sounds/freedesktop/stereo/complete.oga");
	process.stderr.write("\x07");
}

function patchMethod(obj: any, methodName: string) {
	if (obj && typeof obj[methodName] === "function" && !obj[methodName]._alertWrapped) {
		const orig = obj[methodName];
		const wrapped = async function(...args: any[]) {
			playAlert();
			return orig.apply(obj, args);
		};
		wrapped._alertWrapped = true;
		obj[methodName] = wrapped;
	}
}

export default function(pi: ExtensionAPI) {
	const patchUI = (ctx: any) => {
		const ui = ctx?.ui;
		if (!ui) return;

		patchMethod(ui, "input");
		patchMethod(ui, "confirm");
		patchMethod(ui, "select");
		patchMethod(ui, "editor");
		patchMethod(ui, "custom");
	};

	pi.on("turn_start", async (_event, ctx) => patchUI(ctx));
	pi.on("agent_start", async (_event, ctx) => patchUI(ctx));
}

