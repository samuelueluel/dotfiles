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
// rejects redirects, command substitution, shell lists, executable paths,
// leading environment assignments, and known write-like options; this set alone
// is not a permission policy.
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
  "man",
  "info",
  "apropos",
  "whatis",
  "echo",
  "true",
  "false",
]);

// These references identify private credential locations when they appear in
// shell path syntax. Detection is deliberately conservative: quoted path
// forms are normalized, and relative paths are included because Bash runs from
// a mutable working directory. This is a boundary check, not a shell parser.
const SECRET_SHELL_PATH = new RegExp(
  `(?:^|[\\s=])(?:~[^\\s/]*|\\$HOME|\\$\\{HOME\\}|\\.{1,2}|/(?:home|var/home)/[^\\s/]+|/root)/(?:\\.ssh(?:/|$|[*?])|\\.gnupg(?:/|$|[*?])|\\.aws/credentials(?:/|$|[*?])|\\.config/op(?:/|$|[*?]))`,
);

export function isSensitiveShellCommand(command: string): boolean {
  if (!command) return false;
  const normalized = command.replace(/["']/g, "").replaceAll("\\", "/");
  return SECRET_SHELL_PATH.test(normalized);
}

type NullRedirection = {
  nextIndex: number;
  current: string;
};

/**
 * Consume only stdout/stderr redirection to the literal /dev/null. Returning
 * null means the `>` token is not an approved null redirection and must fail
 * closed. The command text itself is not rewritten for execution; `current`
 * is only the classification view used to find the command name.
 */
function consumeNullRedirection(
  command: string,
  index: number,
  current: string,
): NullRedirection | null {
  const fdMatch = current.match(/(?:^|\s)(\d+)$/);
  if (fdMatch && fdMatch[1] !== "1" && fdMatch[1] !== "2") return null;

  const operatorEnd = command[index + 1] === ">" ? index + 2 : index + 1;
  let targetStart = operatorEnd;
  while (targetStart < command.length && /\s/.test(command[targetStart]!)) targetStart += 1;
  if (!command.startsWith("/dev/null", targetStart)) return null;

  const nextIndex = targetStart + "/dev/null".length;
  const boundary = command[nextIndex];
  if (boundary !== undefined && boundary !== "|" && !/\s/.test(boundary)) return null;

  return {
    nextIndex,
    current: fdMatch ? current.slice(0, -fdMatch[1].length) : current,
  };
}

function splitReadOnlyCommandList(command: string): string[] | null {
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
      if (char === ">") {
        const redirection = consumeNullRedirection(command, i, current);
        if (!redirection) return null;
        current = redirection.current;
        i = redirection.nextIndex - 1;
        continue;
      }

      // Logical lists are safe only because each resulting simple command is
      // checked against the same allowlist below. Keep `;` and background `&`
      // rejected: they add sequencing/concurrency without a need here.
      if ((char === "&" && next === "&") || (char === "|" && next === "|")) {
        if (!current.trim()) return null;
        parts.push(current.trim());
        current = "";
        i += 1;
        continue;
      }
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
  const first = words[0];
  if (!first) return null;

  // Do not treat a prefixed assignment as harmless setup. PATH, loader
  // variables, and command-specific configuration can change what executes.
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) return null;

  // A basename allowlist must not turn ./cat or /tmp/cat into the trusted
  // `cat` command. The shell's executable resolution is outside this parser's
  // proof boundary, so explicit paths fail closed.
  if (first.includes("/")) return null;

  return first;
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
  if (
    commandName === "sort" &&
    /(?:^|\s)(?:-o\S*|--output(?:=\S*)?)(?:\s|$)/.test(part)
  ) {
    return true;
  }
  if (
    commandName === "sort" &&
    /(?:^|\s)--compress-program(?:=\S*)?(?:\s|$)/.test(part)
  ) {
    return true;
  }
  if (commandName === "date" && part.split(/\s+/).some(hasDateSetOption)) {
    return true;
  }
  return false;
}

export function isSafeBashCommand(command: string, headless = false): boolean {
  if (isSensitiveShellCommand(command)) return false;

  const parts = splitReadOnlyCommandList(command);
  if (!parts) return false;

  for (const part of parts) {
    const commandName = getCommandName(part);
    if (!commandName || !SAFE_BASH_COMMANDS.has(commandName)) return false;
    if (headless && HEADLESS_INTERACTIVE_COMMANDS.has(commandName)) return false;
    if (hasUnsafeReadOnlyOption(commandName, part)) return false;
  }

  return true;
}
