import assert from "node:assert/strict";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { createJiti, piCoreUrl, piPackageRoot } from "./helpers/pi-test-runtime.mjs";

const jiti = createJiti(`${process.env.HOME}/.pi/agent/npm`, {
	alias: { "@earendil-works/pi-ai": path.join(piPackageRoot, "node_modules/@earendil-works/pi-ai/dist/compat.js") },
});
const extension = await jiti.import(
	`${process.env.HOME}/.pi/agent/extensions/working-state-reminders.ts`,
);

function messagesWithToolTail() {
	return [
		{ role: "user", content: "work" },
		{ role: "toolResult", toolName: "bash", isError: false, content: [] },
	];
}

const stateDirectory = path.join(os.homedir(), ".pi", "agent", "working-state");
const idsByDir = new Map();
function statePath(dir) {
	return path.join(stateDirectory, `${idsByDir.get(dir)}.md`);
}
function makeStateDir(withFile) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "working-state-"));
	idsByDir.set(dir, randomUUID());
	if (withFile) {
		fs.mkdirSync(stateDirectory, { recursive: true });
		fs.writeFileSync(statePath(dir), "# SESSION-STATE\n");
	}
	return dir;
}
function removeStateDir(dir) {
	fs.rmSync(statePath(dir), { force: true });
	idsByDir.delete(dir);
	fs.rmSync(dir, { recursive: true, force: true });
}

function makeHarness({ cwd, threshold = 15, maxNudges = 2, trigger, margin } = {}) {
	process.env.PI_WORKING_STATE_STALE_THRESHOLD = String(threshold);
	process.env.PI_WORKING_STATE_MAX_NUDGES = String(maxNudges);
	if (trigger === undefined) delete process.env.PI_BLACKHOLE_COMPACT_AFTER_TOKENS;
	else process.env.PI_BLACKHOLE_COMPACT_AFTER_TOKENS = String(trigger);
	if (margin === undefined) delete process.env.PI_WORKING_STATE_PRE_COMPACT_MARGIN;
	else process.env.PI_WORKING_STATE_PRE_COMPACT_MARGIN = String(margin);
	const handlers = new Map();
	const tools = new Map();
	const pi = {
		registerTool(tool) { tools.set(tool.name, tool); },
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
	};
	extension.default(pi);
	assert.equal(handlers.get("context").length, 1);
	const ctx = { cwd, sessionManager: { getSessionId: () => idsByDir.get(cwd) } };
	return {
		handlers,
		tools,
		ctx,
		async emit(name, event = {}) {
			let result;
			for (const handler of handlers.get(name) ?? []) result = await handler(event, ctx) ?? result;
			return result;
		},
	};
}

async function reminderText(harness) {
	const contextHandler = harness.handlers.get("context")[0];
	const injected = await contextHandler({ messages: messagesWithToolTail() }, harness.ctx);
	if (!injected) return undefined;
	return injected.messages
		.filter((message) => message.customType === "pi-system-reminders")
		.flatMap((message) => message.content.map((part) => part.text))
		.join("\n");
}

async function actions(harness, count) {
	for (let i = 0; i < count; i += 1) {
		await harness.emit("tool_execution_end", { toolName: "read", isError: false, result: {} });
	}
}

