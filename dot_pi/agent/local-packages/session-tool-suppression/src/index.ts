import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DISABLED_SESSION_GUIDANCE =
  "\n\nWhen the user references @session:<uuid>, treat it as a session token. If you call session_ask, pass only the UUID value, not the @session: prefix.";

/**
 * pi-sessions' handoff feature adds session_ask guidance even when both
 * transcript tools are disabled. Remove that stale prompt text while keeping
 * the user-facing handoff/picker UI enabled.
 */
export default function sessionToolSuppression(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event) => {
    if (!event.systemPrompt.includes("session_ask")) {
      return;
    }

    const systemPrompt = event.systemPrompt.replaceAll(DISABLED_SESSION_GUIDANCE, "");
    if (systemPrompt === event.systemPrompt) {
      return;
    }

    return { systemPrompt };
  });
}
