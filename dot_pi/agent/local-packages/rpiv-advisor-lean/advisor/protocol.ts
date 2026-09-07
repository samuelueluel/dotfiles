/**
 * protocol — recover recently loaded local skill guidance from the executor
 * branch without forwarding native tool-call blocks. The reviewer gets a
 * bounded attachment and/or read-only skill tools; it never receives arbitrary
 * filesystem access.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Message } from "@earendil-works/pi-ai";

export const MAX_PROTOCOL_ATTACHMENT_CHARS = 14_000;
export const MAX_PROTOCOL_FILES = 4;
export const PROTOCOL_RECENCY_ENTRIES = 32;

export interface ActiveProtocolFile {
	path: string;
	content: string;
	entryIndex: number;
}

export interface ActiveProtocolContext {
	files: ActiveProtocolFile[];
}

type BranchEntry = {
	type?: string;
	message?: Message;
};

function pathInside(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function existingDirectory(path: string): string | undefined {
	try {
		if (!statSync(path).isDirectory()) return undefined;
		return realpathSync(path);
	} catch {
		return undefined;
	}
}

/** The only roots from which advisor-side skill tools may read. */
export function getAllowedSkillRoots(cwd: string): string[] {
	const candidates = [
		join(homedir(), ".agents", "skills"),
		join(cwd, ".agents", "skills"),
		join(homedir(), "dotfiles", "dot_agents", "skills"),
	];
	const roots: string[] = [];
	for (const candidate of candidates) {
		const root = existingDirectory(candidate);
		if (root && !roots.includes(root)) roots.push(root);
	}
	return roots;
}

function expandTilde(value: string): string {
	return value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

/** Resolve a skill reference while retaining the allowed-root boundary. */
export function resolveAllowedSkillPath(
	value: unknown,
	cwd: string,
	requireExisting = false,
): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const raw = expandTilde(value.trim());
	const roots = getAllowedSkillRoots(cwd);
	const candidates = isAbsolute(raw) ? [resolve(raw)] : roots.map((root) => resolve(root, raw));
	for (const candidate of candidates) {
		let checked = candidate;
		try {
			if (existsSync(candidate)) checked = realpathSync(candidate);
		} catch {
			continue;
		}
		if (!roots.some((root) => pathInside(root, checked))) continue;
		if (requireExisting) {
			try {
				if (!existsSync(candidate)) continue;
				const stats = statSync(checked);
				if (!stats.isFile() && !stats.isDirectory()) continue;
			} catch {
				continue;
			}
		}
		return checked;
	}
	return undefined;
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } =>
			!!part && typeof part === "object" && (part as any).type === "text" && typeof (part as any).text === "string",
		)
		.map((part) => part.text)
		.join("\n");
}

function messageAt(entry: BranchEntry): Message | undefined {
	return entry?.type === "message" ? entry.message : undefined;
}

/**
 * Find the latest correlated `read` result for recently loaded skill files.
 * Correlation is by Pi's toolCallId, not by adjacency, so unrelated tool
 * activity cannot accidentally be treated as protocol.
 */
export function collectActiveProtocolContext(
	entries: BranchEntry[],
	cwd: string,
	recentEntries = PROTOCOL_RECENCY_ENTRIES,
): ActiveProtocolContext {
	const readCalls = new Map<string, { path: unknown; entryIndex: number }>();
	for (let index = 0; index < entries.length; index++) {
		const message = messageAt(entries[index]);
		if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part.type !== "toolCall" || part.name !== "read") continue;
			readCalls.set(part.id, { path: part.arguments?.path, entryIndex: index });
		}
	}

	const firstRecent = Math.max(0, entries.length - Math.max(1, recentEntries));
	const latest = new Map<string, ActiveProtocolFile>();
	for (let index = firstRecent; index < entries.length; index++) {
		const message = messageAt(entries[index]);
		if (!message || message.role !== "toolResult" || message.toolName !== "read" || message.isError) continue;
		const call = readCalls.get(message.toolCallId);
		if (!call || call.entryIndex >= index) continue;
		const path = resolveAllowedSkillPath(call.path, cwd, false);
		if (!path || !path.toLowerCase().endsWith(".md")) continue;
		const content = textFromContent(message.content).trim();
		if (!content) continue;
		latest.set(path, { path, content, entryIndex: index });
	}

	const files = [...latest.values()].sort((a, b) => {
		const aSkill = basename(a.path).toLowerCase() === "skill.md";
		const bSkill = basename(b.path).toLowerCase() === "skill.md";
		if (aSkill !== bSkill) return aSkill ? -1 : 1;
		return b.entryIndex - a.entryIndex;
	});
	return { files };
}