test("real SDK resolves paths through direct and nested execution with contextless Bash", async (t) => {
	const { createAgentSession, createBashTool, DefaultResourceLoader, SessionManager, SettingsManager } = await import(piCoreUrl);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "working-state-sdk-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const settingsManager = SettingsManager.inMemory({});
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir, agentDir: dir, settingsManager,
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
		extensionFactories: [extension.default],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: dir, agentDir: dir, resourceLoader, settingsManager,
		sessionManager: SessionManager.inMemory(dir),
	});
	t.after(() => session.dispose());
	await session.bindExtensions({});
	// A pre-wrapped shell tool without a session context cannot expose the UUID.
	const bash = createBashTool(dir);
	const shell = await bash.execute("shell-test", { command: 'printf "%s" "$PI_SESSION_ID"' });
	assert.equal(shell.structuredContent.output, "", "reproduces the missing shell UUID");
	const tool = session.agent.state.tools.find((tool) => tool.name === "working_state_path");
	assert.ok(tool, "resolver is active without a discovery step");
	const direct = await tool.execute("path-direct", {});
	// Nested execution must be owned by an assistant-issued parent tool call.
	session.agent.state.messages.push({ role: "assistant", content: [
		{ type: "toolCall", id: "path-parent", name: "codemode", arguments: {} },
	] });
	const nested = await session.extensionRunner.createToolContext("path-parent", undefined)
		.executeTool("working_state_path", {});
	assert.equal(nested.isError, false, JSON.stringify(nested.result));
	assert.deepEqual(direct.structuredContent, nested.result.structuredContent);
	assert.equal(direct.structuredContent.session_id, session.sessionManager.getSessionId());
	assert.equal(direct.structuredContent.state_file,
		path.join(stateDirectory, `${session.sessionManager.getSessionId()}.md`));
	assert.equal(direct.structuredContent.exists, false);
	assert.equal(fs.existsSync(direct.structuredContent.state_file), false);
});

test("path resolver uses the live UUID without shell env or filesystem creation", async (t) => {
	const dir = makeStateDir(false);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir });
	const tool = harness.tools.get("working_state_path");
	assert.equal(tool.annotations.readOnlyHint, true);
	const priorId = process.env.PI_SESSION_ID;
	process.env.PI_SESSION_ID = "wrong-inherited-session";
	t.after(() => {
		if (priorId === undefined) delete process.env.PI_SESSION_ID;
		else process.env.PI_SESSION_ID = priorId;
	});
	const result = await tool.execute("test", {}, undefined, undefined, harness.ctx);
	assert.deepEqual(result.structuredContent, {
		session_id: idsByDir.get(dir), state_file: statePath(dir), exists: false,
	});
	assert.equal(fs.existsSync(statePath(dir)), false);
	fs.mkdirSync(stateDirectory, { recursive: true });
	fs.writeFileSync(statePath(dir), "# SESSION-STATE\n");
	assert.equal((await tool.execute("test", {}, undefined, undefined, harness.ctx)).structuredContent.exists, true);
});

test("path resolver rebinds per call and isolates sessions sharing a cwd", async (t) => {
	const dir = makeStateDir(false);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir });
	const tool = harness.tools.get("working_state_path");
	const first = await tool.execute("test", {}, undefined, undefined, harness.ctx);
	const replacementId = randomUUID();
	harness.ctx.sessionManager.getSessionId = () => replacementId;
	const next = await tool.execute("test", {}, undefined, undefined, harness.ctx);
	assert.equal(next.structuredContent.session_id, replacementId);
	assert.notEqual(next.structuredContent.state_file, first.structuredContent.state_file);
	assert.equal(next.structuredContent.state_file, path.join(stateDirectory, `${replacementId}.md`));
});

test("path resolver fails closed for invalid IDs and missing tool context", async (t) => {
	const dir = makeStateDir(false);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir });
	const tool = harness.tools.get("working_state_path");
	for (const id of ["", "../other-window", `${process.pid}-${randomUUID()}`, undefined]) {
		harness.ctx.sessionManager.getSessionId = () => id;
		await assert.rejects(tool.execute("test", {}, undefined, undefined, harness.ctx), /UUID unavailable/);
	}
	await assert.rejects(tool.execute("test", {}, undefined, undefined, undefined), /UUID unavailable/);
});

test("path lookups do not advance the staleness counter", async (t) => {
	const dir = makeStateDir(true);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir, threshold: 2 });
	await harness.emit("session_start");
	await reminderText(harness);
	for (let i = 0; i < 5; i += 1) {
		await harness.emit("tool_execution_end", { toolName: "working_state_path", isError: false });
	}
	assert.equal(await reminderText(harness), undefined);
	await actions(harness, 2);
	assert.match(await reminderText(harness), /successful actions/);
});

