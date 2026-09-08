#!/usr/bin/env python3
"""Regression tests for scoped zotero-extract initialization."""

from __future__ import annotations

import importlib.util
from importlib.machinery import SourceFileLoader
import json
import os
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "dot_local" / "bin" / "executable_zotero-extract"


class ZoteroExtractTests(unittest.TestCase):
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

    def test_items_file_creates_frozen_explicit_scope(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            items_file = root / "items.json"
            run_dir = root / "run"
            items_file.write_text(json.dumps({"items": [
                {"key": "Z9Z9Z9Z9", "title": "Later", "itemType": "report"},
                {"key": "A1A1A1A1", "title": "Earlier", "itemType": "journalArticle"},
            ]}), encoding="utf-8")

            result = self.run_cli(
                "init", "--items-file", str(items_file),
                "--rule", "Extract all estimates.", "--outdir", str(run_dir),
            )

            self.assertIn("scope      : explicit items (2)", result.stdout)
            config = json.loads((run_dir / "config.json").read_text())
            manifest = json.loads((run_dir / "manifest.json").read_text())
            self.assertEqual(config["scope_type"], "items")
            self.assertEqual(manifest["manifest_version"], 2)
            self.assertEqual(config["inventory_source"], "explicit_items_file")
            self.assertEqual(config["scope_spec"]["item_keys"], [
                "A1A1A1A1", "Z9Z9Z9Z9",
            ])
            self.assertEqual(
                [item["item_key"] for item in manifest["items"]],
                ["A1A1A1A1", "Z9Z9Z9Z9"],
            )
            self.assertIsNone(config["collection_key"])

    def test_legacy_collection_snapshot_remains_readable(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            items_file = root / "items.json"
            run_dir = root / "run"
            items_file.write_text(json.dumps([
                {"key": "A1A1A1A1", "title": "Paper", "itemType": "report"},
            ]), encoding="utf-8")

            result = self.run_cli(
                "init", "--collection", "LEGACY01", "--name", "Legacy",
                "--items-file", str(items_file), "--rule", "Extract all.",
                "--outdir", str(run_dir),
            )

            self.assertIn("legacy collection-snapshot", result.stderr)
            config = json.loads((run_dir / "config.json").read_text())
            self.assertEqual(config["scope_type"], "collection")
            self.assertEqual(config["inventory_source"], "legacy_items_file")
            self.assertEqual(config["collection_key"], "LEGACY01")

    def test_explicit_inventory_rejects_duplicates_and_non_parent_items(self):
        cases = [
            ([{"key": "DUPL0001"}, {"key": "DUPL0001"}], "duplicate explicit item key"),
            ([{"key": "ATTACH01", "itemType": "attachment"}], "select its parent item"),
        ]
        for items, expected in cases:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as root:
                root = Path(root)
                items_file = root / "items.json"
                run_dir = root / "run"
                items_file.write_text(json.dumps(items), encoding="utf-8")
                result = self.run_cli(
                    "init", "--items-file", str(items_file), "--rule", "Extract all.",
                    "--outdir", str(run_dir), check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(expected, result.stderr)
                self.assertFalse(run_dir.exists() and any(run_dir.iterdir()))

    def test_direct_item_keys_resolve_metadata_without_collection(self):
        items = {
            "Z9Z9Z9Z9": {"key": "Z9Z9Z9Z9", "data": {
                "itemType": "report", "title": "Later", "date": "2021",
            }},
            "A1A1A1A1": {"key": "A1A1A1A1", "data": {
                "itemType": "journalArticle", "title": "Earlier", "date": "2020",
            }},
        }

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                key = self.path.split("/items/", 1)[1].split("?", 1)[0]
                body = json.dumps(items[key]).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with tempfile.TemporaryDirectory() as root:
                run_dir = Path(root) / "run"
                result = self.run_cli(
                    "init", "--items", "Z9Z9Z9Z9,A1A1A1A1", "--rule", "Extract all.",
                    "--outdir", str(run_dir), env={
                        "ZOTERO_LOCAL_API":
                        f"http://127.0.0.1:{server.server_port}/api/users/0",
                    },
                )
                self.assertIn("scope      : explicit items (2)", result.stdout)
                manifest = json.loads((run_dir / "manifest.json").read_text())
                self.assertEqual(
                    [item["item_key"] for item in manifest["items"]],
                    ["A1A1A1A1", "Z9Z9Z9Z9"],
                )
                self.assertEqual(manifest["items"][0]["title"], "Earlier")
        finally:
            server.shutdown()
            server.server_close()

    def test_old_collection_manifest_status_remains_compatible(self):
        with tempfile.TemporaryDirectory() as root:
            run_dir = Path(root) / "run"
            run_dir.mkdir()
            (run_dir / "config.json").write_text(json.dumps({
                "collection_key": "OLD00001",
                "collection_name": "Old collection",
                "inclusion_rule": "Extract all.",
            }), encoding="utf-8")
            (run_dir / "manifest.json").write_text(json.dumps({
                "manifest_version": 1,
                "collection_key": "OLD00001",
                "collection_name": "Old collection",
                "inclusion_rule": "Extract all.",
                "items": [{
                    "item_key": "A1A1A1A1", "title": "Paper", "state": "pending",
                }],
            }), encoding="utf-8")

            result = self.run_cli("status", str(run_dir))
            self.assertIn("scope      : collection Old collection (OLD00001)", result.stdout)


    def _load_spine_module(self):
        loader = SourceFileLoader("zotero_extract_spine", str(SCRIPT))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        assert spec is not None
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)
        return module

    def test_pdf_attachment_uri_forms_resolve_safely(self):
        module = self._load_spine_module()
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            storage = root / "storage"
            storage_pdf = storage / "STOR0001" / "stored.pdf"
            attachments_pdf = storage / "ATTA0001" / "attached.pdf"
            filename_pdf = storage / "NAME0001" / "from-filename.pdf"
            storage_pdf.parent.mkdir(parents=True)
            attachments_pdf.parent.mkdir(parents=True)
            filename_pdf.parent.mkdir(parents=True)
            storage_pdf.write_bytes(b"%PDF storage")
            attachments_pdf.write_bytes(b"%PDF attachments")
            filename_pdf.write_bytes(b"%PDF filename")
            absolute_pdf = root / "absolute.pdf"
            absolute_pdf.write_bytes(b"%PDF absolute")
            children = [
                {"key": "STOR0001", "data": {
                    "itemType": "attachment", "contentType": "application/pdf",
                    "path": "storage:stored.pdf",
                }},
                {"key": "ATTA0001", "data": {
                    "itemType": "attachment", "contentType": "application/pdf",
                    "path": "attachments:attached.pdf",
                }},
                # Imported-file API responses may provide filename without
                # data.path; the resolver must map it into the child directory.
                {"key": "NAME0001", "data": {
                    "itemType": "attachment", "contentType": "application/pdf",
                    "filename": "from-filename.pdf",
                }},
                {"key": "ABSO0001", "data": {
                    "itemType": "attachment", "contentType": "application/pdf",
                    "path": str(absolute_pdf),
                }},
            ]
            with patch.dict(os.environ, {"ZOTERO_STORAGE_DIR": str(storage)}), \
                    patch.object(module, "http_get_json", return_value=children):
                resolved = module.resolve_pdf_paths("PARENT01")
            self.assertEqual(resolved, [
                storage_pdf.resolve(), attachments_pdf.resolve(),
                filename_pdf.resolve(), absolute_pdf,
            ])

    def test_pdf_attachment_uri_traversal_and_malformed_paths_are_ignored(self):
        module = self._load_spine_module()
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            storage = root / "storage"
            storage.mkdir()
            # This file would be reached by an unsafe `../` join.
            (storage / "escape.pdf").write_bytes(b"%PDF outside attachment")
            children = [
                {"key": "BAD00001", "data": {
                    "itemType": "attachment", "contentType": "application/pdf",
                    "path": "storage:../escape.pdf",
                }},
                {"key": "BAD00002", "data": {
                    "itemType": "attachment", "contentType": "application/pdf",
                    "path": "attachments:/absolute.pdf",
                }},
                {"key": "BAD00003", "data": {
                    "itemType": "attachment", "contentType": "application/pdf",
                    "path": "storage:",
                }},
                {"key": "BAD00004", "data": {
                    "itemType": "attachment", "contentType": "application/pdf",
                    "path": "relative.pdf",
                }},
            ]
            with patch.dict(os.environ, {"ZOTERO_STORAGE_DIR": str(storage)}), \
                    patch.object(module, "http_get_json", return_value=children):
                resolved = module.resolve_pdf_paths("PARENT01")
            self.assertEqual(resolved, [])

    def _make_worker_run(self, root, text):
        key = "WORK0001"
        sidecars = root / "sidecars"
        sidecars.mkdir()
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

    def test_worker_result_materializes_exact_source_span(self):
        text = "Introduction\nThe sample contains $10 \\ %$ in 2020.\n"
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            key, run_dir, _ = self._make_worker_run(root, text)
            quote = "The sample contains $10 \\ %$ in 2020."
            start = text.index(quote)
            result_path = root / "worker-result.json"
            result_path.write_text(json.dumps({
                "records": [{
                    "kind": "estimate",
                    "span": {"start": start, "end": start + len(quote)},
                    "anchor": {"page": None, "section": "Introduction", "table": None},
                    "confidence": "high",
                    "ambiguous": False,
                    "note": "",
                }],
                "omission_pass": {"performed": True, "records_added": 1},
                "negative_result": {"examined_in_full": True,
                                    "qualifying_evidence": True},
            }), encoding="utf-8")

            checked = self.run_cli(
                "check-worker-result", str(run_dir), key, str(result_path),
            )
            self.assertTrue(json.loads(checked.stdout)["valid"])
            submitted = self.run_cli(
                "submit-worker-result", str(run_dir), key, str(result_path),
                "--worker", "test-worker",
            )
            self.assertIn("accepted WORK0001", submitted.stdout)

            packet = json.loads((run_dir / "packets" / f"{key}.json").read_text())
            self.assertEqual(packet["records"][0]["quote"], quote)
            self.assertNotIn("span", packet["records"][0])
            self.assertEqual(packet["worker"], "test-worker")
            raw = run_dir / "worker-results" / f"{key}.json"
            self.assertTrue(raw.is_file())
            manifest = json.loads((run_dir / "manifest.json").read_text())
            entry = manifest["items"][0]
            self.assertEqual(entry["state"], "processed")
            self.assertEqual(entry["worker_result"], str(raw))

    def test_worker_result_rejects_aliases_and_preserves_manifest(self):
        text = "Introduction\nThe sample contains a qualifying estimate in 2020.\n"
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            key, run_dir, _ = self._make_worker_run(root, text)
            result_path = root / "bad-worker-result.json"
            result_path.write_text(json.dumps({
                "packet_version": "1",
                "item_key": key,
                "source_route": "mineru_sidecar",
                "path": "/wrong/path",
                "sha256": "wrong",
                "records": [{
                    "type": "estimate",
                    "quote": "The sample contains a qualifying estimate in 2020.",
                    "anchor": "Introduction",
                }],
                "omission_pass": {"performed": True, "records_added": 1},
                "negative_result": {"examined_in_full": True,
                                    "qualifying_evidence": True},
            }), encoding="utf-8")
            manifest_path = run_dir / "manifest.json"
            before = manifest_path.read_text(encoding="utf-8")

            checked = self.run_cli(
                "check-worker-result", str(run_dir), key, str(result_path),
                check=False,
            )
            self.assertNotEqual(checked.returncode, 0)
            payload = json.loads(checked.stdout)
            self.assertFalse(payload["valid"])
            self.assertTrue(any("result keys invalid" in error
                                for error in payload["errors"]))
            self.assertEqual(manifest_path.read_text(encoding="utf-8"), before)
            self.assertFalse((run_dir / "packets" / f"{key}.json").exists())
            self.assertFalse((run_dir / "worker-results").exists())

    def test_worker_result_rejects_full_source_span_without_mutation(self):
        text = "Introduction\nThe sample contains a qualifying estimate in 2020.\n"
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            key, run_dir, _ = self._make_worker_run(root, text)
            result_path = root / "full-source-span.json"
            result_path.write_text(json.dumps({
                "records": [{
                    "kind": "estimate",
                    "span": {"start": 0, "end": len(text)},
                    "anchor": {"page": None, "section": "Introduction", "table": None},
                    "confidence": "high",
                    "ambiguous": False,
                    "note": "The source contains a qualifying estimate.",
                }],
                "omission_pass": {"performed": True, "records_added": 0},
                "negative_result": {"examined_in_full": True,
                                    "qualifying_evidence": True},
            }), encoding="utf-8")
            checked = self.run_cli(
                "check-worker-result", str(run_dir), key, str(result_path),
                check=False,
            )
            self.assertNotEqual(checked.returncode, 0)
            payload = json.loads(checked.stdout)
            self.assertFalse(payload["valid"])
            self.assertTrue(any("entire source" in error
                                for error in payload["errors"]))
            manifest = json.loads((run_dir / "manifest.json").read_text())
            self.assertEqual(manifest["items"][0]["state"], "pending")

    def test_worker_result_rejects_record_shape_and_types(self):
        text = "Introduction\nThe sample contains a qualifying estimate in 2020.\n"
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            key, run_dir, _ = self._make_worker_run(root, text)
            start = text.index("The sample")
            end = start + len("The sample contains a qualifying estimate in 2020.")
            base = {
                "kind": "estimate",
                "span": {"start": start, "end": end},
                "anchor": {"page": None, "section": "Introduction", "table": None},
                "confidence": "high",
                "ambiguous": False,
                "note": "",
            }
            cases = [
                ("invalid-kind", {**base, "kind": "not-a-kind"}, "kind must be one of"),
                ("list-span", {**base, "span": [start, end]}, "span must be an object"),
                ("string-anchor", {**base, "anchor": "Introduction"},
                 "anchor must be an object"),
                ("string-ambiguous", {**base, "ambiguous": "false"},
                 "ambiguous must be a boolean"),
            ]
            for name, record, expected in cases:
                with self.subTest(name=name):
                    result_path = root / f"{name}.json"
                    result_path.write_text(json.dumps({
                        "records": [record],
                        "omission_pass": {"performed": True, "records_added": 0},
                        "negative_result": {"examined_in_full": True,
                                            "qualifying_evidence": True},
                    }), encoding="utf-8")
                    checked = self.run_cli(
                        "check-worker-result", str(run_dir), key, str(result_path),
                        check=False,
                    )
                    self.assertNotEqual(checked.returncode, 0)
                    payload = json.loads(checked.stdout)
                    self.assertFalse(payload["valid"])
                    self.assertTrue(any(expected in error for error in payload["errors"]))

    def test_worker_result_rejects_out_of_bounds_span_without_mutation(self):
        text = "Introduction\nThe sample contains a qualifying estimate in 2020.\n"
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            key, run_dir, _ = self._make_worker_run(root, text)
            result_path = root / "bad-span.json"
            result_path.write_text(json.dumps({
                "records": [{
                    "kind": "estimate",
                    "span": {"start": 0, "end": len(text) + 1},
                    "anchor": {"page": None, "section": "Introduction", "table": None},
                    "confidence": "high",
                    "ambiguous": False,
                    "note": "",
                }],
                "omission_pass": {"performed": True, "records_added": 1},
                "negative_result": {"examined_in_full": True,
                                    "qualifying_evidence": True},
            }), encoding="utf-8")
            checked = self.run_cli(
                "check-worker-result", str(run_dir), key, str(result_path),
                check=False,
            )
            self.assertNotEqual(checked.returncode, 0)
            payload = json.loads(checked.stdout)
            self.assertFalse(payload["valid"])
            self.assertTrue(any("within source text" in error
                                for error in payload["errors"]))
            manifest = json.loads((run_dir / "manifest.json").read_text())
            self.assertEqual(manifest["items"][0]["state"], "pending")


if __name__ == "__main__":
    unittest.main()
