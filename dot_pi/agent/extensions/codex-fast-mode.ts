import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CODEX_PROVIDER = "openai-codex";
const FAST_MODEL_ID = "gpt-5.6-luna-fast";
const FAST_UPSTREAM_MODEL_ID = "gpt-5.6-luna";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Codex aliases in models.json (fast mode and -max context variants)
 * need to be mapped to their upstream OpenAI model IDs before sending the payload.
 */
export default function codexFastMode(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event, ctx) => {
    const model = ctx.model;
    if (
      model?.provider !== CODEX_PROVIDER
      || model.api !== "openai-codex-responses"
      || !isRecord(event.payload)
    ) {
      return;
    }

    if (model.id === FAST_MODEL_ID) {
      return {
        ...event.payload,
        model: FAST_UPSTREAM_MODEL_ID,
        service_tier: "priority",
      };
    }

    if (model.id.endsWith("-max")) {
      return {
        ...event.payload,
        model: model.id.replace(/-max$/, ""),
      };
    }
  });
}
