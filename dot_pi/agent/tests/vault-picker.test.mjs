/**
 * Tests for the /vault picker (extensions/vault-picker.ts).
 *
 *   node --test ~/.pi/agent/tests/vault-picker.test.mjs
 *
 * pi resolves pi-tui through its own node_modules, so locate the installed
 * package from the `pi` binary rather than hardcoding a cellar path.
 */

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const require = createRequire(import.meta.url);

function piModulesDir() {
	const candidates = [];
	let dir = dirname(realpathSync(execSync("which pi", { encoding: "utf8" }).trim()));
	for (let i = 0; i < 6; i += 1) {
		// brew lays pi out as <cellar>/bin/pi with deps under <cellar>/libexec/lib/node_modules.
		candidates.push(join(dir, "libexec", "lib", "node_modules"), join(dir, "lib", "node_modules"), join(dir, "node_modules"));
		dir = dirname(dir);
	}
	if (process.env.PI_MODULES) candidates.unshift(process.env.PI_MODULES);
	// pi-tui and jiti ship inside the pi package's own node_modules, so start there
	// and fall back to a shared node_modules layout.
	const pkgDirs = candidates.filter((c) => existsSync(join(c, "@earendil-works", "pi-coding-agent")));
	for (const c of pkgDirs) {
		const nested = join(c, "@earendil-works", "pi-coding-agent", "node_modules");
		if (existsSync(join(nested, "@earendil-works", "pi-tui", "dist", "index.js"))) return nested;
		if (existsSync(join(c, "@earendil-works", "pi-tui", "dist", "index.js"))) return c;
	}
	throw new Error(`no pi node_modules found near ${execSync("which pi", { encoding: "utf8" }).trim()}`);
}

const PI_MODULES = piModulesDir();
const { createJiti } = require(join(PI_MODULES, "jiti", "lib", "jiti.cjs"));
const jiti = createJiti(import.meta.url, {
	alias: { "@earendil-works/pi-tui": join(PI_MODULES, "@earendil-works", "pi-tui", "dist", "index.js") },
});

// ---------------------------------------------------------------- fixtures ----

const ROOT = mkdtempSync(join(tmpdir(), "vault-picker-"));
const CFG = {
	vaultPath: ROOT,
	readyPrompt: 'Read the following Obsidian notes, reply only with "Ready.", and wait for follow up discussion.',
	includeDescription: true,
	readDescriptions: true,
	maxVisibleRows: 6,
	maxTotalBytes: 400,
	cacheTtlMs: 120_000,
	borderColor: "borderAccent",
	descLines: 2,
	padList: true,
	skipDirs: ["node_modules", "attachments", ".trash", ".obsidian", ".git"],
};

// Point the extension at this fixture vault before it loads, so no test ever
// touches the real vault or the real pick-usage file.
writeFileSync(join(ROOT, "config.json"), JSON.stringify(CFG));
process.env.PI_VAULT_CONFIG = join(ROOT, "config.json");
process.env.PI_VAULT_USAGE = join(ROOT, "usage.json");

const vp = await jiti.import(new URL("../extensions/vault-picker.ts", import.meta.url).pathname);
const tui = await jiti.import(join(PI_MODULES, "@earendil-works", "pi-tui", "dist", "index.js"));

const FILES = {
	"02_Memories/Vault-Picker.md": `---\ndescription: "Clipboard tax when feeding notes into terminal agents."\ntags:\n  - linux\nupdated: 2026-09-19T02:18:37\n---\n# Context\n`,
	"02_Memories/Stata-Table-Export.md": `---\ndescription: Formatting rules for Stata table exports.\ntags: [stata, pin]\nupdated: 2026-09-01T09:00:00\n---\n`,
	"20_Library/Clustering-Standard-Errors.md": `---\ndescription: When to cluster standard errors by state vs firm.\ntags:\n  - econometrics\nupdated: 2026-08-11T09:00:00\n---\n`,
	"20_Library/Deep-Nested.md": `---\ndescription: Deep note.\n---\n`,
	"20_Library/Untitled.md": `no frontmatter at all\n`,
	".obsidian/appearance.json": `{}`,
	"attachments/blob.png": `x`,
	"20_Library/Big.md": `---\ndescription: A deliberately large note for the budget guard.\n---\n${"padding ".repeat(200)}\n`,
};

for (const [rel, contents] of Object.entries(FILES)) {
	const abs = join(ROOT, rel);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, contents);
}

