const HEADLESS_INTERACTIVE_COMMANDS = new Set([
  "bc",
  "less",
  "more",
  "zless",
  "man",
  "info",
  "apropos",
  "whatis",
]);

// Read-only command names carried over from modes.ts. The parser below still
// rejects redirects, command substitution, shell lists, and known write-like
// options; this set alone is not a permission policy.
const SAFE_BASH_COMMANDS = new Set([
  "rg",
  "fd",
  "grep",
  "ag",
  "pt",
  "ripgrep",
  "ls",
  "tree",
  "stat",
  "file",
  "find",
  "du",
  "df",
  "pwd",
  "which",
  "type",
  "column",
  "fmt",
  "expand",
  "unexpand",
  "fold",
  "paste",
  "pr",
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "zcat",
  "zless",
  "nl",
  "tac",
  "rev",
  "jq",
  "sort",
  "uniq",
  "wc",
  "cut",
  "tr",
  "diff",
  "comm",
  "join",
  "lsof",
  "ss",
  "netstat",
  "lspci",
  "lsusb",
  "lscpu",
  "dmidecode",
  "lsblk",
  "env",
  "printenv",
  "whoami",
  "id",
  "uptime",
  "free",
  "ps",
  "cal",
  "date",
  "sha1sum",
  "cksum",
  "bc",
  "md5sum",
  "sha256sum",
  "base64",
  "xxd",
  "hexdump",
  "od",
  "strings",
  "nm",
  "objdump",
  "readelf",
  "time",
  "man",
  "info",
  "apropos",
  "whatis",
  "echo",
  "true",
  "false",
]);

function splitReadOnlyPipeline(command: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    const next = command[i + 1];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\" && !inSingleQuote) {
      current += char;
      escapeNext = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    // Command substitution executes even inside double quotes. It is only
    // literal inside single quotes (or when the dollar/backtick is escaped).
    if (!inSingleQuote && (char === "`" || (char === "$" && next === "("))) {
      return null;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === "|" && next !== "|") {
        if (!current.trim()) return null;
        parts.push(current.trim());
        current = "";
        continue;
      }
      if (
        char === "|" ||
        char === ";" ||
        char === "&" ||
        char === "<" ||
        char === ">" ||
        char === "\n" ||
        char === "\r"
      ) {
        return null;
      }
    }

    current += char;
  }

  if (inSingleQuote || inDoubleQuote || !current.trim()) return null;
  parts.push(current.trim());
  return parts;
}

function getCommandName(part: string): string | null {
  const words = part.split(/\s+/).filter(Boolean);
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]!)) {
    index += 1;
  }
  if (index >= words.length) return null;
  return words[index]!.replace(/^.*\//, "");
}

function hasDateSetOption(word: string): boolean {
  if (/^--set(?:=|$)/.test(word)) return true;
  if (!/^-[^-]/.test(word)) return false;

  const shortOptions = word.slice(1);
  for (let index = 0; index < shortOptions.length; index += 1) {
    const option = shortOptions[index];
    if (option === "s") return true;
    // These options consume the remainder of a short-option token as an
    // argument, so an `s` in values such as `-Iseconds` is not `-s`.
    if (option === "d" || option === "f" || option === "r" || option === "I") return false;
  }
  return false;
}

function hasUnsafeReadOnlyOption(commandName: string, part: string): boolean {
  if (
    commandName === "find" &&
    /(?:^|\s)-(?:exec(?:dir)?|delete|ok(?:dir)?|fls|fprint(?:0|f)?|fprintf)(?:\s|$)/.test(part)
  ) {
    return true;
  }
  if (commandName === "fd" && /(?:^|\s)--exec(?:-batch)?(?:[=\s]|$)/.test(part)) {
    return true;
  }
  if (commandName === "rg" && /(?:^|\s)--pre(?:[=\s]|$)/.test(part)) {
    return true;
  }
  if (commandName === "sort" && /(?:^|\s)-o(?:[=\s]|$)/.test(part)) {
    return true;
  }
  if (commandName === "date" && part.split(/\s+/).some(hasDateSetOption)) {
    return true;
  }
  return false;
}

export function isSafeBashCommand(command: string, headless = false): boolean {
  const parts = splitReadOnlyPipeline(command);
  if (!parts) return false;

  for (const part of parts) {
    const commandName = getCommandName(part);
    if (!commandName || !SAFE_BASH_COMMANDS.has(commandName)) return false;
    if (headless && HEADLESS_INTERACTIVE_COMMANDS.has(commandName)) return false;
    if (headless && (commandName === "env" || commandName === "time")) return false;
    if (hasUnsafeReadOnlyOption(commandName, part)) return false;
  }

  return true;
}