for (const action of ["write", "delete"]) {
	for (const observeBeforeDelivery of [false, true]) {
		test(`queued staleness nudge is cleared after ${action} (observed=${observeBeforeDelivery})`, async (t) => {
			const dir = makeStateDir(true);
			t.after(() => removeStateDir(dir));
			const harness = makeHarness({ cwd: dir, threshold: 2 });
			await harness.emit("session_start");
			await reminderText(harness);
			await actions(harness, 2);
			if (action === "delete") fs.rmSync(statePath(dir));
			else {
				fs.appendFileSync(statePath(dir), "- [ok] recorded\n");
				const later = new Date(Date.now() + 2000);
				fs.utimesSync(statePath(dir), later, later);
			}
			if (observeBeforeDelivery) await actions(harness, 1);
			assert.equal(await reminderText(harness), undefined);
		});
	}
}

test("post-compaction restore reminder forks on file existence and consumes once", async (t) => {
	const emptyDir = makeStateDir(false);
	t.after(() => removeStateDir(emptyDir));
	const noFileHarness = makeHarness({ cwd: emptyDir });
	await noFileHarness.emit("session_compact");
	const absentText = await reminderText(noFileHarness);
	assert.match(absentText, /create .*working-state\/[0-9a-f-]+\.md/);
	assert.equal(await reminderText(noFileHarness), undefined);

	const filledDir = makeStateDir(true);
	t.after(() => removeStateDir(filledDir));
	const fileHarness = makeHarness({ cwd: filledDir });
	await fileHarness.emit("session_compact");
	const existsText = await reminderText(fileHarness);
	assert.match(existsText, /re-read .*working-state\/[0-9a-f-]+\.md/);
	assert.match(existsText, /Post-compaction/);
	assert.equal(await reminderText(fileHarness), undefined);
});

test("session start arms the re-read nudge only when a state file exists", async (t) => {
	const filledDir = makeStateDir(true);
	t.after(() => removeStateDir(filledDir));
	const resumeHarness = makeHarness({ cwd: filledDir });
	await resumeHarness.emit("session_start");
	assert.match(await reminderText(resumeHarness), /re-read .*working-state\/[0-9a-f-]+\.md/);
	assert.equal(await reminderText(resumeHarness), undefined);

	const emptyDir = makeStateDir(false);
	t.after(() => removeStateDir(emptyDir));
	const freshHarness = makeHarness({ cwd: emptyDir });
	await freshHarness.emit("session_start");
	assert.equal(await reminderText(freshHarness), undefined);
});

test("two sessions in the same cwd never read one another's state or legacy shared file", async (t) => {
	const dir = makeStateDir(true);
	t.after(() => removeStateDir(dir));
	fs.writeFileSync(path.join(dir, "SESSION-STATE.md"), "other window's legacy state");
	const otherId = randomUUID();
	const otherPath = path.join(stateDirectory, `${otherId}.md`);
	t.after(() => fs.rmSync(otherPath, { force: true }));
	const first = makeHarness({ cwd: dir, threshold: 2 });
	const second = makeHarness({ cwd: dir, threshold: 2 });
	second.ctx.sessionManager.getSessionId = () => otherId;
	await first.emit("session_start");
	await second.emit("session_start");
	assert.match(await reminderText(first), new RegExp(idsByDir.get(dir)));
	assert.equal(await reminderText(second), undefined, "the shared file does not arm a new session");
	await actions(second, 3);
	assert.equal(await reminderText(second), undefined, "other session's writes cannot arm staleness");
	await second.emit("session_compact");
	assert.match(await reminderText(second), new RegExp(otherId));
	assert.doesNotMatch((await reminderText(first)) ?? "", new RegExp(otherId));

	fs.writeFileSync(otherPath, "second window's state");
	await second.emit("session_start");
	assert.match(await reminderText(second), new RegExp(otherId));
	assert.equal(await reminderText(first), undefined);
});

