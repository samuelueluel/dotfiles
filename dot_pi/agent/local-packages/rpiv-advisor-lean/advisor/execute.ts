/**
 * execute — the advisor side-call. Curates the executor's branch into a
 * checkpoint-plus-delta briefing, preserves recently loaded skill protocol, and
 * invokes the advisor model through a bounded read-only skill-tool loop. Every result branch (success
 * / abort / error / empty) and the pre-call error paths funnel through
 * buildAdvisorResult so the envelope is built in exactly one place.
 */

import type { AssistantMessage, Message, StopReason, TextContent, ThinkingLevel, Usage } from "@earendil-works/pi-ai";
import {
	type AgentToolResult,
	type AgentToolUpdateCallback,
	buildSessionContext,
	convertToLlm,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	findLatestAdvisorCheckpoint,
	findLatestAdvisorEvidence,
	findLatestUserRequest,
	messagesAfterCheckpoint,
} from "./checkpoint.js";
import { getInventoryMessage, mergeInventoryWithAdvisorMessages } from "./inventory.js";
import {
	ERR_ABORTED_DETAIL,
	ERR_CALL_ABORTED,
	ERR_EMPTY_RESPONSE,
	ERR_EMPTY_RESPONSE_DETAIL,
	ERR_NO_MODEL,
	ERR_NO_MODEL_SELECTED,
	errCallFailed,
	errCallThrew,
	errMisconfigured,
	errNoApiKey,
	errNoApiKeyDetail,
	msgConsulting,
} from "./messages.js";
import { getRuntimeCompleteSimple, loadCompleteSimple } from "./pi-compat.js";
import { getAdvisorSystemPrompt } from "./prompt.js";
import { collectActiveProtocolContext, renderActiveProtocolContext } from "./protocol.js";
import {
	getAdvisorProtocolMode,
	getMaxDiffChars,
	getMaxSkillToolRounds,
	loadAdvisorConfig,
	type ProtocolMode,
} from "./config.js";
import { runAdvisorWithSkillTools } from "./skill-tools.js";
import { getAdvisorEffort, getAdvisorModel } from "./state.js";
import {
	type AdvisorCheckpointState,
	buildLeanAdvisorMessages,
	type LeanMetrics,
	type LeanResult,
} from "./lean-scribe.js";

interface AdvisorDetails {
	advisorModel?: string;
	effort?: ThinkingLevel;
	usage?: Usage;
	advisorUsage?: Usage;
	scribeUsage?: Usage;
	stopReason?: StopReason;
	errorMessage?: string;
	leanMetrics?: LeanMetrics;
	advisorCheckpoint?: AdvisorCheckpointState;
	consultationEvidence?: string;
	protocolMode?: ProtocolMode;
	skillToolRounds?: number;
	skillToolCalls?: number;
}

