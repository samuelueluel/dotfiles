import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createJiti } = require(`${process.env.HOME}/.pi/agent/npm/node_modules/.jiti-vMeKVizl/lib/jiti.cjs`);
const piModules = "/var/home/linuxbrew/.linuxbrew/Cellar/pi-coding-agent/0.85.1/libexec/lib/node_modules";
const jiti = createJiti(`${process.env.HOME}/.pi/agent/npm`, {
	alias: {
		"@earendil-works/pi-coding-agent": `${piModules}/@earendil-works/pi-coding-agent/dist/index.js`,
		"@earendil-works/pi-ai": `${piModules}/@earendil-works/pi-ai/dist/index.js`,
	},
});
const packageRoot = `${process.env.HOME}/.pi/agent/local-packages/rpiv-advisor-lean`;
const { buildLeanAdvisorMessages, SCRIBE_SYSTEM_PROMPT } = await jiti.import(
	`${packageRoot}/advisor/lean-scribe.ts`,
);
const {
	findLatestAdvisorCheckpoint,
	findLatestAdvisorEvidence,
	findLatestUserRequest,
	messagesAfterCheckpoint,
} = await jiti.import(`${packageRoot}/advisor/checkpoint.ts`);
const { getInventoryMessage, mergeInventoryWithAdvisorMessages } = await jiti.import(
	`${packageRoot}/advisor/inventory.ts`,
);
const { executeAdvisor } = await jiti.import(`${packageRoot}/advisor/execute.ts`);
const {
	collectActiveProtocolContext,
	getAllowedSkillRoots,
	resolveAllowedSkillPath,
	renderActiveProtocolContext,
} = await jiti.import(`${packageRoot}/advisor/protocol.ts`);
const {
	ADVISOR_SKILL_TOOLS,
	executeAdvisorSkillTool,
	runAdvisorWithSkillTools,
} = await jiti.import(`${packageRoot}/advisor/skill-tools.ts`);
const { getAdvisorSystemPrompt } = await jiti.import(`${packageRoot}/advisor/prompt.ts`);
const { setAdvisorEffort, setAdvisorModel } = await jiti.import(`${packageRoot}/advisor/state.ts`);
const { SessionManager } = await import(`${piModules}/@earendil-works/pi-coding-agent/dist/index.js`);

const user = (text, timestamp = 1) => ({
	role: "user",
	content: [{ type: "text", text }],
	timestamp,
});

const assistant = (content, timestamp = 1) => ({
	role: "assistant",
	content,
	api: "openai-codex-responses",
	provider: "openai-codex",
	model: "gpt-5.6-luna",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "toolUse",
	timestamp,
});

const toolResult = (name, id, text, timestamp = 1) => ({
	role: "toolResult",
	toolCallId: id,
	toolName: name,
	content: [{ type: "text", text }],
	isError: false,
	timestamp,
});

function dummyContext(model) {
	return {
		cwd: process.cwd(),
		modelRegistry: {
			find: (provider, id) =>
				model && provider === model.provider && id === model.id ? model : undefined,
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "mock-key" }),
		},
	};
}

test("short sessions bypass the scribe and become a serialized advisor briefing", async () => {
	const rawSessionMessages = [
		user("Please explore the dataset.", 1),
		assistant([{ type: "text", text: "I will check the directory." }], 2),
	];
	const completeSimple = async () => {
		throw new Error("scribe should not be called for a short session");
	};

	const result = await buildLeanAdvisorMessages({
		ctx: dummyContext(),
		rawSessionMessages,
		completeSimple,
		currentUserRequest: "Please explore the dataset.",
		question: "  Is this the right first step?  ",
		evidence: "  exact evidence  ",
		currentEntryId: "entry-now",
	});

	assert.equal(result.leanMetrics.summaryAttempted, false);
	assert.equal(result.leanMetrics.summarized, false);
	assert.equal(result.messages.length, 1);
	assert.equal(result.messages[0].role, "user");
	const briefing = result.messages[0].content[0].text;
	assert.match(briefing, /CURRENT USER REQUEST \(VERBATIM; AUTHORITATIVE\)/);
	assert.match(briefing, /\n  Is this the right first step\?  $/);
	assert.match(briefing, /CURRENT CONSULTATION EVIDENCE \(VERBATIM\) ===\n  exact evidence  /);
	assert.match(briefing, /\[Assistant\]: I will check the directory\./);
});

