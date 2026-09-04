import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CODEX_PROVIDER = "openai-codex";
const FAST_MODEL_ID = "gpt-5.6-luna-fast";
const UPSTREAM_MODEL_ID = "gpt-5.6-luna";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The Fast entry is a selectable alias in models.json. Pi's Codex stream
 * supports serviceTier internally, but models.json cannot set that option, so
 * rewrite only this alias after Pi has built the provider payload.
 */
export default function codexFastMode(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event, ctx) => {
    const model = ctx.model;
    if (
      model?.provider !== CODEX_PROVIDER
      || model.id !== FAST_MODEL_ID
      || model.api !== "openai-codex-responses"
      || !isRecord(event.payload)
    ) {
      return;
    }

    return {
      ...event.payload,
      model: UPSTREAM_MODEL_ID,
      service_tier: "priority",
    };
  });
}
