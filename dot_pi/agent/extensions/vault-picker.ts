/**
 * /vault — fuzzy-pick Obsidian notes and drop them into the conversation.
 *
 * Replaces the launcher → clipboard → paste loop. Type `/v`, fuzzy-search note
 * names, Tab to multi-select, Enter to send:
 *
 *   Read the following Obsidian notes, reply only with "Ready.", and wait for
 *   follow up discussion.
 *
 *   02_Memories/Vault-Picker.md
 *   10_Projects/Stata-Config.md
 *
 * The extension never reads note bodies beyond the frontmatter head used for the
 * preview pane, and it never talks to MCP. The agent reads whatever it needs with
 * the tools it already has.
 *
 * Config: ~/.config/pi-vault.json (all keys optional)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	type Focusable,
	fuzzyMatch,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

// Env overrides keep tests hermetic; normal use falls back to the usual spots.
const CONFIG_PATH = process.env.PI_VAULT_CONFIG ?? path.join(os.homedir(), ".config", "pi-vault.json");
const USAGE_PATH = process.env.PI_VAULT_USAGE ?? path.join(os.homedir(), ".cache", "pi-vault-picker", "usage.json");
const HEAD_BYTES = 4096;

interface VaultConfig {
	vaultPath: string;
	readyPrompt: string;
	includeDescription: boolean;
	readDescriptions: boolean;
	maxVisibleRows: number;
	maxTotalBytes: number;
	cacheTtlMs: number;
	skipDirs: string[];
	/** Theme color name used for every border glyph, so the frame reads as one piece. */
	borderColor: string;
	/** Fixed height of the preview panel. Padded, so scrolling never resizes the window. */
	descLines: number;
	/** Hold the result list at full height when only a few notes match. */
	padList: boolean;
}

const DEFAULT_CONFIG: VaultConfig = {
	vaultPath: path.join(os.homedir(), "Dropbox", "Sam-Obsidian-Vault"),
	readyPrompt: 'Read the following Obsidian notes with TurboVault, reply only with "Ready.", and wait for follow-up discussion.',
	includeDescription: true,
	readDescriptions: true,
	maxVisibleRows: 12,
	maxTotalBytes: 160_000,
	cacheTtlMs: 120_000,
	skipDirs: ["node_modules", "attachments", ".trash", ".obsidian", ".git"],
	borderColor: "borderAccent",
	descLines: 2,
	padList: true,
};

interface NoteEntry {
	/** Vault-relative path with forward slashes. Canonical id; never the title. */
	path: string;
	dir: string;
	title: string;
	description: string;
	tags: string[];
	bytes: number;
	mtimeMs: number;
	updatedMs: number;
	pinned: boolean;
}

interface UsageStats {
	counts: Record<string, number>;
	lastUsed: Record<string, number>;
	lastSelection: string[];
}


// ---------------------------------------------------------------- config ----

function unquote(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 1)
	) {
		return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
	}
	return trimmed;
}

export function loadConfig(): VaultConfig {
	let overrides: Partial<VaultConfig> = {};
	try {
		overrides = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Partial<VaultConfig>;
	} catch {
		overrides = {};
	}
	const merged: VaultConfig = { ...DEFAULT_CONFIG, ...overrides };
	if (merged.vaultPath.startsWith("~/")) {
		merged.vaultPath = path.join(os.homedir(), merged.vaultPath.slice(2));
	}
	merged.descLines = Math.max(0, Math.min(4, Math.floor(Number(merged.descLines) || 0)));
	merged.borderColor = typeof merged.borderColor === "string" && merged.borderColor ? merged.borderColor : "borderAccent";
	return merged;
}

export function loadUsage(): UsageStats {
	try {
		const raw = JSON.parse(fs.readFileSync(USAGE_PATH, "utf8")) as Partial<UsageStats>;
		return {
			counts: raw.counts ?? {},
			lastUsed: raw.lastUsed ?? {},
			lastSelection: Array.isArray(raw.lastSelection) ? raw.lastSelection : [],
		};
	} catch {
		return { counts: {}, lastUsed: {}, lastSelection: [] };
	}
}

export function saveUsage(usage: UsageStats): void {
	try {
		fs.mkdirSync(path.dirname(USAGE_PATH), { recursive: true });
		fs.writeFileSync(USAGE_PATH, JSON.stringify(usage), "utf8");
	} catch {
		// Usage ranking is a nicety; never fail a pick over it.
	}
}

