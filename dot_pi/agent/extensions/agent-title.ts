import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

export default function(pi: ExtensionAPI) {
	const updateTitle = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const model = ctx.model;
		const isLocal = model ? (model.provider === "local" || model.baseUrl?.includes("13305") || model.baseUrl?.includes("127.0.0.1")) : false;
		const isCloud = !isLocal;
		const sysPrompt = ctx.getSystemPrompt() || "";
		const isStata = sysPrompt.includes("mcp-stata") || sysPrompt.includes("STATA") || sysPrompt.includes("APPEND_SYSTEM_BETA");
		const symbol = isStata ? (isCloud ? "β̂" : "β") : (isCloud ? "π̂" : "π");
		const cwdParts = ctx.cwd.split("/");
		const dir = cwdParts[cwdParts.length - 1] || ctx.cwd;
		const sessionName = ctx.sessionManager.getSessionName();
		const title = sessionName ? `${symbol} - ${sessionName} - ${dir}` : `${symbol} - ${dir}`;
		ctx.ui.setTitle(title);
	};

	pi.on("session_start", async (_event, ctx) => {
		updateTitle(ctx);
	});
	pi.on("turn_start", async (_event, ctx) => {
		updateTitle(ctx);
	});
	pi.on("model_select", async (_event, ctx) => {
		updateTitle(ctx);
	});
	pi.on("thinking_level_select", async (_event, ctx) => {
		updateTitle(ctx);
	});
}