test("session replacement clears pending reminders and rebinds the UUID", async (t) => {
	const dir = makeStateDir(true);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir, threshold: 2 });
	await harness.emit("session_start");
	await actions(harness, 2);
	const replacementId = randomUUID();
	harness.ctx.sessionManager.getSessionId = () => replacementId;
	await harness.emit("session_start");
	assert.equal(await reminderText(harness), undefined);
	await harness.emit("session_compact");
	assert.match(await reminderText(harness), new RegExp(replacementId));
});

test("staleness reminder fires at the threshold and resets when the file is written", async (t) => {
	const dir = makeStateDir(true);
	t.after(() => removeStateDir(dir));
	const file = statePath(dir);
	const harness = makeHarness({ cwd: dir, threshold: 3 });
	await harness.emit("session_start");

	await actions(harness, 3);
	assert.match(await reminderText(harness), /~3 successful actions/);
	assert.equal(await reminderText(harness), undefined);

	// The reminder was delivered, not acted on: the count is cumulative since
	// the last write, so the next threshold re-arms with the higher number
	// (bounded to maxNudges per request cycle, tested separately).
	await actions(harness, 3);
	assert.match(await reminderText(harness), /~6 successful actions/);

	// A state-file write resets the mtime anchor: the first post-write action
	// re-anchors, then a full threshold of counted actions is required again.
	// agent_start begins a fresh request cycle, clearing the nudge cap.
	fs.appendFileSync(file, "- [ok] outcome recorded\n");
	await harness.emit("agent_start");
	await actions(harness, 3);
	assert.equal(await reminderText(harness), undefined);
	await actions(harness, 1);
	assert.match(await reminderText(harness), /~3 successful actions/);
});

test("staleness nudges are bounded per request cycle and re-armed by agent_start", async (t) => {
	const dir = makeStateDir(true);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir, threshold: 2, maxNudges: 2 });
	await harness.emit("session_start");

	await actions(harness, 2);
	assert.match(await reminderText(harness), /successful actions/);
	await actions(harness, 2);
	assert.match(await reminderText(harness), /successful actions/);
	await actions(harness, 2);
	assert.equal(await reminderText(harness), undefined, "cap of two nudges per cycle reached");

	await harness.emit("agent_start");
	await actions(harness, 2);
	assert.match(await reminderText(harness), /successful actions/, "new cycle re-arms nudging");
});

test("strict silence when no state file exists, regardless of action volume", async (t) => {
	const dir = makeStateDir(false);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir, threshold: 2 });
	await harness.emit("session_start");
	await actions(harness, 20);
	assert.equal(await reminderText(harness), undefined);
	await harness.emit("session_compact");
	// Compaction is the one event that still speaks when no file exists.
	assert.match(await reminderText(harness), /create .*working-state\/[0-9a-f-]+\.md/);
});

test("errored tool executions do not advance the staleness counter", async (t) => {
	const dir = makeStateDir(true);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir, threshold: 2 });
	await harness.emit("session_start");
	// session_start with a leftover state file arms the resume nudge; consume it,
	// then verify that errored traffic alone never re-arms anything.
	assert.match(await reminderText(harness), /re-read .*working-state\/[0-9a-f-]+\.md/);

	for (let i = 0; i < 5; i += 1) {
		await harness.emit("tool_execution_end", { toolName: "bash", isError: true, result: {} });
	}
	assert.equal(await reminderText(harness), undefined);

	await actions(harness, 2);
	assert.match(await reminderText(harness), /successful actions/);
});

test("todo tool executions do not advance the staleness counter", async (t) => {
	const dir = makeStateDir(true);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir, threshold: 2 });
	await harness.emit("session_start");
	// Consume the resume nudge armed by session_start before counting todo traffic.
	assert.match(await reminderText(harness), /re-read .*working-state\/[0-9a-f-]+\.md/);

	for (let i = 0; i < 5; i += 1) {
		await harness.emit("tool_execution_end", { toolName: "todo", isError: false, result: {} });
	}
	assert.equal(await reminderText(harness), undefined);

	await actions(harness, 2);
	assert.match(await reminderText(harness), /successful actions/);
});