test("long sessions refresh a checkpoint from one serialized scribe input", async () => {
	const rawSessionMessages = [user("Clean panel data", 1)];
	for (let i = 0; i < 6; i++) {
		const id = `call-${i}`;
		rawSessionMessages.push(
			assistant([{ type: "toolCall", id, name: "bash", arguments: { command: `step-${i}` } }], i * 2 + 2),
			toolResult("bash", id, `result-${i}`, i * 2 + 3),
		);
	}
	rawSessionMessages.push(
		assistant(
			[
				{ type: "thinking", thinking: "I suspect the merge key is malformed." },
				{ type: "toolCall", id: "advisor-now", name: "advisor", arguments: {} },
			],
			20,
		),
	);

	const model = { provider: "openai-codex", id: "gpt-5.6-luna" };
	let scribeRequest;
	const completeSimple = async (_model, request, options) => {
		scribeRequest = { request, options };
		return {
			content: [{ type: "text", text: "1. CURRENT USER GOAL:\nClean panel data.\n7. CONSULTATION TARGET:\nInspect merge-key strategy." }],
			stopReason: "stop",
			usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		};
	};

	const result = await buildLeanAdvisorMessages({
		ctx: dummyContext(model),
		rawSessionMessages,
		completeSimple,
		currentUserRequest: "Clean panel data",
		question: "Should malformed keys be dropped?",
		currentEntryId: "entry-now",
	});

	assert.equal(scribeRequest.request.systemPrompt, SCRIBE_SYSTEM_PROMPT);
	assert.equal(scribeRequest.request.messages.length, 1);
	assert.equal(scribeRequest.request.messages[0].role, "user");
	assert.equal(scribeRequest.request.messages.some((message) => message.role === "toolResult"), false);
	assert.match(scribeRequest.request.messages[0].content[0].text, /CURRENT USER REQUEST \(VERBATIM\)/);
	assert.match(scribeRequest.request.messages[0].content[0].text, /Should malformed keys be dropped\?/);
	assert.equal(scribeRequest.options.reasoning, "high");
	assert.equal(result.leanMetrics.summarized, true);
	assert.equal(result.leanMetrics.checkpointUpdated, true);
	assert.deepEqual(result.checkpoint, {
		version: 1,
		summary: "1. CURRENT USER GOAL:\nClean panel data.\n7. CONSULTATION TARGET:\nInspect merge-key strategy.",
		throughEntryId: "entry-now",
	});
	assert.match(result.messages[0].content[0].text, /ADVISOR CHECKPOINT/);
	assert.match(result.messages[0].content[0].text, /RECENT ACTIVITY \(VERBATIM SERIALIZATION\)/);
	assert.match(result.messages[0].content[0].text, /CONSULTATION QUESTION \(ANSWER THIS DIRECTLY\)/);
});

test("repeated short consultations reuse the checkpoint and send only the delta", async () => {
	const previousCheckpoint = {
		version: 1,
		summary: "Stable checkpoint: approach A is active.",
		throughEntryId: "old-boundary",
	};
	const delta = [
		toolResult("advisor", "previous-advisor", "Prior guidance: verify assumption A.", 10),
		assistant([{ type: "text", text: "Verification contradicted assumption A." }], 11),
	];
	const completeSimple = async () => {
		throw new Error("scribe should not refresh a small delta");
	};

	const result = await buildLeanAdvisorMessages({
		ctx: dummyContext(),
		rawSessionMessages: delta,
		completeSimple,
		previousCheckpoint,
		currentEntryId: "new-boundary",
		currentUserRequest: "Resolve the contradiction.",
		question: "Which assumption should change?",
	});

	assert.equal(result.leanMetrics.checkpointReused, true);
	assert.equal(result.leanMetrics.checkpointUpdated, false);
	assert.equal(result.checkpoint, previousCheckpoint);
	const briefing = result.messages[0].content[0].text;
	assert.match(briefing, /Stable checkpoint: approach A is active/);
	assert.match(briefing, /Prior guidance: verify assumption A/);
	assert.match(briefing, /Verification contradicted assumption A/);
	assert.match(briefing, /Which assumption should change\?/);
});

test("checkpoint refresh merges only prior checkpoint plus new delta", async () => {
	const previousCheckpoint = {
		version: 1,
		summary: "PRIOR-CHECKPOINT-CONTENT",
		throughEntryId: "old-boundary",
	};
	const delta = Array.from({ length: 13 }, (_, index) => user(`NEW-DELTA-${index}`, index + 1));
	const model = { provider: "openai-codex", id: "gpt-5.6-luna" };
	let scribeInput = "";
	const completeSimple = async (_model, request) => {
		scribeInput = request.messages[0].content[0].text;
		return { content: [{ type: "text", text: "UPDATED-CHECKPOINT" }], stopReason: "stop" };
	};

	const result = await buildLeanAdvisorMessages({
		ctx: dummyContext(model),
		rawSessionMessages: delta,
		completeSimple,
		previousCheckpoint,
		currentEntryId: "new-boundary",
		currentUserRequest: "CURRENT-REQUEST",
	});

	assert.match(scribeInput, /PRIOR-CHECKPOINT-CONTENT/);
	assert.match(scribeInput, /NEW-DELTA-12/);
	assert.doesNotMatch(scribeInput, /UNRELATED-OLD-HISTORY/);
	assert.equal(result.checkpoint.summary, "UPDATED-CHECKPOINT");
	assert.equal(result.checkpoint.throughEntryId, "new-boundary");
});

