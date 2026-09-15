export const SAVED_PLANS_DIRECTORY = "02_Memories/Saved-Plans";
export const PLAN_FORMAT_VERSION = 1;
export const PLAN_SOFT_MAX_EXECUTION_UNITS = 8;
export const PLAN_HARD_MAX_EXECUTION_UNITS = 12;
export const PLAN_SOFT_MAX_SUBSTEPS = 8;
export const LINTED_PLAN_ENTRY_TYPE = "save-plan:linted";
export const LINTED_PLAN_RESET_ENTRY_TYPE = "save-plan:lint-reset";
export const SAVED_PLAN_ENTRY_TYPE = "save-plan:saved";
export const PLAN_INTAKE_COMPLETE_ENTRY_TYPE = "save-plan:intake-complete";

export interface PlanSessionEntry {
  type?: string;
  id?: string;
  customType?: string;
  data?: unknown;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

export interface LintedPlanRecord {
  format: typeof PLAN_FORMAT_VERSION;
  title: string;
  markdown: string;
  lintedAt: string;
  sourceSession?: string;
  /** The user-supplied selector for the plan edition or conversation scope. */
  qualification?: string;
  warnings?: string[];
}

export interface PlanExecutionUnit {
  id: string;
  subject: string;
  action: string;
  inputs?: string;
  outputs?: string;
  verify: string;
  dependsOn: string[];
  substeps?: string;
}

export interface StructuredPlan {
  format: typeof PLAN_FORMAT_VERSION;
  title: string;
  objective: string;
  scopeAndConstraints: string;
  decisions: string;
  units: PlanExecutionUnit[];
  stopConditions: string;
  completionCriteria: string;
  openQuestions: string;
  issues: string[];
  warnings: string[];
  ok: boolean;
}

export interface ParsedSavedPlan extends StructuredPlan {
  path: string;
  content: string;
  body: string;
  metadata: Record<string, unknown>;
  updatedAt?: string;
  createdAt?: string;
  status?: string;
}

export interface PlanCandidate {
  path: string;
  title: string;
  updatedAt?: string;
  modifiedAt: number;
  status?: string;
  valid?: boolean;
}

export interface PlanNoteSource {
  sessionId?: string;
  model?: string;
  effort?: string;
  /** The /lint-plan qualification used to select the source material. */
  qualification?: string;
  createdAt?: Date | string;
}

export interface PreparedPlanSave {
  title: string;
  fileName: string;
  path: string;
  content: string;
  markdown: string;
  commitMessage: string;
  warnings: string[];
}

const MARKDOWN_HEADING_PATTERN = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm;
const MAX_FILENAME_PREFIX_LENGTH = 72;
const PLAN_SECTION_ORDER = [
  "Objective",
  "Scope and constraints",
  "Decisions",
  "Execution units",
  "Stop conditions",
  "Completion criteria",
  "Open questions",
] as const;
const UNIT_FIELD_NAMES = ["Action", "Inputs", "Outputs", "Verify", "Depends on", "Substeps"] as const;
type UnitFieldName = (typeof UNIT_FIELD_NAMES)[number];

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

/** Find the newest non-empty assistant response on the active branch. */
export function findLatestAssistantResponse(entries: readonly PlanSessionEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;

    const text = extractAssistantText(entry);
    if (text) return text;
  }
  return undefined;
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
    const raw = cleanTitle(match[1] ?? "");
    if (!raw) continue;
    const planHeading = raw.match(/^plan\s*:\s*(.+)$/i);
    const candidate = cleanTitle(planHeading?.[1] ?? raw);
    if (candidate && !/^plan\s*:?$/i.test(candidate)) return candidate;
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

/** Convert a user/title string into a safe Title-Case-With-Hyphens filename. */
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

export function planFileName(title: string): string {
  return `${slugifyPlanTitle(title)}.md`;
}

export function planRelativePath(title: string): string {
  return `${SAVED_PLANS_DIRECTORY}/${planFileName(title)}`;
}

function formatLocalTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-")
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatSourceTimestamp(value: Date | string | undefined, fallback: Date): string {
  if (value instanceof Date) return formatLocalTimestamp(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return formatLocalTimestamp(fallback);
}

function stripExistingFrontmatter(markdown: string): string {
  return markdown.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "").trim();
}

export function buildPlanNote(
  planMarkdown: string,
  title: string,
  updatedAt: Date,
  source: PlanNoteSource = {},
): string {
  const description = `Canonical Pi plan: ${title}.`;
  const metadata = [
    "---",
    `created: ${formatSourceTimestamp(source.createdAt, updatedAt)}`,
    `updated: ${formatLocalTimestamp(updatedAt)}`,
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    `plan_format: ${PLAN_FORMAT_VERSION}`,
    "status: canonical",
    "tags:",
    "  - plan",
    "  - pi",
  ];
  if (source.sessionId?.trim()) metadata.push(`source_session: ${JSON.stringify(source.sessionId.trim())}`);
  if (source.model?.trim()) metadata.push(`source_model: ${JSON.stringify(source.model.trim())}`);
  if (source.effort?.trim()) metadata.push(`source_effort: ${JSON.stringify(source.effort.trim())}`);
  if (source.qualification?.trim()) metadata.push(`lint_qualification: ${JSON.stringify(source.qualification.trim())}`);
  metadata.push("---", "");

  const body = stripExistingFrontmatter(planMarkdown);
  return `${metadata.join("\n")}\n${body}\n`;
}

function sectionPlaceholder(text: string): boolean {
  return /^(none|n\/a|nil|no(?:ne)?(?:\.)?|no open questions(?:\.)?)$/i.test(text.trim());
}

function sectionText(lines: string[]): string {
  return lines.join("\n").trim();
}

function parseUnitBlock(
  id: string,
  subject: string,
  lines: string[],
  issues: string[],
): PlanExecutionUnit {
  const values = new Map<UnitFieldName, string[]>();
  let activeField: UnitFieldName | undefined;

  for (const line of lines) {
    const fieldMatch = line.match(/^\s*-\s+\*\*(Action|Inputs|Outputs|Verify|Depends on|Substeps):\*\*\s*(.*)$/);
    if (fieldMatch) {
      const field = fieldMatch[1] as UnitFieldName;
      if (values.has(field)) {
        issues.push(`${id} repeats the ${field} field.`);
      }
      values.set(field, [fieldMatch[2] ?? ""]);
      activeField = field;
      continue;
    }

    if (/^\s*-\s+\*\*[^*]+:\*\*\s*/.test(line)) {
      issues.push(`${id} contains an unrecognized field.`);
      activeField = undefined;
      continue;
    }

    if (line.trim() && !activeField) {
      issues.push(`${id} has content outside its prescribed fields.`);
      continue;
    }
    if (activeField) values.get(activeField)?.push(line);
  }

  const value = (field: UnitFieldName): string => (values.get(field) ?? []).join("\n").trim();
  const action = value("Action");
  const verify = value("Verify");
  const dependencyText = value("Depends on");

  if (!action) issues.push(`${id} is missing a non-empty Action field.`);
  if (!verify) issues.push(`${id} is missing a non-empty Verify field.`);
  if (!dependencyText) issues.push(`${id} is missing a Depends on field.`);

  const dependsOn = sectionPlaceholder(dependencyText)
    ? []
    : dependencyText.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);