const stubTheme = {
	// Plain ANSI only, so visibleWidth() stays honest about column counts.
	fg: (_c, text) => `\x1b[38;5;39m${text}\x1b[0m`,
	bg: (_c, text) => `\x1b[48;5;236m${text}\x1b[0m`,
	bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

/** Theme stub that records the color name around each run, for border audits. */
const tagTheme = {
	fg: (c, text) => `\u00ab${c}\u00bb${text}\u00ab/\u00bb`,
	bg: (c, text) => `\u00ab@${c}\u00bb${text}\u00ab/\u00bb`,
	bold: (text) => `\u00ab*b\u00bb${text}\u00ab/\u00bb`,
};

const BORDER_GLYPHS = new Set("\u2502\u251c\u2524\u2500\u256d\u256e\u2570\u257f".concat("\u256f"));

/** Which theme color each border glyph in the rendered output actually carries. */
function borderColors(lines) {
	const seen = new Set();
	const stack = [];
	for (const line of lines) {
		let i = 0;
		while (i < line.length) {
			const rest = line.slice(i);
			const open = /^\u00ab([^/\u00BB]{1,24})\u00bb/.exec(rest);
			if (open) {
				stack.push(open[1]);
				i += open[0].length;
				continue;
			}
			if (rest.startsWith("\u00ab/\u00bb")) {
				stack.pop();
				i += 3;
				continue;
			}
			if (BORDER_GLYPHS.has(rest[0])) seen.add(stack.length ? stack[stack.length - 1] : "<uncolored>");
			i += 1;
		}
	}
	return seen;
}

const USAGE = {
	counts: { "20_Library/Clustering-Standard-Errors.md": 4 },
	lastUsed: {},
	lastSelection: [],
};

function makePicker(theme = stubTheme, overrides = {}) {
	let result = null;
	const cfg = { ...CFG, ...overrides };
	const picker = new vp.VaultPicker(theme, vp.buildNotes(cfg, true), USAGE, new Set(), cfg, (r) => {
		result = r;
	});
	picker.focused = true;
	return { picker, result: () => result };
}

function type(picker, text) {
	for (const ch of text) picker.handleInput(ch);
}

process.on("exit", () => rmSync(ROOT, { recursive: true, force: true }));

// ---------------------------------------------------------- frontmatter ----

test("parses quoted description, block tags, and updated", () => {
	const fm = vp.parseFrontmatter(FILES["02_Memories/Vault-Picker.md"]);
	assert.equal(fm.description, "Clipboard tax when feeding notes into terminal agents.");
	assert.deepEqual(fm.tags, ["linux"]);
	assert.equal(fm.updatedMs, Date.parse("2026-09-19T02:18:37"));
	assert.equal(fm.pinned, false);
});

test("parses inline tag arrays and detects pin", () => {
	const fm = vp.parseFrontmatter(FILES["02_Memories/Stata-Table-Export.md"]);
	assert.deepEqual(fm.tags, ["stata", "pin"]);
	assert.equal(fm.pinned, true);
});

test("missing frontmatter and folded descriptions degrade to empty", () => {
	assert.equal(vp.parseFrontmatter("# just a heading\n").description, "");
	assert.equal(vp.parseFrontmatter("---\ndescription: >\n  folded\n---\n").description, "");
});

// ------------------------------------------------------------- scanning ----

test("walks markdown only, honouring dot dirs and skipDirs", () => {
	const notes = vp.buildNotes(CFG, true);
	assert.equal(notes.length, 6, notes.map((n) => n.path).join(", "));
	assert.ok(!notes.some((n) => n.path.includes(".obsidian")));
	assert.ok(!notes.some((n) => n.path.includes("attachments")));
	assert.equal(notes.find((n) => n.title === "Vault-Picker").dir, "02_Memories");
});

test("warm rebuild is cache-served and title/desc survive", () => {
	const cold = vp.buildNotes(CFG, true);
	const warm = vp.buildNotes(CFG, false);
	assert.deepEqual(warm.map((n) => n.path).sort(), cold.map((n) => n.path).sort());
	assert.ok(warm.find((n) => n.title === "Big").description.length > 10);
});

// ------------------------------------------------------------- ranking ----

test("empty query ranks pinned first, then familiar, junk last", () => {
	const titles = vp.filterNotes(vp.buildNotes(CFG, true), "", USAGE).map((n) => n.title);
	assert.equal(titles[0], "Stata-Table-Export");
	assert.equal(titles[1], "Clustering-Standard-Errors");
	assert.equal(titles.at(-1), "Untitled");
});

test("title matches outrank description matches", () => {
	const titles = vp.filterNotes(vp.buildNotes(CFG, true), "stata", USAGE).map((n) => n.title);
	assert.equal(titles[0], "Stata-Table-Export");
});

test("slash-separated tokens scope the search by folder", () => {
	const titles = vp.filterNotes(vp.buildNotes(CFG, true), "20/clus", USAGE).map((n) => n.title);
	assert.equal(titles[0], "Clustering-Standard-Errors");
});

test("a token nothing matches drops every note", () => {
	assert.equal(vp.filterNotes(vp.buildNotes(CFG, true), "qwxzvp", USAGE).length, 0);
});

// -------------------------------------------------------------- output ----

test("prompt is the ready line plus one path per line", () => {
	const notes = vp.buildNotes(CFG, true);
	const byPath = new Map(notes.map((n) => [n.path, n]));
	const text = vp.formatVaultPrompt(["02_Memories/Vault-Picker.md", "20_Library/Deep-Nested.md"], byPath, CFG);
	const lines = text.trim().split("\n");
	assert.equal(lines[0], CFG.readyPrompt);
	assert.equal(lines[1], "");
	assert.ok(lines[2].startsWith("02_Memories/Vault-Picker.md — "));
	assert.ok(lines[3].startsWith("20_Library/Deep-Nested.md — "));
});

test("includeDescription false emits bare paths", () => {
	const byPath = new Map(vp.buildNotes(CFG, true).map((n) => [n.path, n]));
	const text = vp.formatVaultPrompt(["02_Memories/Vault-Picker.md"], byPath, { ...CFG, includeDescription: false });
	assert.equal(text.trim().split("\n").at(-1), "02_Memories/Vault-Picker.md");
});

// ------------------------------------------------------------ rendering ----

test("every row is framed to exactly the requested width", () => {
	for (const width of [60, 80, 110]) {
		const { picker } = makePicker();
		type(picker, "clus");
		picker.handleInput("\t");
		for (const line of picker.render(width)) {
			const bare = tui.stripTerminalSequences(line).replace(/\x1b_pi:c\x07/g, "");
			assert.equal(bare.length, width, `expected ${width} cols: ${JSON.stringify(bare)}`);
			const left = bare[0];
			const right = bare[bare.length - 1];
			const box = "╭├╰│";
			const closing = "╮┤╯│";
			assert.ok(box.includes(left) && closing.includes(right), `missing side border: ${bare}`);
		}
	}
});

test("top-level folders show as an OR group of paths", () => {
	const groups = vp.parseQuery("10_Projects or 20_Library");
	assert.equal(groups.length, 2);
	assert.equal(groups[0][0].text, "10_projects");
	assert.equal(groups[1][0].text, "20_library");
});

test("plain terms AND, pipe and the word 'or' union", () => {
	const notes = vp.buildNotes(CFG, true);
	const paths = (q) => vp.filterNotes(notes, q, USAGE).map((n) => n.path);
	const single = paths("Deep-Nested");
	for (const q of ["Vault-Picker | Deep-Nested", "Vault-Picker or Deep-Nested"]) {
		const got = paths(q);
		assert.ok(got.includes("02_Memories/Vault-Picker.md"), q);
		assert.ok(got.includes("20_Library/Deep-Nested.md"), q);
		assert.ok(got.length > single.length, `${q} should be broader than a single term`);
	}
	assert.ok(paths("stata export").length === 1, "both terms must match");
});

test("^ anchors to the start of a name or path segment", () => {
	const notes = vp.buildNotes(CFG, true);
	const paths = (q) => vp.filterNotes(notes, q, USAGE).map((n) => n.path);
	assert.deepEqual(paths("^deep"), ["20_Library/Deep-Nested.md"]);
	assert.ok(paths("^stata").includes("02_Memories/Stata-Table-Export.md"));
	assert.ok(!paths("^table").includes("02_Memories/Stata-Table-Export.md"), "mid-name is not a start match");
});

test("$ anchors to the end and ignores the extension", () => {
	const notes = vp.buildNotes(CFG, true);
	const paths = (q) => vp.filterNotes(notes, q, USAGE).map((n) => n.path);
	assert.deepEqual(paths("export$"), ["02_Memories/Stata-Table-Export.md"]);
	assert.ok(paths("md$").length > 0, "extension-insensitive end match still finds notes");
	assert.ok(!paths("table$").includes("02_Memories/Stata-Table-Export.md"), "mid-name is not an end match");
});

test("! excludes", () => {
	const notes = vp.buildNotes(CFG, true);
	const paths = (q) => vp.filterNotes(notes, q, USAGE).map((n) => n.path);
	const without = paths("deep !nested");
	assert.equal(without.length, 0);
	assert.ok(!paths("!deep").includes("20_Library/Deep-Nested.md"));
	assert.ok(paths("!deep").includes("02_Memories/Vault-Picker.md"));
});

test("field prefixes scope a term to one field", () => {
	const notes = vp.buildNotes(CFG, true);
	const paths = (q) => vp.filterNotes(notes, q, USAGE).map((n) => n.path);
	assert.deepEqual(paths("tag:pin"), ["02_Memories/Stata-Table-Export.md"]);
	assert.ok(paths("dir:library").every((p) => p.startsWith("20_Library/")) && paths("dir:library").length > 1);
	assert.deepEqual(paths("name:deep"), ["20_Library/Deep-Nested.md"]);
	assert.equal(paths("desc:nonexistentphrase").length, 0);
	assert.ok(paths("desc:clipboard").includes("02_Memories/Vault-Picker.md"));
});

test("operators combine in any order around a field prefix", () => {
	const shape = (q) => {
		const [group] = vp.parseQuery(q);
		const [term] = group;
		return (
			`${term.field}|${term.text}|` +
			`${term.substring ? "'" : ""}${term.anchorStart ? "^" : ""}${term.anchorEnd ? "$" : ""}${term.negate ? "!" : ""}`
		);
	};
	// Negated terms normalize to the literal matcher, matching tv's `!foo` semantics.
	assert.equal(shape("!^hp"), "any|hp|'^!");
	assert.equal(shape("^!hp"), "any|hp|'^!");
	assert.equal(shape("!dir:x"), "dir|x|'!");
	assert.equal(shape("dir:!x"), "dir|x|'!");
	assert.equal(shape("^!dir:x"), "dir|x|'^!");
	assert.equal(shape("tag:^pin$"), "tag|pin|^$");
	assert.equal(shape("!!x"), "any|x|'!");
	assert.equal(shape("'stata"), "any|stata|'");
	assert.equal(shape("!'stata"), "any|stata|'!");
	assert.equal(shape("dir:'mcp"), "dir|mcp|'");
	assert.equal(vp.parseQuery("!x")[0][0].substring, true);
	assert.equal(vp.parseQuery("x")[0][0].substring, false);
});

test("' forces a contiguous run, so fuzzy-only hits drop out", () => {
	const notes = vp.buildNotes(CFG, true);
	const paths = (q) => vp.filterNotes(notes, q, USAGE).map((n) => n.path);
	// "cluser" is a subsequence of "Clustering" but never appears as a literal run.
	assert.ok(paths("cluser").includes("20_Library/Clustering-Standard-Errors.md"), "fuzzy should reach it");
	assert.deepEqual(paths("'cluser"), [], "substring should not reach it");
	assert.deepEqual(paths("'clustering-standard"), ["20_Library/Clustering-Standard-Errors.md"]);
});

test("tv's exact form ^foo$ matches the whole name", () => {
	const notes = vp.buildNotes(CFG, true);
	const paths = (q) => vp.filterNotes(notes, q, USAGE).map((n) => n.path);
	assert.deepEqual(paths("^Deep-Nested$"), ["20_Library/Deep-Nested.md"]);
	assert.ok(!paths("^Nested$").includes("20_Library/Deep-Nested.md"), "not the whole name, so no match");
});

test("a bare field prefix is dropped rather than searched literally", () => {
	assert.deepEqual(vp.parseQuery("dir:"), []);
	assert.deepEqual(vp.parseQuery("llm tag:"), [
		[{ field: "any", text: "llm", substring: false, anchorStart: false, anchorEnd: false, negate: false }],
	]);
});

test("a negated term with no matches leaves the note in", () => {
	const groups = vp.parseQuery("!zzz");
	assert.equal(groups.length, 1);
	assert.equal(groups[0][0].negate, true);
	const notes = vp.buildNotes(CFG, true);
	assert.equal(vp.filterNotes(notes, "!zzz", USAGE).length, notes.length);
});

test("compactPath keeps the full path when it fits", () => {
	const full = "10_Projects/Local-LLMs/Agents/Pi/Advisor.md";
	assert.equal(vp.compactPath(full, 80), full);
});

test("compactPath drops middle folders, keeping the top folder and the name", () => {
	const full = "10_Projects/Local-LLMs/Agents/Pi/Advisor.md";
	const out = vp.compactPath(full, 28);
	assert.ok(out.startsWith("10_Projects/"), out);
	assert.ok(out.endsWith("/Advisor.md"), out);
	assert.ok(tui.visibleWidth(out) <= 28, `${out} is ${tui.visibleWidth(out)} wide`);
});

test("empty result state tells the user", () => {
	const { picker } = makePicker();
	type(picker, "qwxzvp");
	assert.ok(picker.render(100).join("\n").includes("no notes match"));
});

// ------------------------------------------------------------ geometry ----

test("the whole frame is one border color, corners, sides, and dividers alike", () => {
	const { picker } = makePicker(tagTheme);
	for (const w of [60, 80, 100]) {
		const seen = borderColors(picker.render(w));
		assert.deepEqual([...seen], ["borderAccent"], `width ${w}: ${[...seen].join(", ")}`);
	}
});

test("borderColor is a single knob for the entire frame", () => {
	const { picker } = makePicker(tagTheme, { borderColor: "warning" });
	assert.deepEqual([...borderColors(picker.render(90))], ["warning"]);
});

test("moving the cursor never resizes the window", () => {
	const { picker } = makePicker();
	const heights = new Set();
	for (let i = 0; i < 12; i += 1) {
		heights.add(picker.render(90).length);
		picker.handleInput("\x1b[B"); // down
	}
	assert.equal(heights.size, 1, `heights seen: ${[...heights].join(", ")}`);
});

test("the window stays the same height as the match set shrinks", () => {
	const { picker } = makePicker();
	const base = picker.render(90).length;
	const heights = new Set([base]);
	for (const q of ["a", "e", "o", "deep", "deep nested", "zzzz no match"]) {
		picker.handleInput("\x15"); // ctrl+u
		type(picker, q);
		heights.add(picker.render(90).length);
	}
	assert.equal(heights.size, 1, `heights seen: ${[...heights].join(", ")}`);
});

test("the highlight band never covers a border glyph", () => {
	const { picker } = makePicker(tagTheme);
	const PIPE = "\u2502";
	const highlighted = picker.render(88).filter((l) => l.includes("\u00ab@selectedBg\u00bb"));
	assert.equal(highlighted.length, 1, "exactly one row should carry the highlight");
	const line = highlighted[0];
	assert.ok(line.startsWith(`\u00abborderAccent\u00bb${PIPE}\u00ab/\u00bb`), "left border sits outside the band");
	assert.ok(line.endsWith(`\u00abborderAccent\u00bb${PIPE}\u00ab/\u00bb`), "right border sits outside the band");
	assert.equal([...line].filter((c) => c === PIPE).length, 2, "no stray pipe inside the band");
});

test("padList:false trades the fixed height back for a tight list", () => {
	const { picker } = makePicker(stubTheme, { padList: false });
	const full = picker.render(90).length;
	picker.handleInput("\x15");
	type(picker, "deep");
	assert.ok(picker.render(90).length < full, "a one-note result should be shorter when not padding");
});

// ------------------------------------------------------------- keyboard ----

test("enter with nothing selected submits the cursor row", () => {
	const { picker, result } = makePicker();
	type(picker, "clus");
	picker.handleInput("\r");
	assert.deepEqual(result()?.paths, ["20_Library/Clustering-Standard-Errors.md"]);
});

test("selection survives query edits across searches", () => {
	const { picker, result } = makePicker();
	type(picker, "stata");
	picker.handleInput("\t");
	picker.handleInput("\x15"); // ctrl+u clears the query
	type(picker, "vault");
	picker.handleInput("\t");
	picker.handleInput("\r");
	assert.deepEqual(result()?.paths, ["02_Memories/Stata-Table-Export.md", "02_Memories/Vault-Picker.md"]);
});

test("ctrl+a selects and clears every filtered note", () => {
	const { picker } = makePicker();
	picker.handleInput("\x01");
	const first = picker.selected.size;
	picker.handleInput("\x01");
	assert.ok(first > 1, "expected several filtered notes");
	assert.equal(picker.selected.size, 0);
});

test("escape cancels with no result", () => {
	let captured = "unset";
	const picker = new vp.VaultPicker(stubTheme, vp.buildNotes(CFG, true), USAGE, new Set(), CFG, (r) => {
		captured = r;
	});
	picker.handleInput("\x1b");
	assert.equal(captured, undefined);
});

test("enter on an empty result list submits nothing", () => {
	const { picker, result } = makePicker();
	type(picker, "qwxzvp");
	picker.handleInput("\r");
	assert.equal(result(), null);
});

test("page keys move the cursor without escaping the list", () => {
	const { picker } = makePicker();
	picker.handleInput("\x06"); // ctrl+f is unbound; should be a no-op for the cursor
	const before = picker.cursor;
	picker.handleInput("\x1b[6~"); // pageDown
	assert.ok(picker.cursor > before);
	for (let i = 0; i < 20; i += 1) picker.handleInput("\x1b[5~"); // pageUp
	assert.equal(picker.cursor, 0);
});

// -------------------------------------------------------------- wiring ----

/** Fake ExtensionAPI + command context that records everything the extension does. */
function fakeHost(overrides = {}) {
	const state = { commands: {}, sent: [], editor: [], notices: [] };
	vp.default({
		registerCommand: (name, def) => {
			state.commands[name] = def;
		},
		on: () => {},
		sendUserMessage: (text, opts) => state.sent.push({ text, opts }),
	});
	const ctx = {
		mode: "print",
		isIdle: () => true,
		ui: {
			notify: (message, kind) => state.notices.push(`${kind ?? "info"}: ${message}`),
			confirm: async () => false,
			setEditorText: (text) => state.editor.push(text),
			custom: async () => undefined,
		},
		sessionManager: { getEntries: () => [] },
		...overrides,
	};
	return { state, ctx };
}

test("registers /vault, /v, and /vd", () => {
	const { state } = fakeHost();
	for (const name of ["vault", "v", "vd"]) {
		assert.equal(typeof state.commands[name]?.handler, "function", `missing /${name}`);
	}
});

test("--help documents the flags", async () => {
	const { state, ctx } = fakeHost();
	await state.commands.vault.handler("--help", ctx);
	const joined = state.notices.join(" ");
	assert.match(joined, /--draft/);
	assert.match(joined, /--again/);
	assert.match(joined, /--refresh/);
	assert.equal(state.sent.length, 0);
});

test("bare unique title resolves and sends the prompt", async () => {
	const { state, ctx } = fakeHost();
	await state.commands.vault.handler("Vault-Picker", ctx);
	assert.equal(state.sent.length, 1);
	assert.match(state.sent[0].text, /^Read the following Obsidian notes/);
	assert.ok(state.sent[0].text.includes("02_Memories/Vault-Picker.md"));
});

test("--again replays the last selection", async () => {
	const { state, ctx } = fakeHost();
	await state.commands.vault.handler("Deep-Nested", ctx);
	const first = state.sent.at(-1).text;
	await state.commands.vault.handler("--again", ctx);
	assert.equal(state.sent.at(-1).text, first);
});

test("unknown notes warn instead of sending", async () => {
	const { state, ctx } = fakeHost();
	await state.commands.vault.handler("NoSuchNote-9999", ctx);
	assert.equal(state.sent.length, 0);
	assert.match(state.notices.join(" "), /do not exist|unresolved|None/i);
});

test("/vd fills the editor and sends nothing", async () => {
	const { state, ctx } = fakeHost();
	await state.commands.vd.handler("Vault-Picker", ctx);
	assert.equal(state.sent.length, 0);
	assert.equal(state.editor.length, 1);
	assert.ok(state.editor[0].includes("02_Memories/Vault-Picker.md"));
});

test("over-budget selection declines into the editor", async () => {
	const { state, ctx } = fakeHost();
	const big = [...vp.buildNotes(CFG, true)]
		.sort((a, b) => b.bytes - a.bytes)
		.map((n) => n.title)
		.filter((t) => t === "Big");
	await state.commands.vault.handler(big.join(" "), ctx);
	// confirm() resolves false above, so the text lands in the editor unsent.
	assert.equal(state.sent.length, 0, "expected no send after declining the budget prompt");
	assert.equal(state.editor.length, 1);
});

test("picker is skipped outside the TUI unless paths are given", async () => {
	const { state, ctx } = fakeHost();
	await state.commands.vault.handler("", ctx);
	assert.equal(state.sent.length, 0);
	assert.match(state.notices.join(" "), /TUI/);
});
