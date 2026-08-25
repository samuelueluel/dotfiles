import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { exec } from "node:child_process";

export default function(pi: ExtensionAPI) {
	pi.on("agent_settled", async (_event, ctx) => {
		try {
			const branch = ctx.sessionManager.getBranch();
			let isError = false;

			for (let i = branch.length - 1; i >= 0; i--) {
				const entry = branch[i];
				if (entry.type === "message" && entry.message?.role === "assistant") {
					if (entry.message.stopReason === "error") {
						isError = true;
					}
					break;
				}
			}

			if (isError) {
				// Fatal/unrecoverable error that halted the agent run and needs user attention
				exec("paplay /usr/share/sounds/freedesktop/stereo/dialog-warning.oga");
			} else {
				// Normal task completion
				exec("paplay /usr/share/sounds/freedesktop/stereo/complete.oga");
			}
			process.stderr.write("\x07");
		} catch {
			// Fallback
			exec("paplay /usr/share/sounds/freedesktop/stereo/complete.oga");
			process.stderr.write("\x07");
		}
	});
}

