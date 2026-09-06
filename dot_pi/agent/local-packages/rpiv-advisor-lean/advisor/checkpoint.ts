import type { Message } from "@earendil-works/pi-ai";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import type { AdvisorCheckpointState } from "./lean-scribe.js";
import { ADVISOR_TOOL_NAME } from "./messages.js";

interface EntryLike {
	type: string;
	id?: string;
	message?: any;
}

function isCheckpoint(value: unknown): value is AdvisorCheckpointState {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		candidate.version === 1 &&
		typeof candidate.summary === "string" &&
		candidate.summary.length > 0 &&
		typeof candidate.throughEntryId === "string" &&
		candidate.throughEntryId.length > 0
	);
}

export function findLatestAdvisorEvidence(branchEntries: EntryLike[]): string | undefined {
	for (let index = branchEntries.length - 1; index >= 0; index--) {
		const entry = branchEntries[index];
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "toolResult" || message.toolName !== ADVISOR_TOOL_NAME) continue;
		const evidence = message.details?.consultationEvidence;
		// One-hop retention: only the immediately preceding advisor result can
		// carry exact evidence forward. Do not search older advisor results, which
		// would pin a large source blob indefinitely.
		return typeof evidence === "string" && evidence.trim() ? evidence : undefined;
	}
	return undefined;
}

export function findLatestAdvisorCheckpoint(branchEntries: EntryLike[]): AdvisorCheckpointState | undefined {
	const branchIndexById = new Map<string, number>();
	branchEntries.forEach((entry, index) => {
		if (typeof entry.id === "string") branchIndexById.set(entry.id, index);
	});
	for (let carrierIndex = branchEntries.length - 1; carrierIndex >= 0; carrierIndex--) {
		const entry = branchEntries[carrierIndex];
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "toolResult" || message.toolName !== ADVISOR_TOOL_NAME) continue;
		const checkpoint = message.details?.advisorCheckpoint;
		if (!isCheckpoint(checkpoint)) continue;
		const boundaryIndex = branchIndexById.get(checkpoint.throughEntryId);
		// A valid checkpoint can summarize only state that existed before the tool
		// result carrying it. Reject imported/malformed future boundaries that would
		// otherwise skip unsummarized activity.
		if (boundaryIndex !== undefined && boundaryIndex < carrierIndex) return checkpoint;
	}
	return undefined;
}

export function messagesAfterCheckpoint(
	branchEntries: EntryLike[],
	checkpoint: AdvisorCheckpointState,
): Message[] | undefined {
	const checkpointIndex = branchEntries.findIndex((entry) => entry.id === checkpoint.throughEntryId);
	if (checkpointIndex < 0) return undefined;
	const deltaEntries = branchEntries.slice(checkpointIndex + 1);
	// Pi compaction and branch summaries define a new resolved-context boundary.
	// Returning undefined tells execute.ts to discard the advisor checkpoint and
	// use buildSessionContext() rather than replay raw pre-compaction messages or
	// omit summary-only state.
	if (deltaEntries.some((entry) => entry.type === "compaction" || entry.type === "branch_summary")) {
		return undefined;
	}
	const agentMessages = deltaEntries
		.filter((entry) => entry.type === "message" && entry.message)
		.map((entry) => entry.message);
	return convertToLlm(agentMessages);
}

function userText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (part && typeof part === "object" && (part as any).type === "text") return String((part as any).text ?? "");
			if (part && typeof part === "object" && (part as any).type === "image") return "[image attachment]";
			return "";
		})
		.filter((part) => part.length > 0)
		.join("\n");
}

export function findLatestUserRequest(branchEntries: EntryLike[]): string | undefined {
	for (let index = branchEntries.length - 1; index >= 0; index--) {
		const entry = branchEntries[index];
		if (entry.type !== "message" || entry.message?.role !== "user") continue;
		const text = userText(entry.message.content);
		if (text.trim()) return text;
	}
	return undefined;
}