  return {
    id,
    subject: subject.trim(),
    action,
    inputs: value("Inputs") || undefined,
    outputs: value("Outputs") || undefined,
    verify,
    dependsOn,
    substeps: value("Substeps") || undefined,
  };
}

function numberedSubstepCount(value: string | undefined): number {
  if (!value) return 0;
  return value.split("\n").filter((line) => /^\s*\d+[.)]\s+/.test(line)).length;
}

/** Validate and parse the strict plan document emitted by /lint-plan. */
export function validateStructuredPlan(markdown: string): StructuredPlan {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const issues: string[] = [];
  const warnings: string[] = [];
  const emptyPlan: StructuredPlan = {
    format: PLAN_FORMAT_VERSION,
    title: "",
    objective: "",
    scopeAndConstraints: "",
    decisions: "",
    units: [],
    stopConditions: "",
    completionCriteria: "",
    openQuestions: "",
    issues,
    warnings,
    ok: false,
  };

  if (!normalized) {
    issues.push("The response is empty.");
    return emptyPlan;
  }

  const lines = normalized.split("\n");
  const titleMatch = lines[0]?.match(/^#\s+Plan:\s*(.+?)\s*$/);
  if (!titleMatch?.[1]?.trim()) {
    issues.push("The document must begin with '# Plan: <title>'.");
  }
  const title = cleanTitle(titleMatch?.[1] ?? "");
  const sections = new Map<string, string[]>();
  let currentSection: string | undefined;
  let lastSectionIndex = -1;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const sectionMatch = line.match(/^##\s+(.+?)\s*$/);
    if (sectionMatch) {
      const section = sectionMatch[1]?.trim() ?? "";
      const sectionIndex = PLAN_SECTION_ORDER.indexOf(section as (typeof PLAN_SECTION_ORDER)[number]);
      if (sectionIndex < 0) {
        issues.push(`Unrecognized section '## ${section}'.`);
        currentSection = undefined;
        continue;
      }
      if (sections.has(section)) {
        issues.push(`Section '## ${section}' appears more than once.`);
      }
      if (sectionIndex < lastSectionIndex) {
        issues.push(`Section '## ${section}' is out of order.`);
      }
      lastSectionIndex = Math.max(lastSectionIndex, sectionIndex);
      currentSection = section;
      sections.set(section, []);
      continue;
    }

    if (/^#\s+/.test(line) || (/^#{3,6}\s+/.test(line) && currentSection !== "Execution units")) {
      issues.push("The document contains a heading outside the prescribed structure.");
      continue;
    }

    if (!currentSection) {
      if (line.trim()) issues.push("The document contains commentary outside the prescribed sections.");
      continue;
    }
    sections.get(currentSection)?.push(line);
  }

  for (const required of PLAN_SECTION_ORDER) {
    if (!sections.has(required)) issues.push(`Missing required section '## ${required}'.`);
  }

  const units: PlanExecutionUnit[] = [];
  const executionLines = sections.get("Execution units") ?? [];
  const starts: Array<{ id: string; subject: string; index: number }> = [];
  const unitHeadingPattern = /^###\s+(U\d+)\s+(?:—|-)\s+(.+?)\s*$/;

  for (let index = 0; index < executionLines.length; index += 1) {
    const line = executionLines[index] ?? "";
    const unitMatch = line.match(unitHeadingPattern);
    if (unitMatch) {
      starts.push({ id: unitMatch[1]!, subject: cleanTitle(unitMatch[2] ?? ""), index });
      continue;
    }
    if (line.trim() && !starts.length) issues.push("Execution units contains content before the first unit.");
    if (line.trim() && /^#{3,6}\s+/.test(line)) issues.push("Execution units contains an invalid nested heading.");
  }

  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!;
    const end = starts[index + 1]?.index ?? executionLines.length;
    const expectedId = `U${index + 1}`;
    if (start.id !== expectedId) issues.push(`Execution units must use consecutive ids; expected ${expectedId}, found ${start.id}.`);
    if (!start.subject) issues.push(`${start.id} is missing a subject.`);
    units.push(parseUnitBlock(start.id, start.subject, executionLines.slice(start.index + 1, end), issues));
  }

  if (units.length === 0) issues.push("Execution units must contain at least one ### U1 — <subject> unit.");
  if (units.length > PLAN_HARD_MAX_EXECUTION_UNITS) {
    issues.push(`The plan contains ${units.length} execution units; the hard limit is ${PLAN_HARD_MAX_EXECUTION_UNITS}. Compact or split the plan into phases.`);
  } else if (units.length > PLAN_SOFT_MAX_EXECUTION_UNITS) {
    warnings.push(`The plan contains ${units.length} execution units; the recommended maximum is ${PLAN_SOFT_MAX_EXECUTION_UNITS}.`);
  }

  const knownIds = new Set(units.map((unit) => unit.id));
  for (const [index, unit] of units.entries()) {
    const priorIds = new Set(units.slice(0, index).map((candidate) => candidate.id));
    for (const dependency of unit.dependsOn) {
      if (!knownIds.has(dependency)) issues.push(`${unit.id} depends on unknown unit ${dependency}.`);
      else if (dependency === unit.id) issues.push(`${unit.id} cannot depend on itself.`);
      else if (!priorIds.has(dependency)) issues.push(`${unit.id} must depend only on an earlier unit; ${dependency} is not earlier.`);
    }
    const substeps = numberedSubstepCount(unit.substeps);
    if (substeps > PLAN_SOFT_MAX_SUBSTEPS) {
      warnings.push(`${unit.id} contains ${substeps} substeps; consider splitting or grouping the work more deliberately.`);
    }
  }

  const textFor = (section: string): string => sectionText(sections.get(section) ?? []);
  const objective = textFor("Objective");
  const scopeAndConstraints = textFor("Scope and constraints");
  const decisions = textFor("Decisions");
  const stopConditions = textFor("Stop conditions");
  const completionCriteria = textFor("Completion criteria");
  const openQuestions = textFor("Open questions");

  for (const [name, text] of [
    ["Objective", objective],
    ["Scope and constraints", scopeAndConstraints],
    ["Decisions", decisions],
    ["Stop conditions", stopConditions],
    ["Completion criteria", completionCriteria],
    ["Open questions", openQuestions],
  ] as const) {
    if (!text) issues.push(`Section '## ${name}' must not be empty; write 'None' when it does not apply.`);
  }

  return {
    format: PLAN_FORMAT_VERSION,
    title,
    objective,
    scopeAndConstraints,
    decisions,
    units,
    stopConditions,
    completionCriteria,
    openQuestions,
    issues,
    warnings,
    ok: issues.length === 0,
  };
}

function lintQualificationInstructions(qualification = ""): string[] {
  const selected = qualification.trim();
  if (!selected) {
    return [
      "- No description was supplied. Use the latest coherent version of the plan in this conversation.",
      "- Use earlier turns only for decisions that still belong to that version.",
      "- Do not combine it with abandoned alternatives or later revisions.",
    ];
  }

  return [
    `- Description: ${JSON.stringify(selected)}`,
    "- Use this description to find the plan version or portion to lint; it is not the title and does not ask you to execute anything.",
    "- Include only decisions and work belonging to that target. Leave out abandoned alternatives and later revisions unless the description includes them.",
    "- If it names a subsection, include only that subsection and the prerequisites it needs; do not broaden the plan to unrelated work.",
    "- If more than one version fits, do not blend them. Record the ambiguity under Open questions and use the least-assumptive interpretation.",
  ];
}

export function buildLintPlanPrompt(qualification = ""): string {
  return [
    "This is an explicit /lint-plan command. Treat /lint-plan as the verb 'lint'; the words after it describe what to lint.",
    "Read the full active planning branch to identify that material.",
    "Source selection:",
    ...lintQualificationInstructions(qualification),
    "",
    "Output:",
    "Produce one canonical structured plan from the requested material; do not invent unresolved decisions.",
    "Choose a concise descriptive title for the requested plan or portion and use it after '# Plan:'. Do not leave the title empty.",
    "Do not execute tools that change files, configuration, data, or external state.",
    "Your entire response must be exactly one structured plan document following the sections and rules below: no preamble, no postscript, no commentary, no YAML frontmatter, and no markdown fence around the document.",
    "Your entire response must be exactly one structured plan document following the sections and rules below: no preamble, no postscript, no commentary, no YAML frontmatter, and no markdown fence around the document.",
    "Use exactly these sections, in this order:",
    "# Plan: <title>",
    "## Objective",
    "## Scope and constraints",
    "## Decisions",
    "## Execution units",
    "## Stop conditions",
    "## Completion criteria",
    "## Open questions",
    "Under Execution units, use consecutive headings '### U1 — <imperative subject>', one bounded execution unit per heading.",
    "Each unit must contain these bullets: '- **Action:**', '- **Verify:**', and '- **Depends on:** None or earlier unit ids such as U1, U2'.",
    "Inputs, Outputs, and Substeps are optional bullets. Do not make each command or minor check a separate execution unit; put mechanical details under Substeps.",
    `Target ${PLAN_SOFT_MAX_EXECUTION_UNITS} or fewer execution units; never produce more than ${PLAN_HARD_MAX_EXECUTION_UNITS}. Group actions sharing one deliverable and verification criterion, but split independent decisions or stop points.`,
    "Every execution unit must be bounded enough to complete and verify as one meaningful checkpoint.",
    "For statistical work, put observable checks in Verify: sample counts, key uniqueness, merge rates, assertions, test results, output files, or equivalent Python checks.",
    "Write 'None' in empty sections. Put unresolved decisions only under Open questions.",
  ].join("\n");
}

export function buildLintCorrectionPrompt(
  issues: readonly string[],
  warnings: readonly string[] = [],
  qualification = "",
): string {
  const problems = [...issues.map((issue) => `- ${issue}`), ...warnings.map((warning) => `- Warning: ${warning}`)].join("\n");
  return [
    "Your previous /lint-plan response did not satisfy the required structured plan format.",
    "Revise it now using the same planning context and the same source selection.",
    "Source selection:",
    ...lintQualificationInstructions(qualification),
    "Output exactly one corrected structured plan document, with no preamble, postscript, or commentary outside the prescribed structure.",
    "Choose or retain a concise non-empty title for the requested plan or portion after '# Plan:'.",
    "Do not execute any state-changing operation.",
    "Problems detected:",
    problems || "- The response was not captured correctly.",
  ].join("\n");
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function parsePlanFrontmatter(content: string): {
  metadata: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
} {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { metadata: {}, body: content.trim(), hasFrontmatter: false };

  const metadata: Record<string, unknown> = {};
  let activeListKey: string | undefined;
  for (const line of match[1]!.split(/\r?\n/)) {
    const listStart = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*$/);
    if (listStart) {
      activeListKey = listStart[1];
      metadata[activeListKey] = [];
      continue;
    }
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (field) {
      activeListKey = undefined;
      metadata[field[1]!] = parseScalar(field[2] ?? "");
      continue;
    }
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && activeListKey) {
      const current = metadata[activeListKey];
      if (Array.isArray(current)) current.push(parseScalar(listItem[1] ?? ""));
      continue;
    }
  }

  return {
    metadata,
    body: content.slice(match[0].length).trim(),
    hasFrontmatter: true,
  };
}

