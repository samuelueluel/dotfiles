/**
 * prompt — the built-in advisor system prompt plus an optional live, user-owned
 * prompt file. The package prompt is loaded once; the configured file is read
 * for each consultation so behavior can be tuned without rebuilding/reloading
 * the extension.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveAdvisorSystemPromptFile } from "./config.js";

const MAX_CUSTOM_PROMPT_CHARS = 6_000;

export const ADVISOR_SYSTEM_PROMPT = readFileSync(
	fileURLToPath(new URL("../prompts/advisor-system.txt", import.meta.url)),
	"utf-8",
).trimEnd();

export function getAdvisorSystemPrompt(systemPromptFile?: string): string {
	const path = resolveAdvisorSystemPromptFile(systemPromptFile);
	if (!path) return ADVISOR_SYSTEM_PROMPT;
	try {
		const custom = readFileSync(path, "utf-8").trim();
		if (!custom) return ADVISOR_SYSTEM_PROMPT;
		const bounded = custom.length > MAX_CUSTOM_PROMPT_CHARS
			? `${custom.slice(0, MAX_CUSTOM_PROMPT_CHARS)}\n... [local advisor prompt truncated]`
			: custom;
		return `${ADVISOR_SYSTEM_PROMPT}\n\n## Local advisor preferences (live file)\n${bounded}`;
	} catch {
		// A missing/unreadable optional file must not disable the advisor.
		return ADVISOR_SYSTEM_PROMPT;
	}
}
