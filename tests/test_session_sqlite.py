"""Regression tests for the SQLite transcript projection."""

from __future__ import annotations

import concurrent.futures
import contextlib
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
if not (REPO_ROOT / "dot_local").is_dir():
    REPO_ROOT = REPO_ROOT / "dotfiles"
LIB_DIR = REPO_ROOT / "dot_local" / "lib"
sys.path.insert(0, str(LIB_DIR))


def load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, LIB_DIR / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


sqlite_projection = load_module("pi_session_sqlite")
summary = load_module("pi_session_summary")


class SessionSQLiteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        summary.SUMMARY_INDEX_PATH = str(root / "session-summaries.json")
        summary.SUMMARY_LOCK_PATH = summary.SUMMARY_INDEX_PATH + ".lock"
        summary.SQLITE_INDEX_PATH = str(root / "session-log.sqlite")
        summary.FOLDERS_ROOT = str(root / "folders")
        summary.SESSIONS_ROOT = str(root / "sessions")
        summary.UNFILED_DIR = str(root / "sessions" / "unfiled")
        Path(summary.UNFILED_DIR).mkdir(parents=True)
        summary._INDEX_SYNCING = False

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def write_transcript(self, relative_path: str, session_id: str, text: str) -> Path:
        path = Path(self.tempdir.name) / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        entries = [
            {
                "type": "session",
                "id": session_id,
                "timestamp": "2026-01-01T00:00:00Z",
                "cwd": "/tmp/project",
            },
            {"type": "session_info", "name": session_id},
            {
                "type": "message",
                "message": {"role": "user", "content": [{"type": "text", "text": text}]},
            },
        ]
        path.write_text("\n".join(json.dumps(entry) for entry in entries) + "\n", encoding="utf-8")
        return path

    def connect(self) -> sqlite3.Connection:
        return sqlite3.connect(summary.SQLITE_INDEX_PATH)

    def test_indexes_all_transcripts_without_creating_summaries(self) -> None:
        self.write_transcript("sessions/unfiled/a.jsonl", "a", "alpha transcript marker")
        self.write_transcript("folders/Economics/b.jsonl", "b", "beta transcript marker")

        report = summary.sync_index()
        self.assertEqual(report["files"], 2)
        self.assertEqual(report["summaries_updated"], 0)
        with contextlib.closing(self.connect()) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM session_files WHERE present = 1").fetchone()[0], 2)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM summaries").fetchone()[0], 0)

        result = summary.search_summaries("alpha transcript marker")
        self.assertEqual(result[0]["session_id"], "a")
        self.assertEqual(result[0]["source"], "transcript")

    def test_summary_first_then_transcript_fallback(self) -> None:
        curated = self.write_transcript("sessions/unfiled/curated.jsonl", "curated", "raw curated marker")
        self.write_transcript("sessions/unfiled/raw.jsonl", "raw", "raw-only marker")
        summary.set_summary(
            "curated",
            {
                "title": "Curated title",
                "summary": "Curated summary marker",
                "transcript_path": str(curated),
                "keywords": ["curated-keyword"],
            },
        )

        curated_results = summary.search_summaries("curated summary marker")
        self.assertEqual(curated_results[0]["session_id"], "curated")
        self.assertNotIn("source", curated_results[0])

        fallback_results = summary.search_summaries("raw-only marker")
        self.assertEqual(fallback_results[0]["session_id"], "raw")
        self.assertEqual(fallback_results[0]["source"], "transcript")
        self.assertIn("transcript_snippet", fallback_results[0])

    def test_incremental_append_partial_line_rewrite_move_and_duplicate(self) -> None:
        path = self.write_transcript("sessions/unfiled/a.jsonl", "a", "old-marker")
        summary.sync_index()
        first = summary.sync_index()
        self.assertGreaterEqual(first["unchanged"], 1)

        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"type": "message", "message": {"role": "user", "content": "new-marker"}}) + "\n")
            handle.write('{"type":"message"')
        summary.sync_index()
        self.assertTrue(summary.search_summaries("new-marker"))

        path.write_text(
            "\n".join(
                [
                    json.dumps({"type": "session", "id": "a"}),
                    json.dumps({"type": "message", "message": {"role": "user", "content": "rewritten-marker"}}),
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        summary.sync_index()
        self.assertTrue(summary.search_summaries("rewritten-marker"))
        self.assertFalse(any(item.get("source") == "transcript" for item in summary.search_summaries("old-marker")))

        destination = Path(self.tempdir.name) / "folders" / "Moved" / path.name
        destination.parent.mkdir(parents=True)
        path.rename(destination)
        summary.set_summary("a", {"summary": "Moved summary", "transcript_path": str(path)})
        summary.sync_index()
        self.assertEqual(summary.get_summary("a")["transcript_path"], str(destination.resolve()))

        duplicate = self.write_transcript("folders/Other/duplicate.jsonl", "a", "duplicate-only-marker")
        self.assertTrue(duplicate.exists())
        summary.sync_index()
        duplicate_results = summary.search_summaries("duplicate-only-marker")
        self.assertEqual([item["session_id"] for item in duplicate_results], ["a"])

    def test_recovery_restores_stale_summary_projection_and_preserves_json(self) -> None:
        path = self.write_transcript("sessions/unfiled/a.jsonl", "a", "recovery-marker")
        summary.set_summary("a", {"summary": "Authoritative recovery summary", "transcript_path": str(path)})
        with contextlib.closing(self.connect()) as conn:
            conn.execute("DELETE FROM summaries WHERE session_id = 'a'")
            conn.execute("DELETE FROM summary_fts WHERE session_id = 'a'")
            conn.commit()

        self.assertEqual(summary.search_summaries("Authoritative recovery summary")[0]["session_id"], "a")
        self.assertIn("a", summary.load_store()["sessions"])

    def test_query_safety_mode_and_integrity(self) -> None:
        self.write_transcript("sessions/unfiled/a.jsonl", "a", "unicode café marker")
        summary.sync_index()
        summary.search_summaries('C++ ("bad query')
        mode = os.stat(summary.SQLITE_INDEX_PATH).st_mode & 0o777
        self.assertEqual(mode, 0o600)
        with contextlib.closing(self.connect()) as conn:
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_concurrent_summary_write_and_sync(self) -> None:
        path = self.write_transcript("sessions/unfiled/a.jsonl", "a", "concurrent-marker")

        def write_summary() -> None:
            summary.set_summary("a", {"summary": "Concurrent summary", "transcript_path": str(path)})

        def sync() -> None:
            summary.sync_index()

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(write_summary), pool.submit(sync)]
            for future in futures:
                future.result()

        summary.sync_index()
        with contextlib.closing(self.connect()) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM summaries WHERE session_id = 'a'").fetchone()[0], 1)
        self.assertEqual(summary.get_summary("a")["summary"], "Concurrent summary")


if __name__ == "__main__":
    unittest.main(verbosity=2)
