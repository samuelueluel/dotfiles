#!/usr/bin/env python3
"""Persistent SQLite projection for Pi transcript and session-summary search.

JSONL transcripts and session-summaries.json remain authoritative.  This module
maintains a rebuildable, searchable SQLite projection without creating curated
summary records automatically.
"""

from __future__ import annotations

import datetime as _datetime
import fcntl
import hashlib
import json
import os
import re
import sqlite3
import tempfile
from pathlib import Path
from typing import Any, Iterable

DB_PATH = os.path.expanduser("~/.pi/agent/session-log.sqlite")
FOLDERS_ROOT = os.path.expanduser("~/.pi/agent/folders")
SESSIONS_ROOT = os.path.expanduser("~/.pi/agent/sessions")
SCHEMA_VERSION = 1
CHUNK_SIZE = 2400
MAX_TEXT = 12000
_STOPWORDS = {
    "a", "an", "and", "did", "do", "find", "for", "in", "me", "of",
    "on", "session", "the", "to", "we", "what", "where", "which",
    "was", "were", "with", "this", "that", "our", "my", "about",
}


def configure(*, db_path: str, folders_root: str, sessions_root: str) -> None:
    global DB_PATH, FOLDERS_ROOT, SESSIONS_ROOT
    DB_PATH = os.path.realpath(os.path.expanduser(db_path))
    FOLDERS_ROOT = os.path.realpath(os.path.expanduser(folders_root))
    SESSIONS_ROOT = os.path.realpath(os.path.expanduser(sessions_root))


def _now() -> str:
    return _datetime.datetime.now().replace(microsecond=0).isoformat()


def _workspace_for_path(file_path: str) -> str:
    path = os.path.realpath(file_path)
    folders_root = os.path.realpath(FOLDERS_ROOT)
    unfiled_dir = os.path.join(os.path.realpath(SESSIONS_ROOT), "--var-home-samuel--")
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


def iter_session_paths() -> Iterable[str]:
    seen: set[str] = set()
    for root in (FOLDERS_ROOT, SESSIONS_ROOT):
        if not os.path.isdir(root):
            continue
        for path in sorted(Path(root).rglob("*.jsonl")):
            real_path = os.path.realpath(str(path))
            if real_path not in seen and os.path.isfile(real_path):
                seen.add(real_path)
                yield real_path


def _message_text(content: Any) -> str:
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        pieces = []
        for part in content:
            if not isinstance(part, dict):
                continue
            if isinstance(part.get("text"), str):
                pieces.append(part["text"])
        text = " ".join(pieces)
    else:
        return ""
    text = text.replace("\x00", " ").strip()
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT] + " …"
    return text


def _chunks(text: str) -> list[str]:
    if not text:
        return []
    chunks = []
    for start in range(0, len(text), CHUNK_SIZE):
        chunk = text[start:start + CHUNK_SIZE].strip()
        if chunk:
            chunks.append(chunk)
    return chunks