test("only manual Blackhole compaction asks for confirmation", async (t) => {
	const dir = makeStateDir(true);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir });
	const dialogs = [];
	harness.ctx.hasUI = true;
	harness.ctx.ui = {
		confirm: async (title, message) => {
			dialogs.push({ title, message });
			return true;
		},
		notify() {},
	};

	await harness.emit("session_before_compact", { reason: "manual", customInstructions: "custom /compact" });
	await harness.emit("session_before_compact", { reason: "threshold", customInstructions: "__pi_vcc__" });
	assert.equal(dialogs.length, 0, "ordinary and automatic compactions are untouched");

	const result = await harness.emit("session_before_compact", {
		reason: "manual",
		customInstructions: "__pi_vcc__",
	});
	assert.equal(result, undefined, "confirming allows compaction to continue");
	assert.equal(dialogs.length, 1);
	assert.match(dialogs[0].title, /Blackhole compaction/);
	assert.match(dialogs[0].message, /needs to be updated/);
	await harness.emit("session_compact");
	assert.match(await reminderText(harness), /re-read .*working-state\/[0-9a-f-]+\.md/);

	const headless = makeHarness({ cwd: dir });
	headless.ctx.hasUI = false;
	headless.ctx.ui = { confirm: async () => assert.fail("headless mode must not request a dialog") };
	assert.equal(
		await headless.emit("session_before_compact", { reason: "manual", customInstructions: "__pi_vcc__" }),
		undefined,
	);
});

test("manual Blackhole fails closed when the session ID cannot be resolved", async (t) => {
	const dir = makeStateDir(false);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir });
	const notices = [];
	harness.ctx.sessionManager.getSessionId = () => "../other-window";
	harness.ctx.hasUI = true;
	harness.ctx.ui = {
		confirm: async () => assert.fail("invalid session ID must not prompt to continue"),
		notify: (message, type) => notices.push({ message, type }),
	};
	assert.deepEqual(await harness.emit("session_before_compact", {
		reason: "manual", customInstructions: "__pi_vcc__",
	}), { cancel: true });
	assert.match(notices[0].message, /Session ID unavailable/);
});

test("declining manual Blackhole compaction cancels and points to state-file creation", async (t) => {
	const dir = makeStateDir(false);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir });
	const notifications = [];
	harness.ctx.hasUI = true;
	harness.ctx.ui = {
		confirm: async (_title, message) => {
			assert.match(message, /needs to be created/);
			return false;
		},
		notify: (message, type) => notifications.push({ message, type }),
	};

	const result = await harness.emit("session_before_compact", {
		reason: "manual",
		customInstructions: "__pi_vcc__",
	});
	assert.deepEqual(result, { cancel: true });
	assert.match(notifications[0].message, /Create .*working-state\/[0-9a-f-]+\.md/);
	assert.equal(notifications[0].type, "info");

	const failedDialog = makeHarness({ cwd: dir });
	const failureNotices = [];
	failedDialog.ctx.hasUI = true;
	failedDialog.ctx.ui = {
		confirm: async () => {
			throw new Error("dialog unavailable");
		},
		notify: (message, type) => failureNotices.push({ message, type }),
	};
	const failedResult = await failedDialog.emit("session_before_compact", {
		reason: "manual",
		customInstructions: "__pi_vcc__",
	});
	assert.deepEqual(failedResult, { cancel: true }, "confirmation failures fail closed");
	assert.match(failureNotices[0].message, /confirmation; Blackhole compaction cancelled/);
	assert.equal(failureNotices[0].type, "warning");
});

function turnEndWithTokens(tokens) {
	// chars/4 estimator: a single string payload of ~4×tokens chars, minus JSON overhead slack.
	return { context: { llmMessages: [{ role: "user", content: "x".repeat(Math.max(0, tokens * 4 - 64)) }] } };
}

async function emitTurnTokens(harness, tokens) {
	await harness.emit("turn_end", turnEndWithTokens(tokens));
}