test("scribe failure preserves the old checkpoint and raw delta", async () => {
	const previousCheckpoint = {
		version: 1,
		summary: "SAFE-OLD-CHECKPOINT",
		throughEntryId: "old-boundary",
	};
	const delta = Array.from({ length: 13 }, (_, index) => user(`UNSUMMARIZED-${index}`, index + 1));
	const model = { provider: "openai-codex", id: "gpt-5.6-luna" };
	const completeSimple = async () => {
		throw new Error("scribe unavailable");
	};

	const result = await buildLeanAdvisorMessages({
		ctx: dummyContext(model),
		rawSessionMessages: delta,
		completeSimple,
		previousCheckpoint,
		currentEntryId: "new-boundary",
	});

	assert.equal(result.leanMetrics.summaryAttempted, true);
	assert.equal(result.leanMetrics.checkpointUpdated, false);
	assert.equal(result.leanMetrics.scribeError, "scribe unavailable");
	assert.equal(result.checkpoint, previousCheckpoint);
	assert.match(result.messages[0].content[0].text, /SAFE-OLD-CHECKPOINT/);
	assert.match(result.messages[0].content[0].text, /UNSUMMARIZED-12/);
});

test("serialized tail cannot contain orphan provider function outputs", async () => {
	const raw = [
		user("Diagnose the bug", 1),
		assistant([{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "a.ts" } }], 2),
		toolResult("read", "read-1", "file body", 3),
		assistant(
			[
				{ type: "thinking", thinking: "Now ask for review." },
				{ type: "toolCall", id: "advisor-1", name: "advisor", arguments: {} },
			],
			4,
		),
	];
	const result = await buildLeanAdvisorMessages({
		ctx: dummyContext(),
		rawSessionMessages: raw,
		completeSimple: async () => {
			throw new Error("not expected");
		},
		currentUserRequest: "Diagnose the bug",
		currentEntryId: "assistant-entry",
	});

	assert.equal(result.messages.some((message) => message.role === "toolResult"), false);
	assert.equal(
		result.messages.some((message) =>
			Array.isArray(message.content) && message.content.some((part) => part.type === "toolCall"),
		),
		false,
	);
	assert.match(result.messages[0].content[0].text, /\[Tool result\]: file body/);
	assert.doesNotMatch(result.messages[0].content[0].text, /advisor-1/);
});

test("checkpoint helpers restore branch-local state and delta", () => {
	const checkpoint = { version: 1, summary: "state", throughEntryId: "assistant-old" };
	const branch = [
		{ type: "message", id: "user-old", message: user("Original task", 1) },
		{ type: "message", id: "assistant-old", message: assistant([{ type: "text", text: "pre-call" }], 2) },
		{
			type: "message",
			id: "advisor-result",
			message: {
				...toolResult("advisor", "advisor-old", "guidance", 3),
				details: { advisorCheckpoint: checkpoint },
			},
		},
		{ type: "message", id: "user-new", message: user("Current task", 4) },
	];

	assert.deepEqual(findLatestAdvisorCheckpoint(branch), checkpoint);
	assert.equal(findLatestUserRequest(branch), "Current task");
	const delta = messagesAfterCheckpoint(branch, checkpoint);
	assert.equal(delta.length, 2);
	assert.equal(delta[0].role, "toolResult");
	assert.equal(delta[1].role, "user");
});

test("tool inventory cache invalidates when a same-name schema changes", () => {
	const sourceInfo = { path: "test", source: "test", scope: "temporary", origin: "top-level" };
	const first = getInventoryMessage([
		{ name: "advisor", description: "old", parameters: { type: "object", properties: {} }, sourceInfo },
	]);
	const second = getInventoryMessage([
		{
			name: "advisor",
			description: "new",
			parameters: { type: "object", properties: { question: { type: "string" } } },
			sourceInfo,
		},
	]);

	assert.notEqual(first, second);
	assert.match(second.content[0].text, /question/);
});

