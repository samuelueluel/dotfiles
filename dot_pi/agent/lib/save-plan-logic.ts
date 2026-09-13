export const SAVED_PLANS_DIRECTORY = "02_Memories/Saved-Plans";

export interface PlanSessionEntry {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

export interface PlanWriteRequest {
  path: string;
  content: string;
  mode: "overwrite";
  commit_message: string;
}

export interface PreparedPlanSave {
  title: string;
  path: string;
  content: string;
  commitMessage: string;
  writeRequest: PlanWriteRequest;
}

const MARKDOWN_HEADING_PATTERN = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm;
const MAX_FILENAME_PREFIX_LENGTH = 72;

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((part): part is { type?: unknown; text?: unknown } => Boolean(part) && typeof part === "object")
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

export function extractAssistantText(entry: PlanSessionEntry): string {
  if (entry.type !== "message" || entry.message?.role !== "assistant") return "";
  return textFromContent(entry.message.content).trim();
}

/** Find the newest non-empty assistant response in the active branch. */
export function findLatestAssistantResponse(entries: readonly PlanSessionEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;

    const text = extractAssistantText(entry);
    if (text) return text;
  }
  return undefined;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatLocalTimestamp(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatFileTimestamp(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function cleanTitle(value: string): string {
  return value
    .replace(/[`*_~]/g, "")
    .replace(/\[[^\]]*\]\(([^)]+)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function headingTitle(markdown: string): string | undefined {
  MARKDOWN_HEADING_PATTERN.lastIndex = 0;
  for (const match of markdown.matchAll(MARKDOWN_HEADING_PATTERN)) {
    const candidate = cleanTitle(match[1] ?? "");
    if (candidate && !/^plan\s*:?[ \t]*$/i.test(candidate)) return candidate;
  }
  return undefined;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1).trim();
    }
  }
  return value;
}

/** Convert a user/title string into a safe Title-Case-With-Hyphens filename prefix. */
export function slugifyPlanTitle(value: string): string {
  const words = unquote(cleanTitle(value))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "Saved-Plan";

  const title = words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("-");
  return title.slice(0, MAX_FILENAME_PREFIX_LENGTH).replace(/-+$/g, "") || "Saved-Plan";
}

function stripExistingFrontmatter(markdown: string): string {
  // Keep the saved note's metadata single-layered if a model happened to emit
  // YAML frontmatter as part of the plan itself.
  return markdown.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "").trim();
}

export function buildPlanNote(planMarkdown: string, title: string, createdAt: Date, sessionId?: string): string {
  const description = `Saved Markdown plan from the Pi session: ${title}.`;
  const metadata = [
    "---",
    `created: ${formatLocalTimestamp(createdAt)}`,
    `description: ${JSON.stringify(description)}`,
    "tags:",
    "  - plan",
  ];
  if (sessionId?.trim()) metadata.push(`source_session: ${JSON.stringify(sessionId.trim())}`);
  metadata.push("---", "");

  const body = stripExistingFrontmatter(planMarkdown);
  return `${metadata.join("\n")}\n${body}\n`;
}

export function preparePlanSave(options: {
  args?: string;
  entries: readonly PlanSessionEntry[];
  sessionName?: string;
  sessionId?: string;
  now?: Date;
}): PreparedPlanSave | undefined {
  const plan = findLatestAssistantResponse(options.entries);
  if (!plan) return undefined;

  const now = options.now ?? new Date();
  const requestedTitle = options.args?.trim() || options.sessionName?.trim() || headingTitle(plan) || "Saved Plan";
  const title = cleanTitle(unquote(requestedTitle)) || "Saved Plan";
  const prefix = slugifyPlanTitle(title);
  const sessionSuffix = options.sessionId?.trim().replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
  const uniqueSuffix = sessionSuffix ? `${formatFileTimestamp(now)}-${sessionSuffix}` : formatFileTimestamp(now);
  const path = `${SAVED_PLANS_DIRECTORY}/${prefix}-${uniqueSuffix}.md`;
  const content = buildPlanNote(plan, title, now, options.sessionId);
  const commitMessage = `Save plan memory: ${prefix}`;

  return {
    title,
    path,
    content,
    commitMessage,
    writeRequest: {
      path,
      content,
      mode: "overwrite",
      commit_message: commitMessage,
    },
  };
}
