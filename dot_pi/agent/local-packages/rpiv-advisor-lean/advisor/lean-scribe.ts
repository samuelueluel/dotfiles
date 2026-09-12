import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AssistantMessage, Message, Model, TextContent, Usage } from "@earendil-works/pi-ai";
import { serializeConversation, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stripInflightAdvisorCall } from "./context.js";
import { boundSkillReadResults } from "./protocol.js";

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

Preserve exact paths, identifiers, commands, error strings, versions, thresholds, and material numerical values. When the activity contains local skill/protocol guidance, treat its operative rules as active constraints and retain the rule, its scope, and the skill path in the checkpoint. Distill that guidance; do not copy an entire skill document into the checkpoint. Remove stale or superseded state instead of accumulating it. The output is a checkpoint, not narrative prose.`;

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
	protocolAttached: boolean;
	protocolFiles?: string[];
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

export const DEFAULT_MAX_DIFF_CHARS = 24_000;

const NOISE_PATHSPECS = [
	":(exclude)*.dta",
	":(exclude)*.csv",
	":(exclude)*.parquet",
	":(exclude)*.feather",
	":(exclude)*.rds",
	":(exclude)*.raw",
	":(exclude)*.lock*",
	":(exclude)*package-lock.json",
	":(exclude)*.min.*",
];

const EXCLUDE_ARGS = NOISE_PATHSPECS.map((p) => `"${p}"`).join(" ");

function getUntrackedSummary(cwd: string, statusLines: string[]): string | null {
	const untrackedPaths = statusLines
		.filter((line) => line.startsWith("?? "))
		.map((line) => line.slice(3).trim())
		.filter((file) => {
			const lower = file.toLowerCase();
			return (
				!lower.endsWith(".dta") &&
				!lower.endsWith(".csv") &&
				!lower.endsWith(".parquet") &&
				!lower.endsWith(".feather") &&
				!lower.endsWith(".rds") &&
				!lower.endsWith(".raw") &&
				!lower.endsWith(".lock") &&
				!lower.endsWith(".lockb") &&
				!lower.includes("package-lock") &&
				!lower.includes(".min.")
			);
		});
	if (untrackedPaths.length === 0) return null;

	const entries: string[] = [];
	for (const relPath of untrackedPaths.slice(0, 5)) {
		const fullPath = join(cwd, relPath);
		try {
			const stats = statSync(fullPath);
			if (stats.isDirectory()) {
				entries.push(`- ${relPath}/ (untracked directory)`);
			} else if (stats.isFile()) {
				if (stats.size <= 4_000) {
					const content = readFileSync(fullPath, "utf8");
					entries.push(`--- /dev/null\n+++ b/${relPath} (untracked)\n${content.trimEnd()}`);
				} else {
					entries.push(`- ${relPath} (untracked file, ${stats.size} bytes)`);
				}
			}
		} catch {
			entries.push(`- ${relPath} (untracked)`);
		}
	}
	if (untrackedPaths.length > 5) {
		entries.push(`... and ${untrackedPaths.length - 5} more untracked files`);
	}
	return entries.join("\n\n");
}

export function getWorkingGitDiff(cwd: string, maxChars = DEFAULT_MAX_DIFF_CHARS): string | null {
	try {
		const status = execSync("git status --porcelain", {
			cwd,
			encoding: "utf8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (!status) return null;

		const statusLines = status.split("\n");
		let stat = "";
		let diff = "";
		try {
			stat = execSync(`git diff --stat HEAD -- ${EXCLUDE_ARGS}`, {
				cwd,
				encoding: "utf8",
				timeout: 2000,
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();

			diff = execSync(`git diff HEAD -- ${EXCLUDE_ARGS}`, {
				cwd,
				encoding: "utf8",
				timeout: 3000,
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		} catch {
			// HEAD might not exist or diff may fail
		}

		const untracked = getUntrackedSummary(cwd, statusLines);
		const sections: string[] = [];
		if (stat) sections.push(stat);
		if (diff) sections.push(diff);
		if (untracked) sections.push(`=== UNTRACKED FILES ===\n${untracked}`);
		if (sections.length === 0) return null;

		const payload = sections.join("\n\n");
		return payload.length > maxChars
			? `${payload.slice(0, maxChars)}\n... [diff truncated]`
			: payload;
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
	protocolText?: string;
}): string {
	const sections: string[] = [];
	if (opts.checkpoint) {
		sections.push(`=== ADVISOR CHECKPOINT ===\n${opts.checkpoint.summary}`);
	}
	if (hasText(opts.currentUserRequest)) {
		sections.push(`=== CURRENT USER REQUEST (VERBATIM; AUTHORITATIVE) ===\n${opts.currentUserRequest}`);
	}
	if (hasText(opts.protocolText)) sections.push(opts.protocolText);

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
	protocolText?: string;
	protocolFiles?: string[];
	maxDiffChars?: number;
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
		protocolText,
		protocolFiles,
		maxDiffChars,
	} = opts;

	// Native tool-call blocks are useful to the executor but brittle in a sliced
	// side-call: a retained toolResult without its assistant toolCall is rejected
	// by providers. We therefore serialize all advisor/scribe history into labeled
	// text and never forward native toolCall/toolResult blocks. Skill reads are
	// bounded before either side-call; the full bounded protocol attachment is
	// assembled separately from correlated branch entries.
	const deltaMessages = stripInflightAdvisorCall(rawSessionMessages);
	const scribeDeltaMessages = boundSkillReadResults(deltaMessages, ctx.cwd, 3_500);
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
										deltaMessages: scribeDeltaMessages,
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
	const advisorActivityMessages = boundSkillReadResults(activityMessages, ctx.cwd, 2_000);
	const briefing = buildAdvisorBriefing({
		checkpoint,
		currentUserRequest,
		question,
		evidence,
		priorEvidence,
		activityMessages: advisorActivityMessages,
		gitDiff: getWorkingGitDiff(ctx.cwd, maxDiffChars),
		checkpointUpdated,
		protocolText,
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
			protocolAttached: hasText(protocolText),
			protocolFiles: protocolFiles?.length ? protocolFiles : undefined,
		},
	};
}
