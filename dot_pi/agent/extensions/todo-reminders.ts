import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DRIFT_TOOL_THRESHOLD = Number(process.env.PI_TODO_DRIFT_THRESHOLD) || 15;

export default function todoRemindersExtension(pi: ExtensionAPI): void {
  let toolCountSinceLastTodo = 0;
  let hasCreatedTodos = false;

  pi.on("session_start", () => {
    toolCountSinceLastTodo = 0;
    hasCreatedTodos = false;
  });

  pi.on("tool_call", (event: any) => {
    if (event.toolName === "todo") {
      toolCountSinceLastTodo = 0;
      hasCreatedTodos = true;
    } else {
      toolCountSinceLastTodo++;
    }
  });

  // Transient context injection: fires at turn start ONLY if >= DRIFT_TOOL_THRESHOLD tools have run without todo interaction
  pi.on("context", async (event: any) => {
    if (!event?.messages || event.messages.length === 0) return;

    const tail = event.messages[event.messages.length - 1];
    // Only fire on turn start (when tail is a user message)
    if (tail?.role !== "user") return;

    if (hasCreatedTodos && toolCountSinceLastTodo >= DRIFT_TOOL_THRESHOLD) {
      const reminderText =
        `<system_reminder>\n` +
        `<reminder type="todo-guard">\n` +
        `[Todo Alignment Check] You have executed ${toolCountSinceLastTodo} tool actions since last interacting with \`todo\`. ` +
        `Verify that your current actions directly advance your active task in \`todo\` and that you are not caught in an unnecessary rabbit hole. ` +
        `Continue with your current step, or update your \`todo\` plan if the scope has changed.\n` +
        `</reminder>\n` +
        `</system_reminder>`;

      const reminderMessage = {
        role: "custom",
        customType: "pi-system-reminders",
        content: [{ type: "text", text: reminderText }],
        display: false,
        timestamp: Date.now(),
      };

      const messages = [...event.messages];
      messages.splice(messages.length - 1, 0, reminderMessage);
      return { messages };
    }
  });
}
