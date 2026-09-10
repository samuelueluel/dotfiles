"""Regression tests for the pinned session logger workflow."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from importlib.machinery import SourceFileLoader


REPO_ROOT = Path(__file__).resolve().parents[1]
if not (REPO_ROOT / "dot_local").is_dir():
    REPO_ROOT = REPO_ROOT / "dotfiles"
LIB_DIR = REPO_ROOT / "dot_local" / "lib"
BIN_PATH = REPO_ROOT / "dot_local" / "bin" / "executable_piwork"
sys.path.insert(0, str(LIB_DIR))


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


logger = load_module("pi_session_logger", LIB_DIR / "pi_session_logger.py")
summary = load_module("pi_session_summary", LIB_DIR / "pi_session_summary.py")
piwork_spec = importlib.util.spec_from_file_location(
    "piwork", BIN_PATH, loader=SourceFileLoader("piwork", str(BIN_PATH))
)
assert piwork_spec and piwork_spec.loader
piwork = importlib.util.module_from_spec(piwork_spec)
sys.modules["piwork"] = piwork
piwork_spec.loader.exec_module(piwork)


class SessionLoggerTests(unittest.TestCase):
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

    def write_transcript(self) -> Path:
        path = Path(self.tempdir.name) / "sessions" / "unfiled" / "session.jsonl"
        entries = [
            {"type": "session", "id": "logger-session", "cwd": "/tmp/project"},
            {"type": "message", "message": {"role": "user", "content": "Build the logger test."}},
            {"type": "message", "message": {"role": "assistant", "content": "Created test_logger.py."}},
        ]
        path.write_text("\n".join(json.dumps(entry) for entry in entries) + "\n", encoding="utf-8")
        return path

    def test_transcript_projection_removes_opaque_payloads_and_marks_excerpts(self) -> None:
        raw = "\n".join(
            [
                json.dumps({"type": "session", "id": "projection-session"}),
                json.dumps(
                    {
                        "type": "message",
                        "id": "user-1",
                        "message": {
                            "role": "user",
                            "content": [{
                                "type": "text",
                                "text": "Build the logger test. [[PI_SESSION_LOGGER_OMITTED original]]",
                            }],
                        },
                    }
                ),
                json.dumps(
                    {
                        "type": "message",
                        "id": "assistant-1",
                        "message": {
                            "role": "assistant",
                            "content": [
                                {
                                    "type": "thinking",
                                    "thinking": "\x1b[31mPlan the test\x1b[0m",
                                    "thinkingSignature": "opaque-signature",
                                },
                                {"type": "text", "text": "Created test_logger.py."},
                                {
                                    "type": "toolCall",
                                    "id": "call-1",
                                    "name": "read",
                                    "arguments": {"path": "test_logger.py"},
                                },
                            ],
                        },
                    }
                ),
                json.dumps(
                    {
                        "type": "message",
                        "id": "tool-1",
                        "message": {
                            "role": "toolResult",
                            "toolCallId": "call-1",
                            "toolName": "read",
                            "content": [{"type": "text", "text": "x" * 6000}],
                            "details": {"opaque": "do not send"},
                        },
                    }
                ),
            ]
        ) + "\n"

        projected = logger.prepare_transcript(raw)

        self.assertIn("Build the logger test.", projected)
        self.assertIn("Created test_logger.py.", projected)
        self.assertIn("[[PI_SESSION_LOGGER_ESCAPED_OMITTED original]]", projected)
        self.assertNotIn("[[PI_SESSION_LOGGER_OMITTED original]]", projected)
        self.assertIn("LOGGER_OMITTED", projected)
        self.assertIn('"id":"call-1"', projected)
        self.assertIn('"toolCallId":"call-1"', projected)
        self.assertLess(projected.index('"id":"assistant-1"'), projected.index('"id":"tool-1"'))
        self.assertNotIn("opaque-signature", projected)
        self.assertNotIn("do not send", projected)
        self.assertNotIn("\x1b[31m", projected)
        self.assertLess(len(projected), len(raw))

    def test_transcript_projection_bounds_unicode_and_rejects_oversized_conversation(self) -> None:
        tool_result = "🧪" * 5_000_000
        tool_raw = "\n".join(
            [
                json.dumps({"type": "session", "id": "large-tool-session"}),
                json.dumps(
                    {
                        "type": "message",
                        "message": {
                            "role": "toolResult",
                            "toolCallId": "call-large",
                            "content": [{"type": "text", "text": tool_result}],
                        },
                    }
                ),
            ]
        ) + "\n"
        projected = logger.prepare_transcript(tool_raw)
        self.assertLessEqual(len(projected), logger.LOGGER_MAX_TRANSCRIPT_CHARS)
        self.assertIn("LOGGER_OMITTED", projected)

        oversized_user = json.dumps(
            {
                "type": "message",
                "message": {
                    "role": "user",
                    "content": [{"type": "text", "text": "u" * (logger.LOGGER_MAX_TRANSCRIPT_CHARS + 1)}],
                },
            }
        )
        with self.assertRaisesRegex(ValueError, "remains too large"):
            logger.prepare_transcript(oversized_user)

    def test_transcript_projection_rejects_malformed_jsonl(self) -> None:
        with self.assertRaisesRegex(ValueError, "line 2"):
            logger.prepare_transcript('{"type":"session"}\nnot-json\n')

    def test_model_and_thinking_are_pinned_and_draft_is_validated(self) -> None:
        path = self.write_transcript()
        seen = {}
        flushed = []

        def fake_runner(command, **kwargs):
            seen["command"] = command
            seen["input"] = kwargs["input"]
            return CompletedProcess(command, 0, '{"title":"Logger test","summary":"Created the test.","outcomes":"Added the test.","artifacts":"test_logger.py","open_items":"","keywords":["logger","test"]}', "")

        draft = logger.run_logger(str(path), runner=fake_runner, pi_path="/bin/pi", flusher=flushed.append)
        self.assertEqual(draft["title"], "Logger test")
        self.assertEqual(draft["outcomes"], "Added the test.")
        self.assertEqual(draft["keywords"], ["logger", "test"])
        self.assertEqual(flushed, [str(path.resolve())])
        self.assertIn("openai-codex/gpt-5.6-luna", seen["command"])
        self.assertIn("high", seen["command"])
        self.assertIn("Build the logger test.", seen["input"])
        self.assertIn("--no-tools", seen["command"])
        self.assertIn("--no-session", seen["command"])
        self.assertIn(logger._SYSTEM_PROMPT, seen["command"])
        self.assertIn(logger._user_prompt(), seen["command"])
        self.assertEqual(
            seen["input"],
            logger.prepare_transcript(path.read_text(encoding="utf-8")),
        )
        self.assertLessEqual(len(seen["input"]), logger.LOGGER_MAX_TRANSCRIPT_CHARS)

        logger.run_logger(
            str(path),
            existing_summary={"summary": "Prior summary", "what_changed": "Prior outcome"},
            thinking="max",
            runner=fake_runner,
            pi_path="/bin/pi",
            flusher=lambda _path: None,
        )
        self.assertIn("max", seen["command"])
        self.assertIn("Prior summary", seen["command"][-1])

    def test_logger_failure_writes_nothing(self) -> None:
        path = self.write_transcript()

        def failing_runner(command, **kwargs):
            return CompletedProcess(command, 1, "", "provider unavailable")

        with self.assertRaisesRegex(RuntimeError, "no summary was written"):
            logger.run_logger(str(path), runner=failing_runner, pi_path="/bin/pi")
        self.assertFalse(Path(summary.SUMMARY_INDEX_PATH).exists())

    def test_piwork_log_persists_only_validated_logger_output(self) -> None:
        path = self.write_transcript()
        summary.set_summary("logger-session", {"summary": "Prior summary", "what_changed": "Prior outcome"})
        original = piwork.run_logger
        seen = {}

        def fake_logger(transcript_path, **kwargs):
            seen.update(kwargs)
            return {
                "title": "Dedicated logger session",
                "summary": "Created the logger test.",
                "outcomes": "Added a dedicated logger path.",
                "artifacts": "test_session_logger.py",
                "open_items": "",
                "keywords": ["logger", "session-log"],
            }

        piwork.run_logger = fake_logger
        output = io.StringIO()
        try:
            with contextlib.redirect_stdout(output):
                piwork.cmd_summary(["log", "logger-session", "--transcript-path", str(path), "--json"])
        finally:
            piwork.run_logger = original

        record = json.loads(output.getvalue())
        self.assertEqual(record["title"], "Dedicated logger session")
        self.assertNotIn("status", record)
        self.assertEqual(seen["existing_summary"]["summary"], "Prior summary")
        stored = summary.get_summary("logger-session")
        self.assertEqual(stored["summary"], "Created the logger test.")
        self.assertEqual(stored["what_changed"], "Added a dedicated logger path.")
        self.assertEqual(stored["where_it_lives"], "test_session_logger.py")
        self.assertEqual(stored["next_up"], "")
        self.assertEqual(stored["transcript_path"], str(path.resolve()))

    def test_parent_fallback_requires_explicit_approval_and_persists_all_fields(self) -> None:
        path = self.write_transcript()
        payload = json.dumps({
            "title": "Approved fallback",
            "summary": "Used an explicitly approved parent draft.",
            "outcomes": "Stored every canonical logger field.",
            "artifacts": "test_session_logger.py",
            "open_items": "None",
            "keywords": ["fallback"],
        })
        with self.assertRaisesRegex(ValueError, "requires --parent-fallback-approved"):
            piwork.cmd_summary(["log", "logger-session", "--transcript-path", str(path), "--fallback-json", payload])
        self.assertFalse(Path(summary.SUMMARY_INDEX_PATH).exists())

        piwork.cmd_summary([
            "log", "logger-session", "--transcript-path", str(path),
            "--fallback-json", payload, "--parent-fallback-approved", "--json",
        ])
        stored = summary.get_summary("logger-session")
        self.assertEqual(stored["what_changed"], "Stored every canonical logger field.")
        self.assertEqual(stored["where_it_lives"], "test_session_logger.py")
        self.assertEqual(stored["next_up"], "None")


if __name__ == "__main__":
    unittest.main(verbosity=2)
