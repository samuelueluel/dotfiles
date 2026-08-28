import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function resolveStateFilePath(ctx?: ExtensionContext): string {
	if (process.env.PI_STATE_FILE) {
		return process.env.PI_STATE_FILE;
	}

	const runningDir = path.join(os.homedir(), ".pi", "running");
	const ppidFile = path.join(runningDir, `${process.ppid}.state`);
	if (fs.existsSync(ppidFile)) {
		return ppidFile;
	}

	const pidFile = path.join(runningDir, `${process.pid}.state`);
	if (fs.existsSync(pidFile)) {
		return pidFile;
	}

	if (fs.existsSync(runningDir)) {
		try {
			const files = fs.readdirSync(runningDir).filter((f) => f.endsWith(".state"));
			if (files.length === 1) {
				return path.join(runningDir, files[0]);
			}
		} catch {}
	}

	return pidFile;
}

function syncRunningState(pi: ExtensionAPI, ctx: ExtensionContext, overrideModel?: any, overrideThinking?: string) {
	try {
		const stateFile = resolveStateFilePath(ctx);
		const model = overrideModel || ctx.model;

		let modelStr = "";
		if (model) {
			if (typeof model === "string") {
				modelStr = model;
			} else if (model.provider && model.id && !model.id.startsWith(model.provider + "/")) {
				modelStr = `${model.provider}/${model.id}`;
			} else if (model.id) {
				modelStr = model.id;
			}
		}

		let thinking = overrideThinking;
		if (!thinking) {
			if (ctx.thinkingLevel) {
				thinking = ctx.thinkingLevel;
			} else if (typeof (pi as any).getThinkingLevel === "function") {
				try {
					thinking = (pi as any).getThinkingLevel();
				} catch {}
			}
		}
		if (!thinking) {
			thinking = "max";
		}

		const meta: Record<string, string> = {};
		if (fs.existsSync(stateFile)) {
			try {
				const content = fs.readFileSync(stateFile, "utf8");
				for (const line of content.split("\n")) {
					const idx = line.indexOf("=");
					if (idx > 0) {
						meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
					}
				}
			} catch {}
		}

		const sysPrompt = ctx.getSystemPrompt ? ctx.getSystemPrompt() : "";
		const isStata = sysPrompt.includes("mcp-stata") || sysPrompt.includes("STATA") || sysPrompt.includes("APPEND_SYSTEM_BETA");
		const isLocal = model ? (model.provider === "local" || model.baseUrl?.includes("13305") || model.baseUrl?.includes("127.0.0.1")) : false;
		const defaultType = isStata ? (isLocal ? "beta" : "betahat") : (isLocal ? "pi" : "pihat");

		const cwdParts = (ctx.cwd || process.cwd()).split("/");
		const dir = cwdParts[cwdParts.length - 1] || ctx.cwd || "samuel";

		if (!meta.type) meta.type = defaultType;
		if (modelStr) meta.model = modelStr;
		if (thinking) meta.thinking = thinking;
		if (!meta.cwd) meta.cwd = dir;
		if (!meta.sandbox) meta.sandbox = "unsandboxed";

		fs.mkdirSync(path.dirname(stateFile), { recursive: true });
		const out = Object.entries(meta).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
		fs.writeFileSync(stateFile, out, "utf8");
	} catch {}
}

export default function(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		syncRunningState(pi, ctx);
	});
	pi.on("model_select", async (event, ctx) => {
		syncRunningState(pi, ctx, event.model);
	});
	pi.on("thinking_level_select", async (event, ctx) => {
		syncRunningState(pi, ctx, undefined, event.level);
	});
	pi.on("turn_start", async (_event, ctx) => {
		syncRunningState(pi, ctx);
	});
}