function boundedExcerpt(value: string, limit: number): string {
	if (limit <= 0) return "";
	if (value.length <= limit) return value;
	const marker = "... [protocol excerpt truncated] ...";
	if (limit <= marker.length + 2) return value.slice(0, limit);
	const available = limit - marker.length - 2;
	const head = Math.ceil(available * 0.65);
	const tail = available - head;
	return `${value.slice(0, head)}\n${marker}\n${value.slice(-tail)}`;
}

// Prefer sections that carry operational rules when preparing the much smaller
// scribe excerpt. This is deliberately heuristic and bounded: the reviewer gets
// the more complete attachment separately, while the checkpoint keeps durable
// constraints such as "never clear" and "dry-run first".
function operativeProtocolExcerpt(value: string, limit: number): string {
	const lines = value.split(/\r?\n/);
	const blocks: { index: number; score: number; text: string }[] = [];
	let current: string[] = [];
	let index = 0;
	const flush = () => {
		if (current.length === 0) return;
		const heading = current.find((line) => /^#{1,6}\s+/.test(line)) ?? "";
		const lower = `${heading} ${current.join(" ")}`.toLowerCase();
		const score =
			(lower.match(/safe|invariant|prohibit|boundary|constraint|never|must|require|dry-run|approval|authorization|mutation/g) ?? []).length * 3 +
			(lower.match(/scope|workflow|routing|mode|evidence|only|always|explicit/g) ?? []).length;
		if (score > 0) blocks.push({ index, score, text: current.join("\n") });
		index++;
		current = [];
	};
	for (const line of lines) {
		if (/^#{1,6}\s+/.test(line) && current.length > 0) flush();
		current.push(line);
	}
	flush();
	if (blocks.length === 0) return boundedExcerpt(value, limit);
	blocks.sort((a, b) => b.score - a.score || a.index - b.index);
	const selected: string[] = [];
	let remaining = limit;
	for (const block of blocks) {
		if (remaining <= 0) break;
		const text = boundedExcerpt(block.text, remaining);
		if (!text) break;
		selected.push(text);
		remaining -= text.length + 2;
	}
	return selected.join("\n\n");
}

/** Render a bounded protocol section for the reviewer briefing. */
export function renderActiveProtocolContext(
	context: ActiveProtocolContext,
	includeContent: boolean,
	maxChars = MAX_PROTOCOL_ATTACHMENT_CHARS,
): string {
	if (context.files.length === 0) return "";
	const sections: string[] = [
		"=== ACTIVE PROJECT PROTOCOL (BINDING) ===",
		"Recently loaded local skill guidance is authoritative for this task unless it conflicts with higher-priority system or user instructions. Preserve its operative rules; do not silently substitute generic workflow advice.",
	];

	if (!includeContent) {
		sections.push(
			"The full text is available through the restricted advisor skill tools when they are present. Recently loaded files:",
			...context.files.slice(0, MAX_PROTOCOL_FILES).map((file) => `- ${file.path}`),
		);
		return sections.join("\n");
	}

	let remaining = Math.max(0, maxChars - sections.join("\n\n").length - 2);
	for (const file of context.files.slice(0, MAX_PROTOCOL_FILES)) {
		if (remaining <= 0) break;
		const header = `--- ${file.path} ---`;
		const bodyBudget = Math.max(0, remaining - header.length - 2);
		const body = boundedExcerpt(file.content, bodyBudget);
		if (!body) break;
		sections.push(`${header}\n${body}`);
		remaining -= header.length + body.length + 2;
	}
	return sections.join("\n\n");
}

/**
 * Bound correlated skill reads before serializing them into a side-call. The
 * full bounded attachment is assembled separately from the branch; keeping a
 * short marker/excerpt here prevents the same skill document from being copied
 * wholesale into the scribe or repeated in recent activity.
 */
export function boundSkillReadResults(messages: Message[], cwd: string, maxChars = 3_500): Message[] {
	const readCalls = new Map<string, unknown>();
	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part.type === "toolCall" && part.name === "read") readCalls.set(part.id, part.arguments?.path);
		}
	}
	return messages.map((message) => {
		if (message.role !== "toolResult" || message.toolName !== "read") return message;
		const callPath = readCalls.get(message.toolCallId);
		const skillPath = resolveAllowedSkillPath(callPath, cwd, false);
		const content = textFromContent(message.content);
		if (skillPath && skillPath.toLowerCase().endsWith(".md")) {
			return {
				...message,
				content: [{ type: "text" as const, text: `[Local skill protocol read; bounded excerpt from ${skillPath}]\n${operativeProtocolExcerpt(content, maxChars)}` }],
			};
		}
		// A delta can begin with a tool result whose call is before the retained
		// boundary. Cap that orphaned read conservatively rather than risking a
		// large document in the scribe input.
		if (callPath === undefined) {
			return {
				...message,
				content: [{ type: "text" as const, text: `[Read result bounded for side-call]\n${boundedExcerpt(content, maxChars)}` }],
			};
		}
		return message;
	});
}