export function parseSavedPlanDocument(content: string, path: string): ParsedSavedPlan {
  const frontmatter = parsePlanFrontmatter(content);
  const parsed = validateStructuredPlan(frontmatter.body);
  const issues = [...parsed.issues];
  const warnings = [...parsed.warnings];
  const format = frontmatter.metadata.plan_format;
  if (!frontmatter.hasFrontmatter) issues.unshift("The saved note has no frontmatter.");
  if (format !== PLAN_FORMAT_VERSION) issues.unshift(`The saved note must declare plan_format: ${PLAN_FORMAT_VERSION}.`);
  if (frontmatter.metadata.status !== "canonical") issues.unshift("The saved note is not marked status: canonical.");

  const metadataTitle = typeof frontmatter.metadata.title === "string" ? frontmatter.metadata.title : undefined;
  const title = metadataTitle?.trim() || parsed.title;
  if (metadataTitle && parsed.title && cleanTitle(metadataTitle) !== cleanTitle(parsed.title)) {
    issues.push("The frontmatter title does not match the document title.");
  }

  return {
    ...parsed,
    title,
    path,
    content,
    body: frontmatter.body,
    metadata: frontmatter.metadata,
    updatedAt: typeof frontmatter.metadata.updated === "string" ? frontmatter.metadata.updated : undefined,
    createdAt: typeof frontmatter.metadata.created === "string" ? frontmatter.metadata.created : undefined,
    status: typeof frontmatter.metadata.status === "string" ? frontmatter.metadata.status : undefined,
    issues,
    warnings,
    ok: issues.length === 0,
  };
}

