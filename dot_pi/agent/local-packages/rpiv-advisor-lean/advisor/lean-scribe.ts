import { execSync } from "node:child_process";
import type { AssistantMessage, Message, Model, TextContent, Usage } from "@earendil-works/pi-ai";
import { serializeConversation, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stripInflightAdvisorCall } from "./context.js";

const SUMMARY_MESSAGE_THRESHOLD = 12;
const SUMMARY_CHAR_THRESHOLD = 16_000;
const RAW_TAIL_MESSAGES = 4;

export const SCRIBE_SYSTEM_PROMPT = `You are an executive scribe maintaining a state-transfer checkpoint for a senior technical advisor. An executor model is working on a task and may consult the advisor repeatedly.

Rewrite the prior checkpoint (if supplied) using only the new activity, current user request, and explicit consultation question supplied below. Do not answer the consultation question. Produce EXACTLY these seven sections (maximum 450 words total):

1. CURRENT USER GOAL:
   - The current task, not superseded requests from earlier in the session.

2. CONSTRAINTS & PROHIBITIONS:
   - Explicit user requirements, safety boundaries, and scope limits that remain active.

3. VALIDATED FACTS & WORK COMPLETED:
   - Established evidence, files inspected or changed, and verification already performed. Preserve the conclusions and exact identifiers from supplied consultation evidence so they survive after the one-hop verbatim copy expires.

4. KEY DECISIONS & FAILED APPROACHES:
   - Decisions and rationale; failures that must not be repeated. Distinguish facts from assumptions.

5. ACTIVE STATE & PROPOSED NEXT STEP:
   - The executor's present hypothesis, intended action, and assumptions it relies on.

6. BLOCKERS & UNRESOLVED QUESTIONS:
   - Concrete errors, contradictions, missing evidence, or choices still open.

7. CONSULTATION TARGET:
   - The exact question for the advisor when supplied; otherwise the specific judgment now needed.

Preserve exact paths, identifiers, commands, error strings, versions, thresholds, and material numerical values. Remove stale or superseded state instead of accumulating it. The output is a checkpoint, not narrative prose.`;

export interface AdvisorCheckpointState {
	version: 1;
	summary: string;
	throughEntryId: string;
}

export interface LeanMetrics {
	summarized: boolean;
	summaryAttempted: boolean;
	scribeModel?: string;
	scribeError?: string;
	rawMessagesCount: number;
	deltaMessagesCount: number;
	leanMessagesCount: number;
	checkpointReused: boolean;
	checkpointUpdated: boolean;
}

export interface LeanResult {
	messages: Message[];
	checkpoint?: AdvisorCheckpointState;
	leanMetrics: LeanMetrics;
	scribeUsage?: Usage;
}

function contentCharacterCount(messages: Message[]): number {
	let total = 0;
	for (const msg of messages) {
		if (typeof msg.content === "string") {
			total += msg.content.length;
			continue;
		}
		if (!Array.isArray(msg.content)) continue;
		for (const part of msg.content) {
			if (part && typeof part === "object" && "text" in part && typeof (part as any).text === "string") {
				total += (part as any).text.length;
			} else if (part && typeof part === "object" && "thinking" in part && typeof (part as any).thinking === "string") {
				total += (part as any).thinking.length;
			}
		}
	}
	return total;
}

function hasText(value: string | undefined): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function splitModelKey(modelKey: string): [string | undefined, string | undefined] {
	const slash = modelKey.indexOf("/");
	if (slash <= 0 || slash === modelKey.length - 1) return [undefined, undefined];
	return [modelKey.slice(0, slash), modelKey.slice(slash + 1)];
}

