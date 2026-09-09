#!/usr/bin/env python3
"""Lifecycle regression tests: mark-pending return, init pre-stat,
late-sidecar adoption, and empty-sidecar fallback.

Staging copy: intended final home is
~/dotfiles/tests/test_zotero_extract_lifecycle.py with SCRIPT resolved
repo-relative (see REPO_ROOT below). For staging runs, set
ZOTERO_EXTRACT_SCRIPT explicitly.
"""

from __future__ import annotations

import importlib.util
from importlib.machinery import SourceFileLoader
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCRIPT = REPO_ROOT / "dot_local" / "bin" / "executable_zotero-extract"
SCRIPT = Path(os.environ.get(
    "ZOTERO_EXTRACT_SCRIPT",
    str(DEFAULT_SCRIPT) if DEFAULT_SCRIPT.is_file() else
    "/var/home/samuel/dotfiles/dot_local/bin/executable_zotero-extract",
))


class ZoteroExtractLifecycleTests(unittest.TestCase):
    def run_cli(self, *args, env=None, check=True):
        merged_env = os.environ.copy()
        merged_env["ZOTERO_MINERU_SIDECAR_DIR"] = "/tmp/no-such-zotero-sidecars"
        if env:
            merged_env.update(env)
        return subprocess.run(
            ["python3", str(SCRIPT), *args],
            text=True,
            capture_output=True,
            env=merged_env,
            check=check,
        )

    def _make_worker_run(self, root, text, key="WORK0001"):
        sidecars = root / "sidecars"
        sidecars.mkdir(exist_ok=True)
        (sidecars / f"{key}.md").write_text(text, encoding="utf-8")
        items_file = root / "items.json"
        items_file.write_text(json.dumps([{
            "key": key, "title": "Worker fixture", "itemType": "journalArticle",
        }]), encoding="utf-8")
        run_dir = root / "run"
        self.run_cli(
            "init", "--items-file", str(items_file),
            "--rule", "Extract every estimate.", "--outdir", str(run_dir),
            env={"ZOTERO_MINERU_SIDECAR_DIR": str(sidecars)},
        )
        return key, run_dir, sidecars

    def _load_spine_module(self):
        loader = SourceFileLoader("zotero_extract_spine", str(SCRIPT))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        assert spec is not None
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)
        return module

    def test_mark_excluded_then_return_to_pending(self):
        text = "Introduction\nNothing qualifying here.\n"
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            key, run_dir, _ = self._make_worker_run(root, text)
            marked = self.run_cli("mark", str(run_dir), key, "excluded",
                                  "--reason", "out_of_scope_per_rule")
            self.assertIn(f"marked {key}: excluded", marked.stdout)
            status = self.run_cli("status", str(run_dir))
            self.assertIn("excluded 1", status.stdout)
            returned = self.run_cli("mark", str(run_dir), key, "pending",
                                    "--reason", "rule clarified; retry")
            self.assertIn(f"returned {key} to pending", returned.stdout)
            manifest = json.loads((run_dir / "manifest.json").read_text())
            entry = manifest["items"][0]
            self.assertEqual(entry["state"], "pending")
            self.assertEqual(entry["reason"], "rule clarified; retry")

    def test_mark_pending_refused_from_processed(self):
        text = "Introduction\nNothing qualifying here at all.\n"
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            key, run_dir, _ = self._make_worker_run(root, text)
            result_path = root / "negative.json"
            result_path.write_text(json.dumps({
                "records": [],
                "omission_pass": {"performed": True, "records_added": 0},
                "negative_result": {"examined_in_full": True,
                                    "qualifying_evidence": False},
            }), encoding="utf-8")
            submitted = self.run_cli(
                "submit-worker-result", str(run_dir), key, str(result_path))
            self.assertIn(f"accepted {key}", submitted.stdout)
            for state in ("pending", "excluded"):
                with self.subTest(state=state):
                    refused = self.run_cli(
                        "mark", str(run_dir), key, state,
                        "--reason", "audit probe", check=False)
                    self.assertNotEqual(refused.returncode, 0)
                    self.assertIn("already processed", refused.stderr)
            manifest = json.loads((run_dir / "manifest.json").read_text())
            self.assertEqual(manifest["items"][0]["state"], "processed")

    def test_init_escalates_oversized_sidecar_immediately(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            key = "BIG00001"
            sidecars = root / "sidecars"
            sidecars.mkdir()
            (sidecars / f"{key}.md").write_text(
                "Introduction\n" + "x" * 200 + "\n", encoding="utf-8")
            items_file = root / "items.json"
            items_file.write_text(json.dumps([{
                "key": key, "title": "Oversized fixture",
                "itemType": "journalArticle",
            }]), encoding="utf-8")
            run_dir = root / "run"
            self.run_cli(
                "init", "--items-file", str(items_file),
                "--rule", "Extract every estimate.", "--outdir", str(run_dir),
                env={"ZOTERO_MINERU_SIDECAR_DIR": str(sidecars),
                     "ZOTERO_EXTRACT_MAX_SOURCE_CHARS": "64"},
            )
            manifest = json.loads((run_dir / "manifest.json").read_text())
            entry = manifest["items"][0]
            self.assertEqual(entry["state"], "escalated")
            self.assertIn("oversized_source", entry["reason"])
            status = self.run_cli("status", str(run_dir))
            self.assertIn("escalated 1", status.stdout)
            self.assertIn("run is COMPLETE", status.stdout)

    def test_source_adopts_sidecar_built_after_init(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            key = "LATE0001"
            sidecars = root / "sidecars"
            sidecars.mkdir()
            items_file = root / "items.json"
            items_file.write_text(json.dumps([{
                "key": key, "title": "Late sidecar fixture",
                "itemType": "journalArticle",
            }]), encoding="utf-8")
            run_dir = root / "run"
            env = {"ZOTERO_MINERU_SIDECAR_DIR": str(sidecars)}
            self.run_cli(
                "init", "--items-file", str(items_file),
                "--rule", "Extract every estimate.", "--outdir", str(run_dir),
                env=env,
            )
            manifest = json.loads((run_dir / "manifest.json").read_text())
            self.assertIsNone(manifest["items"][0]["extraction_route"])
            text = "Introduction\nThe sample contains a late estimate.\n"
            (sidecars / f"{key}.md").write_text(text, encoding="utf-8")
            sourced = self.run_cli("source", str(run_dir), key, env=env)
            self.assertIn("upgraded to mineru_sidecar", sourced.stderr)
            payload = json.loads(sourced.stdout)
            self.assertEqual(payload["extraction_route"], "mineru_sidecar")
            manifest = json.loads((run_dir / "manifest.json").read_text())
            self.assertEqual(
                manifest["items"][0]["extraction_route"], "mineru_sidecar")

    def test_source_falls_back_when_sidecar_empty(self):
        module = self._load_spine_module()
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            key = "EMPTY001"
            sidecar = root / f"{key}.md"
            sidecar.write_text("   \n  \n", encoding="utf-8")
            run_dir = root / "run"
            run_dir.mkdir()
            (run_dir / "config.json").write_text(json.dumps({
                "inclusion_rule": "Extract every estimate.",
            }), encoding="utf-8")
            (run_dir / "manifest.json").write_text(json.dumps({
                "manifest_version": 2,
                "inclusion_rule": "Extract every estimate.",
                "items": [{
                    "item_key": key, "title": "Empty sidecar", "state": "pending",
                    "extraction_route": "mineru_sidecar", "route_fidelity": "high",
                    "source_path": str(sidecar), "source_sha256": None,
                }],
            }), encoding="utf-8")
            with patch.dict(os.environ,
                            {"ZOTERO_MINERU_SIDECAR_DIR": str(root)}), \
                    patch.object(module, "resolve_pdf_paths", return_value=[]):
                with self.assertRaises(SystemExit):
                    module.cmd_source(str(run_dir), key)
            manifest = json.loads((run_dir / "manifest.json").read_text())
            entry = manifest["items"][0]
            self.assertEqual(entry["state"], "unreadable")
            self.assertTrue(entry["reason"].startswith("no_pdf"))


    def test_split_sidecar_roundtrip_exact(self):
        text = ("# Title\n\nIntro paragraph.\n\n## Methods\n\n" + "m " * 60 + "\n\n" +
                "## Results\n\n" + "r " * 60 + "\n\n### Details\n\n" + "d " * 60 + "\n")
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            sidecar = root / "BIG.md"
            sidecar.write_text(text, encoding="utf-8")
            outdir = root / "parts"
            split = self.run_cli("split-sidecar", str(sidecar),
                                 "--out", str(outdir), "--max-chars", "200")
            self.assertIn("into", split.stderr)
            parts = sorted(outdir.glob("part_*.md"))
            self.assertGreater(len(parts), 1)
            cat = "".join(p.read_text(encoding="utf-8") for p in parts)
            self.assertEqual(cat, text)
            for p in parts:
                self.assertLessEqual(len(p.read_text(encoding="utf-8")), 200)

    def test_split_sidecar_refuses_atomic_oversize(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            sidecar = root / "ATOM.md"
            sidecar.write_text("# T\n" + "z" * 500 + "\n", encoding="utf-8")
            refused = self.run_cli("split-sidecar", str(sidecar),
                                   "--out", str(root / "parts"),
                                   "--max-chars", "100", check=False)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("atomic paragraph", refused.stderr)


if __name__ == "__main__":
    unittest.main()
