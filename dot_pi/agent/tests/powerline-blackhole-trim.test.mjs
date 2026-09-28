import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "./helpers/pi-test-runtime.mjs";

const jiti = createJiti(`${process.env.HOME}/.pi/agent/npm`);
const lib = await jiti.import(
	`${process.env.HOME}/.pi/agent/lib/blackhole-status.ts`,
);
const { trimBlackholeStatus } = lib;

// The powerline footer (which consumes this) imports @mariozechner packages
// that only resolve inside pi's runtime, so the test targets the pure lib
// function; the footer is load-checked implicitly by every live /reload.

// Mirrors pi-blackhole 0.5.9's gauge rendering: each segment letter carries its
// own color run, and every bar cell run is individually wrapped.
const fg = (code, text) => `\x1b[${code}m${text}\x1b[0m`;
const bar = (filled) =>
	fg("2", "▕") + fg("2", "█".repeat(filled)) + fg("2", "░".repeat(8 - filled)) + fg("2", "▏");
const blackholeStatus = (o, p, x, activity = "") =>
	`${fg("32", "bh")} ${fg("2", "O")}${bar(o)}  ${fg("2", "P")}${bar(p)}  ${fg("2", "X")}${bar(x)}` +
	(activity ? `  ${activity}` : "");

const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("trims dead O and P gauges, keeps bh and the live X gauge", () => {
	const trimmed = trimBlackholeStatus(blackholeStatus(8, 0, 4), { dropObservationGauges: true });
	const visible = plain(trimmed);
	assert.match(visible, /bh/);
	assert.doesNotMatch(visible, /O▕/);
	assert.doesNotMatch(visible, /P▕/);
	assert.match(visible, /X▕████░░░░▏/);
	assert.equal(visible.includes("   "), false, "collapses leftover separator runs");
});

test("keeps activity segments (spinners, completion notes) after the gauges", () => {
	const activity = `${fg("36", "◓")} ${fg("36", "[observe]")}`;
	const trimmed = trimBlackholeStatus(blackholeStatus(8, 0, 4, activity), { dropObservationGauges: true });
	const visible = plain(trimmed);
	assert.match(visible, /X▕/);
	assert.match(visible, /\[observe\]/);
	assert.doesNotMatch(visible, /O▕/);
});

test("no-op when memory is enabled and all gauges are meaningful", () => {
	const status = blackholeStatus(3, 2, 5);
	assert.equal(trimBlackholeStatus(status), status);
});

test("no-op on unrecognized shapes", () => {
	const status = `${fg("32", "bh")} re-indexing`;
	assert.equal(trimBlackholeStatus(status), status);
});