test("inventory and briefing are normalized to one provider user message", () => {
	const inventory = user("INVENTORY", 1);
	const briefing = user("BRIEFING", 2);
	const merged = mergeInventoryWithAdvisorMessages(inventory, [briefing]);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].role, "user");
	assert.equal(merged[0].content[0].text, "INVENTORY\n\n---\n\nBRIEFING");
});

test("slash-containing scribe model IDs are preserved after the first slash", async () => {
	const model = { provider: "custom", id: "family/model/revision" };
	let resolved;
	const ctx = {
		cwd: process.cwd(),
		modelRegistry: {
			find: (provider, id) => {
				resolved = [provider, id];
				return provider === model.provider && id === model.id ? model : undefined;
			},
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "key" }),
		},
	};
	await buildLeanAdvisorMessages({
		ctx,
		rawSessionMessages: Array.from({ length: 13 }, (_, i) => user(`delta-${i}`, i)),
		completeSimple: async () => ({ content: [{ type: "text", text: "summary" }], stopReason: "stop" }),
		scribeModelKey: "custom/family/model/revision",
		currentEntryId: "boundary",
	});
	assert.deepEqual(resolved, ["custom", "family/model/revision"]);
});

test("runtime-auth scribe omits explicit credentials while legacy requires a key", async () => {
	const model = { provider: "oauth", id: "scribe" };
	const messages = Array.from({ length: 13 }, (_, i) => user(`delta-${i}`, i));
	let runtimeOptions;
	const runtimeResult = await buildLeanAdvisorMessages({
		ctx: {
			cwd: process.cwd(),
			modelRegistry: {
				find: () => model,
				getApiKeyAndHeaders: async () => ({ ok: true }),
			},
		},
		rawSessionMessages: messages,
		completeSimple: async (_model, _request, options) => {
			runtimeOptions = options;
			return { content: [{ type: "text", text: "runtime summary" }], stopReason: "stop" };
		},
		scribeUsesRuntimeAuth: true,
		currentEntryId: "runtime-boundary",
	});
	assert.equal("apiKey" in runtimeOptions, false);
	assert.equal(runtimeResult.leanMetrics.checkpointUpdated, true);

	let legacyCalled = false;
	const legacyResult = await buildLeanAdvisorMessages({
		ctx: {
			cwd: process.cwd(),
			modelRegistry: {
				find: () => model,
				getApiKeyAndHeaders: async () => ({ ok: true }),
			},
		},
		rawSessionMessages: messages,
		completeSimple: async () => {
			legacyCalled = true;
			throw new Error("must not run");
		},
		scribeUsesRuntimeAuth: false,
		currentEntryId: "legacy-boundary",
	});
	assert.equal(legacyCalled, false);
	assert.match(legacyResult.leanMetrics.scribeError, /no API key for legacy scribe completion/);
});

test("future checkpoint boundaries are rejected", () => {
	const malformed = { version: 1, summary: "bad", throughEntryId: "future" };
	const branch = [
		{ type: "message", id: "carrier", message: { ...toolResult("advisor", "a", "g"), details: { advisorCheckpoint: malformed } } },
		{ type: "message", id: "future", message: user("future") },
	];
	assert.equal(findLatestAdvisorCheckpoint(branch), undefined);
});

test("checkpoint deltas reset across compaction and branch-summary boundaries", () => {
	const checkpoint = { version: 1, summary: "state", throughEntryId: "boundary" };
	const beforeCompaction = [
		{ type: "message", id: "boundary", message: assistant([{ type: "text", text: "before" }]) },
		{ type: "message", id: "carrier", message: { ...toolResult("advisor", "a", "g"), details: { advisorCheckpoint: checkpoint } } },
		{ type: "compaction", id: "compact", summary: "pi summary" },
		{ type: "message", id: "after", message: user("after") },
	];
	assert.equal(messagesAfterCheckpoint(beforeCompaction, checkpoint), undefined);

	const afterCompactionCheckpoint = { version: 1, summary: "new", throughEntryId: "after-boundary" };
	const afterCompaction = [
		{ type: "compaction", id: "compact", summary: "pi summary" },
		{ type: "message", id: "after-boundary", message: assistant([{ type: "text", text: "after compact" }]) },
		{ type: "message", id: "new-carrier", message: { ...toolResult("advisor", "b", "g"), details: { advisorCheckpoint: afterCompactionCheckpoint } } },
		{ type: "message", id: "delta", message: user("delta") },
	];
	assert.equal(messagesAfterCheckpoint(afterCompaction, afterCompactionCheckpoint).length, 2);

	const branchSummary = [
		{ type: "message", id: "boundary", message: assistant([{ type: "text", text: "before" }]) },
		{ type: "message", id: "carrier", message: { ...toolResult("advisor", "a", "g"), details: { advisorCheckpoint: checkpoint } } },
		{ type: "branch_summary", id: "summary", summary: "fork state" },
	];
	assert.equal(messagesAfterCheckpoint(branchSummary, checkpoint), undefined);
});

