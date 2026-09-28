#!/usr/bin/env python3
"""Tests for UUID-scoped working-state discovery in pi_session_logger.

Run directly: python3 ~/.local/lib/test_pi_session_logger_working_state.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pi_session_logger as psl  # noqa: E402

FAILURES: list[str] = []
SESSION_ID = "9cf838cb-bffb-4148-9e83-71cd75b232f4"
OTHER_ID = "8d7a2c5b-6f49-4d0d-84b6-14baa5a979ce"


def check(name: str, fn) -> None:
    for state_file in psl._WORKING_STATE_DIRECTORY.glob("*.md"):
        state_file.unlink()
    try:
        fn()
        print(f"ok  {name}")
    except Exception as exc:  # noqa: BLE001
        FAILURES.append(name)
        print(f"FAIL {name}: {exc}")


def write_state(text: str, session_id: str = SESSION_ID) -> str:
    path = psl._WORKING_STATE_DIRECTORY / f"{session_id}.md"
    path.write_text(text, encoding="utf-8")
    return str(path)


def make_transcript(cwd: str, session_id: str = SESSION_ID) -> str:
    return (
        json.dumps({"type": "session", "id": session_id, "cwd": cwd}) + "\n"
        + json.dumps({"type": "message", "message": {"role": "user", "content": "hi"}}) + "\n"
    )


def test_session_id_extracted() -> None:
    assert psl._session_id(make_transcript("/tmp/project")) == SESSION_ID
    assert psl._session_id(make_transcript("/tmp/project", "../escape")) == ""
    assert psl._session_id('{"type": "message", "message": {"role": "user"}}\n') == ""
    assert psl._session_id("not json at all\n") == ""


def test_autodetect_finds_only_own_state_file() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        legacy = Path(tmp) / "SESSION-STATE.md"
        legacy.write_text("wrong legacy window", encoding="utf-8")
        path = write_state("# SESSION-STATE\n\n- [ok] coef 0.12\n")
        entry = psl.read_working_state(SESSION_ID)
        assert entry is not None
        assert entry["type"] == "working_state"
        assert entry["source"] == path
        assert entry["truncated"] is False
        assert "[ok] coef 0.12" in entry["content"]
        assert "T" in entry["mtime"]
        assert psl.read_working_state(OTHER_ID) is None
        assert psl.read_working_state("../escape") is None


def test_autodetect_silent_when_absent_or_empty() -> None:
    assert psl.read_working_state(SESSION_ID) is None
    write_state("   \n")
    assert psl.read_working_state(SESSION_ID) is None
    assert psl.read_working_state("") is None


def test_explicit_override_missing_raises() -> None:
    try:
        psl.read_working_state("", "/nonexistent/STATE.md")
    except FileNotFoundError:
        pass
    else:
        raise AssertionError("missing explicit override must raise FileNotFoundError")


def test_oversized_state_file_is_capped() -> None:
    write_state("x" * (psl._WORKING_STATE_MAX_CHARS + 500))
    entry = psl.read_working_state(SESSION_ID)
    assert entry is not None
    assert entry["truncated"] is True
    assert len(entry["content"]) == psl._WORKING_STATE_MAX_CHARS


def _stub_runner_expected_payload(payload_marker: str):
    def runner(command, input=None, **kwargs):  # noqa: A002
        draft = {
            "title": "t", "summary": "s", "outcomes": "o", "artifacts": "a",
            "open_items": "", "keywords": [],
        }
        return subprocess.CompletedProcess(
            command, 0, stdout=json.dumps(draft), stderr=""
        ) if payload_marker in input else subprocess.CompletedProcess(
            command, 1, stdout="", stderr="payload missing " + payload_marker
        )

    return runner


def test_run_logger_appends_only_matching_state_entry() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        write_state("# SESSION-STATE\n\n## Outcome ledger\n- [ok] n=4,182\n")
        write_state("other window", OTHER_ID)
        transcript = os.path.join(tmp, "session.jsonl")
        Path(transcript).write_text(make_transcript(tmp), encoding="utf-8")
        draft = psl.run_logger(
            transcript,
            runner=_stub_runner_expected_payload("n=4,182"),
            flusher=lambda _p: None,
        )
        assert draft["title"] == "t"


def test_run_logger_without_state_file_stays_transcript_only() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, "SESSION-STATE.md").write_text("other window", encoding="utf-8")
        write_state("also other window", OTHER_ID)
        transcript = os.path.join(tmp, "session.jsonl")
        Path(transcript).write_text(make_transcript(tmp), encoding="utf-8")
        captured: dict[str, str] = {}

        def runner(command, input=None, **kwargs):  # noqa: A002
            captured["input"] = input
            draft = {
                "title": "t", "summary": "s", "outcomes": "o", "artifacts": "a",
                "open_items": "", "keywords": [],
            }
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(draft), stderr="")

        psl.run_logger(transcript, runner=runner, flusher=lambda _p: None)
        assert "working_state" not in captured["input"]
        assert "other window" not in captured["input"]


def test_explicit_override_reaches_payload() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        state = Path(tmp, "SESSION-STATE.md")
        state.write_text("# SESSION-STATE\nexplicit\n", encoding="utf-8")
        transcript = os.path.join(tmp, "session.jsonl")
        Path(transcript).write_text(make_transcript(tmp), encoding="utf-8")
        draft = psl.run_logger(
            transcript, state_file=str(state),
            runner=_stub_runner_expected_payload("explicit"),
            flusher=lambda _p: None,
        )
        assert draft["title"] == "t"


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as state_dir:
        psl._WORKING_STATE_DIRECTORY = Path(state_dir)
        check("session id extracted", test_session_id_extracted)
        check("autodetect finds only own state file", test_autodetect_finds_only_own_state_file)
        check("autodetect silent when absent or empty", test_autodetect_silent_when_absent_or_empty)
        check("explicit override missing raises", test_explicit_override_missing_raises)
        check("oversized state file is capped", test_oversized_state_file_is_capped)
        check("run logger appends only matching working state", test_run_logger_appends_only_matching_state_entry)
        check("run logger without matching state stays transcript only", test_run_logger_without_state_file_stays_transcript_only)
        check("explicit override reaches payload", test_explicit_override_reaches_payload)
    if FAILURES:
        print(f"\n{len(FAILURES)} failing: {', '.join(FAILURES)}")
        sys.exit(1)
    print("\nall green")
