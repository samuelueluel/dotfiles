#!/usr/bin/env python3
"""Persistent session-summary storage and lookup for piwork/Television."""

from __future__ import annotations

import difflib
import fcntl
import glob
import json
import os
import re
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator

import pi_session_sqlite as session_db

SUMMARY_INDEX_PATH = os.path.expanduser("~/.pi/agent/session-summaries.json")
SUMMARY_LOCK_PATH = SUMMARY_INDEX_PATH + ".lock"
SQLITE_INDEX_PATH = os.path.expanduser("~/.pi/agent/session-log.sqlite")
_DEFAULT_SUMMARY_INDEX_PATH = SUMMARY_INDEX_PATH
_INDEX_SYNCING = False
FOLDERS_ROOT = os.path.expanduser("~/.pi/agent/folders")
SESSIONS_ROOT = os.path.expanduser("~/.pi/agent/sessions")
UNFILED_DIR = os.path.join(SESSIONS_ROOT, "--var-home-samuel--")
SUMMARY_VERSION = 1
SUMMARY_STATUS_VALUES = frozenset({"complete", "in_progress", "blocked", "exploratory"})

_SEARCH_FIELDS = (
    "session_id",
    "title",
    "workspace",
    "status",
    "summary",
    "what_changed",
    "where_it_lives",
    "next_up",
    "keywords",
    "initial_prompt",
)
_STOPWORDS = {
    "a", "an", "and", "did", "do", "find", "for", "in", "me", "of",
    "on", "session", "the", "to", "we", "what", "where", "which",
    "was", "were", "with", "this", "that", "our", "my", "about",
}


def _now() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def _empty_store() -> dict[str, Any]:
    return {"version": SUMMARY_VERSION, "sessions": {}}


def _read_store_unlocked() -> dict[str, Any]:
    if not os.path.exists(SUMMARY_INDEX_PATH):
        return _empty_store()
    try:
        with open(SUMMARY_INDEX_PATH, "r", encoding="utf-8") as handle:
            store = json.load(handle)
    except (OSError, ValueError, TypeError):
        return _empty_store()
    if not isinstance(store, dict):
        return _empty_store()
    sessions = store.get("sessions")
    if not isinstance(sessions, dict):
        sessions = {}
    store["version"] = int(store.get("version", SUMMARY_VERSION))
    store["sessions"] = sessions
    return store