function usage(input, output = 0) {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input, output, cacheRead: 0, cacheWrite: 0, total: input + output },
	};
}

function executeContext(responses, { auth = async () => ({ ok: true }), entries } = {}) {
	const model = { provider: "mock", id: "advisor", reasoning: true };
	setAdvisorModel(model);
	setAdvisorEffort("high");
	const sessionManager = SessionManager.inMemory(process.cwd());
	if (entries) {
		for (const message of entries) sessionManager.appendMessage(message);
	} else {
		sessionManager.appendMessage(user("  preserve request whitespace  ", 1));
		sessionManager.appendMessage(
			assistant([{ type: "toolCall", id: "advisor-current", name: "advisor", arguments: {} }], 2),
		);
	}
	let index = 0;
	const runtime = {
		completeSimple: async () => {
			const next = responses[index++];
			if (next instanceof Error) throw next;
			return next;
		},
	};
	return {
		ctx: {
			cwd: process.cwd(),
			modelRegistry: {
				runtime,
				getApiKeyAndHeaders: auth,
				// Resolves the scribe model when a refresh is triggered; the advisor
				// model itself comes from the advisor state module.
				find: () => ({ provider: "mock", id: "scribe" }),
			},
			sessionManager,
		},
		pi: { getAllTools: () => [] },
	};
}

test("advisor retry aggregates usage from empty then successful attempts", async () => {
	const { ctx, pi } = executeContext([
		{ content: [], stopReason: "stop", usage: usage(10, 1) },
		{ content: [{ type: "text", text: "recovered" }], stopReason: "stop", usage: usage(20, 2) },
	]);
	const result = await executeAdvisor(ctx, pi, { question: "  exact question  " }, undefined, undefined);
	assert.equal(result.content[0].text, "recovered");
	assert.equal(result.usage.input, 30);
	assert.equal(result.usage.output, 3);
	assert.equal(result.details.advisorUsage.totalTokens, 33);
});

test("advisor retry aggregates first usage on empty-empty and empty-error paths", async () => {
	for (const [second, expected] of [
		[{ content: [], stopReason: "stop", usage: usage(7) }, "Advisor returned no text content."],
		[{ content: [], stopReason: "error", errorMessage: "boom", usage: usage(8) }, "Advisor call failed: boom"],
	]) {
		const { ctx, pi } = executeContext([
			{ content: [], stopReason: "stop", usage: usage(5) },
			second,
		]);
		const result = await executeAdvisor(ctx, pi, {}, undefined, undefined);
		assert.equal(result.content[0].text, expected);
		assert.equal(result.usage.input, 5 + second.usage.input);
	}
});

test("advisor retry preserves first usage when the second attempt throws", async () => {
	const { ctx, pi } = executeContext([
		{ content: [], stopReason: "stop", usage: usage(9) },
		new Error("transport failed"),
	]);
	const result = await executeAdvisor(ctx, pi, {}, undefined, undefined);
	assert.match(result.content[0].text, /transport failed/);
	assert.equal(result.usage.input, 9);
});

test("thrown advisor authentication is returned in the normal error envelope", async () => {
	const { ctx, pi } = executeContext([], {
		auth: async () => {
			throw new Error("auth exploded");
		},
	});
	const result = await executeAdvisor(ctx, pi, {}, undefined, undefined);
	assert.match(result.content[0].text, /Advisor call threw: auth exploded/);
	assert.equal(result.details.errorMessage, "auth exploded");
});

