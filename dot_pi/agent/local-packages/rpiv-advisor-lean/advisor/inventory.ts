/**
 * inventory — stable tool-inventory Message for advisor prompt-cache parity.
 *
 * globalThis-keyed (Symbol.for("rpiv-advisor")) so the cache survives module
 * re-import on /new, /fork, /resume (mirrors rpiv-btw/btw.ts). Single-slot — the
 * Pi tool registry is process-scoped, so per-session keying would be redundant;
 * the cache invalidates only when the set of registered tool names changes. Also
 * exposes the key-sorted JSON serializer (stableStringify) the block is built from.
 */

import type { Message } from "@earendil-works/pi-ai";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";

const ADVISOR_STATE_KEY = Symbol.for("rpiv-advisor");

interface AdvisorState {
	inventorySignature?: string;
	inventoryMessage?: Message;
}

function getAdvisorRuntimeState(): AdvisorState {
	const g = globalThis as unknown as { [k: symbol]: AdvisorState | undefined };
	let state = g[ADVISOR_STATE_KEY];
	if (!state) {
		state = {};
		g[ADVISOR_STATE_KEY] = state;
	}
	return state;
}

// Recursive key-sorted JSON serializer — matches JSON.stringify semantics
// (drops `undefined` in objects, emits `null` for `undefined` in arrays) but
// guarantees stable key ordering across V8 insertion-order variation. Required
// because nested TypeBox schemas may be authored in any order, and prompt
// caching is byte-sensitive.
export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	const entries: string[] = [];
	for (const k of Object.keys(obj).sort()) {
		const v = obj[k];
		if (v === undefined) continue;
		entries.push(`${JSON.stringify(k)}:${stableStringify(v)}`);
	}
	return `{${entries.join(",")}}`;
}

function buildInventoryBlock(tools: ToolInfo[]): string {
	// Omit `sourceInfo` — its `path` field is install-location-dependent and
	// would bust cache parity across machines/reinstalls.
	return tools
		.map((t) => `### ${t.name}\n${t.description}\n\nParameters: ${stableStringify(t.parameters)}`)
		.join("\n\n---\n\n");
}

// Returns `undefined` when the registry is empty (no extensions loaded) so
// callers can skip prepending an empty block that would still cost a cache unit.
export function getInventoryMessage(tools: ToolInfo[]): Message | undefined {
	if (tools.length === 0) return undefined;
	const sorted = [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	const inventoryBlock = buildInventoryBlock(sorted);
	// Include descriptions and schemas, not only names. A /reload can change a
	// tool's parameters (for example advisor's optional question) without changing
	// the registered name set; a name-only signature would retain stale inventory.
	const signature = inventoryBlock;
	const state = getAdvisorRuntimeState();
	if (state.inventorySignature === signature && state.inventoryMessage) {
		return state.inventoryMessage;
	}
	const text = `## Available Executor Tools\n\n${inventoryBlock}`;
	const message: Message = {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
	state.inventorySignature = signature;
	state.inventoryMessage = message;
	return message;
}

export function mergeInventoryWithAdvisorMessages(inventory: Message | undefined, messages: Message[]): Message[] {
	if (!inventory) return messages;
	if (messages.length === 0) return [inventory];
	const first = messages[0];
	if (inventory.role !== "user" || first.role !== "user") return [inventory, ...messages];

	const inventoryText = Array.isArray(inventory.content)
		? inventory.content
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.map((part) => part.text)
				.join("\n")
		: String(inventory.content);
	const briefingText = Array.isArray(first.content)
		? first.content
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.map((part) => part.text)
				.join("\n")
		: String(first.content);
	const merged: Message = {
		role: "user",
		content: [{ type: "text", text: `${inventoryText}\n\n---\n\n${briefingText}` }],
		timestamp: first.timestamp,
	};
	return [merged, ...messages.slice(1)];
}
