#!/usr/bin/env python3
"""Run the dedicated, read-only model used to draft session summaries."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

LOGGER_MODEL = "openai-codex/gpt-5.6-luna"
LOGGER_THINKING = "high"
LOGGER_TIMEOUT_SECONDS = 900
LOGGER_MAX_TRANSCRIPT_CHARS = 1_500_000
_TOOL_RESULT_EXCERPT_CHARS = 2_500
_TOOL_ARGUMENT_EXCERPT_CHARS = 8_000
_THINKING_EXCERPT_CHARS = 1_200
_ALLOWED_THINKING = frozenset({"high", "max"})
_TEXT_FIELDS = ("title", "summary", "outcomes", "artifacts", "open_items")
_OMISSION_MARKER_PREFIX = "[[PI_SESSION_LOGGER_OMITTED"
_OMISSION_ESCAPED_PREFIX = "[[PI_SESSION_LOGGER_ESCAPED_OMITTED"
_ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")

_SYSTEM_PROMPT = """You are Samuel's dedicated session logger.

Read the compact Pi session transcript representation supplied on standard
input. It may omit opaque model-reasoning signatures and excerpt large tool
payloads; explicit omission markers are not evidence. Return exactly one JSON
object and no prose, Markdown fence, or explanation. Use only evidence in the
transcript and the existing summary context, if supplied. Do not invent
decisions, files, commands, outcomes, or next steps.

The JSON object must have exactly these useful fields:
- title: concise title for this completed session
- summary: one sentence describing purpose and outcome
- outcomes: substantive changes, decisions, and findings
- artifacts: exact files, commands, datasets, notes, or paths mentioned
- open_items: unfinished work or verification steps; use an empty string when none
- keywords: array of exact identifiers worth searching later

