import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type SubagentProfile = "local" | "cloud";

const CLOUD_EXPLORE_MODEL = "openai-codex/gpt-5.6-luna";

/**
 * Select the subagent policy explicitly when a launcher sets
 * PI_SUBAGENT_PROFILE. Otherwise infer it from the parent model: the local
 * provider (or a loopback endpoint) is local; everything else is cloud.
 */
function getProfile(ctx: any): SubagentProfile | undefined {
  const configured = process.env.PI_SUBAGENT_PROFILE?.trim().toLowerCase();
  if (configured === "local" || configured === "cloud") return configured;

  const model = ctx?.model;
  if (!model) return undefined;

  const provider = String(model.provider ?? "").toLowerCase();
  const baseUrl = String(model.baseUrl ?? "").toLowerCase();
  const loopback = /^(https?:\/\/)?(localhost|127\.0\.0\.1|::1)(:\d+)?(?:\/|$)/.test(baseUrl);
  return provider === "local" || loopback ? "local" : "cloud";
}

/**
 * Apply the local/cloud policy to Explore spawns only.
 *
 * This deliberately does not touch tools, MCP, or max_turns. max_turns remains
 * a parameter selected by the parent model (when supplied). Local Explore is
 * pinned to the parent's exact model; cloud Explore is pinned to Codex Luna.
 * The cloud policy defaults thinking to medium while allowing an explicit
 * per-invocation thinking request. PI_SUBAGENT_CLOUD_MODEL is intentionally
 * ignored.
 */
export default function subagentProfile(pi: ExtensionAPI) {
  pi.on("tool_call", async (event: any, ctx: any) => {
    if (event.toolName !== "Agent") return;

    const input = event.input as Record<string, unknown> | undefined;
    if (!input || typeof input !== "object") return;

    const type = typeof input.subagent_type === "string"
      ? input.subagent_type.trim().toLowerCase()
      : "";
    if (type !== "explore" || input.resume) return;

    const profile = getProfile(ctx);
    if (!profile) return;

    if (profile === "local") {
      // Preserve the existing local Explore policy and guarantee that an
      // accidental model argument cannot move it away from the parent model.
      delete input.model;
      if (typeof input.thinking !== "string" || input.thinking.trim() === "") {
        input.thinking = "xhigh";
      }
      return;
    }

    // Cloud: never honor the orchestrator's model argument (or a model env
    // override). Explore is always pinned to the ChatGPT Plus Codex model.
    input.model = CLOUD_EXPLORE_MODEL;
    if (typeof input.thinking !== "string" || input.thinking.trim() === "") {
      input.thinking = process.env.PI_SUBAGENT_CLOUD_THINKING?.trim() || "medium";
    }
  });
}
