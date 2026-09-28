// LOCAL: compaction-loop fix — regression tests.
/**
 * Tests for the compaction-loop fix: while a compaction divergence window is
 * open (pi rewrote history mid-turn, CC session not yet rebuilt), the bridge
 * must not feed CC's stale session usage to pi's context meter — it reports
 * the pi-side chars/4 estimate instead. Cost stays on the real numbers.
 *
 * Regression context: on a 320k-capped bridge model, a mid-turn auto-compaction
 * marked needsRebuild but the live CC session kept its full ~300k history; the
 * next assistant's usage (~96% of cap) re-triggered compaction forever.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QueryContext } from "../src/query-state.ts";
import { __test } from "../src/index.ts";

const { updateUsage, estimatePiContext } = __test;

const fakeModel = {
	api: "anthropic", provider: "anthropic", id: "test-model", contextWindow: 320000,
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, tiers: [] },
};

const STALE_CC_USAGE = {
	input_tokens: 2, output_tokens: 800,
	cache_read_input_tokens: 303061, cache_creation_input_tokens: 4302,
};

describe("updateUsage stale-session rewrite", () => {
	it("passes CC usage through unchanged when no divergence window is open", () => {
		const c = new QueryContext();
		c.resetTurnState(fakeModel);
		updateUsage(c.turnOutput, STALE_CC_USAGE, fakeModel, c);
		const u = c.turnOutput.usage;
		assert.equal(u.totalTokens, 2 + 800 + 303061 + 4302);
		assert.equal(u.cacheRead, 303061);
		assert.ok(u.cost.total > 0);
	});

	it("rewrites to the pi-side estimate while staleUsageUntilRebuild is set", () => {
		const c = new QueryContext();
		c.resetTurnState(fakeModel);
		c.staleUsageUntilRebuild = true;
		c.piContextEstimate = 52000;
		updateUsage(c.turnOutput, STALE_CC_USAGE, fakeModel, c);
		const u = c.turnOutput.usage;
		assert.equal(u.totalTokens, 52000, "meter sees the pi-side estimate, not stale cacheRead");
		assert.equal(u.cacheRead, 0);
		assert.equal(u.cacheWrite, 0);
		assert.equal(u.input, 52000 - 800);
		assert.ok(u.cost.total > 0, "cost stays on real CC-reported numbers");
	});

	it("falls back to pass-through when the estimate is not yet populated", () => {
		const c = new QueryContext();
		c.resetTurnState(fakeModel);
		c.staleUsageUntilRebuild = true;
		c.piContextEstimate = 0;
		updateUsage(c.turnOutput, STALE_CC_USAGE, fakeModel, c);
		assert.equal(c.turnOutput.usage.totalTokens, 2 + 800 + 303061 + 4302);
	});

	it("clamps the estimate to at least the output tokens", () => {
		const c = new QueryContext();
		c.resetTurnState(fakeModel);
		c.staleUsageUntilRebuild = true;
		c.piContextEstimate = 3;
		updateUsage(c.turnOutput, { input_tokens: 1, output_tokens: 700, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, fakeModel, c);
		assert.equal(c.turnOutput.usage.totalTokens, 700);
	});
});

describe("estimatePiContext", () => {
	it("estimates chars/4 across mixed roles including system", () => {
		const est = estimatePiContext({
			systemPrompt: "",
			tools: [],
			messages: [
				{ role: "user", content: "a".repeat(400) },
				{ role: "assistant", content: [{ type: "text", text: "b".repeat(200) }] },
				{ role: "toolResult", content: "c".repeat(80), isError: false, toolCallId: "t" },
			],
		});
		assert.equal(est, 170);
	});
});