function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 700 - t.length;

  let queryIndex = 0;
  let score = 0;
  let previousMatch = -2;
  for (let textIndex = 0; textIndex < t.length && queryIndex < q.length; textIndex += 1) {
    if (t[textIndex] !== q[queryIndex]) continue;
    score += previousMatch === textIndex - 1 ? 8 : 1;
    const previous = t[textIndex - 1];
    if (textIndex === 0 || previous === " " || previous === "-" || previous === "/" || previous === ":") score += 4;
    previousMatch = textIndex;
    queryIndex += 1;
  }
  return queryIndex === q.length ? score : null;
}

export function rankPlanCandidates(candidates: readonly PlanCandidate[], query = ""): PlanCandidate[] {
  if (!query.trim()) return [...candidates];
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: fuzzyScore(query, `${candidate.title} ${candidate.path}`),
    }))
    .filter((item): item is { candidate: PlanCandidate; index: number; score: number } => item.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.candidate);
}

export function findLatestLintedPlan(entries: readonly PlanSessionEntry[]): LintedPlanRecord | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom") continue;
    if (entry.customType === LINTED_PLAN_RESET_ENTRY_TYPE) return undefined;
    if (entry.customType !== LINTED_PLAN_ENTRY_TYPE) continue;
    const data = entry.data;
    if (!data || typeof data !== "object") continue;
    const record = data as Partial<LintedPlanRecord>;
    if (record.format !== PLAN_FORMAT_VERSION || typeof record.title !== "string" || typeof record.markdown !== "string") continue;
    return {
      format: PLAN_FORMAT_VERSION,
      title: record.title,
      markdown: record.markdown,
      lintedAt: typeof record.lintedAt === "string" ? record.lintedAt : entry.timestamp ?? "",
      sourceSession: typeof record.sourceSession === "string" ? record.sourceSession : undefined,
      qualification: typeof record.qualification === "string" && record.qualification.trim() ? record.qualification : undefined,
      warnings: Array.isArray(record.warnings) ? record.warnings.filter((item): item is string => typeof item === "string") : undefined,
    };
  }
  return undefined;
}