test("evidence reaches the scribe, checkpoint, and advisor briefing, then survives one hop", async () => {
	const evidence = "EXACT-EVIDENCE-BLOB line two";
	const delta = Array.from({ length: 13 }, (_, index) => user(`delta-${index}`, index + 1));
	const model = { provider: "openai-codex", id: "gpt-5.6-luna" };
	let scribeInput = "";
	const first = await buildLeanAdvisorMessages({
		ctx: dummyContext(model),
		rawSessionMessages: delta,
		completeSimple: async (_model, request) => {
			scribeInput = request.messages[0].content[0].text;
			return { content: [{ type: "text", text: "CHECKPOINT-WITH-EVIDENCE" }], stopReason: "stop" };
		},
		currentEntryId: "boundary-1",
		question: "First question?",
		evidence,
	});
	assert.match(scribeInput, /CURRENT CONSULTATION EVIDENCE \(EXACT; RETAIN CRITICAL STATE\) ===\nEXACT-EVIDENCE-BLOB line two/);
	assert.equal(first.checkpoint.summary, "CHECKPOINT-WITH-EVIDENCE");

	const briefing = first.messages[0].content[0].text;
	assert.match(briefing, /CURRENT CONSULTATION EVIDENCE \(VERBATIM\) ===\nEXACT-EVIDENCE-BLOB line two/);

	let secondScribeCalled = false;
	const second = await buildLeanAdvisorMessages({
		ctx: dummyContext(),
		rawSessionMessages: [toolResult("advisor", "prev", "prior guidance", 9)],
		completeSimple: async () => {
			secondScribeCalled = true;
			throw new Error("small delta must bypass the scribe");
		},
		previousCheckpoint: first.checkpoint,
		currentEntryId: "boundary-2",
		priorEvidence: evidence,
	});
	assert.equal(secondScribeCalled, false);
	assert.match(
		second.messages[0].content[0].text,
		/PRIOR CONSULTATION EVIDENCE \(VERBATIM; ONE-HOP RETENTION\) ===\nEXACT-EVIDENCE-BLOB line two/,
	);

	let refreshInput = "";
	await buildLeanAdvisorMessages({
		ctx: dummyContext(model),
		rawSessionMessages: Array.from({ length: 13 }, (_, index) => user(`later-${index}`, index + 1)),
		completeSimple: async (_model, request) => {
			refreshInput = request.messages[0].content[0].text;
			return { content: [{ type: "text", text: "NEXT-CHECKPOINT" }], stopReason: "stop" };
		},
		previousCheckpoint: first.checkpoint,
		currentEntryId: "boundary-3",
		priorEvidence: evidence,
	});
	assert.match(refreshInput, /PRIOR CONSULTATION EVIDENCE \(EXACT; RETAIN CRITICAL STATE\) ===\nEXACT-EVIDENCE-BLOB line two/);
});

test("advisor evidence retention is one hop only", () => {
	const withEvidence = {
		...toolResult("advisor", "a", "guidance"),
		details: { consultationEvidence: "EVID-1" },
	};
	const branch = [
		{ type: "message", id: "u1", message: user("task") },
		{ type: "message", id: "a1", message: assistant([{ type: "toolCall", id: "c1", name: "advisor", arguments: {} }]) },
		{ type: "message", id: "r1", message: withEvidence },
		{ type: "message", id: "u2", message: user("next") },
	];
	assert.equal(findLatestAdvisorEvidence(branch), "EVID-1");

	const afterBareResult = [
		...branch,
		{ type: "message", id: "a2", message: assistant([{ type: "toolCall", id: "c2", name: "advisor", arguments: {} }]) },
		{ type: "message", id: "r2", message: toolResult("advisor", "c2", "no evidence this time") },
	];
	assert.equal(findLatestAdvisorEvidence(afterBareResult), undefined);
});

test("executeAdvisor stores consultation evidence and includes it in both model calls", async () => {
	const evidence = "STORED-EVIDENCE-MARKER";
	const entries = [user("Long analysis task", 1)];
	for (let i = 0; i < 13; i++) {
		entries.push(user(`filler-${i}`, i + 2));
	}
	const requests = [];
	entries.push(
		assistant([{ type: "toolCall", id: "advisor-current", name: "advisor", arguments: { evidence } }], 99),
	);
	const { ctx, pi } = executeContext([]);
	ctx.sessionManager = SessionManager.inMemory(process.cwd());
	for (const message of entries) ctx.sessionManager.appendMessage(message);
	// Replace the response queue with a system-prompt-aware responder:
	// call 1 is the scribe refresh, call 2 the advisor.
	let call = 0;
	ctx.modelRegistry.runtime.completeSimple = async (_model, request) => {
		requests.push(request);
		call++;
		if (call === 1) {
			return { content: [{ type: "text", text: "CHECKPOINT-SUMMARY" }], stopReason: "stop" };
		}
		return { content: [{ type: "text", text: "EVIDENCED GUIDANCE" }], stopReason: "stop" };
	};

	const result = await executeAdvisor(ctx, pi, { question: "Review it.", evidence }, undefined, undefined);
	assert.equal(result.content[0].text, "EVIDENCED GUIDANCE");
	assert.equal(result.details.consultationEvidence, evidence);
	assert.equal(result.details.advisorCheckpoint.summary, "CHECKPOINT-SUMMARY");
	assert.match(requests[0].messages[0].content[0].text, /STORED-EVIDENCE-MARKER/);
	assert.match(requests[1].messages[0].content[0].text, /STORED-EVIDENCE-MARKER/);
});

