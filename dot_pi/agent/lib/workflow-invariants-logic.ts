import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

export const VAULT_ROOT = path.join(os.homedir(), "Dropbox", "Sam-Obsidian-Vault");
export const VAULT_OBSIDIAN_DIR = path.join(VAULT_ROOT, ".obsidian");
export const DOTFILES_ROOT = path.join(os.homedir(), "dotfiles");

/**
 * Checks whether a path targets an Obsidian vault note rather than internal
 * configuration (.obsidian/ containing CSS snippets, plugins, or themes).
 */
export function isVaultNotePath(targetPath: string, vaultRoot = VAULT_ROOT): boolean {
  if (!targetPath) return false;
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(vaultRoot)) return false;

  // Exception: files inside .obsidian/ (e.g. .obsidian/snippets/*.css, plugins)
  const obsidianConfigDir = path.join(vaultRoot, ".obsidian");
  if (resolved === obsidianConfigDir || resolved.startsWith(obsidianConfigDir + path.sep)) {
    return false;
  }

  return true;
}

/**
 * Checks whether a path targets static source files inside ~/dotfiles directly,
 * which should be edited via the live path followed by `chezmoi add`.
 * Template files (*.tmpl) are exempt and must be edited directly.
 */
export function isDotfilesStaticPath(targetPath: string, dotfilesRoot = DOTFILES_ROOT): boolean {
  if (!targetPath) return false;
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(dotfilesRoot)) return false;

  // Exception: .tmpl files must be edited directly in the dotfiles repository
  if (resolved.endsWith(".tmpl")) return false;

  return true;
}

/**
 * Checks whether a path targets sensitive credentials that should not be exposed.
 */
export function isSecretFilePath(targetPath: string): boolean {
  if (!targetPath) return false;
  const resolved = path.resolve(targetPath);
  return (
    /\/\.ssh\/id_[^\/]+$/.test(resolved) ||
    /\/\.gnupg\//.test(resolved) ||
    /\/\.aws\/credentials$/.test(resolved) ||
    /\/\.config\/op\//.test(resolved)
  );
}

export type CommandCheckResult = {
  blocked: boolean;
  reason?: string;
};

/**
 * Checks whether a shell command attempts host-level package management,
 * unauthorized sudo, or session-clobbering chezmoi apply.
 */
export function checkPrivilegedOrHostMutation(command: string): CommandCheckResult {
  if (!command) return { blocked: false };

  if (/\bchezmoi\s+apply\b/.test(command)) {
    return {
      blocked: true,
      reason: "Running 'chezmoi apply' inside an agent session is prohibited. Ask Samuel to run it if needed.",
    };
  }

  if (/\bsudo\b/.test(command)) {
    return {
      blocked: true,
      reason: "Privileged 'sudo' commands are prohibited. Write multi-step commands to ~/sudo_temp.sh or ask Samuel to run them.",
    };
  }

  if (/\b(rpm-ostree|dnf|flatpak\s+install)\b/.test(command)) {
    return {
      blocked: true,
      reason: "Native package installations are prohibited on the immutable host.",
    };
  }

  return { blocked: false };
}

/**
 * Checks whether a shell command executes unrecoverable/destructive operations
 * on Git repositories or filesystems.
 */
export function checkDestructiveCommand(command: string): CommandCheckResult {
  if (!command) return { blocked: false };

  // 1. Destructive Git checks
  if (/git\s+reset\s+--hard\b/.test(command)) {
    return {
      blocked: true,
      reason: "Destructive Git reset ('git reset --hard') will discard uncommitted changes.",
    };
  }

  if (/git\s+clean\s+-[a-zA-Z]*f[a-zA-Z]*/.test(command)) {
    return {
      blocked: true,
      reason: "Destructive Git clean ('git clean -f') will permanently delete untracked files.",
    };
  }

  if (/git\s+(checkout|restore)\s+(?:--\s+)?\.(?:\s|$)/.test(command)) {
    return {
      blocked: true,
      reason: "Destructive Git checkout/restore on '.' will discard all unstaged working tree changes.",
    };
  }

  if (/git\s+push\s+.*(?:--force\b|-f\b)/.test(command)) {
    return {
      blocked: true,
      reason: "Force-pushing ('git push --force') can overwrite remote Git repository history.",
    };
  }

  if (/git\s+branch\s+-[a-zA-Z]*D[a-zA-Z]*/.test(command)) {
    return {
      blocked: true,
      reason: "Force-deleting a branch ('git branch -D') can permanently destroy unmerged work.",
    };
  }

  // 2. Destructive Filesystem checks
  if (
    /rm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+([\/\~]|(?:\.\.?[\/\\])|(?:\*))(?:\s|$)/.test(command) ||
    /rm\s+-[a-zA-Z]*f[a-zA-Z]*r?\s+([\/\~]|(?:\.\.?[\/\\])|(?:\*))(?:\s|$)/.test(command)
  ) {
    return {
      blocked: true,
      reason: "Recursive root, home, or wildcard deletion ('rm -rf') is prohibited.",
    };
  }

  if (/\bmkfs(?:\.[a-z0-9]+)?\b/.test(command)) {
    return {
      blocked: true,
      reason: "Disk formatting command ('mkfs') is prohibited.",
    };
  }

  if (/\bdd\s+if=/.test(command)) {
    return {
      blocked: true,
      reason: "Raw block device writing ('dd') is prohibited.",
    };
  }

  return { blocked: false };
}

/**
 * Checks whether a shell command attempts direct operations on vault notes
 * (while allowing operations targeting .obsidian/ config/snippets/plugins).
 */
export function checkVaultShellAccess(command: string, vaultRoot = VAULT_ROOT): boolean {
  if (!command) return false;
  if (!command.includes("Dropbox/Sam-Obsidian-Vault") && !command.includes(vaultRoot)) {
    return false;
  }

  // If command specifically and only targets .obsidian/, allow it
  const hasVaultRef = command.includes("Dropbox/Sam-Obsidian-Vault") || command.includes(vaultRoot);
  const hasObsidianConfigRef =
    command.includes("Dropbox/Sam-Obsidian-Vault/.obsidian") ||
    command.includes(path.join(vaultRoot, ".obsidian"));

  // If it references the vault but not .obsidian, it's accessing notes
  if (hasVaultRef && !hasObsidianConfigRef) {
    return true;
  }

  return false;
}

/**
 * Determines if a file path is managed by Chezmoi.
 * Uses `chezmoi source-path <file>` synchronously; returns true if exit 0.
 */
export function isChezmoiManaged(filePath: string): boolean {
  if (!filePath) return false;
  try {
    execFileSync("chezmoi", ["source-path", filePath], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