export function preparePlanSave(options: {
  markdown?: string;
  title?: string;
  /** Backward-compatible alias for callers that still pass raw command args. */
  args?: string;
  entries?: readonly PlanSessionEntry[];
  sessionName?: string;
  sessionId?: string;
  sourceModel?: string;
  sourceEffort?: string;
  qualification?: string;
  createdAt?: Date | string;
  now?: Date;
}): PreparedPlanSave | undefined {
  const plan = options.markdown?.trim() || (options.entries ? findLatestAssistantResponse(options.entries) : undefined);
  if (!plan) return undefined;

  const now = options.now ?? new Date();
  const requestedTitle = options.title?.trim() || options.args?.trim() || options.sessionName?.trim() || headingTitle(plan) || "Saved Plan";
  const title = cleanTitle(unquote(requestedTitle)) || "Saved Plan";
  const prefix = slugifyPlanTitle(title);
  const fileName = `${prefix}.md`;
  const path = `${SAVED_PLANS_DIRECTORY}/${fileName}`;
  const warnings = validateStructuredPlan(plan).warnings;
  const content = buildPlanNote(plan, title, now, {
    sessionId: options.sessionId,
    model: options.sourceModel,
    effort: options.sourceEffort,
    qualification: options.qualification,
    createdAt: options.createdAt,
  });
  const commitMessage = `Save plan memory: ${prefix}`;

  return {
    title,
    fileName,
    path,
    content,
    markdown: plan,
    commitMessage,
    warnings,
  };
}

