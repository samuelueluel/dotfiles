import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const FOLDERS_ROOT = path.join(os.homedir(), ".pi", "agent", "folders");

function getExistingFolders(): string[] {
	if (!fs.existsSync(FOLDERS_ROOT)) {
		fs.mkdirSync(FOLDERS_ROOT, { recursive: true });
		return [];
	}
	return fs.readdirSync(FOLDERS_ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith("."))
		.map((d) => d.name)
		.sort();
}

export default function stashExtension(pi: ExtensionAPI): void {
	pi.registerCommand("stash", {
		description: "Stash current session into a project folder (~/.pi/agent/folders/)",
		handler: async (args, ctx: any) => {
			const sessionFile = ctx.sessionManager?.sessionFile;
			if (!sessionFile || !fs.existsSync(sessionFile)) {
				ctx.ui.notify("Cannot stash: session file not saved to disk yet.", "warning");
				return;
			}

			let targetFolder = (args || "").trim();

			if (!targetFolder) {
				const folders = getExistingFolders();
				const options = ["+ New Folder...", ...folders];
				const selected = await ctx.ui.select("Select folder to stash this conversation into:", options);
				if (!selected) {
					ctx.ui.notify("Stash cancelled.", "info");
					return;
				}

				if (selected === "+ New Folder...") {
					const inputName = await ctx.ui.input("Enter new folder name:");
					if (!inputName || !inputName.trim()) {
						ctx.ui.notify("Stash cancelled.", "info");
						return;
					}
					targetFolder = inputName.trim();
				} else {
					targetFolder = selected;
				}
			}

			const targetDir = path.join(FOLDERS_ROOT, targetFolder);
			fs.mkdirSync(targetDir, { recursive: true });

			const fileName = path.basename(sessionFile);
			const targetPath = path.join(targetDir, fileName);

			if (sessionFile === targetPath) {
				ctx.ui.notify(`Session is already in folder '${targetFolder}'.`, "info");
				return;
			}

			try {
				fs.renameSync(sessionFile, targetPath);
				if (typeof ctx.sessionManager.setSessionFile === "function") {
					ctx.sessionManager.setSessionFile(targetPath);
				}
				ctx.ui.notify(`✓ Session stashed into folder '${targetFolder}'`, "info");
			} catch (err: any) {
				ctx.ui.notify(`Failed to stash session: ${err.message}`, "error");
			}
		},
	});
}