Return a complete replacement record. Preserve supported existing summary facts
unless the transcript clearly updates them. Do not return status, session IDs,
transcript paths, or metadata. Use plain text inside fields. If the evidence does
not support a claim, leave that field empty rather than guessing. Only summarize
substantive work; do not describe this logger instruction."""


def _user_prompt(existing_summary: dict[str, Any] | None = None) -> str:
    if not existing_summary:
        return "Analyze the JSONL transcript supplied on stdin and return the required JSON object now."
    context = {
        "title": existing_summary.get("title", ""),
        "summary": existing_summary.get("summary", ""),
        "outcomes": existing_summary.get("what_changed", ""),
        "artifacts": existing_summary.get("where_it_lives", ""),
        "open_items": existing_summary.get("next_up", ""),
        "keywords": existing_summary.get("keywords", []),
    }
    return (
        "Analyze the JSONL transcript supplied on stdin. The following existing "
        "summary is context; return a complete replacement JSON object and "
        "preserve supported facts unless the transcript updates them.\n\n"
        "Existing summary:\n"
        + json.dumps(context, ensure_ascii=False, indent=2)
    )


def _escape_omission_marker(text: str) -> str:
    """Prevent source text from masquerading as a projection omission."""
    return str(text or "").replace(
        _OMISSION_MARKER_PREFIX, _OMISSION_ESCAPED_PREFIX
    )


def _excerpt(text: str, limit: int, *, label: str) -> str:
    """Keep useful head/tail evidence while marking omitted payload text."""
    text = _escape_omission_marker(text)
    if len(text) <= limit:
        return text
    if limit <= 0:
        return f"[{label} omitted: {len(text)} characters]"
    head = max(1, int(limit * 0.65))
    tail = max(1, limit - head)
    omitted = len(text) - head - tail
    return (
        text[:head]
        + f"\n[[LOGGER_OMITTED label={label!r} chars={omitted}]]\n"
        + text[-tail:]
    )


def _project_transcript_entry(
    entry: dict[str, Any],
    *,
    tool_result_limit: int,
    tool_argument_limit: int,
    thinking_limit: int,
) -> dict[str, Any]:
    """Drop opaque/session-internal fields before sending a transcript to Pi."""
    entry_type = entry.get("type")
    if entry_type != "message":
        projected: dict[str, Any] = {"type": entry_type}
        for key in (
            "version",
            "id",
            "timestamp",
            "cwd",
            "name",
            "provider",
            "modelId",
            "thinkingLevel",
            "customType",
            "firstKeptEntryId",
            "tokensBefore",
            "fromHook",
        ):
            if key in entry:
                projected[key] = entry[key]
        if entry_type == "compaction" and isinstance(entry.get("summary"), str):
            projected["summary"] = _escape_omission_marker(entry["summary"])
        if entry_type == "custom" and isinstance(entry.get("data"), dict):
            data = entry["data"]
            projected["data"] = {
                key: data[key]
                for key in ("lastAutoTitle", "lastAppliedUserTurnCount", "lastTrigger")
                if key in data
            }
        return projected

    message = entry.get("message") or {}
    role = str(message.get("role") or "")
    projected_message: dict[str, Any] = {"role": role}
    for key in ("toolName", "toolCallId"):
        if key in message:
            projected_message[key] = message[key]

    projected_content: list[dict[str, Any]] = []
    content = message.get("content")
    if isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            if item_type == "text":
                text = _escape_omission_marker(str(item.get("text") or ""))
                if role == "toolResult":
                    text = _excerpt(text, tool_result_limit, label="tool result")
                projected_content.append({"type": "text", "text": text})
            elif item_type == "thinking" and thinking_limit > 0:
                thinking = _escape_omission_marker(
                    _ANSI_ESCAPE_RE.sub("", str(item.get("thinking") or ""))
                )
                if thinking:
                    projected_content.append(
                        {
                            "type": "thinking",
                            "thinking": _excerpt(
                                thinking, thinking_limit, label="thinking"
                            ),
                        }
                    )
            elif item_type == "toolCall":
                arguments = item.get("arguments", "")
                if not isinstance(arguments, str):
                    arguments = json.dumps(
                        arguments, ensure_ascii=False, sort_keys=True
                    )
                arguments = _escape_omission_marker(arguments)
                projected_content.append(
                    {
                        "type": "toolCall",
                        "id": item.get("id"),
                        "name": str(item.get("name") or ""),
                        "arguments": _excerpt(
                            arguments, tool_argument_limit, label="tool arguments"
                        ),
                    }
                )
    elif isinstance(content, str):
        content = _escape_omission_marker(content)
        projected_content.append(
            {
                "type": "text",
                "text": (
                    _excerpt(content, tool_result_limit, label="tool result")
                    if role == "toolResult"
                    else content
                ),
            }
        )
    projected_message["content"] = projected_content

    projected = {
        "type": "message",
        "id": entry.get("id"),
        "timestamp": entry.get("timestamp"),
        "message": projected_message,
    }
    return projected


def prepare_transcript(transcript: str) -> str:
    """Build a bounded evidence-preserving transcript for the logger model.

    Pi transcripts contain encrypted reasoning signatures and tool-result
    details that are useful for resuming Pi but waste logger context. Keep user
    and assistant text, tool names/calls, compaction summaries, and bounded
    tool-result excerpts; omit opaque fields and mark every excerpt.
    """
    entries: list[dict[str, Any]] = []
    for line_number, line in enumerate(transcript.splitlines(), 1):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid transcript JSON on line {line_number}: {exc}") from exc
        if not isinstance(entry, dict):
            raise ValueError(f"transcript line {line_number} is not a JSON object")
        entries.append(entry)

    # This is a conservative character budget, not a tokenizer-derived model
    # context limit. Shrink non-conversational payloads progressively if a
    # session has many large tool results. If the conversation itself exceeds the budget, fail
    # explicitly rather than silently dropping user or assistant evidence.
    budgets = (
        (_TOOL_RESULT_EXCERPT_CHARS, _TOOL_ARGUMENT_EXCERPT_CHARS, _THINKING_EXCERPT_CHARS),
        (1_200, 4_000, 0),
        (400, 1_000, 0),
        (0, 0, 0),
    )
    for tool_result_limit, tool_argument_limit, thinking_limit in budgets:
        projected = [
            _project_transcript_entry(
                entry,
                tool_result_limit=tool_result_limit,
                tool_argument_limit=tool_argument_limit,
                thinking_limit=thinking_limit,
            )
            for entry in entries
        ]
        rendered = "\n".join(
            json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
            for entry in projected
        ) + "\n"
        if len(rendered) <= LOGGER_MAX_TRANSCRIPT_CHARS:
            return rendered

    raise ValueError(
        "transcript remains too large for the logger context after omitting "
        "non-conversational payloads; no summary was written"
    )


def flush_transcript(path: str) -> None:
    """Flush filesystem buffers before reading an active-session transcript."""
    if hasattr(os, "sync"):
        os.sync()
    try:
        with open(path, "rb") as handle:
            os.fsync(handle.fileno())
    except OSError:
        # The file may be replaced between stat and open; the caller will read
        # the current path immediately afterward and the next invocation retries.
        pass


def _extract_json(output: str) -> dict[str, Any]:
    text = str(output or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("logger did not return a JSON object") from None
        try:
            value = json.loads(text[start:end + 1])
        except json.JSONDecodeError as exc:
            raise ValueError(f"logger returned invalid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError("logger output must be a JSON object")
    return value


def normalize_draft(value: dict[str, Any]) -> dict[str, Any]:
    draft: dict[str, Any] = {}
    for field in _TEXT_FIELDS:
        item = value.get(field, "")
        if not isinstance(item, str):
            raise ValueError(f"logger field {field!r} must be a string")
        draft[field] = item.strip()
    keywords = value.get("keywords", [])
    if not isinstance(keywords, list) or any(not isinstance(item, str) for item in keywords):
        raise ValueError("logger field 'keywords' must be an array of strings")
    seen: set[str] = set()
    normalized_keywords = []
    for keyword in keywords:
        item = keyword.strip()
        key = item.casefold()
        if item and key not in seen:
            normalized_keywords.append(item)
            seen.add(key)
    draft["keywords"] = normalized_keywords
    if not draft["title"]:
        raise ValueError("logger returned an empty title")
    if not draft["summary"]:
        raise ValueError("logger returned an empty summary")
    return draft


def _pi_command(thinking: str = LOGGER_THINKING, pi_path: str | None = None) -> list[str]:
    thinking = str(thinking).strip().lower()
    if thinking not in _ALLOWED_THINKING:
        raise ValueError("session logger thinking must be high or max")
    executable = pi_path or shutil.which("pi")
    if not executable:
        raise RuntimeError("cannot run session logger: pi executable not found")
    return [
        executable,
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-themes",
        "--no-context-files",
        "--no-approve",
        "--model",
        LOGGER_MODEL,
        "--thinking",
        thinking,
        "--system-prompt",
        _SYSTEM_PROMPT,
        "--print",
        _user_prompt(),
    ]


def run_logger(
    transcript_path: str,
    *,
    existing_summary: dict[str, Any] | None = None,
    thinking: str = LOGGER_THINKING,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    pi_path: str | None = None,
    flusher: Callable[[str], None] = flush_transcript,
) -> dict[str, Any]:
    """Return a validated draft without writing any summary or index files."""
    path = os.path.realpath(os.path.expanduser(str(transcript_path)))
    if not os.path.isfile(path):
        raise FileNotFoundError(f"transcript not found: {path}")
    flusher(path)
    raw_transcript = Path(path).read_text(encoding="utf-8", errors="replace")
    if not raw_transcript.strip():
        raise ValueError("cannot log an empty transcript")
    transcript = prepare_transcript(raw_transcript)
    command = _pi_command(thinking=thinking, pi_path=pi_path)
    command[-1] = _user_prompt(existing_summary)
    try:
        result = runner(
            command,
            input=transcript,
            text=True,
            capture_output=True,
            cwd=os.path.expanduser("~"),
            timeout=LOGGER_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("session logger timed out; no summary was written") from exc
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        if len(detail) > 1200:
            detail = detail[-1200:]
        raise RuntimeError(f"session logger failed; no summary was written: {detail}")
    return normalize_draft(_extract_json(result.stdout))
