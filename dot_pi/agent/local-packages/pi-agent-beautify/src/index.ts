import { spawnSync } from "node:child_process";

import { CustomEditor, UserMessageComponent, type AppKeybinding, type ExtensionAPI, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings, Markdown, matchesKey, truncateToWidth, visibleWidth, type AutocompleteProvider, type EditorComponent, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { registerCjkMarkdownTransformer } from "./cjk-markdown.js";

interface Attachment {
  token: string;
  path: string;
}

const CLIPBOARD_PATH_RE = /(?:[^\s"'`<>]+[\\/])?pi-clipboard-[0-9a-f-]+\.(?:png|jpe?g|webp|gif)/gi;
const TOKEN_RE = /\[image(\d+)\]/g;
const TOKEN_LINE_RE = /\[image\d+\]/g;
const IMAGE_FILE_RE = /\.(?:png|jpe?g|webp|gif)$/i;
const MARKDOWN_PATCH_STATE = Symbol.for("pi-agent-beautify.markdown.patch");
const USER_MESSAGE_PATCH_STATE = Symbol.for("pi-agent-beautify.user-message.patch");
const PLAIN_CODE_LANGS = new Set(["text", "plain", "plaintext"]);
/** Left accent bar for user messages (1 terminal column). */
const USER_MESSAGE_BAR = "▎";
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
/** Same keys pi uses so theme stays valid across /new /reload /session switch. */
const PI_THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const PI_THEME_KEY_OLD = Symbol.for("@mariozechner/pi-coding-agent:theme");

/**
 * Read the live Theme from globalThis — never close over extension ctx.
 * Session replacement invalidates ctx.ui, but the active Theme is always here.
 */
function getActiveTheme(): Theme | undefined {
  const g = globalThis as typeof globalThis & Record<symbol, Theme | undefined>;
  return g[PI_THEME_KEY] ?? g[PI_THEME_KEY_OLD];
}

function paintUserMessageBar(text: string): string {
  const active = getActiveTheme();
  if (!active) return text;
  try {
    return active.fg("borderAccent", text);
  } catch {
    try {
      return active.fg("border", text);
    } catch {
      return text;
    }
  }
}

/** Strip ANSI so syntax highlighting cannot override the code-box text color. */
function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

interface CodeBlockPalette {
  background: string;
  foreground: string;
}

const DEFAULT_CODE_BLOCK_PALETTE: CodeBlockPalette = {
  background: "\u001b[48;2;136;136;136m", // #888888
  foreground: "\u001b[38;2;0;0;0m", // #000000
};

const CODE_BLOCK_PALETTES: Record<string, CodeBlockPalette> = {
  noctalia: DEFAULT_CODE_BLOCK_PALETTE,
  "gruvbox-light-soft": {
    background: "\u001b[48;2;170;166;159m", // #aaa69f, warm gray against Gruvbox's yellow
    foreground: "\u001b[38;2;0;0;0m", // #000000
  },
};

function getCodeBlockPalette(): CodeBlockPalette {
  const themeName = getActiveTheme()?.name;
  return (themeName ? CODE_BLOCK_PALETTES[themeName] : undefined) ?? DEFAULT_CODE_BLOCK_PALETTE;
}

function paintCodeBlockBackground(text: string): string {
  return `${getCodeBlockPalette().background}${text}\u001b[49m`;
}

function paintCodeBlockText(text: string): string {
  return `${getCodeBlockPalette().foreground}${stripAnsi(text)}\u001b[39m`;
}
const MACOS_CLIPBOARD_FILE_PATHS_SCRIPT = `
ObjC.import('AppKit');
ObjC.import('Foundation');
const pb = $.NSPasteboard.generalPasteboard;
const classes = $.NSArray.arrayWithObject($.NSURL);
const options = $.NSDictionary.dictionaryWithObjectForKey($.NSNumber.numberWithBool(true), $.NSPasteboardURLReadingFileURLsOnlyKey);
const urls = pb.readObjectsForClassesOptions(classes, options);
const paths = [];
if (urls) {
  for (let i = 0; i < urls.count; i++) {
    const url = urls.objectAtIndex(i);
    if (url.isFileURL) paths.push(ObjC.unwrap(url.path));
  }
}
JSON.stringify(paths);
`;

interface MarkdownCodeToken {
  type: "code";
  lang?: string;
  text?: string;
}

interface MarkdownHeadingToken {
  type: "heading";
  depth: number;
  text?: string;
  tokens?: unknown[];
}

interface BeautifyMarkdownTheme {
  heading: (text: string) => string;
  bold: (text: string) => string;
  italic: (text: string) => string;
  underline: (text: string) => string;
  hr: (text: string) => string;
  codeBlock: (text: string) => string;
  codeBlockBorder: (text: string) => string;
  codeBlockIndent?: string;
  highlightCode?: (code: string, lang?: string) => string[];
}

interface InlineStyleContext {
  applyText: (text: string) => string;
  stylePrefix: string;
}

interface MarkdownRuntime {
  text?: string;
  theme: BeautifyMarkdownTheme;
  applyDefaultStyle?: (text: string) => string;
  getStylePrefix?: (styleFn: (text: string) => string) => string;
  renderInlineTokens?: (tokens: unknown[], styleContext?: InlineStyleContext) => string;
}

type MarkdownRenderToken = (this: MarkdownRuntime, token: unknown, width: number, nextTokenType?: string, styleContext?: unknown) => string[];
type MarkdownRender = (this: MarkdownRuntime, width: number) => string[];

interface MarkdownPatchState {
  installed: true;
  original: MarkdownRenderToken;
  originalRender?: MarkdownRender;
  resetHeadingState?: (instance: MarkdownRuntime) => void;
  /** Fixed neutral background painter for code panels. */
  codeBlockBg?: (text: string) => string;
  /** Fixed black text painter for code-panel content. */
  codeBlockText?: (text: string) => string;
  renderCodeToken: (instance: MarkdownRuntime, token: MarkdownCodeToken, width: number, nextTokenType?: string) => string[];
  renderHeadingToken: (instance: MarkdownRuntime, token: MarkdownHeadingToken, width: number, nextTokenType?: string) => string[];
}

type PatchedMarkdownPrototype = {
  render?: MarkdownRender;
  renderToken?: MarkdownRenderToken;
  [key: symbol]: unknown;
};

function isMarkdownCodeToken(token: unknown): token is MarkdownCodeToken {
  return typeof token === "object" && token !== null && (token as { type?: unknown }).type === "code";
}

function isMarkdownHeadingToken(token: unknown): token is MarkdownHeadingToken {
  return typeof token === "object" && token !== null && (token as { type?: unknown }).type === "heading";
}

/**
 * Paint a code line with the same kind of solid background used by tool-execution panels.
 * Pads to `width` so the bar reads as a block; no border glyphs (copy stays clean).
 */
function paintCodeLine(text: string, width: number, bgFn?: (text: string) => string): string {
  if (!bgFn) return text;
  const pad = Math.max(0, width - visibleWidth(text));
  return bgFn(text + " ".repeat(pad));
}

function renderCodeTokenWithoutFences(
  instance: MarkdownRuntime,
  token: MarkdownCodeToken,
  width: number,
  nextTokenType?: string,
): string[] {
  const raw = typeof token.text === "string" ? token.text : "";
  const langRaw = typeof token.lang === "string" ? token.lang.trim() : "";
  const lang = langRaw.toLowerCase();
  const lines: string[] = [];
  const indent = instance.theme.codeBlockIndent ?? "  ";
  const proto = Markdown.prototype as unknown as PatchedMarkdownPrototype;
  const mdState = proto[MARKDOWN_PATCH_STATE] as MarkdownPatchState | undefined;
  const bgFn = mdState?.codeBlockBg;
  const textFn = mdState?.codeBlockText;
  const w = Math.max(1, width);

  // text/plain fences: still no syntax-highlight chrome, but use the same panel
  // background — these blocks are often used for emphasis / expected output.
  let contentLines: string[];
  if (PLAIN_CODE_LANGS.has(lang)) {
    contentLines = raw.split("\n").map((line) => instance.applyDefaultStyle?.(line) ?? line);
  } else if (instance.theme.highlightCode) {
    contentLines = instance.theme.highlightCode(raw, token.lang);
  } else {
    contentLines = raw.split("\n").map((line) => instance.theme.codeBlock(line));
  }

  // No raw ``` fences, no box-drawing glyphs.
  // Fixed neutral gray background + black text keeps code panels distinct across themes.
  const renderCodeLine = (line: string): string => {
    const content = `${indent}${line}`;
    return paintCodeLine(textFn ? textFn(content) : content, w, bgFn);
  };
  lines.push(paintCodeLine("", w, bgFn));
  if (contentLines.length === 0) {
    lines.push(renderCodeLine(""));
  } else {
    for (const line of contentLines) lines.push(renderCodeLine(line));
  }
  lines.push(paintCodeLine("", w, bgFn));

  if (nextTokenType && nextTokenType !== "space") lines.push("");
  return lines;
}

/**
 * Build a level-aware style for headings.
 * Terminals cannot reliably change font size for individual spans, so all
 * heading levels use the theme heading palette; H1 is bold, numbered roots
 * are normal, and deeper numbered headings are italic.
 */
function createHeadingStyleFn(
  theme: BeautifyMarkdownTheme,
  sourceLevel: number,
  displayedLevel = sourceLevel,
): (text: string) => string {
  if (sourceLevel === 1) return (text) => theme.heading(theme.bold(text));
  if (displayedLevel === 1) return (text) => theme.heading(text);
  return (text) => theme.heading(theme.italic(text));
}

interface HeadingNumberState {
  sourceText: string | undefined;
  /** Counters for the displayed numbered levels. */
  counters: number[];
  /** Source Markdown heading depth that maps to displayed level 1. */
  baseLevel: number | undefined;
}

const MAX_HEADING_LEVEL = 6;
const headingNumberStates = new WeakMap<object, HeadingNumberState>();

function getHeadingNumberState(instance: MarkdownRuntime): HeadingNumberState {
  const sourceText = typeof instance.text === "string" ? instance.text : undefined;
  let state = headingNumberStates.get(instance);
  if (!state || state.sourceText !== sourceText) {
    state = {
      sourceText,
      counters: Array.from({ length: MAX_HEADING_LEVEL }, () => 0),
      baseLevel: undefined,
    };
    headingNumberStates.set(instance, state);
  }
  return state;
}

function resetHeadingNumberState(instance: MarkdownRuntime): void {
  headingNumberStates.delete(instance);
}

/**
 * Recognize a leading outline number that the model may have included in the
 * heading text. Keep this conservative so titles such as "2024. Results" are
 * not treated as manual section numbering.
 */
const MANUAL_HEADING_NUMBER_PREFIX_RE = /^(?:\[\d{1,3}(?:\.\d{1,3})*\]|\(\d{1,3}(?:\.\d{1,3})*\)|\d{1,3}(?:\.\d{1,3})+\.?|\d{1,2}[.)])[ \t]+/;

/**
 * Return one or more leading manual outline prefixes. Multiple prefixes are
 * accepted so a heading such as "[1.1] 1. Details" is still de-duplicated.
 */
function getManualHeadingNumberPrefix(text: string): string {
  let remainder = text;
  let prefix = "";

  for (let i = 0; i < 3; i++) {
    const match = MANUAL_HEADING_NUMBER_PREFIX_RE.exec(remainder);
    if (!match) break;
    prefix += match[0];
    remainder = remainder.slice(match[0].length);
  }

  return prefix;
}

/**
 * Remove a prefix from already-styled text while preserving ANSI styling for
 * the heading text that remains. This keeps manual-number stripping display-
 * only and avoids changing the parsed Markdown or session contents.
 */
function stripVisiblePrefix(text: string, prefix: string): string {
  if (!prefix) return text;

  let textIndex = 0;
  let prefixIndex = 0;
  let leadingAnsi = "";
  while (textIndex < text.length && prefixIndex < prefix.length) {
    const ansiMatch = /^\u001b\[[0-?]*[ -/]*[@-~]/.exec(text.slice(textIndex));
    if (ansiMatch) {
      // Preserve opening styles that occur before the removed prefix. Without
      // this, the remaining heading text falls back to the terminal default
      // color even though the generated label is styled correctly.
      leadingAnsi += ansiMatch[0];
      textIndex += ansiMatch[0].length;
      continue;
    }

    if (text[textIndex] !== prefix[prefixIndex]) return text;
    textIndex += 1;
    prefixIndex += 1;
  }

  return prefixIndex === prefix.length ? leadingAnsi + text.slice(textIndex) : text;
}

/**
 * H1 is an unnumbered document title. The first numbered source level (usually
 * H2) is displayed as level 1, so a response without H1 still starts at [1].
 * Incrementing a displayed level resets every deeper counter.
 */
function getDisplayedHeadingLevel(instance: MarkdownRuntime, level: number): number {
  const state = getHeadingNumberState(instance);

  // Promote the first heading level used in a response to displayed level 1.
  // H1 is reserved for an unnumbered title, so H2 becomes the root when it is
  // present; skipped levels are handled by the ancestor initialization below.
  if (state.baseLevel === undefined) state.baseLevel = Math.max(2, level);
  if (level >= 2 && level < state.baseLevel) {
    state.baseLevel = level;
    state.counters.fill(0);
  }

  return Math.max(1, level - state.baseLevel + 1);
}

function nextHeadingNumber(instance: MarkdownRuntime, level: number): string {
  const state = getHeadingNumberState(instance);
  const displayedLevel = getDisplayedHeadingLevel(instance, level);
  const levelIndex = Math.max(0, Math.min(MAX_HEADING_LEVEL - 1, displayedLevel - 1));

  // Gracefully number documents that skip a level: an unseen ancestor starts
  // at 1 rather than producing a 0 component.
  for (let i = 0; i < levelIndex; i++) {
    if (state.counters[i] === 0) state.counters[i] = 1;
  }

  state.counters[levelIndex] += 1;
  for (let i = levelIndex + 1; i < MAX_HEADING_LEVEL; i++) {
    state.counters[i] = 0;
  }

  return state.counters.slice(0, levelIndex + 1).join(".");
}

function resetNumberingAfterTitle(instance: MarkdownRuntime): void {
  const state = getHeadingNumberState(instance);
  state.baseLevel = 2;
  state.counters.fill(0);
}

/**
 * Render headings as styled text without raw markdown markers.
 * Upstream pi-tui already hides "#" / "##" for h1/h2, but still prints
 * "###"… markers for h3+. This normalizes every level to natural heading style
 * and adds a clear visual hierarchy across H1–H6.
 */
function renderHeadingTokenNatural(
  instance: MarkdownRuntime,
  token: MarkdownHeadingToken,
  _width: number,
  nextTokenType?: string,
): string[] {
  const headingLevel = Math.max(1, Math.min(6, Number(token.depth) || 1));
  const displayedHeadingLevel = headingLevel === 1 ? undefined : getDisplayedHeadingLevel(instance, headingLevel);
  const headingStyleFn = createHeadingStyleFn(instance.theme, headingLevel, displayedHeadingLevel);

  const headingStyleContext: InlineStyleContext = {
    applyText: headingStyleFn,
    stylePrefix: instance.getStylePrefix?.(headingStyleFn) ?? "",
  };

  const renderedHeadingText = instance.renderInlineTokens?.(token.tokens || [], headingStyleContext) ?? "";
  const manualNumberPrefix = typeof token.text === "string"
    ? getManualHeadingNumberPrefix(token.text)
    : "";
  const headingText = stripVisiblePrefix(renderedHeadingText, manualNumberPrefix);

  let lines: string[];
  if (headingLevel === 1) {
    // Treat H1 as the document title. It stays styled as a heading but has no
    // generated label; the following H2 becomes displayed level 1.
    resetNumberingAfterTitle(instance);
    lines = [headingText];
  } else {
    const number = nextHeadingNumber(instance, headingLevel);
    // Bold only the generated bracketed number; keep the following space and
    // subheading text at their existing weight.
    const label = `${instance.theme.heading(instance.theme.bold(`[${number}]`))} `;
    lines = [`${label}${headingText}`];
  }

  if (nextTokenType && nextTokenType !== "space") lines.push("");
  return lines;
}

function installMarkdownBeautifyPatch(): void {
  const proto = Markdown.prototype as unknown as PatchedMarkdownPrototype;
  const existing = proto[MARKDOWN_PATCH_STATE] as MarkdownPatchState | undefined;
  if (existing?.installed) {
    existing.renderCodeToken = renderCodeTokenWithoutFences;
    existing.renderHeadingToken = renderHeadingTokenNatural;
    existing.resetHeadingState = resetHeadingNumberState;

    // Add the render-cycle reset when upgrading from an older installed copy.
    if (typeof existing.originalRender !== "function" && typeof proto.render === "function") {
      existing.originalRender = proto.render;
      proto.render = function (this: MarkdownRuntime, width: number): string[] {
        const current = proto[MARKDOWN_PATCH_STATE] as MarkdownPatchState | undefined;
        current?.resetHeadingState?.(this);
        return (current?.originalRender ?? existing.originalRender!).call(this, width);
      };
    }
    return;
  }

  const original = proto.renderToken;
  const originalRender = proto.render;
  if (typeof original !== "function" || typeof originalRender !== "function") return;

  const state: MarkdownPatchState = {
    installed: true,
    original,
    originalRender,
    resetHeadingState: resetHeadingNumberState,
    renderCodeToken: renderCodeTokenWithoutFences,
    renderHeadingToken: renderHeadingTokenNatural,
  };
  proto[MARKDOWN_PATCH_STATE] = state;

  proto.render = function (this: MarkdownRuntime, width: number): string[] {
    const current = proto[MARKDOWN_PATCH_STATE] as MarkdownPatchState | undefined;
    current?.resetHeadingState?.(this);
    return (current?.originalRender ?? originalRender).call(this, width);
  };

  proto.renderToken = function (this: MarkdownRuntime, token: unknown, width: number, nextTokenType?: string, styleContext?: unknown): string[] {
    const current = proto[MARKDOWN_PATCH_STATE] as MarkdownPatchState | undefined;
    if (current && isMarkdownHeadingToken(token)) return current.renderHeadingToken(this, token, width, nextTokenType);
    if (current && isMarkdownCodeToken(token)) return current.renderCodeToken(this, token, width, nextTokenType);
    return (current?.original ?? original).call(this, token, width, nextTokenType, styleContext);
  };
}

type UserMessageRender = (this: unknown, width: number) => string[];

interface UserMessagePatchState {
  installed: true;
  original: UserMessageRender;
}

type PatchedUserMessagePrototype = {
  render?: UserMessageRender;
  [key: symbol]: unknown;
};

/**
 * Strip OSC 133 shell-integration markers so we can re-wrap lines cleanly.
 * UserMessageComponent injects these around the first/last rendered lines.
 */
function stripOsc133(line: string): string {
  return line
    .replaceAll(OSC133_ZONE_START, "")
    .replaceAll(OSC133_ZONE_END, "")
    .replaceAll(OSC133_ZONE_FINAL, "");
}

/**
 * Paint a light-blue left bar on every user-message line.
 * Mirrors the accent stripe in modern chat UIs (screenshot style).
 *
 * Caller should render the original component at `width - barWidth` so layout
 * already accounts for the column we prepend — no right-edge clipping.
 */
function withUserMessageBar(lines: string[]): string[] {
  if (lines.length === 0) return lines;

  // Resolve bar color from the live global theme on every paint — never from a
  // captured extension ctx (those go stale after /new, /reload, session switch).
  const bar = paintUserMessageBar(USER_MESSAGE_BAR);

  const painted = lines.map((raw) => {
    // Strip OSC markers first; re-wrap after prepending the bar.
    const body = stripOsc133(raw);
    return `${bar}${body}`;
  });

  // Re-apply OSC 133 markers so shell integration / terminal zones stay intact.
  painted[0] = OSC133_ZONE_START + painted[0];
  painted[painted.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + painted[painted.length - 1];
  return painted;
}

function installUserMessageBarPatch(): void {
  const proto = UserMessageComponent.prototype as unknown as PatchedUserMessagePrototype;
  const existing = proto[USER_MESSAGE_PATCH_STATE] as UserMessagePatchState | undefined;
  if (existing?.installed) return;

  const original = proto.render;
  if (typeof original !== "function") return;

  const state: UserMessagePatchState = {
    installed: true,
    original,
  };
  proto[USER_MESSAGE_PATCH_STATE] = state;

  proto.render = function (this: unknown, width: number): string[] {
    const current = proto[USER_MESSAGE_PATCH_STATE] as UserMessagePatchState | undefined;
    const barWidth = visibleWidth(USER_MESSAGE_BAR);
    // Lay out content one column narrower so the bar never overflows.
    const contentWidth = Math.max(1, width - barWidth);
    const lines = (current?.original ?? original).call(this, contentWidth);
    return withUserMessageBar(lines);
  };
}

/**
 * Remove only this extension's legacy bar wrapper during /reload.
 *
 * Another extension may have replaced the renderer since this package loaded;
 * never restore our stale `original` over that newer renderer.
 */
function uninstallUserMessageBarPatch(): void {
  const proto = UserMessageComponent.prototype as unknown as PatchedUserMessagePrototype;
  const existing = proto[USER_MESSAGE_PATCH_STATE] as UserMessagePatchState | undefined;
  if (!existing?.installed) return;

  const current = proto.render;
  const isLegacyBarWrapper =
    typeof current === "function" &&
    Function.prototype.toString.call(current).includes("withUserMessageBar");
  if (isLegacyBarWrapper) proto.render = existing.original;

  delete proto[USER_MESSAGE_PATCH_STATE];
}

function imageChip(id: number): string {
  return `[image${id}]`;
}

function displayChip(token: string, theme: Theme): string {
  return theme.fg("toolDiffAdded", theme.inverse(token));
}

function readClipboardFilePaths(): string[] {
  if (process.platform !== "darwin") return [];

  const result = spawnSync("osascript", ["-l", "JavaScript", "-e", MACOS_CLIPBOARD_FILE_PATHS_SCRIPT], {
    encoding: "utf8",
    timeout: 700,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) return [];

  try {
    const parsed: unknown = JSON.parse(result.stdout.trim() || "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter((path): path is string => {
      if (typeof path !== "string" || path.length === 0 || seen.has(path)) return false;
      seen.add(path);
      return true;
    });
  } catch {
    return [];
  }
}

function pasteClipboardFilePaths(editor: EditorComponent, imageTokens: ImageTokenController, tui: TUI): boolean {
  const paths = readClipboardFilePaths();
  if (paths.length === 0) return false;

  const text = imageTokens.formatClipboardFilePaths(paths, editor.getText());
  if (!text) return false;

  if (editor.insertTextAtCursor) {
    editor.insertTextAtCursor(text);
  } else {
    editor.setText(editor.getText() + text);
    editor.onChange?.(editor.getText());
  }
  tui.requestRender();
  return true;
}

interface EditorInternals {
  state: { lines: string[]; cursorLine: number; cursorCol: number };
  historyIndex: number;
  lastAction: string | null;
  pushUndoSnapshot: () => void;
  setCursorCol: (col: number) => void;
}

class ImageTokenController {
  constructor(private readonly attachments: Map<string, Attachment>) {}

  renderChips(lines: string[], theme: Theme, width: number): string[] {
    let rendered = lines;
    for (const attachment of this.attachments.values()) {
      rendered = rendered.map((line) => line.replaceAll(attachment.token, displayChip(attachment.token, theme)));
    }
    return rendered.map((line) => truncateToWidth(line, width, ""));
  }

  replaceClipboardPathsInText(text: string, existingText = ""): string {
    const usedIds = this.collectUsedIds(`${existingText}\n${text}`);
    return text.replace(CLIPBOARD_PATH_RE, (path) => this.createImageToken(path, usedIds));
  }

  formatClipboardFilePaths(paths: string[], existingText = ""): string {
    const usedIds = this.collectUsedIds(existingText);
    const pieces = paths.map((path) => (IMAGE_FILE_RE.test(path) ? this.createImageToken(path, usedIds) : path));
    return pieces.join(paths.length > 1 ? "\n" : "");
  }

  replaceClipboardPathsInEditor(editor: EditorComponent, tui: TUI): void {
    const current = editor.getText();
    const usedIds = this.collectUsedIds(current);
    let changed = false;
    const next = current.replace(CLIPBOARD_PATH_RE, (path) => {
      changed = true;
      return this.createImageToken(path, usedIds);
    });
    if (!changed) return;
    editor.setText(next);
    tui.requestRender();
  }

  deleteImageTokenAtCursor(editor: EditorComponent, data: string, tui: TUI): boolean {
    const keybindings = getKeybindings();
    const backward = keybindings.matches(data, "tui.editor.deleteCharBackward") || matchesKey(data, "shift+backspace");
    const forward = keybindings.matches(data, "tui.editor.deleteCharForward") || matchesKey(data, "shift+delete");
    if (!backward && !forward) return false;

    const writableEditor = editor as unknown as Partial<EditorInternals>;
    if (!writableEditor.state || !writableEditor.pushUndoSnapshot || !writableEditor.setCursorCol) return false;

    const line = writableEditor.state.lines[writableEditor.state.cursorLine] || "";
    const range = this.findImageTokenDeleteRange(line, writableEditor.state.cursorCol, backward);
    if (!range) return false;

    writableEditor.historyIndex = -1;
    writableEditor.lastAction = null;
    writableEditor.pushUndoSnapshot();
    writableEditor.state.lines[writableEditor.state.cursorLine] = line.slice(0, range.start) + line.slice(range.end);
    writableEditor.setCursorCol(range.start);
    this.attachments.delete(range.token);
    editor.onChange?.(editor.getText());
    tui.requestRender();
    return true;
  }

  private findImageTokenDeleteRange(line: string, cursorCol: number, backward: boolean): { start: number; end: number; token: string } | undefined {
    for (const match of line.matchAll(TOKEN_LINE_RE)) {
      const token = match[0];
      const start = match.index;
      let end = start + token.length;
      if (backward) {
        if (start < cursorCol && cursorCol <= end) return { start, end, token };
        if (cursorCol === end + 1 && line[end] === " ") return { start, end: end + 1, token };
      } else if (start <= cursorCol && cursorCol < end) {
        if (line[end] === " ") end += 1;
        return { start, end, token };
      }
    }
    return undefined;
  }

  private collectUsedIds(text: string): Set<number> {
    const usedIds = new Set<number>();
    for (const match of text.matchAll(TOKEN_RE)) usedIds.add(Number(match[1]));
    return usedIds;
  }

  private createImageToken(path: string, usedIds: Set<number>): string {
    let id = 1;
    while (usedIds.has(id)) id++;
    usedIds.add(id);
    const token = imageChip(id);
    this.attachments.set(token, { token, path });
    return token;
  }
}

class BeautifyEditor extends CustomEditor {
  private scanTimers: Array<ReturnType<typeof setTimeout>> = [];

  constructor(
    tui: TUI,
    theme: EditorTheme,
    private readonly appKeybindings: KeybindingsManager,
    private readonly imageTokens: ImageTokenController,
    private readonly getTheme: () => Theme,
  ) {
    super(tui, theme, appKeybindings);
  }

  handleInput(data: string): void {
    const isImagePaste = this.appKeybindings.matches(data, "app.clipboard.pasteImage");
    if (isImagePaste) {
      if (this.onExtensionShortcut?.(data)) return;
      if (pasteClipboardFilePaths(this, this.imageTokens, this.tui)) return;
      this.onPasteImage?.();
      this.scheduleClipboardPathScan();
      return;
    }
    if (this.imageTokens.deleteImageTokenAtCursor(this, data, this.tui)) return;
    super.handleInput(data);
  }

  insertTextAtCursor(text: string): void {
    super.insertTextAtCursor(this.imageTokens.replaceClipboardPathsInText(text, this.getText()));
  }

  render(width: number): string[] {
    return this.imageTokens.renderChips(super.render(width), this.getTheme(), width);
  }

  private scheduleClipboardPathScan(): void {
    for (const timer of this.scanTimers) clearTimeout(timer);
    this.scanTimers = [80, 250, 600].map((delay) =>
      setTimeout(() => {
        this.imageTokens.replaceClipboardPathsInEditor(this, this.tui);
      }, delay),
    );
  }
}

class BeautifyEditorWrapper implements EditorComponent {
  actionHandlers = new Map<AppKeybinding, () => void>();
  private scanTimers: Array<ReturnType<typeof setTimeout>> = [];
  private _onSubmit: ((text: string) => void) | undefined;
  private _onChange: ((text: string) => void) | undefined;
  onEscape: (() => void) | undefined;
  onCtrlD: (() => void) | undefined;
  onPasteImage: (() => void) | undefined;
  onExtensionShortcut: ((data: string) => boolean) | undefined;

  constructor(
    private readonly inner: EditorComponent,
    private readonly tui: TUI,
    private readonly appKeybindings: KeybindingsManager,
    private readonly imageTokens: ImageTokenController,
    private readonly getTheme: () => Theme,
  ) {}

  get focused(): boolean {
    return Boolean((this.inner as EditorComponent & { focused?: boolean }).focused);
  }

  set focused(value: boolean) {
    (this.inner as EditorComponent & { focused?: boolean }).focused = value;
  }

  get borderColor(): ((str: string) => string) | undefined {
    return this.inner.borderColor;
  }

  set borderColor(value: ((str: string) => string) | undefined) {
    this.inner.borderColor = value;
  }

  get onSubmit(): ((text: string) => void) | undefined {
    return this._onSubmit;
  }

  set onSubmit(handler: ((text: string) => void) | undefined) {
    this._onSubmit = handler;
    this.inner.onSubmit = handler;
  }

  get onChange(): ((text: string) => void) | undefined {
    return this._onChange;
  }

  set onChange(handler: ((text: string) => void) | undefined) {
    this._onChange = handler;
    this.inner.onChange = handler;
  }

  getText(): string {
    return this.inner.getText();
  }

  setText(text: string): void {
    this.inner.setText(text);
  }

  getExpandedText(): string {
    return this.inner.getExpandedText?.() ?? this.inner.getText();
  }

  addToHistory(text: string): void {
    this.inner.addToHistory?.(text);
  }

  insertTextAtCursor(text: string): void {
    const next = this.imageTokens.replaceClipboardPathsInText(text, this.inner.getText());
    if (this.inner.insertTextAtCursor) {
      this.inner.insertTextAtCursor(next);
      return;
    }
    this.inner.setText(this.inner.getText() + next);
    this.inner.onChange?.(this.inner.getText());
  }

  setAutocompleteProvider(provider: AutocompleteProvider): void {
    this.inner.setAutocompleteProvider?.(provider);
  }

  setPaddingX(padding: number): void {
    this.inner.setPaddingX?.(padding);
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    this.inner.setAutocompleteMaxVisible?.(maxVisible);
  }

  onAction(action: AppKeybinding, handler: () => void): void {
    this.actionHandlers.set(action, handler);
  }

  invalidate(): void {
    this.inner.invalidate?.();
  }

  render(width: number): string[] {
    return this.imageTokens.renderChips(this.inner.render(width), this.getTheme(), width);
  }

  handleInput(data: string): void {
    const isImagePaste = this.appKeybindings.matches(data, "app.clipboard.pasteImage");
    if (this.onExtensionShortcut?.(data)) return;
    if (this.imageTokens.deleteImageTokenAtCursor(this.inner, data, this.tui)) return;
    if (isImagePaste) {
      if (pasteClipboardFilePaths(this, this.imageTokens, this.tui)) return;
      this.onPasteImage?.();
      this.scheduleClipboardPathScan();
      return;
    }
    if (this.handleAppAction(data)) return;
    this.inner.handleInput(data);
  }

  private handleAppAction(data: string): boolean {
    if (this.appKeybindings.matches(data, "app.interrupt")) {
      if (!this.isShowingAutocomplete()) {
        const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
        if (handler) {
          handler();
          return true;
        }
      }
      return false;
    }

    if (this.appKeybindings.matches(data, "app.exit")) {
      if (this.getText().length === 0) {
        const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
        if (handler) {
          handler();
          return true;
        }
      }
    }

    for (const [action, handler] of this.actionHandlers) {
      if (action !== "app.interrupt" && action !== "app.exit" && this.appKeybindings.matches(data, action)) {
        handler();
        return true;
      }
    }

    return false;
  }

  private isShowingAutocomplete(): boolean {
    const inner = this.inner as EditorComponent & { isShowingAutocomplete?: () => boolean };
    return inner.isShowingAutocomplete?.() ?? false;
  }

  private scheduleClipboardPathScan(): void {
    for (const timer of this.scanTimers) clearTimeout(timer);
    this.scanTimers = [80, 250, 600].map((delay) =>
      setTimeout(() => {
        this.imageTokens.replaceClipboardPathsInEditor(this.inner, this.tui);
      }, delay),
    );
  }
}

function collectImageAttachments(text: string, attachments: Map<string, Attachment>): Attachment[] {
  const selected: Attachment[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = imageChip(Number(match[1]));
    if (seen.has(token)) continue;
    const attachment = attachments.get(token);
    if (!attachment) continue;
    seen.add(token);
    selected.push(attachment);
  }
  return selected;
}

export default function piAgentBeautify(pi: ExtensionAPI) {
  installMarkdownBeautifyPatch();
  // Keep the local customization effective across /reload as well as restarts.
  uninstallUserMessageBarPatch();
  registerCjkMarkdownTransformer(pi);

  const attachments = new Map<string, Attachment>();

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    // Use the fixed neutral code-panel palette across themes and alternate configs.
    const mdProto = Markdown.prototype as unknown as PatchedMarkdownPrototype;
    const mdState = mdProto[MARKDOWN_PATCH_STATE] as MarkdownPatchState | undefined;
    if (mdState) {
      mdState.codeBlockBg = paintCodeBlockBackground;
      mdState.codeBlockText = paintCodeBlockText;
    }
    attachments.clear();
    const previousEditorFactory = ctx.ui.getEditorComponent();
    const imageTokens = new ImageTokenController(attachments);
    // Capture the session theme as a fallback for editor rendering.
    const sessionTheme = ctx.ui.theme;
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      // getTheme reads the live global theme so chips stay valid after session replace.
      if (!previousEditorFactory) {
        return new BeautifyEditor(tui, theme, keybindings, imageTokens, () => getActiveTheme() ?? sessionTheme);
      }
      return new BeautifyEditorWrapper(previousEditorFactory(tui, theme, keybindings), tui, keybindings, imageTokens, () => getActiveTheme() ?? sessionTheme);
    });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    attachments.clear();
    // ctx may already be invalidated during session replace — never crash here.
    try {
      if (ctx.hasUI) ctx.ui.setStatus("pi-agent-beautify", undefined);
    } catch {
      // ignore stale ctx
    }
  });

  pi.on("input", async (event) => {
    const selected = collectImageAttachments(event.text, attachments);
    if (selected.length === 0) return { action: "continue" };

    const text = event.text.replace(TOKEN_RE, (full, id) => attachments.get(imageChip(Number(id)))?.path ?? full);
    for (const attachment of selected) attachments.delete(attachment.token);

    return {
      action: "transform",
      text,
      images: event.images,
    };
  });
}
