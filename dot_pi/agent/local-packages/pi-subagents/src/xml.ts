/**
 * xml.ts — escaping for the `<task-notification>` payloads.
 *
 * Kept separate so notification formatting can reuse the escaping helper without
 * coupling the UI and agent-management modules.
 */

/** Escape XML special characters to prevent injection in structured notifications. */
export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