test("correlated recent skill reads become a bounded active protocol attachment", () => {
	const skillPath = "/var/home/samuel/.agents/skills/music/SKILL.md";
	const branch = [
		{ type: "message", id: "read-call", message: assistant([{ type: "toolCall", id: "read-1", name: "read", arguments: { path: skillPath } }], 1) },
		{ type: "message", id: "read-result", message: toolResult("read", "read-1", "MUSIC-PROTOCOL-MARKER\nUse the music workflow.", 2) },
		{ type: "message", id: "other", message: user("continue", 3) },
		{ type: "message", id: "advisor-call", message: assistant([{ type: "toolCall", id: "advisor-1", name: "advisor", arguments: {} }], 4) },
	];
	const context = collectActiveProtocolContext(branch, process.cwd());
	assert.deepEqual(context.files.map((file) => file.path), [skillPath]);
	const rendered = renderActiveProtocolContext(context, true, 2_000);
	assert.match(rendered, /ACTIVE PROJECT PROTOCOL \(BINDING\)/);
	assert.match(rendered, /MUSIC-PROTOCOL-MARKER/);
	assert.doesNotMatch(rendered, /advisor-1/);

	const stale = collectActiveProtocolContext(branch, process.cwd(), 2);
	assert.equal(stale.files.length, 0);
});

test("skill reads are bounded before scribe serialization", async () => {
	const skillPath = "/var/home/samuel/.agents/skills/music/SKILL.md";
	const fullSkillRead = `SKILL-HEAD\n${"A".repeat(2_500)}\nMIDDLE-SKILL-CONTENT\n${"B".repeat(5_000)}\nSKILL-TAIL`;
	const raw = [
		assistant([{ type: "toolCall", id: "read-skill", name: "read", arguments: { path: skillPath } }], 1),
		toolResult("read", "read-skill", fullSkillRead, 2),
		...Array.from({ length: 13 }, (_, index) => user(`activity-${index}`, index + 3)),
	];
	let scribeInput = "";
	await buildLeanAdvisorMessages({
		ctx: dummyContext({ provider: "openai-codex", id: "gpt-5.6-luna" }),
		rawSessionMessages: raw,
		completeSimple: async (_model, request) => {
			scribeInput = request.messages[0].content[0].text;
			return { content: [{ type: "text", text: "bounded checkpoint" }], stopReason: "stop" };
		},
		currentEntryId: "boundary",
	});
	assert.match(scribeInput, /Local skill protocol read; bounded excerpt/);
	assert.doesNotMatch(scribeInput, /MIDDLE-SKILL-CONTENT/);
});

test("advisor skill tools read only permitted Markdown and grep bounded matches", () => {
	const roots = getAllowedSkillRoots(process.cwd());
	assert.ok(roots.some((root) => root.endsWith("/.agents/skills")));
	assert.ok(resolveAllowedSkillPath("music/SKILL.md", process.cwd(), true)?.endsWith("music/SKILL.md"));
	assert.equal(resolveAllowedSkillPath("/etc/passwd", process.cwd(), true), undefined);

	const read = executeAdvisorSkillTool(
		{ type: "toolCall", id: "skill-read", name: "skill_read", arguments: { path: "music/SKILL.md" } },
		process.cwd(),
	);
	assert.equal(read.isError, false);
	assert.match(read.content[0].text, /SKILL\.md/);

	const grep = executeAdvisorSkillTool(
		{
			type: "toolCall",
			id: "skill-grep",
			name: "skill_grep",
			arguments: { pattern: "music", path: "music/SKILL.md", literal: true, maxResults: 2 },
		},
		process.cwd(),
	);
	assert.equal(grep.isError, false);
	assert.match(grep.content[0].text, /SKILL\.md:\d+:/);

	const denied = executeAdvisorSkillTool(
		{ type: "toolCall", id: "denied", name: "skill_read", arguments: { path: "/etc/passwd" } },
		process.cwd(),
	);
	assert.equal(denied.isError, true);
});

