/**
 * register — the advisor tool registration: zero-param schema, curated
 * description / promptSnippet / promptGuidelines, and an execute that delegates
 * to executeAdvisor. The guidance overrides are read from persisted config.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateGuidanceFields } from "@juicesharp/rpiv-config";
import { Type } from "typebox";
import { loadAdvisorConfig } from "./config.js";
import { executeAdvisor } from "./execute.js";
import { ADVISOR_TOOL_NAME, TOOL_LABEL } from "./messages.js";

const AdvisorParams = Type.Object({
	question: Type.Optional(
		Type.String({
			description:
				"Exact question or decision for the advisor. Use this when the user says to ask the advisor about something specific.",
		}),
	),
	evidence: Type.Optional(
		Type.String({
			description:
				"Exact source, diff, error, or line-numbered excerpt the advisor must inspect. Use when a summary alone cannot ground the requested review.",
			maxLength: 60_000,
		}),
	),
});

const ADVISOR_DESCRIPTION =
	"Escalate to a stronger reviewer model for guidance. The extension sends a " +
	"branch-aware checkpoint plus new activity, the current user request, and an " +
	"optional exact question. Use question when the user asks what the advisor " +
	"thinks about a specific issue. Add evidence when exact source, a diff, an " +
	"error, or line-numbered excerpts are required for a grounded answer.";

export const DEFAULT_PROMPT_SNIPPET =
	"Escalate to a stronger reviewer model for guidance when stuck, before substantive work, or before declaring done";

export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	"Call `advisor` BEFORE substantive work — before writing, before committing to an interpretation, before building on an assumption. Orientation (finding files, fetching a source, seeing what's there) is not substantive work; writing, editing, and declaring an answer are.",
	"Also call `advisor` when you believe the task is complete. BEFORE this call, make your deliverable durable: write the file, save the result, commit the change. The advisor call takes time; if the session ends during it, a durable result persists and an unwritten one doesn't.",
	"Also call `advisor` when stuck — errors recurring, approach not converging, results that don't fit — or when considering a change of approach.",
	"On tasks longer than a few steps, call `advisor` at least once before committing to an approach and once before declaring done. On short reactive tasks where the next action is dictated by tool output you just read, you don't need to keep calling — the advisor adds most of its value on the first call, before the approach crystallizes.",
	"Give the advisor's advice serious weight. If you follow a step and it fails empirically, or you have primary-source evidence that contradicts a specific claim, adapt — a passing self-test is not evidence the advice is wrong, it's evidence your test doesn't check what the advice is checking.",
	"If the user says to ask the advisor what it thinks about X, call `advisor` with `question` containing that exact issue. Do not rely on the session summary to reconstruct a specific requested question.",
	"When asking `advisor` to inspect particular source code, prose, a diff, or an exact error, include the necessary material in `evidence`; advisor-side tools are restricted to skill protocol lookup, and a checkpoint is not a substitute for source evidence.",
	"If you've already retrieved data pointing one way and the advisor points another, don't silently switch — call `advisor` again with a focused reconcile question such as `I found X, while your prior guidance says Y. Which constraint breaks the tie?`.",
	"After each `advisor` result, put the advisor's key guidance into your next visible reply to the user before continuing — quote or paraphrase the plan, correction, or stop signal. The user often cannot see collapsed tool results; do not keep the advisor's words only in silent tool context.",
];

export function registerAdvisorTool(pi: ExtensionAPI): void {
	const guidance = validateGuidanceFields(loadAdvisorConfig().guidance);
	pi.registerTool({
		name: ADVISOR_TOOL_NAME,
		label: TOOL_LABEL,
		description: ADVISOR_DESCRIPTION,
		promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
		parameters: AdvisorParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const question = params.question?.trim() ? params.question : undefined;
			const evidence = params.evidence?.trim() ? params.evidence : undefined;
			return executeAdvisor(ctx, pi, { question, evidence }, signal, onUpdate);
		},
	});
}
