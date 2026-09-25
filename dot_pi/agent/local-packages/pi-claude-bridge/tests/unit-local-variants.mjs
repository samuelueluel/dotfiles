import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLongContext, claudeCodeModelId } from "../src/models.ts";

const settings = { plan: "pro", longContextExtraUsage: false, contextCap: 320000, maxVariants: ["claude-opus-5-5", "claude-sonnet-5"] };
const catalog = [
	{ id: "claude-opus-5-5", name: "Claude Opus 5.5", contextWindow: 1000000 },
	{ id: "claude-sonnet-5", name: "Claude Sonnet 5", contextWindow: 1000000 },
	{ id: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: 200000 },
];

test("base 1M models are capped, -max variants are full 1M, both request [1m]", () => {
	const reg = applyLongContext(catalog, settings);
	const by = Object.fromEntries(reg.map((m) => [m.id, m]));
	assert.deepEqual(reg.map((m) => m.id), ["claude-opus-5-5", "claude-opus-5-5-max", "claude-sonnet-5", "claude-sonnet-5-max", "claude-haiku-4-5"]);
	assert.equal(by["claude-opus-5-5"].contextWindow, 320000);
	assert.equal(by["claude-opus-5-5"].name, "Claude Opus 5.5");
	assert.equal(by["claude-opus-5-5-max"].contextWindow, 1000000);
	assert.equal(by["claude-opus-5-5-max"].name, "Claude Opus 5.5 (Max Context)");
	assert.equal(by["claude-haiku-4-5"].contextWindow, 200000);
	assert.equal(claudeCodeModelId({ id: "claude-opus-5-5" }, settings), "claude-opus-5-5[1m]");
	assert.equal(claudeCodeModelId({ id: "claude-sonnet-5-max" }, settings), "claude-sonnet-5[1m]");
	assert.equal(claudeCodeModelId({ id: "claude-haiku-4-5-max" }, settings), "claude-haiku-4-5-max");
});