test("advisor skill loop services tools, preserves pairs, and enforces the round cap", async () => {
	const requests = [];
	const seenUsage = [];
	let index = 0;
	const responses = [
		{ content: [{ type: "toolCall", id: "g-1", name: "skill_grep", arguments: { pattern: "workflow", path: "music/SKILL.md" } }], stopReason: "toolUse", usage: usage(3) },
		{ content: [{ type: "toolCall", id: "r-1", name: "skill_read", arguments: { path: "music/SKILL.md" } }], stopReason: "toolUse", usage: usage(4) },
		{ content: [{ type: "text", text: "Use the loaded music protocol." }], stopReason: "stop", usage: usage(5) },
	];
	const result = await runAdvisorWithSkillTools({
		model: { provider: "mock", id: "advisor" },
		systemPrompt: "system",
		initialMessages: [user("review")],
		completeSimple: async (_model, request) => {
			requests.push(request);
			return responses[index++];
		},
		requestOptions: {},
		cwd: process.cwd(),
		maxToolRounds: 2,
		onUsage: (value) => seenUsage.push(value),
	});
	assert.equal(result.toolRounds, 2);
	assert.equal(result.toolCalls, 2);
	assert.equal(requests[0].tools.length, ADVISOR_SKILL_TOOLS.length);
	assert.equal(requests[1].messages.at(-1).role, "toolResult");
	assert.equal(requests[2].tools.length, 0);
	assert.equal(seenUsage.length, 3);
	assert.equal(result.response.content[0].text, "Use the loaded music protocol.");
});

test("advisor skill loop makes only one forced no-tools completion after the cap", async () => {
	const requests = [];
	let calls = 0;
	const result = await runAdvisorWithSkillTools({
		model: { provider: "mock", id: "advisor" },
		systemPrompt: "system",
		initialMessages: [user("review")],
		completeSimple: async (_model, request) => {
			requests.push(request);
			calls++;
			return { content: [{ type: "toolCall", id: `call-${calls}`, name: "skill_grep", arguments: { pattern: "never" } }], stopReason: "toolUse" };
		},
		requestOptions: {},
		cwd: process.cwd(),
		maxToolRounds: 1,
	});
	assert.equal(requests.length, 2);
	assert.equal(requests[0].tools.length, ADVISOR_SKILL_TOOLS.length);
	assert.equal(requests[1].tools.length, 0);
	assert.equal(result.toolRounds, 1);
	assert.equal(result.toolCalls, 1);
});

test("empty-response retry does not reset the consultation skill-tool budget", async () => {
	const entries = [
		user("Review the music workflow", 1),
		assistant([{ type: "toolCall", id: "advisor-current", name: "advisor", arguments: {} }], 2),
	];
	const { ctx, pi } = executeContext([], { entries });
	const requests = [];
	let call = 0;
	ctx.modelRegistry.runtime.completeSimple = async (_model, request) => {
		requests.push(request);
		call++;
		if (call === 1 || call === 3) {
			return {
				content: [{ type: "toolCall", id: `skill-${call}`, name: "skill_grep", arguments: { pattern: "workflow", path: "music/SKILL.md" } }],
				stopReason: "toolUse",
			};
		}
		return { content: [], stopReason: "stop" };
	};
	const result = await executeAdvisor(ctx, pi, {}, undefined, undefined);
	assert.equal(result.content[0].text, "Advisor returned no text content.");
	assert.equal(result.details.skillToolRounds, 2);
	assert.equal(result.details.skillToolCalls, 2);
	assert.equal(requests.filter((request) => request.tools.length > 0).length, 3);
	assert.equal(requests.at(-1).tools.length, 0);
});

test("executeAdvisor attaches loaded protocol and enables restricted advisor tools", async () => {
	const skillPath = "/var/home/samuel/.agents/skills/music/SKILL.md";
	const entries = [
		user("Follow the music workflow", 1),
		assistant([{ type: "toolCall", id: "read-skill", name: "read", arguments: { path: skillPath } }], 2),
		toolResult("read", "read-skill", "EXECUTOR-READ-MUSIC-PROTOCOL", 3),
		assistant([{ type: "toolCall", id: "advisor-current", name: "advisor", arguments: {} }], 4),
	];
	const { ctx, pi } = executeContext([], { entries });
	const requests = [];
	ctx.modelRegistry.runtime.completeSimple = async (_model, request) => {
		requests.push(request);
		return { content: [{ type: "text", text: "Follow the active protocol." }], stopReason: "stop" };
	};
	const result = await executeAdvisor(ctx, pi, {}, undefined, undefined);
	assert.equal(result.content[0].text, "Follow the active protocol.");
	assert.equal(result.details.protocolMode, "both");
	assert.equal(result.details.leanMetrics.protocolAttached, true);
	assert.ok(result.details.leanMetrics.protocolFiles.includes(skillPath));
	assert.equal(requests.length, 1);
	assert.equal(requests[0].tools.length, ADVISOR_SKILL_TOOLS.length);
	assert.match(requests[0].messages[0].content[0].text, /EXECUTOR-READ-MUSIC-PROTOCOL/);
	assert.match(requests[0].systemPrompt, /Local advisor preferences \(live file\)/);
});
