import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ──────────────────────────────────────────────
// JSONL log parsing
// The worker runs with `pi --mode json`, which streams line-delimited event
// objects to the log AS THEY HAPPEN — so even a worker that we kill on timeout
// leaves behind a usable trace of what it was doing. We distill that stream into
// a compact digest (the worker's reply + the tools it ran + outcomes) instead of
// dumping ~300KB of thinking deltas back into the Manager's context.
// ──────────────────────────────────────────────

function stripAnsi(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s.replace(/\x1b\[[0-9;:?]*[a-zA-Z]/g, "");
}

function summarizeArgs(args: any): string {
	if (!args || typeof args !== "object") return "";
	if (typeof args.command === "string") return args.command;
	if (typeof args.path === "string") return args.path;
	if (typeof args.targetFile === "string") return args.targetFile;
	try { return JSON.stringify(args); } catch { return String(args); }
}

interface WorkerDigest {
	finalText: string;   // the worker's last assistant reply (visible text only)
	steps: string[];     // one line per tool execution: name(args) -> [ok|ERROR] result
	notes: string;       // loop warnings / truncation notes
}

function summarizeWorkerLog(raw: string): WorkerDigest {
	const argsById = new Map<string, any>();
	const endedIds = new Set<string>();
	const repeatCount = new Map<string, number>();
	const steps: string[] = [];
	let finalText = "";

	for (const line of raw.split("\n")) {
		const t = line.trim();
		if (!t) continue;
		let ev: any;
		try { ev = JSON.parse(t); } catch { continue; } // skip the truncated final line on a kill, and any non-JSON stderr
		if (!ev || typeof ev !== "object") continue;

		if (ev.type === "tool_execution_start" && ev.toolCallId) {
			argsById.set(ev.toolCallId, ev.args);
		} else if (ev.type === "tool_execution_end") {
			endedIds.add(ev.toolCallId);
			let argStr = summarizeArgs(argsById.get(ev.toolCallId));
			if (argStr.length > 120) argStr = argStr.slice(0, 120) + "…";

			let resultText = "";
			try {
				resultText = (ev.result?.content || [])
					.filter((c: any) => c?.type === "text")
					.map((c: any) => c.text).join("");
			} catch { /* ignore malformed result */ }
			resultText = stripAnsi(resultText).replace(/\s+/g, " ").trim();
			if (resultText.length > 400) resultText = resultText.slice(0, 400) + "…";

			const key = `${ev.toolName}|${argStr}`;
			repeatCount.set(key, (repeatCount.get(key) || 0) + 1);
			steps.push(`${ev.toolName}(${argStr}) -> [${ev.isError ? "ERROR" : "ok"}] ${resultText}`);
		} else if (ev.type === "message_end" && ev.message?.role === "assistant") {
			try {
				const txt = (ev.message.content || [])
					.filter((c: any) => c?.type === "text")
					.map((c: any) => c.text).join("");
				if (txt.trim()) finalText = stripAnsi(txt).trim();
			} catch { /* ignore */ }
		}
	}

	// Tool calls that started but never produced an end event = killed mid-execution.
	for (const [id, args] of argsById) {
		if (!endedIds.has(id)) steps.push(`(running when killed) ${summarizeArgs(args)}`);
	}

	let notes = "";
	for (const [key, count] of repeatCount) {
		if (count >= 3) notes += `\n⚠ Possible loop: the worker ran the same ${key.split("|")[0]} call ${count}× — likely stuck.`;
	}
	if (steps.length > 40) {
		notes += `\n(…${steps.length - 40} earlier steps omitted)`;
		steps.splice(0, steps.length - 40);
	}
	if (finalText.length > 2000) finalText = finalText.slice(0, 2000) + "…";

	return { finalText, steps, notes };
}

function renderSteps(d: WorkerDigest): string {
	return d.steps.length
		? `\nSteps the worker took:\n${d.steps.map(s => `  - ${s}`).join("\n")}${d.notes}`
		: "";
}

// Shared worker runner used by BOTH the regular `spawn_subagent` tool and the
// orchestrator-only `delegate` tool. The two tools differ only in their
// description / when-to-use policy; the execution mechanics are identical.
async function runWorker(params: any): Promise<any> {
	const taskStr = params?.task || params?.input?.task || JSON.stringify(params);
	const timeout = params?.timeoutSeconds || params?.input?.timeoutSeconds || 600;
	const fs = require('fs');
	// Unique suffix (pid + random) so concurrent spawns in the same millisecond
	// don't collide on the same temp filenames and clobber each other's I/O.
	const uniq = `${Date.now()}_${process.pid}_${Math.random().toString(36).slice(2)}`;
	const tmpFile = `/tmp/subagent_${uniq}.log`;
	const promptFile = `/tmp/subagent_prompt_${uniq}.txt`;

	const readLog = (): string => {
		try { return fs.existsSync(tmpFile) ? fs.readFileSync(tmpFile, 'utf8') : ''; } catch { return ''; }
	};

	try {
		// Inject a clear role for the subagent so it knows its job
		const subagentPrompt = `[SYSTEM] You are an autonomous local worker subagent spawned by a Manager AI.
Your job is to execute the following task, use any necessary tools to complete it, and report back the final result or any errors.
Do NOT wait for user input. Do NOT ask for permission. Execute the task completely.
[END SYSTEM]

=== TASK ===
${taskStr}
=== END TASK ===`;

		fs.writeFileSync(promptFile, subagentPrompt);

		// --mode json streams line-delimited events to the log as they happen, so a killed
		//   worker still leaves a parseable trace (plain text mode buffers until exit → empty log).
		// --no-session gives the worker a clean context (it won't read the manager's rejections).
		// timeout -k SIGKILLs a worker that ignores SIGTERM.
		// @file passes the prompt safely (no shell injection from backticks in the prompt).
		await execAsync(`timeout -k 10 ${timeout} pi --mode json -p -a --no-session -xt ask_user @${promptFile} < /dev/null > ${tmpFile} 2>&1`);

		const raw = readLog();
		const digest = summarizeWorkerLog(raw);
		// Fallback: if nothing parsed (e.g. pi crashed before emitting events), show the raw tail.
		if (!digest.finalText && digest.steps.length === 0) {
			const tail = raw.trim().slice(-1500);
			return { content: [{ type: "text", text: `Worker finished but produced no parseable output.\n\nRaw log tail:\n${tail || '(empty)'}` }] };
		}
		const reply = digest.finalText ? `Worker's reply:\n${digest.finalText}\n` : `Worker produced no final message.\n`;
		return { content: [{ type: "text", text: `${reply}${renderSteps(digest)}` }] };
	} catch (error: any) {
		const raw = readLog();
		const digest = summarizeWorkerLog(raw);

		// GNU timeout exits 124 when it kills the child; anything else is the worker's own non-zero exit.
		const isTimeout = error.code === 124 || error.code === 137;

		// A killed worker may have already written files before dying — surface filesystem ground truth.
		let fsState = '';
		try {
			const status = execSync('git status --short 2>/dev/null', { encoding: 'utf8' }).trim();
			if (status) {
				fsState = `\n\nNOTE: the working tree changed during this run — the worker may have partially completed before being killed. Verify these before re-delegating:\n${status}`;
			}
		} catch { /* not a git repo, or git unavailable — skip */ }

		const errorMsg = isTimeout
			? `The local worker did not finish within ${timeout}s and was killed. With a slow local model this usually means the task was too large for one run (see the trace below to confirm it was making progress vs. looping). RECOVERY: raise timeoutSeconds (e.g. ${timeout * 2}) and/or SPLIT the task into smaller pieces. Do NOT lower the timeout.`
			: error.message;

		const trace = renderSteps(digest) || `\n(no tool activity captured before failure)`;
		const partial = digest.finalText ? `\n\nWorker's partial reply:\n${digest.finalText}` : "";
		return {
			isError: true,
			content: [{ type: "text", text: `Subagent failed!\n\nError: ${errorMsg}\n${trace}${partial}${fsState}` }]
		};
	} finally {
		// Clean up temp files (they hold prompt/output content in world-readable /tmp)
		try { fs.unlinkSync(promptFile); } catch {}
		try { fs.unlinkSync(tmpFile); } catch {}
	}
}

export default function(pi: ExtensionAPI) {
	// ── Regular escape-hatch tool (available in normal sessions) ──
	pi.registerTool({
		name: "spawn_subagent",
		description: "Spawn an autonomous subagent for MESSY, MULTI-STEP rabbit holes. Use this ONLY when a task is complex, requires iterative trial-and-error (like debugging a script), or involves deep exploration that would otherwise bloat your main context window. DO NOT use this for simple tasks, single file reads, or quick commands. The subagent runs on a slow local model with a completely blank context, so give it a comprehensive, self-contained prompt. Raise timeoutSeconds for large jobs.",
		parameters: {
			type: "object",
			properties: {
				task: { type: "string", description: "The complete, detailed, self-contained prompt for the subagent." },
				timeoutSeconds: { type: "number", description: "Maximum seconds to let the subagent run. Defaults to 600 (10 minutes). Raise for large jobs; do not lower it (a local model is slow)." }
			},
			required: ["task"]
		},
		execute: async (_toolCallId: string, params: any) => runWorker(params)
	});

	// ── Orchestrator-only tool (gated to ORCHESTRATOR mode by modes.ts) ──
	pi.registerTool({
		name: "delegate",
		description: "Delegate a task to a local worker subagent. THIS IS YOUR PRIMARY TOOL in Orchestrator mode — route ALL work through it, including simple tasks, because you cannot edit files or run commands yourself. Pass a SCHEMATIC PLAN (intent, files to create/change, key function signatures, libraries, constraints, acceptance criteria) — do NOT write the implementation code yourself; the local worker writes the code. Writing code here wastes your expensive frontier tokens and defeats the purpose. The worker is a slow local model with a blank context, so make the plan self-contained but lean. Raise timeoutSeconds for large jobs.",
		parameters: {
			type: "object",
			properties: {
				task: { type: "string", description: "A lean, self-contained SCHEMATIC PLAN for the worker — intent and requirements, NOT pre-written implementation code to transcribe." },
				timeoutSeconds: { type: "number", description: "Maximum seconds to let the worker run. Defaults to 600 (10 minutes). Raise for large code-generation jobs; do NOT lower it — a too-short timeout is the most common cause of failure." }
			},
			required: ["task"]
		},
		execute: async (_toolCallId: string, params: any) => runWorker(params)
	});
}
