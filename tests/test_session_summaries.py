#!/usr/bin/env python3
"""Regression tests for the permanent Pi session-summary index."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
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

    def test_preview_uses_distinct_summary_headings(self) -> None:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            tv.print_summary_sections({
                "summary": "Overview text.",
                "what_changed": "Changed text.",
                "where_it_lives": "Location text.",
                "next_up": "Next text.",
            })
        rendered = output.getvalue()
        for heading in ("[Overview]", "[What Changed]", "[Where It Lives]", "[Next Up]"):
            self.assertIn(heading, rendered)
        self.assertNotIn("What changed:", rendered)

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
