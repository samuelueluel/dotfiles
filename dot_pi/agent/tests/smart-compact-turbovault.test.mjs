import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import test from "node:test";

const agentRoot = resolve(new URL("..", import.meta.url).pathname);
const bundledRuntime = readFileSync(
  resolve(agentRoot, "local-packages/pi-smart-compact/dist/index.js"),
  "utf8",
);

function loadFileTracking() {
  const semanticsStart = bundledRuntime.indexOf("// src/domain/tool-semantics.ts");
  const semanticsEnd = bundledRuntime.indexOf("// src/utils/helpers.ts", semanticsStart);
  const trackingStart = bundledRuntime.indexOf("function buildToolCallIndex(msgs)");
  const trackingEnd = bundledRuntime.indexOf("function isBenignSearchResult", trackingStart);
  assert.ok(semanticsStart >= 0 && semanticsEnd > semanticsStart, "tool semantics block exists");
  assert.ok(trackingStart >= 0 && trackingEnd > trackingStart, "file tracking block exists");

  const source = `
    function isRecord2(value) { return typeof value === "object" && value !== null; }
    function isToolCallBlock(value) {
      return isRecord2(value) && value.type === "toolCall" &&
        typeof value.name === "string" && isRecord2(value.arguments);
    }
    function flattenToolCallBlock(value) { return isToolCallBlock(value) ? [value] : []; }
    function nestedToolCallId(_wrapperId, _messageIndex, toolIndex, nestedId) {
      return typeof nestedId === "string" ? nestedId : String(toolIndex);
    }
    function extractFileRefs() { return []; }
    function extractText(content) {
      if (typeof content === "string") return content;
      if (!Array.isArray(content)) return "";
      return content.map((block) => typeof block?.text === "string" ? block.text : "").join("");
    }
    function isTruncated() { return false; }
    function hasCommandFailureSignal() { return false; }
    function extractShellFileOperations() { return { modified: [], deleted: [] }; }
    var NO_OP_RE = /applied:\\s*0|no changes applied|nothing to (?:do|change)|0 edits? applied/i;
    ${bundledRuntime.slice(semanticsStart, semanticsEnd)}
    ${bundledRuntime.slice(trackingStart, trackingEnd)}
    ({ trackFileOps, classifyToolOperation, extractToolPath });
  `;
  return vm.runInNewContext(source);
}

function toolExchange(toolName, id, arguments_, result) {
  return [
    {
      role: "assistant",
      content: [{ type: "toolCall", id, name: toolName, arguments: arguments_ }],
    },
    {
      role: "toolResult",
      toolCallId: id,
      content: [{ type: "text", text: result }],
    },
  ];
}

test("verified file tracking unwraps TurboVault read and edit proxy calls", () => {
  const { trackFileOps } = loadFileTracking();
  const messages = [
    ...toolExchange(
      "mcp__turbovault",
      "note-read",
      { tool: "turbovault_read_note", args: { path: "20_Library/Example.md" } },
      "Current note contents",
    ),
    ...toolExchange(
      "mcp",
      "note-edit",
      {
        server: "turbovault",
        tool: "turbovault_edit_note",
        args: JSON.stringify({ path: "20_Library/Other.md", edits: "SEARCH/REPLACE" }),
      },
      "Successfully edited note",
    ),
  ];

  const tracked = JSON.parse(JSON.stringify(trackFileOps(messages)));
  assert.deepEqual(tracked.read, ["20_Library/Example.md"]);
  assert.deepEqual(tracked.modified.map((file) => file.path), ["20_Library/Other.md"]);
});

test("TurboVault proxy handling does not unwrap a different MCP server", () => {
  const { trackFileOps } = loadFileTracking();
  const messages = toolExchange(
    "mcp__zotero",
    "wrong-server",
    { tool: "turbovault_read_note", args: { path: "20_Library/Example.md" } },
    "not a TurboVault read",
  );

  const tracked = JSON.parse(JSON.stringify(trackFileOps(messages)));
  assert.deepEqual(tracked.read, []);
  assert.deepEqual(tracked.modified, []);
});