/**
 * The saved plan note is the authoritative copy; this prompt only carries the
 * pointer and the intake protocol. The intake guard in plan-workflow-state.ts
 * verifies loaded units against the extension's own parse of the note, so the
 * note read and todo metadata — not this message — carry the correctness.
 */
export function buildLoadPlanPrompt(plan: ParsedSavedPlan): string {
  return [
    `Load the saved plan ${plan.path} ("${plan.title}").`,
    "",
    "Read the note with turbovault_read_note. If the note cannot be read, say so and stop.",
    "",
    "Then set up the todo list:",
    "- Call todo list first. Reuse any existing task that already has this plan_source and the same plan_step_id instead of creating a duplicate.",
    `- Create one pending item per execution unit in the note's "## Execution units" section, keeping each unit's subject. Use the heading id (U1, U2, …) as plan_step_id and ${plan.path} as plan_source in the task metadata.`,
    "- Create in note order, then set blockedBy from each unit's \"Depends on\" line, using the numeric task ids of the items those ids refer to.",
    "",
    "Don't start any of the work — this turn only creates the todo list. The note is the authoritative plan: re-read it after compaction, or whenever you need a unit's full details.",
    "",
    "While working, keep the note authoritative. If the work shows the plan as written needs correction, re-read the note with turbovault_read_note immediately before editing, then update it to match (TurboVault edit_note with a commit message saying why), sync the todo list, and append new unit ids rather than renumbering. If a correction would change the Objective, Decisions, or Stop conditions, stop and ask first.",
  ].join("\n");
}