def _parse_transcript(path: str) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "session_id": "",
        "started_at": "",
        "cwd": "",
        "pi_title": "",
        "initial_prompt": "",
        "message_count": 0,
        "chunks": [],
        "digest": "",
        "size": 0,
        "mtime_ns": 0,
    }
    hasher = hashlib.sha256()
    try:
        stat = os.stat(path)
        metadata["size"] = int(stat.st_size)
        metadata["mtime_ns"] = int(stat.st_mtime_ns)
        with open(path, "rb") as raw:
            for line_number, raw_line in enumerate(raw, 1):
                hasher.update(raw_line)
                try:
                    line = raw_line.decode("utf-8")
                    entry = json.loads(line)
                except (UnicodeDecodeError, ValueError, TypeError):
                    # A partially written final JSONL record is ignored and
                    # will be retried once the file changes.
                    continue
                if not isinstance(entry, dict):
                    continue
                entry_type = entry.get("type")
                if entry_type == "session":
                    metadata["session_id"] = str(entry.get("id") or "").strip()
                    metadata["started_at"] = str(entry.get("timestamp") or "").strip()
                    metadata["cwd"] = str(entry.get("cwd") or "").strip()
                elif entry_type == "session_info" and entry.get("name"):
                    metadata["pi_title"] = str(entry["name"]).strip()
                elif entry_type == "message":
                    message = entry.get("message") or {}
                    role = str(message.get("role") or "").strip()
                    text = _message_text(message.get("content"))
                    metadata["message_count"] += 1
                    if role == "user" and not metadata["initial_prompt"]:
                        metadata["initial_prompt"] = text
                    for ordinal, chunk in enumerate(_chunks(text)):
                        metadata["chunks"].append({
                            "ordinal": len(metadata["chunks"]),
                            "start_line": line_number,
                            "end_line": line_number,
                            "role": role,
                            "text": chunk,
                        })
    except OSError:
        return metadata
    metadata["digest"] = hasher.hexdigest()
    if not metadata["session_id"]:
        stem = os.path.basename(path)
        if stem.endswith(".jsonl"):
            stem = stem[:-6]
        if "_" in stem:
            metadata["session_id"] = stem.rsplit("_", 1)[-1]
    if not metadata["pi_title"]:
        metadata["pi_title"] = metadata["initial_prompt"] or "Untitled conversation"
    return metadata


