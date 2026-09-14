// zotero-handles.ts — append a compact retrieval-handle footer to Zotero semantic
// search results so evidence_ids survive the agent's own output trimming.
//
// Covers zotero_semantic_search calls made through the MCP proxies
// (mcp__zotero, mcp__turbovault, mcp). Calls made *inside* mcpScript never
// surface as individual tool_result events and are not covered.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROXY_TOOLS = new Set(["mcp__zotero", "mcp__turbovault", "mcp"]);
const TARGET = "zotero_semantic_search";

interface Hit {
  item: string;
  chunk: string;
  evidence: string;
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") parts.push(block);
    else if (block && typeof block === "object" && typeof (block as any).text === "string") {
      parts.push((block as any).text);
    }
  }
  return parts.join("\n");
}

function parseHits(text: string): Hit[] {
  const chunks = [...text.matchAll(/\*\*Chunk ID:\*\*\s*([A-Z0-9]+#\d+)/g)].map(m => m[1]);
  const evidences = [...text.matchAll(/\*\*Evidence ID:\*\*\s*(\S+)/g)].map(m => m[1]);
  if (chunks.length === 0 || chunks.length !== evidences.length) return [];
  return chunks.map((chunk, i) => ({
    item: chunk.split("#")[0],
    chunk,
    evidence: evidences[i],
  }));
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async event => {
    if (event.isError) return;
    if (!PROXY_TOOLS.has(event.toolName)) return;

    const input = event.input as { tool?: string } | undefined;
    if (input?.tool !== TARGET) return;

    const text = extractText(event.content);
    if (!text.includes("Evidence ID:")) return;

    const hits = parseHits(text);
    if (hits.length === 0) return;

    const lines = hits.map(h => `- ${h.item} | ${h.chunk} | ${h.evidence}`);
    lines.push(
      "",
      "Expand any hit with zotero_read_passage(evidence_id=...). Never re-search to see the same passage; if a handle is lost from notes, recover it with one scoped exact-item search."
    );

    const footer = {
      type: "text" as const,
      text: "\n### Retrieval handles\n" + lines.join("\n"),
    };

    const base = Array.isArray(event.content) ? event.content : [];
    return { content: [...base, footer] };
  });
}
