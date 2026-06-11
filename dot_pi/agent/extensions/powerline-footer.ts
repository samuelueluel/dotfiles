// Noctalia-themed powerline footer — replaces the hardcoded Catppuccin colors
// in npm:pi-agent-extensions/extensions/powerline-footer/index.ts
import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import { type Component, type Theme, type TUI, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import * as child_process from "child_process";

class PowerlineFooter implements Component {
	private tui: TUI;
	private theme: Theme;
	private footerData: ReadonlyFooterDataProvider;
	private ctx: ExtensionContext;
	private interval?: ReturnType<typeof setInterval>;
	private sessionStartTime: number;
	private disposed = false;
	private cwd: string;
	private lastRenderedLine = "";
	private lastShortDir: string;
	private lastModelShort = "unknown";
	private lastContextInfo = "";
	private lastCostInfo = "";
	private lastSessionName = "";
	private gitStatusExtras: string = "";

	constructor(tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider, ctx: ExtensionContext) {
		this.tui = tui;
		this.theme = theme;
		this.footerData = footerData;
		this.ctx = ctx;
		this.sessionStartTime = Date.now();
		this.cwd = ctx.cwd;
		this.lastShortDir = this.formatShortDir(this.cwd);
		this.fetchAsyncData();
		this.interval = setInterval(() => {
			if (this.disposed) return;
			this.fetchAsyncData();
			this.tui.requestRender();
		}, 10000);
	}

	dispose() {
		this.disposed = true;
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = undefined;
		}
	}

	private fetchAsyncData() {
		if (this.disposed) return;
		const cwd = this.cwd;
		const branch = this.footerData.getGitBranch();
		if (branch) {
			child_process.exec("git --no-optional-locks status --porcelain", { encoding: "utf8", cwd }, (err, stdout) => {
				if (this.disposed || err) return;
				const staged = (stdout.match(/^[AMDRC]/gm) || []).length;
				const unstaged = (stdout.match(/^.[MD]/gm) || []).length;
				const untracked = (stdout.match(/^\?\?/gm) || []).length;
				child_process.exec("git --no-optional-locks rev-list --count --left-right @{u}...HEAD", { encoding: "utf8", cwd }, (err2, revListOut) => {
					if (this.disposed) return;
					let ahead = 0, behind = 0;
					if (!err2 && revListOut && revListOut.includes("\t")) {
						const [b, a] = revListOut.trim().split("\t");
						behind = parseInt(b, 10);
						ahead = parseInt(a, 10);
					}
					let statusExtras = "";
					if (staged > 0) statusExtras += `+${staged}`;
					if (unstaged > 0) statusExtras += `!${unstaged}`;
					if (untracked > 0) statusExtras += `?${untracked}`;
					if (ahead > 0) statusExtras += `⇡${ahead}`;
					if (behind > 0) statusExtras += `⇣${behind}`;
					this.gitStatusExtras = statusExtras;
					this.tui.requestRender();
				});
			});
		} else {
			this.gitStatusExtras = "";
		}
	}

	invalidate() {}
	handleInput(_data: string) {}

	private formatShortDir(cwd: string): string {
		const homeDir = process.env.HOME || process.env.USERPROFILE || "";
		let shortDir = cwd;
		if (homeDir && shortDir.startsWith(homeDir)) {
			shortDir = "~" + shortDir.slice(homeDir.length);
		}
		const parts = shortDir.split("/");
		if (parts.length > 4) shortDir = parts.slice(parts.length - 4).join("/");
		return shortDir;
	}

	private getShortDir(): string {
		try { this.lastShortDir = this.formatShortDir(this.ctx.cwd); } catch {}
		return this.lastShortDir;
	}

	private getModelShort(): string {
		try {
			const model = this.ctx.model;
			this.lastModelShort = model?.name || model?.id || "unknown";
		} catch {}
		return this.lastModelShort;
	}

	private getContextDetails(reset: string, green: string, yellow: string, red: string, peach: string, dim: string) {
		try {
			const model = this.ctx.model;
			const contextUsage = this.ctx.getContextUsage();
			let contextInfo = "", costInfo = "";
			if (contextUsage) {
				const used = contextUsage.tokens;
				const total = contextUsage.contextWindow;
				const pct = contextUsage.percent;
				if (used !== null && pct !== null) {
					const remaining = 100 - pct;
					let ctxColor = green;
					if (remaining < 20) ctxColor = red;
					else if (remaining < 50) ctxColor = yellow;
					const pctDisplay = pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1);
					contextInfo = `${ctxColor}${this.formatTokens(used)}/${this.formatTokens(total)} (${pctDisplay}%)${reset}`;
				} else {
					contextInfo = `${green}?/${this.formatTokens(total)}${reset}`;
				}
			}
			let totalCost = 0;
			for (const entry of this.ctx.sessionManager.getEntries()) {
				if (entry.type !== "message" || entry.message.role !== "assistant") continue;
				totalCost += entry.message.usage?.cost?.total ?? 0;
			}
			const usingSubscription = model ? this.ctx.modelRegistry.isUsingOAuth(model) : false;
			if (totalCost > 0 || usingSubscription) {
				const formattedCost = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
				costInfo = ` ${dim}|${reset} ${peach}${formattedCost}${reset}`;
			}
			this.lastContextInfo = contextInfo;
			this.lastCostInfo = costInfo;
		} catch {}
		return { contextInfo: this.lastContextInfo, costInfo: this.lastCostInfo };
	}

	private getSessionName(): string {
		try { this.lastSessionName = this.ctx.sessionManager.getSessionName() ?? ""; } catch {}
		return this.lastSessionName;
	}

	private fitToWidth(line: string, width: number): string {
		if (width <= 0) return "";
		if (visibleWidth(line) <= width) return line;
		return truncateToWidth(line, width, "...");
	}

	private formatTokens(num: number): string {
		if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
		if (num >= 1000) return Math.floor(num / 1000) + "K";
		return String(num);
	}

	render(width: number): string[] {
		const RESET     = "\x1b[0m";
		const DIM       = "\x1b[2m";
		const BOLD      = "\x1b[1m";
		// Noctalia palette (truecolor)
		const TURQUOISE = "\x1b[38;2;26;170;212m";   // #1AAAD4 — directory, env
		const SANDSTONE = "\x1b[38;2;218;158;138m";  // #DA9E8A — model name, cost, duration
		const LICHEN    = "\x1b[38;2;150;224;80m";   // #96E050 — context ok
		const GLOBE     = "\x1b[38;2;237;109;66m";   // #ED6D42 — session name, git branch, context warning
		const PRICKLY   = "\x1b[38;2;237;38;88m";    // #ED2658 — git dirty, context critical
		const GRAY      = "\x1b[38;2;113;110;117m";  // #716E75 — dim separators

		if (this.disposed) return [this.fitToWidth(this.lastRenderedLine || "", width)];

		const shortDir = this.getShortDir();
		let gitInfo = "";
		const branch = this.footerData.getGitBranch();
		if (branch) {
			gitInfo = ` ${DIM}on${RESET} ${GLOBE} ${branch}${RESET}`;
			if (this.gitStatusExtras) gitInfo += ` ${PRICKLY}${this.gitStatusExtras}${RESET}`;
		}

		const modelShort = this.getModelShort();
		const { contextInfo, costInfo } = this.getContextDetails(RESET, LICHEN, GLOBE, PRICKLY, SANDSTONE, GRAY);

		let durationInfo = "";
		const durationMs = Date.now() - this.sessionStartTime;
		if (durationMs > 0) {
			const durS = Math.floor(durationMs / 1000);
			let durFmt = "";
			if (durS >= 3600) {
				const durH = Math.floor(durS / 3600);
				const durM = Math.floor((durS % 3600) / 60);
				durFmt = `${durH}h${durM}m`;
			} else if (durS >= 60) {
				durFmt = `${Math.floor(durS / 60)}m`;
			} else {
				durFmt = `${durS}s`;
			}
			durationInfo = ` ${GRAY}|${RESET} ${SANDSTONE}${durFmt}${RESET}`;
		}

		let envInfo = "";
		if (process.env.CONDA_DEFAULT_ENV) {
			envInfo = ` ${TURQUOISE}(${process.env.CONDA_DEFAULT_ENV})${RESET}`;
		} else if (process.env.VIRTUAL_ENV) {
			const venvName = process.env.VIRTUAL_ENV.split("/").pop() || "";
			envInfo = ` ${TURQUOISE}(${venvName})${RESET}`;
		}

		const date = new Date();
		const currentTime = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
		const sessionName = this.getSessionName();
		const sessionInfo = sessionName ? `${GLOBE}[${sessionName}]${RESET} ` : "";

		let left  = `${sessionInfo}${BOLD}${TURQUOISE} ${shortDir}${RESET}${gitInfo}`;
		const right = `${contextInfo}`;

		const statuses = this.footerData.getExtensionStatuses();
		if (statuses.size > 0) {
			const parts: string[] = [];
			for (const [, text] of statuses) {
				if (text) parts.push(text);
			}
			if (parts.length > 0) left += ` ${GRAY}|${RESET} ${parts.join(" ")}`;
		}

		const leftWidth = visibleWidth(left);
		const rightWidth = visibleWidth(right);
		const minPadding = 1;
		let line = "";

		if (leftWidth + minPadding + rightWidth <= width) {
			line = left + " ".repeat(width - leftWidth - rightWidth) + right;
		} else {
			const availableForLeft = Math.max(0, width - rightWidth - minPadding);
			if (availableForLeft > 0) {
				const truncatedLeft = this.fitToWidth(left, availableForLeft);
				const truncatedLeftWidth = visibleWidth(truncatedLeft);
				line = truncatedLeft + " ".repeat(Math.max(minPadding, width - truncatedLeftWidth - rightWidth)) + right;
			} else {
				line = this.fitToWidth(right, width);
			}
		}

		this.lastRenderedLine = line;
		return [line];
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setFooter((tui, theme, footerData) => {
			return new PowerlineFooter(tui, theme, footerData, ctx);
		});
	});
}