@contextmanager
def _index_lock(exclusive: bool = False) -> Iterator[None]:
    os.makedirs(os.path.dirname(SUMMARY_INDEX_PATH), exist_ok=True)
    with open(SUMMARY_LOCK_PATH, "a+", encoding="utf-8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def _effective_sqlite_path() -> str:
    # Test and alternate stores get an adjacent database automatically; the
    # production store uses the permanent Pi session-log path.
    if SUMMARY_INDEX_PATH != _DEFAULT_SUMMARY_INDEX_PATH:
        return os.path.join(os.path.dirname(SUMMARY_INDEX_PATH), "session-log.sqlite")
    return SQLITE_INDEX_PATH


def _sync_sqlite(store: dict[str, Any] | None = None) -> dict[str, int]:
    global _INDEX_SYNCING
    if _INDEX_SYNCING:
        return {}
    if store is None:
        with _index_lock(False):
            store = _read_store_unlocked()
    _INDEX_SYNCING = True
    try:
        session_db.configure(
            db_path=_effective_sqlite_path(),
            folders_root=FOLDERS_ROOT,
            sessions_root=SESSIONS_ROOT,
        )
        return session_db.sync(store.get("sessions", {}))
    finally:
        _INDEX_SYNCING = False


def sync_index() -> dict[str, int]:
    """Index every transcript and repair the SQLite summary projection."""
    return _sync_sqlite()


def load_store() -> dict[str, Any]:
    with _index_lock(False):
        store = _read_store_unlocked()
    # Indexing is automatic; summary creation is not. The returned object is
    # still the JSON-shaped curated store, so Television never sees null rows.
    _sync_sqlite(store)
    return store


def _write_store_unlocked(store: dict[str, Any]) -> None:
    directory = os.path.dirname(SUMMARY_INDEX_PATH)
    os.makedirs(directory, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".session-summaries.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(store, handle, indent=2, ensure_ascii=False, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, SUMMARY_INDEX_PATH)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ", ".join(str(item).strip() for item in value if str(item).strip())
    return str(value).strip()


def _as_keywords(value: Any) -> list[str]:
    if isinstance(value, str):
        values = re.split(r"[,\n]", value)
    elif isinstance(value, (list, tuple, set)):
        values = list(value)
    else:
        values = []
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        item = str(value).strip()
        key = item.casefold()
        if item and key not in seen:
            result.append(item)
            seen.add(key)
    return result


def normalize_record(session_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    record: dict[str, Any] = {"session_id": session_id}
    for field in (
        "title", "workspace", "summary", "what_changed", "where_it_lives",
        "next_up", "initial_prompt", "transcript_path", "logged_at", "updated_at",
    ):
        if field in fields and fields[field] is not None:
            record[field] = _as_text(fields[field])
    if "status" in fields and fields["status"] is not None:
        status = _as_text(fields["status"]).casefold()
        if status not in SUMMARY_STATUS_VALUES:
            allowed = ", ".join(sorted(SUMMARY_STATUS_VALUES))
            raise ValueError(f"status must be one of: {allowed}")
        record["status"] = status
    if "keywords" in fields and fields["keywords"] is not None:
        record["keywords"] = _as_keywords(fields["keywords"])
    return record


def set_summary(session_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    session_id = str(session_id).strip()
    if not session_id:
        raise ValueError("session ID is required")
    with _index_lock(True):
        store = _read_store_unlocked()
        existing = store["sessions"].get(session_id, {})
        if not isinstance(existing, dict):
            existing = {}
        record = dict(existing)
        record.update(normalize_record(session_id, fields))
        record.setdefault("keywords", [])
        now = _now()
        record.setdefault("logged_at", now)
        supplied_updated_at = fields.get("updated_at")
        record["updated_at"] = _as_text(supplied_updated_at) if supplied_updated_at else now
        store["sessions"][session_id] = record
        _write_store_unlocked(store)
        # JSON remains authoritative. SQLite is repaired after the atomic JSON
        # write, so a later sync can recover from a process crash in between.
        _sync_sqlite(store)
        return record


def get_summary(session_id: str) -> dict[str, Any] | None:
    record = load_store()["sessions"].get(str(session_id).strip())
    if not isinstance(record, dict):
        return None
    return _hydrate_record(record, session_path_index())


def all_summaries() -> list[dict[str, Any]]:
    records = []
    for session_id, record in load_store()["sessions"].items():
        if isinstance(record, dict):
            item = dict(record)
            item.setdefault("session_id", session_id)
            records.append(item)
    return records


def iter_session_paths() -> Iterator[str]:
    roots = (FOLDERS_ROOT, SESSIONS_ROOT)
    seen: set[str] = set()
    for root in roots:
        if not os.path.isdir(root):
            continue
        pattern = os.path.join(root, "**", "*.jsonl")
        for path in sorted(glob.iglob(pattern, recursive=True)):
            real_path = os.path.realpath(path)
            if real_path not in seen and os.path.isfile(real_path):
                seen.add(real_path)
                yield real_path


def _message_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip().replace("\n", " ")
    if isinstance(content, list):
        chunks = []
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                chunks.append(part["text"])
        return " ".join(chunks).strip().replace("\n", " ")
    return ""


def read_session_metadata(file_path: str) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "path": file_path,
        "session_id": "",
        "cwd": "",
        "title": "",
        "initial_prompt": "",
        "message_count": 0,
    }
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                except (ValueError, TypeError):
                    continue
                entry_type = entry.get("type")
                if entry_type == "session":
                    metadata["session_id"] = str(entry.get("id") or "")
                    metadata["cwd"] = str(entry.get("cwd") or "")
                elif entry_type == "session_info" and entry.get("name"):
                    metadata["title"] = str(entry["name"]).strip()
                elif entry_type == "message":
                    metadata["message_count"] += 1
                    message = entry.get("message") or {}
                    if message.get("role") == "user" and not metadata["initial_prompt"]:
                        metadata["initial_prompt"] = _message_text(message.get("content"))
    except OSError:
        pass
    if not metadata["title"]:
        metadata["title"] = metadata["initial_prompt"] or "Untitled conversation"
    return metadata


def session_records() -> list[dict[str, Any]]:
    records = []
    for path in iter_session_paths():
        metadata = read_session_metadata(path)
        if metadata["session_id"]:
            records.append(metadata)
    return records


def backlog_summaries(
    *,
    limit: int = 10,
    days: float | None = None,
    idle_hours: float = 24.0,
    workspace: str = "",
    exclude_session_ids: list[str] | set[str] | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    """Find old, unsummarized transcripts without modifying the index."""
    if limit < 1:
        raise ValueError("limit must be at least 1")
    if days is not None and days < 0:
        raise ValueError("days must be nonnegative")
    if idle_hours < 0:
        raise ValueError("idle-hours must be nonnegative")

    current_time = float(time.time() if now is None else now)
    excluded = {str(session_id).strip() for session_id in (exclude_session_ids or []) if str(session_id).strip()}
    excluded_workspace = str(workspace or "").strip().casefold()
    summarized = {
        str(session_id).strip()
        for session_id in load_store().get("sessions", {})
        if str(session_id).strip()
    }
    cutoff = current_time - (days * 86400) if days is not None else None
    idle_cutoff = current_time - (idle_hours * 3600)
    candidates: list[dict[str, Any]] = []

    for path in iter_session_paths():
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            continue
        if cutoff is not None and mtime < cutoff:
            continue
        if mtime > idle_cutoff:
            continue

        metadata = read_session_metadata(path)
        session_id = str(metadata.get("session_id") or "").strip()
        if not session_id or session_id in summarized or session_id in excluded:
            continue

        session_workspace = workspace_for_path(path)
        if excluded_workspace and session_workspace.casefold() != excluded_workspace:
            continue

        message_count = int(metadata.get("message_count") or 0)
        candidates.append({
            "session_id": session_id,
            "title": metadata.get("title") or "Untitled conversation",
            "workspace": session_workspace or "Unknown",
            "transcript_path": os.path.realpath(path),
            "mtime": mtime,
            "modified_at": datetime.fromtimestamp(mtime).replace(microsecond=0).isoformat(),
            "message_count": message_count,
            "turn_count": message_count,
            "initial_prompt": metadata.get("initial_prompt", ""),
        })

    candidates.sort(key=lambda item: (-float(item["mtime"]), item["session_id"]))
    total_matches = len(candidates)
    selected = candidates[:limit]
    return {
        "candidates": selected,
        "total_matches": total_matches,
        "returned_count": len(selected),
        "limit": limit,
        "truncated": total_matches > len(selected),
        "filters": {
            "days": days,
            "idle_hours": idle_hours,
            "workspace": workspace or "",
            "excluded_session_ids": sorted(excluded),
        },
    }


def session_path_index() -> dict[str, str]:
    """Resolve transcript paths cheaply from Pi's UUID-bearing filenames."""
    index: dict[str, str] = {}
    fallback_paths: list[str] = []
    for path in iter_session_paths():
        stem = os.path.basename(path)
        if stem.endswith(".jsonl"):
            stem = stem[:-6]
        candidate = stem.rsplit("_", 1)[-1] if "_" in stem else ""
        if candidate:
            index.setdefault(candidate, path)
        else:
            fallback_paths.append(path)
    for path in fallback_paths:
        metadata = read_session_metadata(path)
        if metadata["session_id"]:
            index.setdefault(metadata["session_id"], path)
    return index


def find_session_path(session_id: str, hint: str = "") -> str:
    session_id = str(session_id).strip()
    if hint and os.path.isfile(hint):
        metadata = read_session_metadata(hint)
        if metadata["session_id"] == session_id:
            return os.path.realpath(hint)
    return session_path_index().get(session_id, "")


def _hydrate_record(record: dict[str, Any], path_index: dict[str, str] | None = None) -> dict[str, Any]:
    item = dict(record)
    session_id = str(item.get("session_id", ""))
    current_path = ""
    hint = item.get("transcript_path", "")
    if hint and os.path.isfile(hint):
        current_path = os.path.realpath(hint)
    elif session_id:
        if path_index is None:
            path_index = session_path_index()
        current_path = path_index.get(session_id, "")
    if current_path:
        item["transcript_path"] = current_path
        item["workspace"] = workspace_for_path(current_path)
    return item


def workspace_for_path(file_path: str) -> str:
    path = os.path.realpath(file_path)
    folders_root = os.path.realpath(FOLDERS_ROOT)
    unfiled_dir = os.path.realpath(UNFILED_DIR)
    sessions_root = os.path.realpath(SESSIONS_ROOT)
    try:
        relative = os.path.relpath(path, folders_root)
        if relative != os.pardir and not relative.startswith(os.pardir + os.sep):
            return relative.split(os.sep)[0]
    except ValueError:
        pass
    if path == unfiled_dir or path.startswith(unfiled_dir + os.sep):
        return "Unfiled"
    try:
        relative = os.path.relpath(path, sessions_root)
        if relative != os.pardir and not relative.startswith(os.pardir + os.sep):
            return "Legacy/" + relative.split(os.sep)[0]
    except ValueError:
        pass
    return ""


def _record_corpus(record: dict[str, Any]) -> str:
    values = []
    for field in _SEARCH_FIELDS:
        value = record.get(field, "")
        values.append(_as_text(value))
    return " ".join(values).casefold()


def _query_terms(query: str) -> list[str]:
    terms = re.findall(r"[\w./:-]+", query.casefold())
    return [term for term in terms if term not in _STOPWORDS and len(term) > 1]


def _score_record(record: dict[str, Any], query: str) -> float:
    corpus = _record_corpus(record)
    if not corpus:
        return 0.0
    normalized_query = " ".join(re.findall(r"[\w./:-]+", query.casefold()))
    score = 0.0
    if normalized_query and normalized_query in corpus:
        score += 5.0
    terms = _query_terms(query)
    if not terms:
        return score + 0.1
    corpus_tokens = set(re.findall(r"[\w./:-]+", corpus))
    matched = 0
    for term in terms:
        if term in corpus:
            score += 2.0
            matched += 1
            continue
        close = difflib.get_close_matches(term, corpus_tokens, n=1, cutoff=0.76)
        if close:
            score += 1.0
            matched += 1
    if matched == 0:
        return 0.0
    return score + (matched / len(terms))


def search_summaries(query: str, limit: int = 10) -> list[dict[str, Any]]:
    # Summary-first retrieval. Only if there are no curated matches do we
    # search the automatically indexed transcript projection.
    store = load_store()
    del store  # load_store performs the sync and preserves JSON compatibility.
    _configure_sqlite_for_queries()
    records = session_db.search_summaries(query, limit)
    if records:
        path_index = session_path_index()
        return [_hydrate_record(record, path_index) for record in records]
    return session_db.search_transcripts(query, limit)


def _configure_sqlite_for_queries() -> None:
    session_db.configure(
        db_path=_effective_sqlite_path(),
        folders_root=FOLDERS_ROOT,
        sessions_root=SESSIONS_ROOT,
    )


def recent_summaries(limit: int = 10) -> list[dict[str, Any]]:
    records = all_summaries()
    records.sort(key=lambda item: item.get("updated_at", item.get("logged_at", "")), reverse=True)
    records = records[: max(1, int(limit))]
    path_index = session_path_index() if records else {}
    return [_hydrate_record(record, path_index) for record in records]


def summary_search_text(record: dict[str, Any], limit: int | None = 220) -> str:
    parts = []
    for field in ("keywords", "summary", "what_changed", "where_it_lives", "next_up"):
        value = _as_text(record.get(field))
        if value:
            parts.append(value)
    text = re.sub(r"\s+", " ", " — ".join(parts)).strip()
    if limit is None or len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"
