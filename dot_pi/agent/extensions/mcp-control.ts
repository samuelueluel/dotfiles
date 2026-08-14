import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function mcpControlExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "mcp_disconnect",
    label: "Disconnect MCP Server",
    description: "Disconnects an active MCP server (e.g. 'stata', 'zotero', 'turbovault', or any future MCP server) to stop its background process and purge its tool definitions from context to save tokens.",
    promptSnippet: "Disconnect an active MCP server when finished to reclaim context tokens.",
    promptGuidelines: [
      "Use mcp_disconnect when finished with an MCP server task to reduce context token usage."
    ],
    parameters: Type.Object({
      server: Type.String({
        description: "Name of the MCP server to disconnect (e.g. 'stata', 'zotero', 'turbovault', or any registered MCP server name)."
      })
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const serverName = params.server.trim().toLowerCase();
      
      try {
        // Execute the /mcp disconnect slash command via Pi context command runner if available
        if (typeof (ctx as any).executeCommand === "function") {
          await (ctx as any).executeCommand(`mcp disconnect ${serverName}`);
        } else if (typeof (ctx as any).ui?.executeCommand === "function") {
          await (ctx as any).ui.executeCommand(`mcp disconnect ${serverName}`);
        }

        ctx.ui?.notify(`MCP server '${serverName}' disconnect requested`, "success");

        return {
          content: [
            {
              type: "text",
              text: `Disconnect request sent for MCP server '${serverName}'. Its tool definitions will be purged from subsequent turns.`
            }
          ],
          details: { server: serverName, status: "disconnected" }
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Attempted to disconnect MCP server '${serverName}'. If tools remain in context, run '/mcp disconnect ${serverName}' directly.`
            }
          ],
          details: { server: serverName, error: err?.message || String(err) }
        };
      }
    }
  });
}
