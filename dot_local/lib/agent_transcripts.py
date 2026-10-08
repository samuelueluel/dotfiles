#!/usr/bin/env python3
"""Read Pi and Claude Code transcripts through one Pi-shaped interface.

Pi transcripts are returned unchanged.  Claude Code transcripts
(``~/.claude/projects/<cwd-slug>/<session-uuid>.jsonl``) are converted into
Pi-shaped JSONL entries (``session``, ``model_change``, ``message``,
``compaction``, ``session_info``) so the existing session-log, piwork, and
Television parsers can read them without format-specific branches.

Conversions are cached under ``~/.cache/agent-transcripts/claude/`` and
rebuilt when the source file's size or mtime changes.  The source transcript is
never modified.

Filing model: a filed Claude Code transcript is moved into a workspace folder
and a symlink is left at its original path, so ``claude --resume`` keeps
appending to the moved file.  Pi transcripts are filed by a plain move.
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import IO, Any, Iterator

CLAUDE_PROJECTS_ROOT = os.path.expanduser("~/.claude/projects")
CACHE_DIR = os.path.expanduser("~/.cache/agent-transcripts/claude")
CONVERTER_VERSION = 3
# Pi's claude bridge drives Claude Code through the Agent SDK ("sdk-ts"), which
# leaves a duplicate transcript here; Pi's own transcript is the canonical copy.
EXCLUDED_ENTRYPOINTS = {"sdk-ts"}
# Summaries that open a continued conversation are not always flagged
# isCompactSummary (for example, Pi bridge sessions); recognise them by text.
_COMPACTION_PREFIXES = (
    "The conversation history before this point was compacted",
    "This session is being continued from a previous conversation",
)

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_COMMAND_NAME_RE = re.compile(r"<command-name>(.*?)</command-name>", re.S)
_COMMAND_ARGS_RE = re.compile(r"<command-args>(.*?)</command-args>", re.S)
# Claude Code wraps local-command output and injected reminders in tags that
# are not user-authored text.
_NON_USER_PREFIXES = (
    "<local-command-stdout>",
    "<local-command-stderr>",
    "<local-command-caveat>",
    "<system-reminder>",
    "<system_reminder>",
)
# Entry types that only exist in Claude Code transcripts (Pi uses "session",
# "message", "model_change", ...).
_CLAUDE_ONLY_TYPES = {
    "user", "assistant", "system", "attachment", "mode", "permission-mode",
    "queue-operation", "last-prompt", "file-history-snapshot", "ai-title",
    "custom-title", "summary", "cost-state", "atis-latch",
}


# --------------------------------------------------------------------------
# Format detection and discovery
# --------------------------------------------------------------------------

def is_claude_transcript(path: str) -> bool:
    """Sniff the first JSON line; Pi transcripts start with a "session" entry."""
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    return False
                if not isinstance(entry, dict):
                    return False
                if entry.get("type") == "session":
                    return False
                return "sessionId" in entry or entry.get("type") in _CLAUDE_ONLY_TYPES
    except OSError:
        return False
    return False


def claude_session_id(path: str) -> str:
    """Claude Code names transcripts after the session UUID."""
    stem = os.path.basename(path)
    if stem.endswith(".jsonl"):
        stem = stem[:-6]
    return stem if _UUID_RE.match(stem) else ""


def iter_claude_transcript_paths() -> Iterator[str]:
    """Top-level Claude Code session transcripts (not subagent sidechains).

    Symlinks left behind by filing are yielded too; callers that dedupe by
    realpath see the filed copy once.
    """
    root = Path(CLAUDE_PROJECTS_ROOT)
    if not root.is_dir():
        return
    for path in sorted(root.glob("*/*.jsonl")):
        if not claude_session_id(str(path)) or not os.path.isfile(path):
            continue
        try:
            entrypoints = set(_load_converted(str(path))[1].get("entrypoints", []))
        except OSError:
            continue
        if not entrypoints & EXCLUDED_ENTRYPOINTS:
            yield str(path)


def iter_unfiled_claude_transcripts() -> Iterator[str]:
    """Claude Code transcripts that still live in ~/.claude/projects."""
    for path in iter_claude_transcript_paths():
        if not os.path.islink(path) and os.path.isfile(path):
            yield path


def is_unfiled_claude_path(path: str) -> bool:
    real = os.path.realpath(path)
    root = os.path.realpath(CLAUDE_PROJECTS_ROOT)
    return real.startswith(root + os.sep)


# --------------------------------------------------------------------------
# Conversion
# --------------------------------------------------------------------------

def _dumps(entry: dict[str, Any]) -> str:
    # Compact separators matter: downstream scanners match substrings such as
    # '"role":"user"' and '"type":"session"'.
    return json.dumps(entry, ensure_ascii=False, separators=(",", ":"))


def _user_text(content: Any) -> str:
    """Turn a Claude Code user message into user-authored text, or ""."""
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text" and isinstance(block.get("text"), str):
                parts.append(block["text"])
            elif block.get("type") == "image":
                parts.append("[image]")
        text = "\n".join(parts)
    else:
        return ""
    stripped = text.strip()
    if not stripped or stripped.startswith(_NON_USER_PREFIXES):
        return ""
    command = _COMMAND_NAME_RE.search(stripped)
    if command:
        args = _COMMAND_ARGS_RE.search(stripped)
        name = command.group(1).strip()
        arg_text = args.group(1).strip() if args else ""
        return f"{name} {arg_text}".strip()
    return stripped


def _tool_result_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text" and isinstance(block.get("text"), str):
                    parts.append(block["text"])
                elif block.get("type") == "image":
                    parts.append("[image]")
        return "\n".join(parts)
    return ""


class _Converter:
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.out: list[str] = []
        self.header_written = False
        self.custom_title = ""
        self.ai_title = ""
        self.model = ""
        self.tool_names: dict[str, str] = {}
        # Claude Code writes one line per content block; blocks of one API
        # message share message.id and are merged into one Pi message.
        self.pending: dict[str, Any] | None = None
        self.pending_message_id = ""
        self.entrypoints: set[str] = set()

    def _header(self, entry: dict[str, Any]) -> None:
        if self.header_written:
            return
        self.header_written = True
        self.out.append(_dumps({
            "type": "session",
            "version": 3,
            "id": self.session_id or str(entry.get("sessionId") or ""),
            "timestamp": entry.get("timestamp", ""),
            "cwd": entry.get("cwd", ""),
            "agent": "claude-code",
        }))

    def _flush(self) -> None:
        if self.pending is not None:
            if self.pending["message"]["content"]:
                self.out.append(_dumps(self.pending))
            self.pending = None
            self.pending_message_id = ""

    def _message(self, entry: dict[str, Any], message: dict[str, Any]) -> None:
        self._flush()
        self.out.append(_dumps({
            "type": "message",
            "id": entry.get("uuid", ""),
            "timestamp": entry.get("timestamp", ""),
            "message": message,
        }))

    def feed(self, entry: dict[str, Any]) -> None:
        entry_type = entry.get("type")
        if entry.get("entrypoint"):
            self.entrypoints.add(str(entry["entrypoint"]))
        if entry_type == "custom-title" and entry.get("customTitle"):
            self.custom_title = str(entry["customTitle"]).strip()
            return
        if entry_type == "ai-title" and entry.get("aiTitle"):
            self.ai_title = str(entry["aiTitle"]).strip()
            return
        if entry_type == "attachment":
            attachment = entry.get("attachment") or {}
            if attachment.get("type") == "queued_command":
                text = _user_text(attachment.get("prompt"))
                if text and entry.get("cwd"):
                    self._header(entry)
                if text:
                    self._message(entry, {"role": "user", "content": [{"type": "text", "text": text}]})
            return
        if entry_type not in ("user", "assistant") or entry.get("isSidechain"):
            return
        if not entry.get("cwd") and not self.header_written:
            return
        self._header(entry)
        message = entry.get("message") or {}
        content = message.get("content")

        if entry_type == "user":
            if entry.get("isCompactSummary"):
                self._flush()
                summary = _user_text(content) if not isinstance(content, str) else content
                self.out.append(_dumps({
                    "type": "compaction",
                    "id": entry.get("uuid", ""),
                    "timestamp": entry.get("timestamp", ""),
                    "summary": summary,
                }))
                return
            if isinstance(content, list) and any(
                isinstance(b, dict) and b.get("type") == "tool_result" for b in content
            ):
                for block in content:
                    if not isinstance(block, dict) or block.get("type") != "tool_result":
                        continue
                    call_id = str(block.get("tool_use_id") or "")
                    self._message(entry, {
                        "role": "toolResult",
                        "toolCallId": call_id,
                        "toolName": self.tool_names.get(call_id, ""),
                        "isError": bool(block.get("is_error")),
                        "content": [{"type": "text", "text": _tool_result_text(block.get("content"))}],
                    })
                return
            if entry.get("isMeta"):
                return
            text = _user_text(content)
            if text.startswith(_COMPACTION_PREFIXES):
                self._flush()
                self.out.append(_dumps({
                    "type": "compaction",
                    "id": entry.get("uuid", ""),
                    "timestamp": entry.get("timestamp", ""),
                    "summary": text,
                }))
                return
            if text:
                self._message(entry, {"role": "user", "content": [{"type": "text", "text": text}]})
            return

        # assistant
        model = str(message.get("model") or "")
        if model and model != self.model and not model.startswith("<"):
            self._flush()
            self.model = model
            self.out.append(_dumps({
                "type": "model_change",
                "id": entry.get("uuid", ""),
                "timestamp": entry.get("timestamp", ""),
                "provider": "anthropic",
                "modelId": model,
            }))
        blocks: list[dict[str, Any]] = []
        for block in content if isinstance(content, list) else []:
            if not isinstance(block, dict):
                continue
            block_type = block.get("type")
            if block_type == "text" and str(block.get("text") or "").strip():
                blocks.append({"type": "text", "text": block["text"]})
            elif block_type == "thinking" and str(block.get("thinking") or "").strip():
                blocks.append({"type": "thinking", "thinking": block["thinking"]})
            elif block_type == "tool_use":
                call_id = str(block.get("id") or "")
                name = str(block.get("name") or "")
                self.tool_names[call_id] = name
                blocks.append({
                    "type": "toolCall",
                    "id": call_id,
                    "name": name,
                    "arguments": block.get("input", {}),
                })
        message_id = str(message.get("id") or entry.get("uuid") or "")
        if self.pending is not None and message_id and message_id == self.pending_message_id:
            self.pending["message"]["content"].extend(blocks)
            return
        self._flush()
        self.pending = {
            "type": "message",
            "id": entry.get("uuid", ""),
            "timestamp": entry.get("timestamp", ""),
            "message": {"role": "assistant", "model": model, "content": blocks},
        }
        self.pending_message_id = message_id

    def finish(self) -> str:
        self._flush()
        title = self.custom_title or self.ai_title
        if title and self.header_written:
            self.out.append(_dumps({"type": "session_info", "name": title}))
        return "\n".join(self.out) + ("\n" if self.out else "")


def convert_claude_text(raw: str, session_id: str = "") -> str:
    """Convert Claude Code JSONL text into Pi-shaped JSONL text."""
    return _convert(raw, session_id).finish()


def _convert(raw: str, session_id: str = "") -> "_Converter":
    converter = _Converter(session_id)
    for line in raw.splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            # A partially written final line is retried on the next change.
            continue
        if isinstance(entry, dict):
            converter.feed(entry)
    return converter


def _cache_paths(real_path: str) -> tuple[str, str]:
    session_id = claude_session_id(real_path) or re.sub(r"[^A-Za-z0-9_.-]", "_", real_path)
    base = os.path.join(CACHE_DIR, session_id)
    return base + ".jsonl", base + ".meta.json"


def _write_private(path: str, data: str) -> None:
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".tmp-", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(data)
        os.chmod(temp, 0o600)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def _load_converted(path: str) -> tuple[str, dict[str, Any]]:
    """(Pi-shaped text, cache metadata), rebuilt when size or mtime changes."""
    real = os.path.realpath(path)
    stat = os.stat(real)
    stamp = {"version": CONVERTER_VERSION, "source": real, "size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
    cache_file, meta_file = _cache_paths(real)
    try:
        with open(meta_file, "r", encoding="utf-8") as handle:
            meta = json.load(handle)
        if {key: meta.get(key) for key in stamp} == stamp:
            return Path(cache_file).read_text(encoding="utf-8"), meta
    except (OSError, ValueError):
        pass
    raw = Path(real).read_text(encoding="utf-8", errors="replace")
    converter = _convert(raw, claude_session_id(real))
    text = converter.finish()
    meta = dict(stamp, entrypoints=sorted(converter.entrypoints))
    try:
        _write_private(cache_file, text)
        _write_private(meta_file, json.dumps(meta))
    except OSError:
        pass
    return text, meta


def converted_claude_text(path: str) -> str:
    """Pi-shaped text for a Claude Code transcript, cached by size and mtime."""
    return _load_converted(path)[0]


def read_transcript_text(path: str) -> str:
    """Whole transcript as Pi-shaped JSONL text."""
    if is_claude_transcript(path):
        return converted_claude_text(path)
    return Path(path).read_text(encoding="utf-8", errors="replace")


def open_transcript(path: str, binary: bool = False) -> IO[Any]:
    """Drop-in replacement for open(path) that yields Pi-shaped JSONL lines."""
    if is_claude_transcript(path):
        text = converted_claude_text(path)
        return io.BytesIO(text.encode("utf-8")) if binary else io.StringIO(text)
    if binary:
        return open(path, "rb")
    return open(path, "r", encoding="utf-8", errors="ignore")


# --------------------------------------------------------------------------
# Filing
# --------------------------------------------------------------------------

def file_transcript(source: str, dest_dir: str) -> str:
    """Move a transcript into dest_dir; leave a symlink for Claude Code ones.

    A Claude Code transcript that is already filed (its original path is a
    symlink) is moved again and the original symlink is re-pointed.
    """
    dest_dir = os.path.abspath(dest_dir)
    os.makedirs(dest_dir, exist_ok=True)
    real = os.path.realpath(source)
    dest = os.path.join(dest_dir, os.path.basename(real))
    if os.path.realpath(dest) == real:
        return dest
    claude = is_claude_transcript(real)
    link = _claude_link_for(real) if claude else ""
    shutil.move(real, dest)
    if claude and link:
        if os.path.islink(link) or not os.path.exists(link):
            try:
                os.unlink(link)
            except FileNotFoundError:
                pass
        os.symlink(dest, link)
    return dest


def _claude_link_for(real_path: str) -> str:
    """Where Claude Code expects this transcript: its original projects path."""
    if is_unfiled_claude_path(real_path):
        return real_path
    session_id = claude_session_id(real_path)
    for candidate in iter_claude_transcript_paths():
        if claude_session_id(candidate) == session_id and os.path.islink(candidate):
            return candidate
    # A filed transcript whose link vanished: rebuild it from the recorded cwd.
    cwd = claude_cwd(real_path)
    if cwd and session_id:
        slug = re.sub(r"[^A-Za-z0-9]", "-", cwd)
        return os.path.join(CLAUDE_PROJECTS_ROOT, slug, session_id + ".jsonl")
    return ""


def claude_cwd(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                if '"cwd"' not in line:
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if isinstance(entry, dict) and entry.get("cwd"):
                    return str(entry["cwd"])
    except OSError:
        pass
    return ""


def repoint_claude_links(old_dir: str, new_dir: str) -> int:
    """After a workspace folder rename, re-point Claude Code symlinks into it."""
    old_prefix = os.path.abspath(old_dir).rstrip(os.sep) + os.sep
    new_dir = os.path.abspath(new_dir)
    count = 0
    # Glob directly: after the rename these links dangle, so the filtered
    # iterator (which needs a readable target) would skip them.
    for path in Path(CLAUDE_PROJECTS_ROOT).glob("*/*.jsonl"):
        link = str(path)
        if not os.path.islink(link):
            continue
        target = os.readlink(link)
        if target.startswith(old_prefix):
            new_target = os.path.join(new_dir, target[len(old_prefix):])
            os.unlink(link)
            os.symlink(new_target, link)
            count += 1
    return count


def claude_resume_command(path: str, launcher: str = "claude") -> tuple[str, str]:
    """(cwd, command) that resumes a Claude Code session in its original cwd."""
    session_id = claude_session_id(os.path.realpath(path))
    cwd = claude_cwd(os.path.realpath(path)) or os.path.expanduser("~")
    return cwd, f"{launcher} --resume {session_id}"