function textMessage(text: string): Message {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function transcript(messages: Message[]): string {
	if (messages.length === 0) return "(no new activity)";
	return serializeConversation(messages);
}

function getWorkingGitDiff(cwd: string): string | null {
	try {
		const status = execSync("git status --porcelain", {
			cwd,
			encoding: "utf8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (!status) return null;
		const diff = execSync("git diff HEAD", {
			cwd,
			encoding: "utf8",
			timeout: 3000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (!diff) return null;
		return diff.length > 3500 ? `${diff.slice(0, 3500)}\n... [diff truncated]` : diff;
	} catch {
		return null;
	}
}

function buildScribeInput(opts: {
	previousCheckpoint?: AdvisorCheckpointState;
	currentUserRequest?: string;
	question?: string;
	evidence?: string;
	priorEvidence?: string;
	deltaMessages: Message[];
}): string {
	const sections: string[] = [];
	if (opts.previousCheckpoint) {
		sections.push(`=== PRIOR CHECKPOINT ===\n${opts.previousCheckpoint.summary}`);
	}
	if (hasText(opts.currentUserRequest)) {
		sections.push(`=== CURRENT USER REQUEST (VERBATIM) ===\n${opts.currentUserRequest}`);
	}
	sections.push(`=== NEW ACTIVITY SINCE CHECKPOINT ===\n${transcript(opts.deltaMessages)}`);
	if (hasText(opts.question)) {
		sections.push(`=== EXPLICIT CONSULTATION QUESTION (VERBATIM) ===\n${opts.question}`);
	}
	if (hasText(opts.priorEvidence)) {
		sections.push(`=== PRIOR CONSULTATION EVIDENCE (EXACT; RETAIN CRITICAL STATE) ===\n${opts.priorEvidence}`);
	}
	if (hasText(opts.evidence)) {
		sections.push(`=== CURRENT CONSULTATION EVIDENCE (EXACT; RETAIN CRITICAL STATE) ===\n${opts.evidence}`);
	}
	return sections.join("\n\n");
}

function buildAdvisorBriefing(opts: {
	checkpoint?: AdvisorCheckpointState;
	currentUserRequest?: string;
	question?: string;
	evidence?: string;
	priorEvidence?: string;
	activityMessages: Message[];
	gitDiff: string | null;
	checkpointUpdated: boolean;
}): string {
	const sections: string[] = [];
	if (opts.checkpoint) {
		sections.push(`=== ADVISOR CHECKPOINT ===\n${opts.checkpoint.summary}`);
	}
	if (hasText(opts.currentUserRequest)) {
		sections.push(`=== CURRENT USER REQUEST (VERBATIM; AUTHORITATIVE) ===\n${opts.currentUserRequest}`);
	}

	const activityLabel = opts.checkpointUpdated
		? "RECENT ACTIVITY (VERBATIM SERIALIZATION)"
		: opts.checkpoint
			? "NEW ACTIVITY SINCE CHECKPOINT"
			: "CURRENT SESSION HISTORY";
	sections.push(`=== ${activityLabel} ===\n${transcript(opts.activityMessages)}`);

	if (opts.gitDiff) {
		sections.push(`=== WORKING GIT DIFF ===\n\`\`\`diff\n${opts.gitDiff}\n\`\`\``);
	}
	if (hasText(opts.priorEvidence)) {
		sections.push(`=== PRIOR CONSULTATION EVIDENCE (VERBATIM; ONE-HOP RETENTION) ===\n${opts.priorEvidence}`);
	}
	if (hasText(opts.evidence)) {
		sections.push(`=== CURRENT CONSULTATION EVIDENCE (VERBATIM) ===\n${opts.evidence}`);
	}

	sections.push(
		hasText(opts.question)
			? `=== CONSULTATION QUESTION (ANSWER THIS DIRECTLY) ===\n${opts.question}`
			: "=== CONSULTATION REQUEST ===\nReview the executor's current situation and give the highest-value plan, correction, or stop signal.",
	);
	return sections.join("\n\n");
}

export async function buildLeanAdvisorMessages(opts: {
	ctx: ExtensionContext;
	rawSessionMessages: Message[];
	completeSimple: (model: Model, request: any, options?: any) => Promise<AssistantMessage>;
	signal?: AbortSignal;
	onUpdate?: (update: any) => void;
	scribeModelKey?: string;
	scribeEffort?: string;
	scribeUsesRuntimeAuth?: boolean;
	previousCheckpoint?: AdvisorCheckpointState;
	currentEntryId?: string;
	currentUserRequest?: string;
	question?: string;
	evidence?: string;
	priorEvidence?: string;
}): Promise<LeanResult> {
	const {
		ctx,
		rawSessionMessages,
		completeSimple,
		signal,
		onUpdate,
		scribeModelKey = "openai-codex/gpt-5.6-luna",
		scribeEffort = "high",
		scribeUsesRuntimeAuth = false,
		previousCheckpoint,
		currentEntryId,
		currentUserRequest,
		question,
		evidence,
		priorEvidence,
	} = opts;

	// Native tool-call blocks are useful to the executor but brittle in a sliced
	// side-call: a retained toolResult without its assistant toolCall is rejected
	// by providers. We therefore serialize all advisor/scribe history into labeled
	// text and never forward native toolCall/toolResult blocks.
	const deltaMessages = stripInflightAdvisorCall(rawSessionMessages);
	const deltaChars = contentCharacterCount(deltaMessages);
	const summaryAttempted =
		deltaMessages.length > SUMMARY_MESSAGE_THRESHOLD || deltaChars > SUMMARY_CHAR_THRESHOLD;

	const [provider, modelId] = splitModelKey(scribeModelKey);
	const scribeModel =
		(provider && modelId ? ctx.modelRegistry.find(provider, modelId) : undefined) ??
		ctx.modelRegistry.find("openai-codex", "gpt-5.6-luna") ??
		ctx.modelRegistry.find("openai", "gpt-5.6-luna");
	const scribeLabel = scribeModel ? `${scribeModel.provider}:${scribeModel.id}` : undefined;

	let checkpoint = previousCheckpoint;
	let checkpointUpdated = false;
	let scribeError: string | undefined;
	let scribeUsage: Usage | undefined;

	if (summaryAttempted) {
		if (!scribeModel) {
			scribeError = `scribe model unavailable: ${scribeModelKey}`;
		} else if (!currentEntryId) {
			scribeError = "cannot advance checkpoint without a current session entry id";
		} else {
			try {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(scribeModel);
				if (!auth.ok) {
					scribeError = auth.error;
				} else if (!scribeUsesRuntimeAuth && !auth.apiKey) {
					scribeError = `no API key for legacy scribe completion (${scribeModel.provider})`;
				} else {
					onUpdate?.({
						content: [{ type: "text", text: `Refreshing advisor checkpoint with ${scribeLabel}...` }],
					});
					const scribeRequestOptions = scribeUsesRuntimeAuth
						? { signal, reasoning: scribeEffort }
						: { signal, reasoning: scribeEffort, apiKey: auth.apiKey, headers: auth.headers };
					const response = await completeSimple(
						scribeModel,
						{
							systemPrompt: SCRIBE_SYSTEM_PROMPT,
							messages: [
								textMessage(
									buildScribeInput({
										previousCheckpoint,
										currentUserRequest,
										question,
										evidence,
										priorEvidence,
										deltaMessages,
									}),
								),
							],
							tools: [],
						},
						scribeRequestOptions,
					);
					scribeUsage = response.usage;
					if (response.stopReason === "error" || response.stopReason === "aborted") {
						scribeError = response.errorMessage ?? `scribe stopped: ${response.stopReason}`;
					} else {
						const summary = response.content
							.filter((c): c is TextContent => c.type === "text")
							.map((c) => c.text)
							.join("\n")
							.trim();
						if (!summary) {
							scribeError = "scribe returned no text content";
						} else {
							checkpoint = { version: 1, summary, throughEntryId: currentEntryId };
							checkpointUpdated = true;
						}
					}
				}
			} catch (error) {
				scribeError = error instanceof Error ? error.message : String(error);
			}
		}
	}

	// When a checkpoint refresh succeeds, retain a small raw tail so the advisor
	// can inspect fresh nuance that the state-transfer summary may have compressed.
	// Otherwise send the complete unsummarized delta. On scribe failure this is a
	// correctness-preserving fallback: never advance a generic/lossy checkpoint.
	const activityMessages = checkpointUpdated ? deltaMessages.slice(-RAW_TAIL_MESSAGES) : deltaMessages;
	const briefing = buildAdvisorBriefing({
		checkpoint,
		currentUserRequest,
		question,
		evidence,
		priorEvidence,
		activityMessages,
		gitDiff: getWorkingGitDiff(ctx.cwd),
		checkpointUpdated,
	});
	const messages = [textMessage(briefing)];

	return {
		messages,
		checkpoint,
		scribeUsage,
		leanMetrics: {
			summarized: checkpointUpdated,
			summaryAttempted,
			scribeModel: scribeLabel,
			scribeError,
			rawMessagesCount: deltaMessages.length,
			deltaMessagesCount: deltaMessages.length,
			leanMessagesCount: messages.length,
			checkpointReused: previousCheckpoint !== undefined,
			checkpointUpdated,
		},
	};
}
