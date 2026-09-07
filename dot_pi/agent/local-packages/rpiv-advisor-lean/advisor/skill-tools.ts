/**
 * skill-tools — restricted, read-only tools exposed only inside the advisor
 * side-call. They can inspect Markdown below the configured skill roots, never
 * the executor's arbitrary filesystem or network.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { getAllowedSkillRoots, resolveAllowedSkillPath } from "./protocol.js";

const MAX_READ_CHARS = 20_000;
const MAX_SKILL_FILE_BYTES = 256_000;
const MAX_GREP_PATTERN_CHARS = 200;
const MAX_GREP_RESULTS = 50;
const MAX_GREP_OUTPUT_CHARS = 12_000;
const MAX_GREP_BYTES_SCANNED = 2_000_000;
const MAX_SKILL_TOOL_CALLS_PER_ROUND = 4;
const MAX_FILES_SCANNED = 500;
const MAX_DIRECTORY_DEPTH = 8;

const SkillReadParameters = Type.Object({
	path: Type.String({
		description: "Skill Markdown path, absolute or relative to a skill root (for example music/SKILL.md).",
		maxLength: 1_000,
	}),
});

const SkillGrepParameters = Type.Object({
	pattern: Type.String({
		description: "Short text to find in skill Markdown files; matching is case-insensitive by default.",
		maxLength: MAX_GREP_PATTERN_CHARS,
	}),
	path: Type.Optional(
		Type.String({
			description: "Optional skill root-relative file or directory (for example music or obsidian/SKILL.md).",
			maxLength: 1_000,
		}),
	),
	literal: Type.Optional(
		Type.Boolean({ description: "Match literal text (default true); set false to use a regular expression." }),
	),
	maxResults: Type.Optional(
		Type.Integer({ description: "Maximum matching lines to return (1–50).", minimum: 1, maximum: MAX_GREP_RESULTS }),
	),
});

export const ADVISOR_SKILL_TOOLS: Tool[] = [
	{
		name: "skill_read",
		description:
			"Read one Markdown skill file below a permitted skill root. Use this only to verify operative local protocol; do not use it for general project files.",
		parameters: SkillReadParameters,
	},
	{
		name: "skill_grep",
		description:
			"Search permitted Markdown skill files for a short phrase or regex. Results are bounded and read-only; use it to locate the relevant protocol before skill_read.",
		parameters: SkillGrepParameters,
	},
];

function toolResult(call: ToolCall, text: string, isError = false): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: call.id,
		toolName: call.name,
		content: [{ type: "text", text }],
		isError,
		timestamp: Date.now(),
	};
}

function argumentString(call: ToolCall, key: string): string | undefined {
	const value = call.arguments && typeof call.arguments === "object" ? call.arguments[key] : undefined;
	return typeof value === "string" ? value : undefined;
}

function argumentInteger(call: ToolCall, key: string, fallback: number, max: number): number {
	const value = call.arguments && typeof call.arguments === "object" ? call.arguments[key] : undefined;
	return typeof value === "number" && Number.isInteger(value) ? Math.max(1, Math.min(max, value)) : fallback;
}

function argumentBoolean(call: ToolCall, key: string, fallback: boolean): boolean {
	const value = call.arguments && typeof call.arguments === "object" ? call.arguments[key] : undefined;
	return typeof value === "boolean" ? value : fallback;
}

function truncate(value: string, limit: number): string {
	if (value.length <= limit) return value;
	const marker = "\n... [skill output truncated]";
	return `${value.slice(0, Math.max(0, limit - marker.length))}${marker}`;
}

function readSkillFile(call: ToolCall, cwd: string): ToolResultMessage {
	const requested = argumentString(call, "path");
	const path = resolveAllowedSkillPath(requested, cwd, true);
	if (!path || extname(path).toLowerCase() !== ".md") {
		return toolResult(call, "skill_read error: path is not an existing Markdown file below an allowed skill root", true);
	}
	try {
		const stats = statSync(path);
		if (!stats.isFile()) return toolResult(call, "skill_read error: path is not a file", true);
		if (stats.size > MAX_SKILL_FILE_BYTES) {
			return toolResult(call, "skill_read error: file exceeds the 256 KB safety cap", true);
		}
		const content = readFileSync(path, "utf8");
		return toolResult(call, `${path}\n\n${truncate(content, MAX_READ_CHARS)}`);
	} catch (error) {
		return toolResult(call, `skill_read error: ${error instanceof Error ? error.message : String(error)}`, true);
	}
}

function isMarkdownFile(path: string): boolean {
	return extname(path).toLowerCase() === ".md";
}

function collectMarkdownFiles(root: string, files: string[], depth: number): void {
	if (files.length >= MAX_FILES_SCANNED || depth > MAX_DIRECTORY_DEPTH) return;
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return;
	}
	for (const entry of entries) {
		if (files.length >= MAX_FILES_SCANNED) return;
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			collectMarkdownFiles(path, files, depth + 1);
		} else if (entry.isFile() && isMarkdownFile(path)) {
			files.push(path);
		}
	}
}

function grepSkillFiles(call: ToolCall, cwd: string): ToolResultMessage {
	const pattern = argumentString(call, "pattern");
	if (!pattern || pattern.length > MAX_GREP_PATTERN_CHARS) {
		return toolResult(call, "skill_grep error: pattern must be a non-empty string of at most 200 characters", true);
	}
	const literal = argumentBoolean(call, "literal", true);
	let matcher: (line: string) => boolean;
	if (literal) {
		const needle = pattern.toLocaleLowerCase();
		matcher = (line) => line.toLocaleLowerCase().includes(needle);
	} else {
		try {
			const expression = new RegExp(pattern, "i");
			matcher = (line) => expression.test(line);
		} catch (error) {
			return toolResult(call, `skill_grep error: invalid regular expression (${error instanceof Error ? error.message : String(error)})`, true);
		}
	}

	const requestedPath = argumentString(call, "path");
	const roots = getAllowedSkillRoots(cwd);
	const files: string[] = [];
	if (requestedPath) {
		const resolved = resolveAllowedSkillPath(requestedPath, cwd, true);
		if (!resolved) return toolResult(call, "skill_grep error: path is not below an allowed skill root", true);
		try {
			if (isMarkdownFile(resolved)) files.push(resolved);
			else if (statSync(resolved).isDirectory()) collectMarkdownFiles(resolved, files, 0);
		} catch {
			return toolResult(call, "skill_grep error: path could not be inspected", true);
		}
	} else {
		for (const root of roots) collectMarkdownFiles(root, files, 0);
	}

	const maxResults = argumentInteger(call, "maxResults", 20, MAX_GREP_RESULTS);
	const matches: string[] = [];
	let bytesScanned = 0;
	for (const path of files) {
		if (matches.length >= maxResults || bytesScanned >= MAX_GREP_BYTES_SCANNED) break;
		let content: string;
		try {
			const stats = statSync(path);
			if (!stats.isFile() || stats.size > MAX_SKILL_FILE_BYTES) continue;
			if (bytesScanned + stats.size > MAX_GREP_BYTES_SCANNED) break;
			bytesScanned += stats.size;
			content = readFileSync(path, "utf8");
		} catch {
			continue;
		}
		const lines = content.split(/\r?\n/);
		for (let index = 0; index < lines.length && matches.length < maxResults; index++) {
			if (!matcher(lines[index])) continue;
			matches.push(`${path}:${index + 1}: ${lines[index]}`);
		}
	}

	if (matches.length === 0) return toolResult(call, "No matches in permitted skill Markdown files.");
	return toolResult(call, truncate(matches.join("\n"), MAX_GREP_OUTPUT_CHARS));
}

/** Execute one internal advisor tool call; unknown calls become recoverable errors. */
export function executeAdvisorSkillTool(call: ToolCall, cwd: string): ToolResultMessage {
	if (call.name === "skill_read") return readSkillFile(call, cwd);
	if (call.name === "skill_grep") return grepSkillFiles(call, cwd);
	return toolResult(call, `Unknown advisor tool: ${call.name}`, true);
}