// ------------------------------------------------------------- scanning ----

function readHead(file: string, maxBytes: number): string {
	let fd: number | undefined;
	try {
		fd = fs.openSync(file, "r");
		const buf = Buffer.alloc(maxBytes);
		const read = fs.readSync(fd, buf, 0, maxBytes, 0);
		return buf.subarray(0, read).toString("utf8");
	} catch {
		return "";
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
	}
}

/** Parse only the YAML frontmatter head for the fields the picker displays. */
export function parseFrontmatter(text: string): {
	description: string;
	tags: string[];
	updatedMs: number;
	pinned: boolean;
} {
	const empty = { description: "", tags: [] as string[], updatedMs: 0, pinned: false };
	const fence = /^﻿?---[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?---[ \t]*(?=\r?\n|$)/.exec(text);
	if (!fence) return empty;

	let description = "";
	let tags: string[] = [];
	let updatedMs = 0;
	let listKey: string | null = null;

	for (const line of fence[1].split(/\r?\n/)) {
		const item = /^([ \t]*)-[ \t]+(.*)$/.exec(line);
		if (item && listKey) {
			if (listKey === "tags") {
				const tag = unquote(item[2]).replace(/^#/, "");
				if (tag) tags.push(tag);
			}
			continue;
		}

		const kv = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/.exec(line);
		if (!kv) {
			if (!/^[ \t]/.test(line)) listKey = null;
			continue;
		}

		const key = kv[1];
		const value = kv[2].trim();
		if (value === "" || value === ">" || value === "|" || /^[>|][-+]?$/.test(value)) {
			listKey = key;
			continue;
		}
		listKey = null;

		if (key === "description") {
			description = unquote(value);
		} else if (key === "tags") {
			const inline = /^\[(.*)\]$/.exec(value);
			if (inline) {
				tags = inline[1]
					.split(",")
					.map((t) => unquote(t).replace(/^#/, ""))
					.filter((t) => t.length > 0);
			}
		} else if (key === "updated") {
			const parsed = Date.parse(unquote(value));
			if (!Number.isNaN(parsed)) updatedMs = parsed;
		}
	}

	return { description, tags, updatedMs, pinned: tags.includes("pin") };
}

function walkVault(root: string, rel: string, out: string[], cfg: VaultConfig, depth: number): void {
	if (depth > 14 || out.length > 20_000) return;
	let dirents: fs.Dirent[];
	try {
		dirents = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
	} catch {
		return;
	}
	for (const ent of dirents) {
		const childRel = rel ? `${rel}/${ent.name}` : ent.name;
		if (ent.isDirectory()) {
			if (ent.name.startsWith(".") || cfg.skipDirs.includes(ent.name)) continue;
			walkVault(root, childRel, out, cfg, depth + 1);
		} else if (ent.isFile() && /\.(md|markdown)$/i.test(ent.name)) {
			out.push(childRel);
		}
	}
}

interface CacheRow {
	size: number;
	mtimeMs: number;
	entry: NoteEntry;
}

let cache = new Map<string, CacheRow>();
let cacheBuiltAt = 0;

/** Vault-relative paths → note entries, reusing cached rows for untouched files. */
export function buildNotes(cfg: VaultConfig, force = false): NoteEntry[] {
	const now = Date.now();
	if (!force && cache.size > 0 && now - cacheBuiltAt < cfg.cacheTtlMs) {
		return [...cache.values()].map((row) => row.entry);
	}

	const relPaths: string[] = [];
	walkVault(cfg.vaultPath, "", relPaths, cfg, 0);

	const next = new Map<string, CacheRow>();
	for (const rel of relPaths) {
		const abs = path.join(cfg.vaultPath, rel);
		let stat: fs.Stats;
		try {
			stat = fs.statSync(abs);
		} catch {
			continue;
		}

		const cached = cache.get(rel);
		if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
			next.set(rel, cached);
			continue;
		}

		const base = path.basename(rel);
		const ext = path.extname(rel);
		const parsed = cfg.readDescriptions ? parseFrontmatter(readHead(abs, HEAD_BYTES)) : {
			description: "",
			tags: [] as string[],
			updatedMs: 0,
			pinned: false,
		};

		next.set(rel, {
			size: stat.size,
			mtimeMs: stat.mtimeMs,
			entry: {
				path: rel,
				dir: path.dirname(rel) === "." ? "" : path.dirname(rel),
				title: base.slice(0, base.length - ext.length),
				description: parsed.description,
				tags: parsed.tags,
				bytes: stat.size,
				mtimeMs: stat.mtimeMs,
				updatedMs: parsed.updatedMs || stat.mtimeMs,
				pinned: parsed.pinned,
			},
		});
	}

	cache = next;
	cacheBuiltAt = now;
	return [...next.values()].map((row) => row.entry);
}

// ------------------------------------------------------------- ranking ----

/** Local-time YYYY-MM-DD; `updated:` frontmatter is written without a timezone. */
function localDate(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const NOISY = /(untitled|scratch|retry|copy of|archive)/i;

type FieldName = "name" | "dir" | "path" | "tag" | "desc";

/** Lower weight wins on matches from this field, so name beats description. */
const WEIGHTS: Array<{ field: FieldName; weight: number }> = [
	{ field: "name", weight: 0 },
	{ field: "path", weight: 6 },
	{ field: "tag", weight: 14 },
	{ field: "dir", weight: 18 },
	{ field: "desc", weight: 45 },
];

const FIELD_ALIASES: Record<string, FieldName> = {
	name: "name",
	title: "name",
	dir: "dir",
	folder: "dir",
	path: "path",
	tag: "tag",
	tags: "tag",
	desc: "desc",
	description: "desc",
};

interface QueryTerm {
	field: FieldName | "any";
	text: string;
	substring: boolean;
	anchorStart: boolean;
	anchorEnd: boolean;
	negate: boolean;
}

interface Ops {
	substring: boolean;
	negate: boolean;
	anchorStart: boolean;
	anchorEnd: boolean;
}

/**
 * Peel operators off a token in any order, accumulating into `ops`. Mirrors
 * Television's search-pattern grammar: `'` contiguous substring, `^` prefix,
 * `$` suffix, `!` negate.
 */
function stripOps(token: string, ops: Ops): string {
	let t = token;
	let changed = true;
	while (changed) {
		changed = false;
		if (t.startsWith("!")) {
			ops.negate = true;
			t = t.slice(1);
			changed = true;
		}
		if (t.startsWith("'")) {
			ops.substring = true;
			t = t.slice(1);
			changed = true;
		}
		if (t.startsWith("^")) {
			ops.anchorStart = true;
			t = t.slice(1);
			changed = true;
		}
		if (t.endsWith("$")) {
			ops.anchorEnd = true;
			t = t.slice(0, -1);
			changed = true;
		}
	}
	return t;
}

/**
 * Query grammar. A query is one or more OR groups; inside a group every term must
 * match, and terms also split on `/` so `02/mem` still narrows by folder.
 *
 *   stata mcp          both terms, fuzzy
 *   llm | mcp          either term   (also written `llm or mcp`)
 *   ^stata            something starts with it (any path segment, or the name)
 *   mcp$              something ends with it, extension-insensitive
 *   !archive          exclude anything matching it
 *   dir:llm tag:pin    restrict a term to one field
 *
 * Anchored terms are strict; they never fall back to fuzzy matching.
 */
export function parseQuery(raw: string): QueryTerm[][] {
	const trimmed = raw.trim();
	if (!trimmed) return [];

	const groups: QueryTerm[][] = [];
	for (const groupText of trimmed.split(/\s*\|\s*|\s+or\s+/i)) {
		const terms: QueryTerm[] = [];
		for (const rawToken of groupText.split(/[\s/]+/).filter(Boolean)) {
			const ops: Ops = { substring: false, negate: false, anchorStart: false, anchorEnd: false };
			let token = stripOps(rawToken, ops);
			let field: FieldName | "any" = "any";

			// A field prefix may sit outside or inside the operators: `!dir:x`, `dir:!x`.
			const scoped = /^([A-Za-z]+):(.*)$/.exec(token);
			if (scoped && FIELD_ALIASES[scoped[1].toLowerCase()]) {
				field = FIELD_ALIASES[scoped[1].toLowerCase()];
				token = stripOps(scoped[2], ops);
			}

			token = token.trim().toLowerCase();
			if (!token) continue;

			// tv negates the literal run, not the fuzzy subsequence, so `!zotero` means
			// "does not contain zotero" rather than "does not fuzzy-match zotero".
			if (ops.negate) ops.substring = true;
			terms.push({ field, text: token, ...ops });
		}
		if (terms.length > 0) groups.push(terms);
	}
	return groups;
}

let cachedQuery = "\u0000";
let cachedGroups: QueryTerm[][] = [];

function groupsFor(query: string): QueryTerm[][] {
	if (query !== cachedQuery) {
		cachedQuery = query;
		cachedGroups = parseQuery(query);
	}
	return cachedGroups;
}

function fieldText(entry: NoteEntry, field: FieldName): string {
	switch (field) {
		case "name":
			return entry.title;
		case "dir":
			return entry.dir;
		case "path":
			return entry.path;
		case "tag":
			return entry.tags.join(" ");
		default:
			return entry.description;
	}
}

const stripExt = (s: string): string => s.replace(/\.(md|markdown)$/i, "");

function anchoredStart(text: string, term: string): boolean {
	return text.startsWith(term) || text.split("/").some((seg) => seg.startsWith(term));
}

function anchoredEnd(text: string, term: string): boolean {
	return text.endsWith(term) || text.split("/").some((seg) => stripExt(seg).endsWith(term));
}

function familiarityBonus(entry: NoteEntry, usage: UsageStats): number {
	let bonus = 0;
	const count = usage.counts[entry.path] ?? 0;
	if (count > 0) bonus -= 10 * Math.log1p(count);
	const last = usage.lastUsed[entry.path] ?? 0;
	if (last > 0) {
		const days = (Date.now() - last) / 86_400_000;
		if (days <= 1) bonus -= 20;
		else if (days <= 7) bonus -= 12;
		else if (days <= 30) bonus -= 5;
	}
	if (entry.pinned) bonus -= 50;
	const touched = (Date.now() - entry.updatedMs) / 86_400_000;
	if (touched <= 7) bonus -= 8;
	else if (touched <= 30) bonus -= 4;
	return bonus;
}

/** Score one term against one note, or null when it does not match. */
function evalTerm(entry: NoteEntry, term: QueryTerm): number | null {
	const fields = term.field === "any" ? WEIGHTS : WEIGHTS.filter((w) => w.field === term.field);
	let best: number | null = null;

	for (const { field, weight } of fields) {
		const text = fieldText(entry, field).toLowerCase();
		if (!text) continue;

		// `'` requires the literal run of characters, so a fuzzy subsequence won't do.
		if (term.substring && !text.includes(term.text)) continue;

		if (term.anchorStart || term.anchorEnd) {
			if (term.anchorStart && !anchoredStart(text, term.text)) continue;
			if (term.anchorEnd && !anchoredEnd(text, term.text)) continue;
			const exact = stripExt(text).toLowerCase() === term.text ? -50 : 0;
			const candidate = weight - 25 + exact;
			if (best === null || candidate < best) best = candidate;
			continue;
		}

		if (term.substring) {
			const candidate = weight - 20;
			if (best === null || candidate < best) best = candidate;
			continue;
		}

		const match = fuzzyMatch(term.text, text);
		if (!match.matches) continue;
		const candidate = match.score + weight;
		if (best === null || candidate < best) best = candidate;
	}

	if (term.negate) return best === null ? 0 : null;
	return best;
}

/**
 * Lower score ranks higher, matching pi-tui's fuzzy convention. Returns null when
 * the note fails every OR group, so it drops out of the list.
 */
export function scoreNote(entry: NoteEntry, query: string, usage: UsageStats): number | null {
	const bonus = familiarityBonus(entry, usage) + (NOISY.test(entry.title) ? 45 : 0);
	const groups = groupsFor(query);
	if (groups.length === 0) return bonus;

	let bestGroup: number | null = null;
	for (const group of groups) {
		let sum = 0;
		for (const term of group) {
			const score = evalTerm(entry, term);
			if (score === null) {
				sum = NaN;
				break;
			}
			sum += score;
		}
		if (Number.isNaN(sum)) continue;
		if (bestGroup === null || sum < bestGroup) bestGroup = sum;
	}

	return bestGroup === null ? null : bestGroup + bonus;
}

export function filterNotes(notes: NoteEntry[], query: string, usage: UsageStats): NoteEntry[] {
	const scored: Array<{ entry: NoteEntry; score: number }> = [];
	for (const entry of notes) {
		const score = scoreNote(entry, query, usage);
		if (score !== null) scored.push({ entry, score });
	}
	scored.sort((a, b) => a.score - b.score || a.entry.path.localeCompare(b.entry.path));
	return scored.map((s) => s.entry);
}

// ------------------------------------------------------------- output ----

export function formatVaultPrompt(paths: string[], byPath: Map<string, NoteEntry>, cfg: VaultConfig): string {
	const lines = paths.map((p) => {
		const entry = byPath.get(p);
		const desc = cfg.includeDescription && entry?.description ? ` — ${entry.description}` : "";
		return `${p}${desc}`;
	});
	return `${cfg.readyPrompt}\n\n${lines.join("\n")}\n`;
}

export function totalBytes(paths: string[], byPath: Map<string, NoteEntry>): number {
	return paths.reduce((sum, p) => sum + (byPath.get(p)?.bytes ?? 0), 0);
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

/** ANSI-aware: never truncates inside an escape sequence or wide grapheme. */
function clamp(text: string, width: number): string {
	if (width <= 0) return "";
	return truncateToWidth(text, width, "…");
}

function wrapAll(text: string, width: number): string[] {
	const lines: string[] = [];
	let current = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const candidate = current ? `${current} ${word}` : word;
		if (current && visibleWidth(candidate) > width) {
			lines.push(current);
			current = word;
		} else {
			current = candidate;
		}
	}
	if (current) lines.push(current);
	return lines;
}

/** Word-wrap to at most `maxLines`, marking the cut with an ellipsis. */
function wrap(text: string, width: number, maxLines: number): string[] {
	const all = wrapAll(text, width);
	if (all.length <= maxLines) return all.map((l) => clamp(l, width));
	const kept = all.slice(0, maxLines);
	kept[maxLines - 1] = clamp(`${kept[maxLines - 1]} …`, width);
	return kept;
}

/** Pad or truncate to exactly `w` visible columns. */
function fit(text: string, w: number): string {
	if (w <= 0) return "";
	const clipped = truncateToWidth(text, w, "…");
	const pad = w - visibleWidth(clipped);
	return pad > 0 ? clipped + " ".repeat(pad) : clipped;
}

/**
 * Keep the vault-relative path whole whenever it fits. When it cannot, drop middle
 * folders first so the top-level folder and the note name both stay visible.
 */
export function compactPath(full: string, w: number): string {
	if (visibleWidth(full) <= w) return full;
	const segments = full.split("/");
	if (segments.length >= 2) {
		const kept = [...segments];
		while (kept.length > 2 && visibleWidth(kept.join("/")) > w) kept.splice(1, 1);
		if (visibleWidth(kept.join("/")) <= w) return kept.join("/");
		const name = kept[kept.length - 1]!;
		if (visibleWidth(name) <= w) return `…/${name}`;
		return `…${name.slice(-(w - 1))}`;
	}
	return truncateToWidth(full, w, "…");
}

// ------------------------------------------------------------- picker ----

type PickerResult = { paths: string[] };

export class VaultPicker implements Focusable {
	focused = false;

	private query = "";
	private results: NoteEntry[];
	private cursor = 0;
	private scroll = 0;
	private selected = new Set<string>();

	constructor(
		private theme: Theme,
		private notes: NoteEntry[],
		private usage: UsageStats,
		private seen: Set<string>,
		private cfg: VaultConfig,
		private done: (result: PickerResult | undefined) => void,
	) {
		this.results = this.filter();
	}

	private filter(): NoteEntry[] {
		return filterNotes(this.notes, this.query, this.usage);
	}

	private setQuery(next: string): void {
		this.query = next;
		this.results = this.filter();
		this.cursor = Math.min(this.cursor, Math.max(0, this.results.length - 1));
		this.scroll = Math.min(this.scroll, Math.max(0, this.results.length - 1));
	}

	private visibleCount(): number {
		return Math.max(1, Math.min(this.cfg.maxVisibleRows, this.results.length));
	}

	/** Rows the list occupies on screen: constant, independent of the match count. */
	private rowSlots(): number {
		return Math.max(1, this.cfg.maxVisibleRows);
	}

	private keepVisible(): void {
		const count = this.visibleCount();
		if (this.cursor < this.scroll) this.scroll = this.cursor;
		if (this.cursor >= this.scroll + count) this.scroll = this.cursor - count + 1;
	}

	private toggle(pathRel: string): void {
		if (this.selected.has(pathRel)) this.selected.delete(pathRel);
		else this.selected.add(pathRel);
	}

	private submit(): void {
		const paths = [...this.selected];
		if (paths.length === 0) {
			const current = this.results[this.cursor];
			if (!current) return;
			paths.push(current.path);
		}
		this.done({ paths });
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.done(undefined);
			return;
		}
		if (matchesKey(data, "return") || matchesKey(data, "ctrl+s")) {
			this.submit();
			return;
		}
		if (matchesKey(data, "tab") || matchesKey(data, "ctrl+space")) {
			const current = this.results[this.cursor];
			if (current) {
				this.toggle(current.path);
				this.cursor = Math.min(this.cursor + 1, Math.max(0, this.results.length - 1));
				this.keepVisible();
			}
			return;
		}
		if (matchesKey(data, "ctrl+a")) {
			const allSelected = this.results.length > 0 && this.results.every((n) => this.selected.has(n.path));
			if (allSelected) this.selected.clear();
			else for (const note of this.results) this.selected.add(note.path);
			return;
		}
		if (matchesKey(data, "ctrl+u") || matchesKey(data, "ctrl+w")) {
			this.setQuery("");
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "ctrl+p")) {
			this.cursor = Math.max(0, this.cursor - 1);
			this.keepVisible();
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "ctrl+n")) {
			this.cursor = Math.min(Math.max(0, this.results.length - 1), this.cursor + 1);
			this.keepVisible();
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.cursor = Math.max(0, this.cursor - this.visibleCount());
			this.keepVisible();
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.cursor = Math.min(Math.max(0, this.results.length - 1), this.cursor + this.visibleCount());
			this.keepVisible();
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.setQuery(this.query.slice(0, -1));
			return;
		}

		// Printable input, including multi-char pastes.
		if (/^[\x20-\x7e\xa0-\uffff]+$/.test(data) && !data.startsWith("\x1b")) {
			this.setQuery(this.query + data);
		}
	}

	render(width: number): string[] {
		const t = this.theme;
		const inner = Math.max(12, width - 4);
		const markCols = 2;
		const seenCols = 2;
		const sizeCols = 6;
		const pathCols = Math.max(14, inner - markCols - seenCols - sizeCols);

		// One color for every glyph of the frame, sides included, so the window reads
		// as a single piece rather than three bands.
		const bc = this.cfg.borderColor;
		const side = (ch: string) => t.fg(bc, ch);
		/**
		 * One padded content row framed by the borders. The highlight band stops
		 * inside the frame: wrapping the border columns too makes the selected row
		 * read as a box wider than the window it sits in.
		 */
		const row = (content: string, highlight = false): string => {
			const body = ` ${fit(content, inner)} `;
			return `${side("│")}${highlight ? t.bg("selectedBg", body) : body}${side("│")}`;
		};
		const edge = (left: string, right: string) =>
			t.fg(bc, `${left}${"─".repeat(inner + 2)}${right}`);

		const lines: string[] = [];
		const sel = this.selected.size;
		const counts = `${this.results.length}/${this.notes.length}${sel ? `   ${sel} selected` : ""}`;
		const head =
			t.fg("accent", t.bold("vault")) +
			" ".repeat(Math.max(2, inner - 5 - visibleWidth(counts))) +
			t.fg("dim", counts);

		lines.push(edge("╭", "╮"));
		lines.push(row(head));

		const prompt = "› ";
		const typed = truncateToWidth(this.query, Math.max(0, inner - visibleWidth(prompt)), "…");
		const typedWidth = visibleWidth(prompt + typed);
		lines.push(
			row(
				`${t.fg("accent", prompt)}${typed}` +
					(this.focused ? CURSOR_MARKER : "") +
					" ".repeat(Math.max(0, inner - typedWidth)),
			),
		);
		lines.push(edge("├", "┤"));

		// The list always occupies the same number of rows, so a shrinking result set
		// cannot pull the frame up or down.
		const listSlots = this.cfg.padList ? this.rowSlots() : this.visibleCount();
		this.keepVisible();
		const slice = this.results.slice(this.scroll, this.scroll + listSlots);

		const emptyMsg = slice.length === 0 ? `no notes match "${this.query}"` : "";

		// Exactly listSlots rows, always: the empty-state notice takes a slot rather
		// than adding one.
		for (let i = 0; i < listSlots; i += 1) {
			const note = slice[i];
			if (!note) {
				lines.push(i === 0 && emptyMsg ? row(t.fg("dim", emptyMsg)) : row(""));
				continue;
			}
			const isSelected = this.selected.has(note.path);
			const isCursor = this.scroll + i === this.cursor;

			const compact = compactPath(note.path, pathCols);
			const slash = compact.lastIndexOf("/");
			const pathCell =
				(slash >= 0 ? t.fg("muted", compact.slice(0, slash + 1)) : "") +
				t.fg(isSelected ? "accent" : "text", slash >= 0 ? compact.slice(slash + 1) : compact);

			lines.push(
				row(
					t.fg(isSelected ? "success" : "dim", isSelected ? "✓ " : "  ") +
						fit(pathCell, pathCols) +
						t.fg("dim", `${this.seen.has(note.path) ? "↺" : " "} `) +
						t.fg("dim", formatBytes(note.bytes).padStart(sizeCols)),
					isCursor,
				),
			);
		}

		lines.push(edge("├", "┤"));

		// Exactly descLines + 1 rows here too: a three-line description on one note
		// and an empty one on the next no longer resize anything.
		const descSlots = this.cfg.descLines;
		if (descSlots > 0) {
			const current = this.results[this.cursor];
			const body = current?.description ? wrap(current.description, inner, descSlots) : [];
			for (let i = 0; i < descSlots; i += 1) lines.push(row(body[i] ?? ""));

			const meta: string[] = [];
			if (current?.tags.length) meta.push(current.tags.map((tag) => `#${tag}`).join(" "));
			if (current) meta.push(localDate(current.updatedMs));
			lines.push(row(current ? t.fg("dim", meta.join("   ·   ")) : ""));
		}

		lines.push(edge("├", "┤"));
		lines.push(row(t.fg("dim", "tab select · ctrl+a all · enter load · esc cancel · ↺ already read")));
		if (inner >= 66) {
			lines.push(
				row(
					t.fg(
						"dim",
						"a b both · a|b either · 'contains · ^starts · ends$ · !not · dir: tag: name:",
					),
				),
			);
		}
		lines.push(edge("╰", "╯"));
		return lines;
	}
}

// ------------------------------------------------------------- wiring ----

function collectSeenPaths(ctx: ExtensionCommandContext): Set<string> {
	const seen = new Set<string>();
	try {
		for (const entry of ctx.sessionManager.getEntries() as any[]) {
			if (entry?.type !== "message") continue;
			const msg = entry.message;
			if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
			for (const block of msg.content) {
				if (block?.type !== "toolCall") continue;
				if (!/turbovault_read_note$/.test(String(block.name ?? ""))) continue;
				const p = block.args?.path ?? block.arguments?.path;
				if (typeof p === "string" && p) seen.add(p.replace(/^\.\//, ""));
			}
		}
	} catch {
		// Session shape drift only costs the ↺ marker.
	}
	return seen;
}

function parseArgs(raw: string): { flags: Set<string>; paths: string[] } {
	const flags = new Set<string>();
	const paths: string[] = [];
	for (const tok of raw.trim().split(/\s+/).filter(Boolean)) {
		if (tok.startsWith("-")) flags.add(tok);
		else paths.push(tok);
	}
	return { flags, paths };
}

export default function vaultPicker(pi: ExtensionAPI): void {
	const handler = async (raw: string, ctx: ExtensionCommandContext, draftDefault = false): Promise<void> => {
		const cfg = loadConfig();
		const { flags, paths } = parseArgs(raw);

		if (flags.has("--help") || flags.has("-h")) {
			ctx.ui.notify(
				"/vault [paths…] · --draft (fill editor instead of sending) · --again (resend last pick) · --refresh (rebuild index)",
				"info",
			);
			return;
		}

		if (!fs.existsSync(cfg.vaultPath)) {
			ctx.ui.notify(`Vault not found: ${cfg.vaultPath}`, "error");
			return;
		}

		const usage = loadUsage();
		const byPath = new Map(buildNotes(cfg, flags.has("--refresh")).map((n) => [n.path, n]));

		const normalize = (raw: string): string => {
			let s = raw.trim().replace(/^\.\//, "");
			if (s.startsWith(`${cfg.vaultPath}/`)) s = s.slice(cfg.vaultPath.length + 1);
			return s;
		};

		/** Accepts a vault-relative path, an absolute path, or a bare unique title. */
		const resolveOne = (raw: string): string | null => {
			const p = normalize(raw);
			if (byPath.has(p)) return p;
			const stem = p.replace(/\.(md|markdown)$/i, "").toLowerCase();
			const titles = [...byPath.values()].filter((n) => n.title.toLowerCase() === stem);
			if (titles.length === 1) return titles[0].path;
			if (titles.length > 1) return null;
			const suffixes = [...byPath.values()].filter((n) => n.path.toLowerCase().endsWith(stem));
			return suffixes.length === 1 ? suffixes[0].path : null;
		};

		const finish = async (requested: string[], draft: boolean): Promise<void> => {
			const resolved: string[] = [];
			const missing: string[] = [];
			for (const raw of requested) {
				const hit = resolveOne(raw);
				if (!hit) {
					missing.push(raw);
					continue;
				}
				if (!resolved.includes(hit)) resolved.push(hit);
			}

			if (resolved.length === 0) {
				ctx.ui.notify("None of those notes exist in the vault.", "warning");
				return;
			}
			if (missing.length > 0) {
				ctx.ui.notify(`Skipped ${missing.length} unresolved: ${missing.join(", ")}`, "warning");
			}

			const bytes = totalBytes(resolved, byPath);
			const text = formatVaultPrompt(resolved, byPath, cfg);

			if (draft) {
				ctx.ui.setEditorText(text);
				return;
			}

			if (bytes > cfg.maxTotalBytes) {
				const ok = await ctx.ui.confirm(
					"Large selection",
					`These notes total ${formatBytes(bytes)}. Send them into context anyway?`,
				);
				if (!ok) {
					ctx.ui.setEditorText(text);
					ctx.ui.notify("Put in the editor instead so you can trim the list.", "info");
					return;
				}
			}

			for (const p of resolved) {
				usage.counts[p] = (usage.counts[p] ?? 0) + 1;
				usage.lastUsed[p] = Date.now();
			}
			usage.lastSelection = resolved;
			saveUsage(usage);

			if (ctx.isIdle()) pi.sendUserMessage(text);
			else pi.sendUserMessage(text, { deliverAs: "followUp" });
		};

		if (flags.has("--again")) {
			if (usage.lastSelection.length === 0) {
				ctx.ui.notify("No previous /vault selection to repeat.", "warning");
				return;
			}
			await finish(usage.lastSelection, draftDefault || flags.has("--draft"));
			return;
		}

		if (paths.length > 0) {
			await finish(paths, draftDefault || flags.has("--draft"));
			return;
		}

		if (ctx.mode !== "tui") {
			ctx.ui.notify("Interactive vault picker needs the TUI. Pass note paths as arguments instead.", "warning");
			return;
		}

		const seen = collectSeenPaths(ctx);
		const notes = [...byPath.values()];
		if (notes.length === 0) {
			ctx.ui.notify(`No markdown notes found in ${cfg.vaultPath}`, "warning");
			return;
		}

		const result = await ctx.ui.custom<PickerResult>(
			(tui, theme, _keybindings, done) => {
				// Keep the box shorter than the overlay so nothing gets clipped.
				const termRows: number = (tui as unknown as { terminal?: { rows?: number } })?.terminal?.rows ?? 40;
				const fitCfg: VaultConfig = {
					...cfg,
					maxVisibleRows: Math.max(4, Math.min(cfg.maxVisibleRows, termRows - 16)),
				};
				return new VaultPicker(theme, notes, usage, seen, fitCfg, done);
			},
			{
				overlay: true,
				overlayOptions: {
					width: "86%",
					minWidth: 72,
					maxHeight: "88%",
					anchor: "center",
				},
			},
		);

		if (!result) return;
		await finish(result.paths, draftDefault || flags.has("--draft"));
	};

	pi.registerCommand("vault", {
		description: "Fuzzy-pick Obsidian notes and load them into this conversation",
		handler: async (args: string, ctx: ExtensionCommandContext) => handler(args, ctx, false),
	});

	pi.registerCommand("v", {
		description: "Short alias for /vault",
		handler: async (args: string, ctx: ExtensionCommandContext) => handler(args, ctx, false),
	});

	pi.registerCommand("vd", {
		description: "Pick Obsidian notes into the editor without sending",
		handler: async (args: string, ctx: ExtensionCommandContext) => handler(args, ctx, true),
	});
}