def _schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS schema_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            started_at TEXT,
            cwd TEXT,
            pi_title TEXT,
            initial_prompt TEXT,
            message_count INTEGER NOT NULL DEFAULT 0,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            indexed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS session_files (
            session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            workspace TEXT NOT NULL DEFAULT '',
            size INTEGER NOT NULL DEFAULT 0,
            mtime_ns INTEGER NOT NULL DEFAULT 0,
            content_hash TEXT NOT NULL DEFAULT '',
            indexed_bytes INTEGER NOT NULL DEFAULT 0,
            present INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (session_id, path)
        );
        CREATE INDEX IF NOT EXISTS session_files_path_idx ON session_files(path);
        CREATE TABLE IF NOT EXISTS summaries (
            session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
            record_json TEXT NOT NULL,
            record_hash TEXT NOT NULL,
            title TEXT,
            workspace TEXT,
            summary TEXT,
            what_changed TEXT,
            where_it_lives TEXT,
            next_up TEXT,
            initial_prompt TEXT,
            transcript_path TEXT,
            logged_at TEXT,
            updated_at TEXT,
            status TEXT,
            keywords_json TEXT
        );
        CREATE TABLE IF NOT EXISTS transcript_chunks (
            chunk_id INTEGER PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
            source_path TEXT NOT NULL,
            ordinal INTEGER NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT '',
            text TEXT NOT NULL,
            UNIQUE(session_id, source_path, ordinal)
        );
        CREATE INDEX IF NOT EXISTS transcript_chunks_session_idx ON transcript_chunks(session_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
            session_id UNINDEXED,
            source_path UNINDEXED,
            role UNINDEXED,
            text,
            tokenize='unicode61'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS summary_fts USING fts5(
            session_id UNINDEXED,
            title,
            summary,
            what_changed,
            where_it_lives,
            next_up,
            keywords,
            tokenize='unicode61'
        );
        INSERT INTO schema_meta(key, value) VALUES ('schema_version', '1')
            ON CONFLICT(key) DO UPDATE SET value=excluded.value;
        """
    )


def _create_database() -> None:
    parent = os.path.dirname(DB_PATH)
    os.makedirs(parent, mode=0o700, exist_ok=True)
    lock_path = DB_PATH + ".lock"
    with open(lock_path, "a+", encoding="utf-8") as lock:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        if os.path.exists(DB_PATH):
            return
        fd, temp_path = tempfile.mkstemp(prefix=".session-log-", suffix=".sqlite", dir=parent)
        os.close(fd)
        try:
            conn = sqlite3.connect(temp_path)
            try:
                _schema(conn)
                conn.execute("PRAGMA integrity_check")
                conn.commit()
            finally:
                conn.close()
            os.chmod(temp_path, 0o600)
            os.replace(temp_path, DB_PATH)
            os.chmod(DB_PATH, 0o600)
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)


def _connect() -> sqlite3.Connection:
    _create_database()
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    _schema(conn)
    conn.commit()
    return conn


def _record_json(record: dict[str, Any]) -> tuple[str, str]:
    payload = json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return payload, hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ", ".join(str(item).strip() for item in value if str(item).strip())
    return str(value).strip()


def _summary_values(record: dict[str, Any]) -> tuple[Any, ...]:
    keywords = record.get("keywords", [])
    if isinstance(keywords, str):
        keywords = [keywords]
    return (
        _text(record.get("title")),
        _text(record.get("workspace")),
        _text(record.get("summary")),
        _text(record.get("what_changed")),
        _text(record.get("where_it_lives")),
        _text(record.get("next_up")),
        _text(record.get("initial_prompt")),
        _text(record.get("transcript_path")),
        _text(record.get("logged_at")),
        _text(record.get("updated_at")),
        _text(record.get("status")),
        json.dumps(keywords, ensure_ascii=False, separators=(",", ":")),
    )


def _upsert_summary(conn: sqlite3.Connection, session_id: str, record: dict[str, Any]) -> bool:
    record = dict(record)
    record["session_id"] = session_id
    record_json, record_hash = _record_json(record)
    previous = conn.execute(
        "SELECT record_hash FROM summaries WHERE session_id = ?", (session_id,)
    ).fetchone()
    if previous and previous["record_hash"] == record_hash:
        return False
    conn.execute(
        """
        INSERT INTO sessions(session_id, first_seen_at, last_seen_at, indexed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id) DO NOTHING
        """,
        (session_id, _now(), _now(), _now()),
    )
    conn.execute("DELETE FROM summary_fts WHERE session_id = ?", (session_id,))
    conn.execute(
        """
        INSERT INTO summaries(
            session_id, record_json, record_hash, title, workspace, summary,
            what_changed, where_it_lives, next_up, initial_prompt,
            transcript_path, logged_at, updated_at, status, keywords_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
            record_json=excluded.record_json,
            record_hash=excluded.record_hash,
            title=excluded.title,
            workspace=excluded.workspace,
            summary=excluded.summary,
            what_changed=excluded.what_changed,
            where_it_lives=excluded.where_it_lives,
            next_up=excluded.next_up,
            initial_prompt=excluded.initial_prompt,
            transcript_path=excluded.transcript_path,
            logged_at=excluded.logged_at,
            updated_at=excluded.updated_at,
            status=excluded.status,
            keywords_json=excluded.keywords_json
        """,
        (session_id, record_json, record_hash, *_summary_values(record)),
    )
    conn.execute(
        "INSERT INTO summary_fts(session_id, title, summary, what_changed, where_it_lives, next_up, keywords) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            session_id,
            _text(record.get("title")),
            _text(record.get("summary")),
            _text(record.get("what_changed")),
            _text(record.get("where_it_lives")),
            _text(record.get("next_up")),
            _text(record.get("keywords")),
        ),
    )
    return True


def _index_file(conn: sqlite3.Connection, path: str, parsed: dict[str, Any], previous: sqlite3.Row | None, stats: dict[str, int]) -> None:
    session_id = str(parsed.get("session_id") or "").strip()
    if not session_id:
        stats["skipped"] += 1
        return
    now = _now()
    if previous and previous["session_id"] != session_id:
        old_session_id = previous["session_id"]
        old_ids = [
            row[0] for row in conn.execute(
                "SELECT chunk_id FROM transcript_chunks WHERE session_id = ? AND source_path = ?",
                (old_session_id, path),
            ).fetchall()
        ]
        if old_ids:
            conn.executemany("DELETE FROM transcript_fts WHERE rowid = ?", [(chunk_id,) for chunk_id in old_ids])
        conn.execute("DELETE FROM transcript_chunks WHERE session_id = ? AND source_path = ?", (old_session_id, path))
        conn.execute("DELETE FROM session_files WHERE session_id = ? AND path = ?", (old_session_id, path))
    existing = conn.execute("SELECT first_seen_at FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
    conn.execute(
        """
        INSERT INTO sessions(session_id, started_at, cwd, pi_title, initial_prompt, message_count, first_seen_at, last_seen_at, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
            started_at=excluded.started_at,
            cwd=excluded.cwd,
            pi_title=excluded.pi_title,
            initial_prompt=excluded.initial_prompt,
            message_count=excluded.message_count,
            last_seen_at=excluded.last_seen_at,
            indexed_at=excluded.indexed_at
        """,
        (
            session_id,
            parsed.get("started_at", ""),
            parsed.get("cwd", ""),
            parsed.get("pi_title", ""),
            parsed.get("initial_prompt", ""),
            int(parsed.get("message_count", 0)),
            (existing["first_seen_at"] if existing else now),
            now,
            now,
        ),
    )
    workspace = _workspace_for_path(path)
    unchanged = bool(
        previous
        and int(previous["size"]) == int(parsed["size"])
        and int(previous["mtime_ns"]) == int(parsed["mtime_ns"])
        and previous["content_hash"] == parsed["digest"]
    )
    if not unchanged:
        old_ids = [
            row[0] for row in conn.execute(
                "SELECT chunk_id FROM transcript_chunks WHERE session_id = ? AND source_path = ?",
                (session_id, path),
            ).fetchall()
        ]
        if old_ids:
            conn.executemany("DELETE FROM transcript_fts WHERE rowid = ?", [(chunk_id,) for chunk_id in old_ids])
        conn.execute("DELETE FROM transcript_chunks WHERE session_id = ? AND source_path = ?", (session_id, path))
        for chunk in parsed["chunks"]:
            cursor = conn.execute(
                "INSERT INTO transcript_chunks(session_id, source_path, ordinal, start_line, end_line, role, text) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (session_id, path, chunk["ordinal"], chunk["start_line"], chunk["end_line"], chunk["role"], chunk["text"]),
            )
            chunk_id = int(cursor.lastrowid)
            conn.execute(
                "INSERT INTO transcript_fts(rowid, session_id, source_path, role, text) VALUES (?, ?, ?, ?, ?)",
                (chunk_id, session_id, path, chunk["role"], chunk["text"]),
            )
        stats["indexed"] += 1
    else:
        stats["unchanged"] += 1
    conn.execute(
        """
        INSERT INTO session_files(session_id, path, workspace, size, mtime_ns, content_hash, indexed_bytes, present, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(session_id, path) DO UPDATE SET
            workspace=excluded.workspace,
            size=excluded.size,
            mtime_ns=excluded.mtime_ns,
            content_hash=excluded.content_hash,
            indexed_bytes=excluded.indexed_bytes,
            present=1,
            updated_at=excluded.updated_at
        """,
        (session_id, path, workspace, parsed["size"], parsed["mtime_ns"], parsed["digest"], parsed["size"], now),
    )


def sync(summary_records: dict[str, Any]) -> dict[str, int]:
    """Synchronize all transcripts and JSON summaries into SQLite."""
    conn = _connect()
    stats = {"indexed": 0, "unchanged": 0, "summaries_updated": 0, "skipped": 0, "files": 0}
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("UPDATE session_files SET present = 0")
        current_summary_ids = set()
        existing_by_path = {
            row["path"]: row
            for row in conn.execute("SELECT * FROM session_files").fetchall()
        }
        for path in iter_session_paths():
            stats["files"] += 1
            try:
                parsed = _parse_transcript(path)
                current = os.stat(path)
            except OSError:
                continue
            # If a transcript changed while it was being parsed, leave it for
            # the next sync instead of committing a partial snapshot.
            if int(current.st_size) != int(parsed["size"]) or int(current.st_mtime_ns) != int(parsed["mtime_ns"]):
                stats["skipped"] += 1
                continue
            _index_file(conn, path, parsed, existing_by_path.get(path), stats)
        for session_id, record in (summary_records or {}).items():
            if not isinstance(record, dict):
                continue
            session_id = str(session_id).strip()
            if not session_id:
                continue
            current_summary_ids.add(session_id)
            if _upsert_summary(conn, session_id, record):
                stats["summaries_updated"] += 1
        if current_summary_ids:
            placeholders = ",".join("?" for _ in current_summary_ids)
            conn.execute(f"DELETE FROM summaries WHERE session_id NOT IN ({placeholders})", tuple(current_summary_ids))
            conn.execute(f"DELETE FROM summary_fts WHERE session_id NOT IN ({placeholders})", tuple(current_summary_ids))
        else:
            conn.execute("DELETE FROM summaries")
            conn.execute("DELETE FROM summary_fts")
        conn.commit()
        os.chmod(DB_PATH, 0o600)
        return stats
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _safe_fts_query(query: str) -> str:
    text = str(query or "").casefold()
    terms = re.findall(r"[\w]+", text, flags=re.UNICODE)
    clauses: list[str] = []
    compound_terms: set[str] = set()
    for compound in re.findall(r"[\w]+(?:[-/.:][\w]+)+", text, flags=re.UNICODE):
        parts = [term for term in re.findall(r"[\w]+", compound) if len(term) > 1 and term not in _STOPWORDS]
        if len(parts) > 1:
            compound_terms.update(parts)
            clauses.append("(" + " AND ".join('"' + term.replace('"', '""') + '"' for term in parts) + ")")
    remaining = [term for term in terms if term not in compound_terms and len(term) > 1 and term not in _STOPWORDS]
    if remaining:
        # OR keeps natural-language questions useful; SQLite's BM25 rank then
        # favors rows matching more of the meaningful terms.
        clauses.append("(" + " OR ".join('"' + term.replace('"', '""') + '"' for term in remaining) + ")")
    return " AND ".join(clauses)


def search_summaries(query: str, limit: int) -> list[dict[str, Any]]:
    match = _safe_fts_query(query)
    if not match:
        return []
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT sf.session_id, sf.rank, s.record_json
            FROM summary_fts AS sf
            JOIN summaries AS s ON s.session_id = sf.session_id
            WHERE summary_fts MATCH ?
            ORDER BY sf.rank
            LIMIT ?
            """,
            (match, max(1, int(limit))),
        ).fetchall()
        results = []
        for row in rows:
            record = json.loads(row["record_json"])
            record["score"] = round(-float(row["rank"]), 3)
            results.append(record)
        return results
    finally:
        conn.close()


def search_transcripts(query: str, limit: int) -> list[dict[str, Any]]:
    match = _safe_fts_query(query)
    if not match:
        return []
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT tf.session_id, tf.source_path, tf.role,
                   snippet(transcript_fts, 3, '[', ']', ' … ', 28) AS snippet,
                   sf.workspace, s.pi_title, s.initial_prompt, s.started_at,
                   tf.rank
            FROM transcript_fts AS tf
            LEFT JOIN session_files AS sf
              ON sf.session_id = tf.session_id AND sf.path = tf.source_path
            LEFT JOIN sessions AS s ON s.session_id = tf.session_id
            WHERE transcript_fts MATCH ?
            ORDER BY tf.rank
            LIMIT ?
            """,
            (match, max(1, int(limit) * 4)),
        ).fetchall()
        results = []
        seen: set[str] = set()
        for row in rows:
            session_id = str(row["session_id"])
            if session_id in seen:
                continue
            seen.add(session_id)
            results.append({
                "session_id": session_id,
                "title": row["pi_title"] or row["initial_prompt"] or "Untitled conversation",
                "workspace": row["workspace"] or "",
                "transcript_path": row["source_path"],
                "started_at": row["started_at"] or "",
                "source": "transcript",
                "transcript_snippet": row["snippet"] or "",
                "score": round(-float(row["rank"]), 3),
            })
            if len(results) >= max(1, int(limit)):
                break
        return results
    finally:
        conn.close()


def database_stats() -> dict[str, int]:
    conn = _connect()
    try:
        return {
            "sessions": int(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]),
            "files": int(conn.execute("SELECT COUNT(*) FROM session_files WHERE present = 1").fetchone()[0]),
            "chunks": int(conn.execute("SELECT COUNT(*) FROM transcript_chunks").fetchone()[0]),
            "summaries": int(conn.execute("SELECT COUNT(*) FROM summaries").fetchone()[0]),
        }
    finally:
        conn.close()