test("pre-compaction nudge fires once near the trigger and directs an update to an existing file", async (t) => {
	const dir = makeStateDir(true);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir, trigger: 230000, margin: 40000 });
	await harness.emit("session_start");
	// session_start arms the resume nudge (file exists); consume it to clear the channel.
	assert.match(await reminderText(harness), /re-read .*working-state\/[0-9a-f-]+\.md/);

	// Below arm threshold (230k − 40k = 190k): silent.
	await emitTurnTokens(harness, 150000);
	assert.equal(await reminderText(harness), undefined);

	// Crossing the arm threshold: one-shot update directive.
	await emitTurnTokens(harness, 200000);
	const text = await reminderText(harness);
	assert.match(text, /Context ≈200k tokens, compaction trigger ≈230k/);
	assert.match(text, /update .*working-state\/[0-9a-f-]+\.md NOW/);
	assert.equal(await reminderText(harness), undefined, "consumed once");

	// Staying above the threshold does not re-arm: one warning per growth cycle.
	await emitTurnTokens(harness, 210000);
	assert.equal(await reminderText(harness), undefined);
});

test("pre-compaction nudge directs creation when no state file exists", async (t) => {
	const dir = makeStateDir(false);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir, trigger: 230000, margin: 40000 });
	await harness.emit("session_start"); // no file: session_start arms nothing
	await emitTurnTokens(harness, 200000);
	assert.match(await reminderText(harness), /create .*working-state\/[0-9a-f-]+\.md per the working-state skill before compaction/);
});

test("pre-compaction nudge re-arms only after the context shrinks below hysteresis", async (t) => {
	const dir = makeStateDir(true);
	t.after(() => removeStateDir(dir));
	const harness = makeHarness({ cwd: dir, trigger: 230000, margin: 40000 });
	await harness.emit("session_start");
	assert.match(await reminderText(harness), /re-read .*working-state\/[0-9a-f-]+\.md/);

	await emitTurnTokens(harness, 200000);
	assert.match(await reminderText(harness), /update .*working-state\/[0-9a-f-]+\.md NOW/);

	// Fired, and still above the disarm threshold (185k): no re-arm.
	await emitTurnTokens(harness, 190000);
	assert.equal(await reminderText(harness), undefined);

	// Compaction cut resets the cycle explicitly (also covered by the dip below 185k).
	await harness.emit("session_compact");
	await emitTurnTokens(harness, 200000);
	assert.match(await reminderText(harness), /update .*working-state\/[0-9a-f-]+\.md NOW/, "post-compaction growth cycle re-arms");

	// Dip below disarm threshold also resets without an explicit compaction event.
	await emitTurnTokens(harness, 100000);
	await emitTurnTokens(harness, 200000);
	assert.match(await reminderText(harness), /update .*working-state\/[0-9a-f-]+\.md NOW/);
});

test("pre-compaction trigger honors the launcher env and the margin env override", async (t) => {
	const dir = makeStateDir(true);
	t.after(() => removeStateDir(dir));
	// Cloud-style trigger 350k with default 40k margin: arm at 310k.
	const cloudHarness = makeHarness({ cwd: dir, trigger: 350000 });
	await cloudHarness.emit("session_start");
	assert.match(await reminderText(cloudHarness), /re-read .*working-state\/[0-9a-f-]+\.md/);
	await emitTurnTokens(cloudHarness, 200000);
	assert.equal(await reminderText(cloudHarness), undefined, "below the 310k cloud arm threshold");
	await emitTurnTokens(cloudHarness, 320000);
	assert.match(await reminderText(cloudHarness), /compaction trigger ≈350k/);

	// Margin override 10k on a 230k trigger: arm at 220k.
	const tightHarness = makeHarness({ cwd: dir, trigger: 230000, margin: 10000 });
	await tightHarness.emit("session_start");
	assert.match(await reminderText(tightHarness), /re-read .*working-state\/[0-9a-f-]+\.md/);
	await emitTurnTokens(tightHarness, 200000);
	assert.equal(await reminderText(tightHarness), undefined);
	await emitTurnTokens(tightHarness, 225000);
	assert.match(await reminderText(tightHarness), /update .*working-state\/[0-9a-f-]+\.md NOW/);
});
