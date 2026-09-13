#!/usr/bin/env python3
"""Regression tests for the permanent Pi session-summary index."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import re
import sys
import tempfile
import time
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
LIB_DIR = REPO_ROOT / "dot_local" / "lib"
MODULE_PATH = LIB_DIR / "pi_session_summary.py"
sys.path.insert(0, str(LIB_DIR))

spec = importlib.util.spec_from_file_location("pi_session_summary", MODULE_PATH)
assert spec and spec.loader
summary = importlib.util.module_from_spec(spec)
sys.modules["pi_session_summary"] = summary
spec.loader.exec_module(summary)

from importlib.machinery import SourceFileLoader


PIWORK_PATH = REPO_ROOT / "dot_local" / "bin" / "executable_piwork"
piwork_spec = importlib.util.spec_from_file_location(
    "piwork", PIWORK_PATH, loader=SourceFileLoader("piwork", str(PIWORK_PATH))
)
assert piwork_spec and piwork_spec.loader
piwork = importlib.util.module_from_spec(piwork_spec)
sys.modules["piwork"] = piwork
piwork_spec.loader.exec_module(piwork)

TV_PATH = REPO_ROOT / "dot_local" / "bin" / "executable_tv-workspaces.py"
tv_spec = importlib.util.spec_from_file_location("tv_workspaces", TV_PATH)
assert tv_spec and tv_spec.loader
tv = importlib.util.module_from_spec(tv_spec)
tv_spec.loader.exec_module(tv)


class SessionSummaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        summary.SUMMARY_INDEX_PATH = str(root / "session-summaries.json")
        summary.SUMMARY_LOCK_PATH = summary.SUMMARY_INDEX_PATH + ".lock"
        summary.FOLDERS_ROOT = str(root / "folders")
        summary.SESSIONS_ROOT = str(root / "sessions")
        summary.UNFILED_DIR = str(root / "sessions" / "unfiled")
        Path(summary.UNFILED_DIR).mkdir(parents=True)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def write_transcript(self, relative_path: str, session_id: str, title: str, message_count: int, mtime: float) -> Path:
        path = Path(self.tempdir.name) / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        entries = [
            {"type": "session", "id": session_id, "cwd": "/var/home/samuel"},
            {"type": "session_info", "name": title},
        ]
        for index in range(message_count):
            role = "user" if index % 2 == 0 else "assistant"
            entries.append({"type": "message", "message": {"role": role, "content": f"{title} message {index}"}})
        path.write_text("\n".join(json.dumps(entry, separators=(",", ":")) for entry in entries) + "\n", encoding="utf-8")
        os.utime(path, (mtime, mtime))
        return path

    def test_partial_update_preserves_keywords(self) -> None:
        summary.set_summary("s1", {
            "summary": "Created the price variable.",
            "keywords": "price variable, panel data",
        })
        summary.set_summary("s1", {"next_up": "Verify labels"})
        record = summary.get_summary("s1")
        self.assertEqual(record["keywords"], ["price variable", "panel data"])
        self.assertEqual(record["next_up"], "Verify labels")

    def test_moved_transcript_resolves_by_uuid(self) -> None:
        source_dir = Path(summary.UNFILED_DIR)
        source = source_dir / "2026-01-01T00-00-00Z_s1.jsonl"
        source.write_text("{}\n", encoding="utf-8")
        summary.set_summary("s1", {
            "summary": "A movable session.",
            "transcript_path": str(source),
        })

        destination_dir = Path(summary.FOLDERS_ROOT) / "Economics"
        destination_dir.mkdir(parents=True)
        destination = destination_dir / source.name
        source.rename(destination)

        record = summary.get_summary("s1")
        self.assertEqual(record["transcript_path"], str(destination.resolve()))
        self.assertEqual(record["workspace"], "Economics")

    def test_archived_summary_is_searchable_without_transcript(self) -> None:
        summary.set_summary("archived", {
            "title": "Archived session",
            "summary": "Documented an archived workflow.",
            "keywords": ["archived", "workflow"],
        })
        record = summary.get_summary("archived")
        self.assertEqual(record["summary"], "Documented an archived workflow.")
        self.assertEqual(summary.search_summaries("archived workflow")[0]["session_id"], "archived")

    def test_natural_language_search_ranks_relevant_session(self) -> None:
        summary.set_summary("price-session", {
            "title": "Panel Data Construction",
            "summary": "Created the price variable during panel-data preparation.",
            "keywords": ["price variable", "panel data"],
        })
        summary.set_summary("music-session", {
            "title": "Music Queue Cleanup",
            "summary": "Reorganized an album queue.",
            "keywords": ["music"],
        })
        results = summary.search_summaries("what session did we create the price variable")
        self.assertEqual(results[0]["session_id"], "price-session")

    def test_television_search_corpus_contains_full_summary_fields(self) -> None:
        record = {
            "session_id": "s1",
            "summary": "A short summary.",
            "next_up": "ultra-rare-next-step-token",
            "keywords": ["identifier"],
        }
        meta = {"id": "s1", "title": "Session title"}
        display = tv.session_display(meta, "Unfiled", "now", {"sessions": {"s1": record}})
        self.assertIn("ultra-rare-next-step-token", display)

    def test_television_prefers_curated_summary_title(self) -> None:
        meta = {"id": "s1", "title": "The initial user prompt"}
        self.assertEqual(
            tv.effective_session_title(meta, {"title": "Curated session title"}),
            "Curated session title",
        )
        self.assertEqual(
            tv.effective_session_title(meta, {"title": "  "}),
            "The initial user prompt",
        )
        display = tv.session_display(
            meta,
            "Unfiled",
            "now",
            {"sessions": {"s1": {"title": "Curated session title"}}},
        )
        self.assertIn("Curated session title", display)
        self.assertNotIn("The initial user prompt", display)

    def test_television_folder_and_session_previews_use_curated_title(self) -> None:
        now = time.time() - 3600
        path = self.write_transcript(
            "sessions/unfiled/curated-title.jsonl",
            "s1",
            "The initial user prompt",
            2,
            now,
        )
        summary.set_summary(
            "s1",
            {"title": "Curated preview title", "transcript_path": str(path)},
        )
        original_unfiled = tv.UNFILED_DIR
        original_folders = tv.FOLDERS_DIR
        tv.UNFILED_DIR = summary.UNFILED_DIR
        tv.FOLDERS_DIR = summary.FOLDERS_ROOT
        try:
            folder_output = io.StringIO()
            with contextlib.redirect_stdout(folder_output):
                tv.cmd_preview("folder:Unfiled")
            session_output = io.StringIO()
            with contextlib.redirect_stdout(session_output):
                tv.cmd_preview(f"session:{path}")
        finally:
            tv.UNFILED_DIR = original_unfiled
            tv.FOLDERS_DIR = original_folders

        self.assertIn("Curated preview title", folder_output.getvalue())
        self.assertNotIn("The initial user prompt", folder_output.getvalue())
        session_lines = session_output.getvalue().splitlines()
        self.assertIn("Curated preview title", session_lines[0])
        self.assertNotIn("The initial user prompt", session_lines[0])

    def test_backlog_scans_filed_and_unfiled_and_excludes_existing(self) -> None:
        now = time.time()
        economics = self.write_transcript(
            "folders/Economics/economics.jsonl", "economics-session", "Economics work", 3, now - 3 * 86400
        )
        unfiled = self.write_transcript(
            "sessions/unfiled/unfiled.jsonl", "unfiled-session", "Unfiled work", 2, now - 2 * 86400
        )
        filed = self.write_transcript(
            "folders/Music/already-logged.jsonl", "logged-session", "Already logged", 4, now - 2 * 86400
        )
        summary.set_summary("logged-session", {"summary": "Already summarized.", "transcript_path": str(filed)})

        report = summary.backlog_summaries(now=now, days=7, idle_hours=24, limit=10)
        by_id = {candidate["session_id"]: candidate for candidate in report["candidates"]}
        self.assertEqual(set(by_id), {"economics-session", "unfiled-session"})
        self.assertEqual(by_id["economics-session"]["workspace"], "Economics")
        self.assertEqual(by_id["unfiled-session"]["workspace"], "Unfiled")
        self.assertEqual(by_id["economics-session"]["message_count"], 3)

    def test_backlog_workspace_and_idle_filters(self) -> None:
        now = time.time()
        self.write_transcript(
            "folders/Economics/old.jsonl", "economics-session", "Economics work", 2, now - 3 * 86400
        )
        self.write_transcript(
            "folders/Music/recent.jsonl", "recent-session", "Recent work", 2, now - 2 * 3600
        )
        self.write_transcript(
            "folders/Music/active.jsonl", "active-session", "Active work", 2, now - 3 * 86400
        )

        report = summary.backlog_summaries(
            now=now,
            days=7,
            idle_hours=24,
            workspace="Economics",
            exclude_session_ids=["active-session"],
            limit=10,
        )
        self.assertEqual([candidate["session_id"] for candidate in report["candidates"]], ["economics-session"])

    def test_backlog_cli_excludes_active_session_environment(self) -> None:
        now = time.time()
        self.write_transcript(
            "sessions/unfiled/active.jsonl", "active-session", "Active work", 2, now - 3 * 86400
        )
        self.write_transcript(
            "folders/Economics/other.jsonl", "other-session", "Other work", 2, now - 3 * 86400
        )
        previous_session_id = os.environ.get("PI_SESSION_ID")
        os.environ["PI_SESSION_ID"] = "active-session"
        output = io.StringIO()
        try:
            with contextlib.redirect_stdout(output):
                piwork.cmd_summary([
                    "backlog", "--json", "--days", "7", "--idle-hours", "24", "--limit", "10"
                ])
        finally:
            if previous_session_id is None:
                os.environ.pop("PI_SESSION_ID", None)
            else:
                os.environ["PI_SESSION_ID"] = previous_session_id

        report = json.loads(output.getvalue())
        self.assertEqual([candidate["session_id"] for candidate in report["candidates"]], ["other-session"])

    def test_backlog_reports_limit_and_does_not_mutate_index(self) -> None:
        now = time.time()
        for index in range(3):
            self.write_transcript(
                f"sessions/unfiled/session-{index}.jsonl",
                f"session-{index}",
                f"Session {index}",
                2,
                now - (index + 2) * 86400,
            )
        summary.set_summary("existing", {"summary": "Keep this record."})
        index_path = Path(summary.SUMMARY_INDEX_PATH)
        before = index_path.read_bytes()

        report = summary.backlog_summaries(now=now, days=7, idle_hours=24, limit=2)
        self.assertEqual(report["total_matches"], 3)
        self.assertEqual(report["returned_count"], 2)
        self.assertTrue(report["truncated"])
        self.assertEqual(index_path.read_bytes(), before)

    def test_preview_uses_professional_summary_headings_and_spacing(self) -> None:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            tv.print_summary_sections({
                "status": "in_progress",
                "summary": "Overview text.",
                "what_changed": "Changed text.",
                "where_it_lives": "Location text.",
                "next_up": "Next text.",
            })
        rendered = output.getvalue()
        plain = re.sub(r"\x1b\[[0-9;]*m", "", rendered)
        for heading in ("[Status]", "[Summary]", "[Outcomes]", "[Artifacts]", "[Open Items]"):
            self.assertIn(heading, plain)
        self.assertIn("[Summary]\n  Overview text.\n\n[Outcomes]", plain)
        self.assertIn("[Artifacts]\n  Location text.\n\n[Open Items]", plain)
        self.assertNotIn("[Overview]", plain)
        self.assertNotIn("What changed:", plain)

    def test_legacy_records_and_valid_status_values(self) -> None:
        legacy = summary.set_summary("legacy", {"summary": "Legacy record."})
        self.assertNotIn("status", legacy)
        for index, status in enumerate(sorted(summary.SUMMARY_STATUS_VALUES)):
            record = summary.set_summary(f"status-{index}", {"status": status})
            self.assertEqual(record["status"], status)

    def test_invalid_status_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "status must be one of"):
            summary.set_summary("invalid-status", {"status": "done"})
        self.assertIsNone(summary.get_summary("invalid-status"))

    def test_status_and_professional_labels_are_searchable(self) -> None:
        summary.set_summary("blocked-session", {
            "status": "blocked",
            "what_changed": "Identified a blocked deployment step.",
        })
        result = summary.search_summaries("blocked")[0]
        self.assertEqual(result["session_id"], "blocked-session")

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            piwork._print_summary_record({
                "session_id": "blocked-session",
                "status": "blocked",
                "what_changed": "Deployment blocker.",
                "where_it_lives": "deploy.sh",
                "next_up": "Resolve credentials.",
            })
        rendered = output.getvalue()
        self.assertIn("Status: blocked", rendered)
        self.assertIn("Outcomes: Deployment blocker.", rendered)
        self.assertIn("Artifacts: deploy.sh", rendered)
        self.assertIn("Open Items: Resolve credentials.", rendered)

    def test_session_action_routing(self) -> None:
        session_path = Path(self.tempdir.name) / "session.jsonl"
        session_path.write_text(
            '{"type":"session","id":"s1","cwd":"/var/home/samuel"}\n',
            encoding="utf-8",
        )
        calls = []
        original_spawn = tv.spawn_terminal
        tv.spawn_terminal = lambda command, cwd=None: calls.append((command, cwd))
        try:
            for action, expected in (
                ("open", "pihat"),
                ("pi", "pi --session"),
                ("beta", "piwork resume-beta"),
                ("betahat", "piwork resume-betahat"),
            ):
                calls.clear()
                tv.cmd_action(action, f"session:{session_path}")
                self.assertEqual(len(calls), 1)
                self.assertIn(expected, calls[0][0])
        finally:
            tv.spawn_terminal = original_spawn

    def test_workspaces_keybindings_match_agent_mapping(self) -> None:
        config = (REPO_ROOT / "dot_config/television/cable/workspaces.toml").read_text(encoding="utf-8")
        for line in (
            'enter = "actions:open"',
            'ctrl-b = "actions:betahat"',
            'ctrl-l = "actions:pi"',
            'ctrl-h = "actions:beta"',
        ):
            self.assertIn(line, config)

    def test_nested_picker_routing(self) -> None:
        session_path = Path(self.tempdir.name) / "session.jsonl"
        session_path.write_text(
            '{"type":"session","id":"s1","cwd":"/var/home/samuel"}\n',
            encoding="utf-8",
        )
        target = f"session:{session_path}"
        home = "/var/home/samuel"
        expected = {
            None: "pihat --session",
            "ctrl-b": "piwork resume-betahat",
            "ctrl-l": "pi --session",
            "ctrl-h": "piwork resume-beta",
            "ctrl-m": "piwork stash",
        }
        for key, prefix in expected.items():
            command, _cwd = tv.resolve_picker_launch(target, key, home)
            self.assertIn(prefix, command)

        command, _cwd = tv.resolve_picker_launch("new:Economics", None, home)
        self.assertIn("pihat --session-dir", command)
        command, _cwd = tv.resolve_picker_launch("new:Economics", "ctrl-b", home)
        self.assertIn("--agent betahat", command)
        command, _cwd = tv.resolve_picker_launch("new:Economics", "ctrl-l", home)
        self.assertIn("--agent pi", command)
        command, _cwd = tv.resolve_picker_launch("new:Economics", "ctrl-h", home)
        self.assertIn("--agent beta", command)


if __name__ == "__main__":
    unittest.main(verbosity=2)