// Extract the advisor's text content from a completeSimple response: concatenate
// every text part, trim. Thinking/toolCall parts are ignored. Returns "" when the
// model returned no text content — the empty-response class R6.4 retries once
// before surfacing. Pure so both attempts share one extraction path.
function advisorTextFromResponse(response: AssistantMessage): string {
	return response.content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

// Single result-envelope builder — every executeAdvisor branch and the pre-call
// error paths funnel through here. `effort` is snapshotted once at executeAdvisor
// entry and threaded through every call so the returned details.effort always
// matches the value sent as `reasoning` to completeSimple, even if module-level
// state is mutated during the await window.
function combineUsage(advisorUsage?: Usage, scribeUsage?: Usage): Usage | undefined {
	if (!advisorUsage && !scribeUsage) return undefined;
	const a = advisorUsage;
	const s = scribeUsage;
	return {
		input: (a?.input ?? 0) + (s?.input ?? 0),
		output: (a?.output ?? 0) + (s?.output ?? 0),
		cacheRead: (a?.cacheRead ?? 0) + (s?.cacheRead ?? 0),
		cacheWrite: (a?.cacheWrite ?? 0) + (s?.cacheWrite ?? 0),
		totalTokens: (a?.totalTokens ?? 0) + (s?.totalTokens ?? 0),
		cost: {
			input: (a?.cost.input ?? 0) + (s?.cost.input ?? 0),
			output: (a?.cost.output ?? 0) + (s?.cost.output ?? 0),
			cacheRead: (a?.cost.cacheRead ?? 0) + (s?.cost.cacheRead ?? 0),
			cacheWrite: (a?.cost.cacheWrite ?? 0) + (s?.cost.cacheWrite ?? 0),
			total: (a?.cost.total ?? 0) + (s?.cost.total ?? 0),
		},
	};
}

function buildAdvisorResult(opts: {
	text: string;
	effort: ThinkingLevel | undefined;
	advisorLabel?: string;
	advisorUsage?: Usage;
	scribeUsage?: Usage;
	stopReason?: StopReason;
	errorMessage?: string;
	leanResult?: LeanResult;
	consultationEvidence?: string;
	protocolMode?: ProtocolMode;
	skillToolRounds?: number;
	skillToolCalls?: number;
}): AgentToolResult<AdvisorDetails> {
	const usage = combineUsage(opts.advisorUsage, opts.scribeUsage);
	const details: AdvisorDetails = { effort: opts.effort };
	if (opts.advisorLabel !== undefined) details.advisorModel = opts.advisorLabel;
	if (usage !== undefined) details.usage = usage;
	if (opts.advisorUsage !== undefined) details.advisorUsage = opts.advisorUsage;
	if (opts.scribeUsage !== undefined) details.scribeUsage = opts.scribeUsage;
	if (opts.stopReason !== undefined) details.stopReason = opts.stopReason;
	if (opts.errorMessage !== undefined) details.errorMessage = opts.errorMessage;
	if (opts.leanResult !== undefined) {
		details.leanMetrics = opts.leanResult.leanMetrics;
		if (opts.leanResult.checkpoint) details.advisorCheckpoint = opts.leanResult.checkpoint;
	}
	if (opts.consultationEvidence !== undefined) details.consultationEvidence = opts.consultationEvidence;
	if (opts.protocolMode !== undefined) details.protocolMode = opts.protocolMode;
	if (opts.skillToolRounds !== undefined) details.skillToolRounds = opts.skillToolRounds;
	if (opts.skillToolCalls !== undefined) details.skillToolCalls = opts.skillToolCalls;
	return { content: [{ type: "text", text: opts.text }], details, usage };
}

function buildErrorResult(
	advisorLabel: string | undefined,
	effort: ThinkingLevel | undefined,
	userText: string,
	errorMessage: string,
): AgentToolResult<AdvisorDetails> {
	return buildAdvisorResult({ text: userText, effort, advisorLabel, errorMessage });
}

export async function executeAdvisor(
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	consultation: { question?: string; evidence?: string },
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<AdvisorDetails> | undefined,
): Promise<AgentToolResult<AdvisorDetails>> {
	// Snapshot effort once at entry — every result envelope and the API call
	// itself use this same value so a concurrent setAdvisorEffort() during the
	// await window cannot desync details.effort from the `reasoning` actually sent.
	const effort = getAdvisorEffort();
	const advisor = getAdvisorModel();
	if (!advisor) {
		return buildErrorResult(undefined, effort, ERR_NO_MODEL, ERR_NO_MODEL_SELECTED);
	}
	const advisorLabel = `${advisor.provider}:${advisor.id}`;

	let leanResult: LeanResult | undefined;
	let accumulatedAdvisorUsage: Usage | undefined;
	let protocolMode: ProtocolMode | undefined;
	let skillToolRounds = 0;
	let skillToolCalls = 0;
	try {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(advisor);
		if (!auth.ok) {
			return buildErrorResult(advisorLabel, effort, errMisconfigured(advisorLabel, auth.error), auth.error);
		}
		// OAuth-backed providers resolve `{ ok: true }` with no literal apiKey — their
		// credentials are applied inside Pi's runtime facade. A missing key is only
		// fatal on legacy hosts without that facade, where the global completion
		// fallback needs the key passed explicitly.
		const runtimeCompleteSimple = getRuntimeCompleteSimple(ctx.modelRegistry);
		if (!auth.apiKey && !runtimeCompleteSimple) {
			return buildErrorResult(advisorLabel, effort, errNoApiKey(advisorLabel), errNoApiKeyDetail(advisor.provider));
		}

		// Prefer Pi's auth-aware runtime facade (resolved once above, before the
		// missing-key guard). Unlike the global compatibility function, it runs
		// request preparation and applies credential-derived fields such as GitHub
		// Copilot's OAuth-specific baseUrl. Do not pass the preflight key/headers
		// to this path: explicit overrides would bypass that resolution and
		// reintroduce the endpoint mismatch.
		const completeSimple = runtimeCompleteSimple ?? (await loadCompleteSimple());
		const requestOptions = runtimeCompleteSimple
			? { signal, reasoning: effort }
			: { apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: effort };

		// Live-read every call — advisor runs mid-turn so any message_end snapshot
		// is always one turn stale. buildSessionContext() preserves Pi's resolved
		// LLM context, including compaction summaries and branch summaries, instead
		// of replaying raw pre-compaction branch messages. convertToLlm is
		// pass-through for user/assistant/toolResult (messages.js:111-114), so
		// element refs are stable across calls via the session store.
		const { messages: sessionMessages } = buildSessionContext(
			ctx.sessionManager.getEntries(),
			ctx.sessionManager.getLeafId(),
		);

		onUpdate?.({
			content: [{ type: "text", text: msgConsulting(advisorLabel, effort) }],
			details: { advisorModel: advisorLabel, effort },
		});

		const branchEntries = ctx.sessionManager.getBranch();
		const checkpointCandidate = findLatestAdvisorCheckpoint(branchEntries);
		const priorEvidence = findLatestAdvisorEvidence(branchEntries);
		const checkpointDelta = checkpointCandidate
			? messagesAfterCheckpoint(branchEntries, checkpointCandidate)
			: undefined;
		// An undefined delta means a Pi compaction/branch-summary boundary occurred
		// after the stored advisor checkpoint. Reset to Pi's resolved context rather
		// than replaying raw history across that boundary.
		const previousCheckpoint = checkpointDelta === undefined ? undefined : checkpointCandidate;
		const advisorCfg = loadAdvisorConfig();
		protocolMode = getAdvisorProtocolMode(advisorCfg);
		const activeProtocol = collectActiveProtocolContext(branchEntries, ctx.cwd);
		const protocolText = renderActiveProtocolContext(
			activeProtocol,
			protocolMode === "attach" || protocolMode === "both",
		);
		leanResult = await buildLeanAdvisorMessages({
			ctx,
			rawSessionMessages: checkpointDelta ?? convertToLlm(sessionMessages),
			completeSimple,
			signal,
			onUpdate,
			scribeModelKey: advisorCfg.scribeModelKey,
			scribeEffort: advisorCfg.scribeEffort ?? "high",
			scribeUsesRuntimeAuth: runtimeCompleteSimple !== undefined,
			previousCheckpoint,
			currentEntryId: ctx.sessionManager.getLeafId() ?? undefined,
			currentUserRequest: findLatestUserRequest(branchEntries),
			question: consultation.question,
			evidence: consultation.evidence,
			priorEvidence,
			protocolText,
			protocolFiles: activeProtocol.files.map((file) => file.path),
			maxDiffChars: getMaxDiffChars(advisorCfg),
		});

		const inventoryMessage = getInventoryMessage(pi.getAllTools());
		const messages: Message[] = mergeInventoryWithAdvisorMessages(inventoryMessage, leanResult.messages);
		const systemPrompt = getAdvisorSystemPrompt(advisorCfg.systemPromptFile);
		const configuredToolRounds = getMaxSkillToolRounds(advisorCfg);
		const skillToolsEnabled = protocolMode !== "attach" && configuredToolRounds > 0;
		const maxToolRounds = skillToolsEnabled ? configuredToolRounds : 0;
		let remainingToolRounds = maxToolRounds;

		// Historical executor tool activity is serialized to text, so no orphan
		// provider call IDs are forwarded. The only native tools exposed here are
		// the bounded, read-only skill tools serviced by runAdvisorWithSkillTools.
		const callAdvisor = async (): Promise<AssistantMessage> => {
			const attemptToolRounds = remainingToolRounds;
			const run = await runAdvisorWithSkillTools({
				model: advisor,
				systemPrompt,
				initialMessages: messages,
				completeSimple,
				requestOptions,
				cwd: ctx.cwd,
				maxToolRounds: attemptToolRounds,
				toolsEnabled: skillToolsEnabled && attemptToolRounds > 0,
				onUsage: (usage) => {
					accumulatedAdvisorUsage = combineUsage(accumulatedAdvisorUsage, usage);
				},
				onToolRound: (round, calls) => {
					onUpdate?.({
						content: [{ type: "text", text: `Advisor checking local skill protocol (round ${round}, ${calls.length} call${calls.length === 1 ? "" : "s"})...` }],
						details: { advisorModel: advisorLabel, effort },
					});
				},
			});
			remainingToolRounds = Math.max(0, remainingToolRounds - run.toolRounds);
			skillToolRounds += run.toolRounds;
			skillToolCalls += run.toolCalls;
			return run.response as AssistantMessage;
		};

		// Build the terminal envelope for an aborted/error stopReason, or return
		// undefined when the attempt produced a normal stop whose text (or lack of
		// text) the caller must still resolve. Aborted/error short-circuit and are
		// NEVER retried — they are not the empty-response class R6.4 targets.
		const stopReasonEnvelope = (r: AssistantMessage): AgentToolResult<AdvisorDetails> | undefined => {
			if (r.stopReason === "aborted") {
				return buildAdvisorResult({
					text: ERR_CALL_ABORTED,
					effort,
					advisorLabel,
					advisorUsage: accumulatedAdvisorUsage,
					scribeUsage: leanResult?.scribeUsage,
					stopReason: r.stopReason,
					errorMessage: r.errorMessage ?? ERR_ABORTED_DETAIL,
					leanResult,
					consultationEvidence: consultation.evidence,
					protocolMode,
					skillToolRounds,
					skillToolCalls,
				});
			}
			if (r.stopReason === "error") {
				return buildAdvisorResult({
					text: errCallFailed(r.errorMessage),
					effort,
					advisorLabel,
					advisorUsage: accumulatedAdvisorUsage,
					scribeUsage: leanResult?.scribeUsage,
					stopReason: r.stopReason,
					errorMessage: r.errorMessage,
					leanResult,
					consultationEvidence: consultation.evidence,
					protocolMode,
					skillToolRounds,
					skillToolCalls,
				});
			}
			return undefined;
		};

		let response = await callAdvisor();

		// Aborted/error short-circuit on the first attempt — no retry.
		const firstTerminal = stopReasonEnvelope(response);
		if (firstTerminal) return firstTerminal;

		let advisorText = advisorTextFromResponse(response);

		// R6.4: a transient empty advisor response (normal stop, no text) gets
		// exactly ONE retry with identical inputs before surfacing as a terminal
		// error. Bounded to a single second call — never a `while`/loop — so a
		// persistent-empty provider cannot hot-loop. The retry reuses the SAME
		// pre-computed `messages`/`requestOptions` (no re-derivation that could
		// diverge from attempt 1), then applies the same three-way route.
		if (!advisorText) {
			response = await callAdvisor();

			const retryTerminal = stopReasonEnvelope(response);
			if (retryTerminal) return retryTerminal;

			advisorText = advisorTextFromResponse(response);
			if (!advisorText) {
				return buildAdvisorResult({
					text: ERR_EMPTY_RESPONSE,
					effort,
					advisorLabel,
					advisorUsage: accumulatedAdvisorUsage,
					scribeUsage: leanResult.scribeUsage,
					stopReason: response.stopReason,
					errorMessage: ERR_EMPTY_RESPONSE_DETAIL,
					leanResult,
					consultationEvidence: consultation.evidence,
					protocolMode,
					skillToolRounds,
					skillToolCalls,
				});
			}
		}

		return buildAdvisorResult({
			text: advisorText,
			effort,
			advisorLabel,
			advisorUsage: accumulatedAdvisorUsage,
			scribeUsage: leanResult.scribeUsage,
			stopReason: response.stopReason,
			leanResult,
			consultationEvidence: consultation.evidence,
			protocolMode,
			skillToolRounds,
			skillToolCalls,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return buildAdvisorResult({
			text: errCallThrew(message),
			effort,
			advisorLabel,
			advisorUsage: accumulatedAdvisorUsage,
			scribeUsage: leanResult?.scribeUsage,
			errorMessage: message,
			leanResult,
			consultationEvidence: consultation.evidence,
			protocolMode,
			skillToolRounds,
			skillToolCalls,
		});
	}
}