export interface AdvisorSkillToolRunOptions {
	model: any;
	systemPrompt: string;
	initialMessages: any[];
	completeSimple: (model: any, request: any, options?: any) => Promise<any>;
	requestOptions: Record<string, unknown>;
	cwd: string;
	maxToolRounds: number;
	toolsEnabled?: boolean;
	onUsage?: (usage: any) => void;
	onToolRound?: (round: number, calls: ToolCall[]) => void;
}

export interface AdvisorSkillToolRunResult {
	response: any;
	toolRounds: number;
	toolCalls: number;
}

/**
 * Run the reviewer to completion, servicing only the two restricted skill
 * tools. The hard round cap is enforced here rather than delegated to prompt
 * compliance. A final no-tools completion asks for an answer after the cap.
 */
export async function runAdvisorWithSkillTools(
	opts: AdvisorSkillToolRunOptions,
): Promise<AdvisorSkillToolRunResult> {
	let messages = [...opts.initialMessages];
	let toolRounds = 0;
	let toolCalls = 0;
	let forcedFinalAttempt = false;
	if (opts.toolsEnabled === false) {
		const response = await opts.completeSimple(
			opts.model,
			{ systemPrompt: opts.systemPrompt, messages, tools: [] },
			opts.requestOptions,
		);
		if (response?.usage) opts.onUsage?.(response.usage);
		return { response, toolRounds, toolCalls };
	}
	while (true) {
		if (toolRounds >= opts.maxToolRounds && !forcedFinalAttempt) {
			forcedFinalAttempt = true;
			// Do not append an assistant message containing unpaired tool calls. A
			// user-role nudge is a valid continuation after the prior results.
			messages = [
				...messages,
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "The restricted skill-tool budget is exhausted. Give the best direct answer now using the attached and retrieved evidence; do not call another tool.",
						},
					],
					timestamp: Date.now(),
				},
			];
		}
		const tools = forcedFinalAttempt ? [] : ADVISOR_SKILL_TOOLS;
		const response = await opts.completeSimple(
			opts.model,
			{ systemPrompt: opts.systemPrompt, messages, tools },
			opts.requestOptions,
		);
		if (response?.usage) opts.onUsage?.(response.usage);
		const calls = Array.isArray(response?.content)
			? response.content.filter((part: any): part is ToolCall => part?.type === "toolCall")
			: [];
		if (calls.length === 0 || forcedFinalAttempt) return { response, toolRounds, toolCalls };
		toolRounds++;
		toolCalls += calls.length;
		opts.onToolRound?.(toolRounds, calls);
		messages.push(response);
		for (const [index, call] of calls.entries()) {
			messages.push(
				index < MAX_SKILL_TOOL_CALLS_PER_ROUND
					? executeAdvisorSkillTool(call, opts.cwd)
					: toolResult(call, "Advisor skill-tool call omitted: per-round safety cap reached", true),
			);
		}
	}
}
