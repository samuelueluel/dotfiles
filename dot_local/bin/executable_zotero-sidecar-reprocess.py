#!/usr/bin/env python3
"""Unattended, resumable MinerU sidecar regeneration + exact-item re-embedding.

Preview: zotero-sidecar-reprocess.py --existing-sidecars
Run (requires separate approval for live changes):
  zotero-sidecar-reprocess.py --existing-sidecars --run-dir PATH \
    --execute --confirm-live-reembed REEMBED
Resume the same frozen scope by repeating the run command with --resume.

An item is parsed and checked in a private staging directory. Failed parses,
enrichment, or quality checks cannot replace a live sidecar or touch the index.
A successful staged item is published with backups of its former sidecar/report,
then indexed through an exact-key update. Indexing failures are recorded and
retried on resume; they are NEVER counted as successes. Do not run a global reset.
"""
from __future__ import annotations

import argparse
from collections import Counter
import fcntl
import hashlib
import inspect
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from typing import Any
from urllib.parse import urlsplit
from urllib.request import urlopen

from zotero_mcp import mineru, sidecar_quality as quality
from zotero_mcp.local_db import LocalZoteroReader

HOME = Path.home()
CONFIG = HOME / ".config/zotero-mcp/config.json"
INDEX_CLI = HOME / ".local/share/uv/tools/zotero-mcp-server/bin/zotero-mcp-server"
ENRICH_CLI = HOME / ".local/bin/zotero-vlm-enrich.py"
PIPELINE_VLM_URL = "http://127.0.0.1:18084/v1/chat/completions"
KEY_RE = re.compile(r"^[A-Z0-9]{8}$")
IMAGE_RE = re.compile(r"!\[[^\]]*\]\(images/[^)]+\)")
TABLE_HTML_RE = re.compile(r"<table\b[^>]*>.*?</table\s*>", re.I | re.S)
# Three page-verified table edits in the existing VNG5RAE7 sidecar. The raw
# source, corrected sidecar, and PDF were reviewed before this runner existed.
# Transfer these exact edits only if the source PDF and both table versions
# match; any change blocks publishing rather than losing an approved fix.
REVIEWED_TABLE_EDITS = {
    "VNG5RAE7": {
        "pdf_sha256": "04710bbebf531709191082fa89298f7d535d71136bb39055ad05925c0c6b68fe",
        "raw_to_corrected": {
            "43bcdb1749d038e30ff3963fa148d116b47a748f06a71e2f1a2383bfa382a86a": "186df9406c9010e4c108824a20b22c56a702ce128bfd4448aac65f39c25d211b",
            "29a5c1481f43a184e9e9a1235adfdb0f11a5c884c943e1a51d4c46193edd2843": "a904e6b228051374930e657ff862e98a922c973a7e183dd3f2568529749cc160",
            "d3aad4a12ea55708c048fcd47677097c5c25d2668d02c7e23813ddd35b266d9b": "c2949ea71749593eac99cd9b021ca51f6a506fe0e3ee2d6709c6513ff7e4fc00",
        },
    },
}


def process_start_ticks(pid: int) -> int:
    """Linux PID birth time; lets the scoped watchdog refuse PID reuse."""
    return int(Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19])


def save_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(value, out, ensure_ascii=False, indent=2, sort_keys=True)
            out.write("\n")
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def copy_atomic(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as out, source.open("rb") as inp:
            shutil.copyfileobj(inp, out)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, target)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def stage_config(cfg: dict[str, Any], stage_home: Path) -> dict[str, Any]:
    return {**cfg,
            "sidecar_dir": str(stage_home / ".config/zotero-mcp/mineru-sidecars"),
            "work_dir": str(stage_home / ".cache/zotero-mcp/mineru-work")}


def select_pdf(reader: Any, key: str, attachment_key: str | None = None) -> tuple[str, Path]:
    # An ambiguous PDF must be explicitly pinned in the frozen scope; do not
    # guess from filename or borrow an attachment from another parent.
    return quality._choose_pdf(reader, key, attachment_key)


def _table_digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def transfer_reviewed_tables(
    key: str, pdf: Path, live_cfg: dict[str, Any], stage_home: Path, staged_sidecar: Path,
) -> None:
    """Carry forward only exact previously approved PDF-bound corrections."""
    protection = REVIEWED_TABLE_EDITS.get(key)
    if protection is None:
        return
    live_sidecar = mineru.sidecar_path(live_cfg, key)
    old_report_path = quality.quality_report_path(live_cfg, key)
    if not live_sidecar.is_file() or not old_report_path.is_file():
        raise RuntimeError(f"{key} approved edits lack their old sidecar/report; refusing to publish")
    old_report = json.loads(old_report_path.read_text(encoding="utf-8"))
    if (
        old_report.get("item_key") != key
        or old_report.get("status") not in ("eligible", "review_required")
        or old_report.get("sidecar_sha256") != quality.sha256_file(live_sidecar)
        or old_report.get("pdf_sha256") != protection["pdf_sha256"]
        or quality.sha256_file(pdf) != protection["pdf_sha256"]
    ):
        raise RuntimeError(f"{key} approved edit source/report/PDF changed; refusing to publish")
    old_text = live_sidecar.read_text(encoding="utf-8")
    old_tables = [_table_digest(m.group()) for m in TABLE_HTML_RE.finditer(old_text)]
    mapping: dict[str, str] = protection["raw_to_corrected"]
    approved_tables: dict[str, str] = {}
    for corrected in mapping.values():
        if old_tables.count(corrected) != 1:
            raise RuntimeError(f"{key} approved table is missing or duplicated in the live sidecar")
        approved_tables[corrected] = next(
            m.group() for m in TABLE_HTML_RE.finditer(old_text) if _table_digest(m.group()) == corrected
        )
    text = staged_sidecar.read_text(encoding="utf-8")
    matches = list(TABLE_HTML_RE.finditer(text))
    present = [_table_digest(m.group()) for m in matches]
    replacements: list[tuple[int, int, str]] = []
    reused = 0
    for raw_hash, corrected_hash in mapping.items():
        raw_matches = [m for m, digest in zip(matches, present) if digest == raw_hash]
        already = present.count(corrected_hash)
        if len(raw_matches) + already != 1:
            raise RuntimeError(f"{key} fresh table differs from its approved original; old sidecar retained")
        if raw_matches:
            m = raw_matches[0]
            replacements.append((m.start(), m.end(), approved_tables[corrected_hash]))
        else:
            reused += 1
    for start, end, corrected_html in sorted(replacements, reverse=True):
        text = text[:start] + corrected_html + text[end:]
    if replacements:
        staged_sidecar.write_text(text, encoding="utf-8")
    save_json(stage_home / "approved-table-transfer.json", {
        "item_key": key, "pdf_sha256": protection["pdf_sha256"],
        "source_sidecar_sha256": old_report["sidecar_sha256"],
        "raw_to_corrected": mapping, "transferred": len(replacements), "already_correct": reused,
    })


def prepare_item(
    key: str, reader: Any, live_cfg: dict[str, Any], stage_home: Path,
    *, enrich: bool = True, attachment_key: str | None = None,
) -> dict[str, Any]:
    """Build a checked candidate without changing the live sidecar or index."""
    cfg = stage_config(live_cfg, stage_home)
    attachment, pdf = select_pdf(reader, key, attachment_key)
    if not mineru.run_mineru(cfg, pdf, key, attachment_key=attachment):
        raise RuntimeError("MinerU parse failed; see the retained staged run log")
    staged_sidecar = mineru.sidecar_path(cfg, key)
    if not staged_sidecar.is_file() or not staged_sidecar.stat().st_size:
        raise RuntimeError("MinerU did not produce a nonempty sidecar")
    transfer_reviewed_tables(key, pdf, live_cfg, stage_home, staged_sidecar)
    if enrich and IMAGE_RE.search(staged_sidecar.read_text(encoding="utf-8")):
        local_vlm_ready()
        # The existing VLM script resolves paths relative to HOME. Keep it
        # entirely within the staged sidecar/work tree.
        # Pin the same endpoint for preflight and the staged child. The
        # standalone enrich CLI retains its separate shared-serve-vlm default.
        env = dict(os.environ, HOME=str(stage_home), ZOTERO_VLM_URL=pipeline_vlm_url())
        log = stage_home / "enrichment.log"
        with log.open("w", encoding="utf-8") as out:
            proc = subprocess.run(
                [sys.executable, str(ENRICH_CLI), "--key", key],
                env=env, stdout=out, stderr=subprocess.STDOUT,
                timeout=60 * 60,
            )
        if proc.returncode:
            # If the service died mid-image, stop the entire batch. Otherwise
            # this is an item-level enrichment error to record and continue.
            local_vlm_ready()
            raise RuntimeError(f"figure enrichment failed (exit {proc.returncode}); see {log}")
    report = quality.build_quality_report(key, cfg, reader, attachment_key=attachment)
    quality.write_quality_report(report, cfg)
    if report["status"] != "eligible":
        codes = sorted({f["code"] for f in report["findings"] if f["severity"] == "critical"})
        raise RuntimeError(f"automated quality check {report['status']}: {', '.join(codes)}")
    quality.verify_current_report(key, cfg, reader)
    return report


def relocate_run(key: str, stage_home: Path, live_cfg: dict[str, Any]) -> Path:
    """Preserve all staged raw files and rewrite only the copied manifest's paths."""
    cfg = stage_config(live_cfg, stage_home)
    work = Path(cfg["work_dir"]) / key / "runs"
    runs = list(work.glob("*/manifest.json"))
    if len(runs) != 1:
        raise RuntimeError(f"expected one staged run manifest, found {len(runs)}")
    old_run = runs[0].parent
    new_run = Path(live_cfg["work_dir"]) / key / "runs" / old_run.name
    if new_run.exists():
        raise RuntimeError(f"run ID collision; refusing to overwrite raw artifacts: {new_run}")
    new_run.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(old_run, new_run)
    manifest = json.loads((old_run / "manifest.json").read_text(encoding="utf-8"))
    for name in ("raw_markdown_path", "content_list_path", "run_log_path"):
        path = manifest.get(name)
        if path:
            origin = Path(path).resolve()
            if not origin.is_relative_to(old_run.resolve()):
                raise RuntimeError(f"staged {name} escapes the immutable run: {origin}")
            manifest[name] = str(new_run / origin.relative_to(old_run.resolve()))
    save_json(new_run / "manifest.json", manifest)
    return new_run


def publish_item(
    key: str, reader: Any, live_cfg: dict[str, Any], stage_home: Path,
    backup_dir: Path,
) -> dict[str, Any]:
    """Only publish a validated staged parse; restore old files on failure."""
    staged_cfg = stage_config(live_cfg, stage_home)
    staged_sidecar = mineru.sidecar_path(staged_cfg, key)
    staged_report = quality.verify_current_report(key, staged_cfg, reader)
    live_sidecar = mineru.sidecar_path(live_cfg, key)
    live_report = quality.quality_report_path(live_cfg, key)
    backup_dir.mkdir(parents=True, exist_ok=True)
    for live, name in ((live_sidecar, "sidecar.before.md"), (live_report, "quality.before.json")):
        if live.is_file() and not (backup_dir / name).exists():
            copy_atomic(live, backup_dir / name)
    new_run = relocate_run(key, stage_home, live_cfg)
    try:
        correction_record = stage_home / "approved-table-transfer.json"
        if correction_record.is_file():
            copy_atomic(correction_record, new_run / correction_record.name)
        copy_atomic(staged_sidecar, live_sidecar)
        report = quality.build_quality_report(
            key, live_cfg, reader, attachment_key=staged_report["attachment_key"]
        )
        if report["status"] != "eligible":
            raise RuntimeError(f"published quality check was {report['status']}")
        quality.write_quality_report(report, live_cfg)
        quality.verify_current_report(key, live_cfg, reader)
        save_json(new_run.parent.parent / "latest-run.json", json.loads((new_run / "manifest.json").read_text()))
        return report
    except Exception:
        for live, name in ((live_sidecar, "sidecar.before.md"), (live_report, "quality.before.json")):
            backup = backup_dir / name
            if backup.is_file():
                copy_atomic(backup, live)
            else:
                live.unlink(missing_ok=True)
        # Leave the attempted raw parse on disk for diagnosis, not as a claim
        # of a successfully published source. Old reports pin their own run.
        raise


class RecoveryRequired(RuntimeError):
    """A failed index operation could not be restored; stop the entire batch."""


class ServiceUnavailable(RuntimeError):
    """A required local service stopped responding; resume after it returns."""


def existing_collection():
    """Open the current Chroma collection without creating/resetting it."""
    import chromadb
    from chromadb.config import Settings
    from zotero_mcp.chroma_client import _NoEmbeddingFunction

    directory = HOME / ".config/zotero-mcp/chroma_db"
    if not (directory / "chroma.sqlite3").is_file():
        return None
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    name = config.get("semantic_search", {}).get("collection_name", "zotero_library")
    client = chromadb.PersistentClient(
        path=str(directory), settings=Settings(anonymized_telemetry=False, allow_reset=True)
    )
    try:
        return client.get_collection(name=name, embedding_function=_NoEmbeddingFunction())
    except Exception as exc:
        raise RuntimeError(f"cannot snapshot the existing Chroma collection {name}: {exc}") from exc


def index_snapshot(key: str, path: Path) -> dict[str, Any]:
    """Persist original chunks (including vectors) before exact-item update."""
    coll = existing_collection()
    found = coll.get(where={"item_key": key}, include=["documents", "metadatas", "embeddings"]) if coll else None
    ids = list(found["ids"]) if found else []
    embeddings = found.get("embeddings") if found else None
    if ids and (
        embeddings is None or len(embeddings) != len(ids)
        or len(found.get("documents") or []) != len(ids)
        or len(found.get("metadatas") or []) != len(ids)
        or any(not isinstance(doc, str) for doc in found["documents"])
        or any(not isinstance(meta, dict) for meta in found["metadatas"])
    ):
        raise RuntimeError(f"cannot fully snapshot existing chunks for {key}; refusing indexing")
    snapshot = {
        "item_key": key, "ids": ids,
        "documents": list(found["documents"]) if ids else [],
        "metadatas": list(found["metadatas"]) if ids else [],
        "embeddings": [list(map(float, row)) for row in embeddings] if ids else [],
    }
    save_json(path, snapshot)
    return snapshot


def restore_snapshot(key: str, path: Path) -> None:
    """On failed/interrupted embedding, remove only this key and restore it."""
    if not path.is_file():
        raise RecoveryRequired(f"missing pre-index snapshot for {key}; stop and inspect the live index")
    old = json.loads(path.read_text(encoding="utf-8"))
    if old.get("item_key") != key:
        raise RecoveryRequired(f"snapshot key mismatch for {key}; stop and inspect the live index")
    coll = existing_collection()
    if coll is None:
        if old["ids"]:
            raise RecoveryRequired(f"index disappeared while restoring {key}")
        return
    current_ids = coll.get(where={"item_key": key}, include=[])["ids"]
    if current_ids:
        coll.delete(ids=current_ids)
    if old["ids"]:
        coll.upsert(
            ids=old["ids"], documents=old["documents"],
            metadatas=old["metadatas"], embeddings=old["embeddings"],
        )
    after = coll.get(where={"item_key": key}, include=["documents", "metadatas", "embeddings"])
    if set(after["ids"]) != set(old["ids"]):
        raise RecoveryRequired(f"chunk restore did not match the saved IDs for {key}")
    before_by_id = dict(zip(old["ids"], zip(old["documents"], old["metadatas"])))
    if any(before_by_id[item_id] != (doc, meta) for item_id, doc, meta in zip(after["ids"], after["documents"], after["metadatas"])):
        raise RecoveryRequired(f"chunk restore did not match the saved content for {key}")
    old_vectors = dict(zip(old["ids"], old["embeddings"]))
    if old["ids"] and (
        after["embeddings"] is None or any(
            len(old_vectors[item_id]) != len(vector)
            or any(abs(a - float(b)) > 1e-6 for a, b in zip(old_vectors[item_id], vector))
            for item_id, vector in zip(after["ids"], after["embeddings"])
        )
    ):
        raise RecoveryRequired(f"chunk restore did not match the saved embeddings for {key}")


def embed_item(key: str, run_dir: Path) -> None:
    log = run_dir / "index-logs" / f"{key}.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, ZOTERO_LOCAL="true")
    with log.open("w", encoding="utf-8") as out:
        try:
            proc = subprocess.run(
                [str(INDEX_CLI), "update-db", "--fulltext", "--no-batch",
                 "--item-key", key, "--config-path", str(CONFIG)],
                env=env, stdout=out, stderr=subprocess.STDOUT,
            )
            text = log.read_text(encoding="utf-8")
            if proc.returncode or not re.search(r"- Processed:\s*[1-9]\d*", text):
                raise RuntimeError(f"exact-item index failed or processed no items (exit {proc.returncode}); see {log}")
            coll = existing_collection()
            if coll is None or not coll.get(where={"item_key": key}, include=[])["ids"]:
                raise RuntimeError(f"index reported success but no chunks exist for {key}; see {log}")
        except Exception as exc:
            snapshot = run_dir / "snapshots" / f"{key}.json"
            try:
                restore_snapshot(key, snapshot)
            except Exception as restore_error:
                raise RecoveryRequired(f"{key} index failed ({exc}); automatic restore failed: {restore_error}") from restore_error
            try:
                local_embedder_ready()
            except RuntimeError as service_error:
                raise ServiceUnavailable(
                    f"{key} index failed; original chunks restored from {snapshot}; {service_error}"
                ) from service_error
            raise RuntimeError(f"{key} index failed; original chunks restored from {snapshot}: {exc}") from exc


def run_batch(
    keys: list[str], run_dir: Path, *, enrich: bool,
    attachments: dict[str, str] | None = None,
) -> int:
    live_cfg = mineru.load_mineru_config()
    raw_cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    db_path = raw_cfg.get("semantic_search", {}).get("zotero_db_path")
    errors = 0
    with LocalZoteroReader(db_path=db_path) as reader:
        for n, key in enumerate(keys, 1):
            state_path = run_dir / "state" / f"{key}.json"
            state = json.loads(state_path.read_text()) if state_path.is_file() else {}
            if state.get("status") == "recovery_required":
                errors += 1
                print(f"[{n}/{len(keys)}] STOP {key}: unresolved index recovery; inspect {state_path}", file=sys.stderr)
                break
            if state.get("status") == "indexed":
                try:
                    quality.verify_current_report(key, live_cfg, reader)
                    print(f"[{n}/{len(keys)}] skip {key}: already indexed", flush=True)
                    continue
                except quality.SidecarQualityError:
                    pass
            try:
                if state.get("status") == "service_unavailable":
                    phase = state.get("phase")
                    if phase in ("published", "index_failed", "indexing"):
                        if phase == "indexing":
                            try:
                                restore_snapshot(key, run_dir / "snapshots" / f"{key}.json")
                            except Exception as exc:
                                raise RecoveryRequired(f"cannot restore interrupted index for {key}: {exc}") from exc
                        state = {"status": "published", "item_key": key, "at": time.time()}
                        save_json(state_path, state)
                    else:
                        state = {}  # VLM died during staging; start a fresh parse.
                if state.get("status") == "indexing":
                    # A prior process may have died after deleting old chunks.
                    # Restore its durable snapshot before any retry.
                    try:
                        restore_snapshot(key, run_dir / "snapshots" / f"{key}.json")
                    except Exception as exc:
                        raise RecoveryRequired(f"cannot restore interrupted index for {key}: {exc}") from exc
                    state = {"status": "published", "item_key": key, "at": time.time()}
                    save_json(state_path, state)
                if state.get("status") in ("published", "index_failed"):
                    try:
                        quality.verify_current_report(key, live_cfg, reader)
                    except quality.SidecarQualityError:
                        # A stale published sidecar cannot be safely indexed;
                        # rerun the staged parse rather than retry blindly.
                        state = {}
                if state.get("status") not in ("published", "index_failed"):
                    stage_home = run_dir / "staging" / key
                    if stage_home.exists():
                        # Failed attempts are preserved for diagnosis. Retry in
                        # a fresh staged directory, never reuse old raw files.
                        archived = stage_home.with_name(f"{key}.attempt-{time.time_ns()}")
                        stage_home.rename(archived)
                    prepare_item(
                        key, reader, live_cfg, stage_home, enrich=enrich,
                        attachment_key=(attachments or {}).get(key),
                    )
                    publish_item(key, reader, live_cfg, stage_home, run_dir / "backups" / key)
                    state = {"status": "published", "item_key": key, "at": time.time()}
                    save_json(state_path, state)
                else:
                    quality.verify_current_report(key, live_cfg, reader)
                index_snapshot(key, run_dir / "snapshots" / f"{key}.json")
                state = {"status": "indexing", "item_key": key, "at": time.time()}
                save_json(state_path, state)
                embed_item(key, run_dir)
                state = {"status": "indexed", "item_key": key, "at": time.time()}
                print(f"[{n}/{len(keys)}] indexed {key}", flush=True)
            except Exception as exc:
                errors += 1
                fatal = isinstance(exc, (RecoveryRequired, ServiceUnavailable))
                status = (
                    "recovery_required" if isinstance(exc, RecoveryRequired) else
                    "service_unavailable" if isinstance(exc, ServiceUnavailable) else
                    "index_failed" if state.get("status") in ("published", "index_failed", "indexing") else "blocked"
                )
                state = {
                    "status": status, "item_key": key, "error": str(exc), "at": time.time(),
                    "phase": state.get("status") if status == "service_unavailable" else None,
                }
                print(f"[{n}/{len(keys)}] {status} {key}: {exc}", file=sys.stderr, flush=True)
                save_json(state_path, state)
                if fatal:
                    break
            else:
                save_json(state_path, state)
    counts = Counter(json.loads(p.read_text())["status"] for p in (run_dir / "state").glob("*.json"))
    save_json(run_dir / "summary.json", {"scope": len(keys), "statuses": dict(counts), "incomplete": errors > 0})
    print(f"run summary: {dict(counts)}; frozen scope={len(keys)}; details={run_dir}", flush=True)
    return 1 if errors else 0


def pipeline_vlm_url() -> str:
    endpoint = os.environ.get("ZOTERO_VLM_URL", PIPELINE_VLM_URL)
    parts = urlsplit(endpoint)
    if (
        parts.scheme != "http" or parts.hostname not in ("localhost", "127.0.0.1", "::1")
        or parts.username or parts.password or parts.query or parts.fragment
        or parts.path != "/v1/chat/completions"
    ):
        raise ServiceUnavailable("pipeline VLM endpoint must be a loopback HTTP /v1/chat/completions URL")
    try:
        if not parts.port:
            raise ValueError("missing port")
    except ValueError as exc:
        raise ServiceUnavailable(f"invalid pipeline VLM port: {exc}") from exc
    return endpoint


def local_vlm_ready() -> None:
    endpoint = pipeline_vlm_url()
    models_url = endpoint.removesuffix("chat/completions") + "models"
    try:
        with urlopen(models_url, timeout=3) as response:
            if response.status != 200:
                raise RuntimeError(f"HTTP {response.status}")
    except Exception as exc:
        raise ServiceUnavailable(
            f"pipeline VLM unavailable at {models_url}; use zotero-vlm-rocm.sh start "
            f"or restore the selected local endpoint before resuming: {exc}"
        ) from exc


def local_embedder_ready() -> None:
    """Fail before parsing if the configured loopback embedder is absent."""
    raw = json.loads(CONFIG.read_text(encoding="utf-8"))
    cfg = raw.get("semantic_search", {}).get("embedding_config", {})
    base = cfg.get("base_url", "")
    host = urlsplit(base).hostname
    if host not in ("localhost", "127.0.0.1", "::1"):
        return  # A nonlocal provider needs its own ordinary CLI error handling.
    try:
        with urlopen(base.rstrip("/") + "/models", timeout=3) as response:
            if response.status != 200:
                raise RuntimeError(f"HTTP {response.status}")
    except Exception as exc:
        raise RuntimeError(
            f"configured local embedder is unavailable at {base}; start it before the live batch: {exc}"
        ) from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--existing-sidecars", action="store_true", help="freeze current sidecar keys as the batch scope")
    parser.add_argument("--key", action="append", dest="keys", metavar="KEY", help="include one exact item; repeat as needed")
    parser.add_argument(
        "--exclude-key", action="append", default=[], metavar="KEY",
        help="explicitly exclude a sidecar without a live Zotero parent; frozen and reported",
    )
    parser.add_argument(
        "--attachment", action="append", default=[], metavar="KEY=ATTACHMENT",
        help="pin one PDF attachment belonging to an ambiguous parent; repeat as needed",
    )
    parser.add_argument("--run-dir", type=Path, help="persistent run directory; required for --execute")
    parser.add_argument("--execute", action="store_true", help="actually parse, publish, and re-embed live items")
    parser.add_argument("--confirm-live-reembed", metavar="REEMBED", help="second guard against accidental live index changes")
    parser.add_argument("--resume", action="store_true", help="resume the frozen scope in --run-dir")
    parser.add_argument("--no-enrich", action="store_true", help="omit optional VLM enrichment (missing figure schemas may block quality)")
    args = parser.parse_args(argv)
    if args.run_dir:
        args.run_dir = args.run_dir.expanduser().resolve()
    if args.resume:
        if not args.run_dir or not (args.run_dir / "scope.json").is_file():
            parser.error("--resume requires a frozen --run-dir with scope.json")
        scope = json.loads((args.run_dir / "scope.json").read_text())
        keys = scope["keys"]
        attachments = scope.get("attachments", {})
        excluded_keys = scope.get("excluded_keys", [])
        source_sidecars = scope.get("source_sidecars", len(keys))
        if args.keys or args.existing_sidecars or args.attachment or args.exclude_key:
            parser.error("--resume cannot change the frozen item, exclusion, or attachment set")
    else:
        if not args.existing_sidecars and not args.keys:
            parser.error("select --existing-sidecars or repeat --key")
        cfg = mineru.load_mineru_config()
        sidecar_keys = (
            {p.stem for p in Path(cfg["sidecar_dir"]).glob("*.md")}
            if args.existing_sidecars else set()
        )
        excluded_keys = sorted(set(args.exclude_key))
        if excluded_keys and not args.existing_sidecars:
            parser.error("--exclude-key requires --existing-sidecars")
        if any(not KEY_RE.fullmatch(key) or key not in sidecar_keys for key in excluded_keys):
            parser.error("every excluded key must name an existing sidecar")
        if set(args.keys or []) & set(excluded_keys):
            parser.error("a key cannot be both explicitly included and excluded")
        source_sidecars = len(sidecar_keys)
        keys = sorted((set(args.keys or []) | sidecar_keys) - set(excluded_keys))
        attachments = {}
        for pair in args.attachment:
            parent, separator, child = pair.partition("=")
            if not separator or not KEY_RE.fullmatch(parent) or not KEY_RE.fullmatch(child):
                parser.error("--attachment must be KEY=ATTACHMENT with two 8-character Zotero keys")
            if parent in attachments and attachments[parent] != child:
                parser.error(f"conflicting PDF attachment pins for {parent}")
            attachments[parent] = child
    if (not keys or any(not KEY_RE.fullmatch(k) for k in keys)
            or not isinstance(excluded_keys, list)
            or any(not isinstance(k, str) or not KEY_RE.fullmatch(k) or k in keys for k in excluded_keys)):
        parser.error("scope must contain valid parent keys and separate explicit exclusions")
    if not isinstance(attachments, dict) or any(
        k not in keys or not isinstance(v, str) or not KEY_RE.fullmatch(v)
        for k, v in attachments.items()
    ):
        parser.error("attachment pins must match scoped parent keys and exact attachment keys")
    if not args.execute:
        print(f"PREVIEW: {len(keys)} frozen item keys; first keys: {', '.join(keys[:10])}")
        if excluded_keys:
            print(f"Explicitly excluded {len(excluded_keys)} of {source_sidecars} sidecars: {', '.join(excluded_keys)}")
        if attachments:
            print("Pinned PDFs: " + ", ".join(f"{key}={value}" for key, value in sorted(attachments.items())))
        print("No sidecars, reports, artifacts, services, or index entries changed.")
        return 0
    if args.confirm_live_reembed != "REEMBED" or not args.run_dir:
        parser.error("--execute requires --run-dir PATH --confirm-live-reembed REEMBED and separate live-run approval")
    # The package overlay must include report-pinned manifest verification.
    # Otherwise an unsuccessful new parse can invalidate a previous eligible
    # report merely by leaving newer raw artifacts on disk.
    if "manifest_path" not in inspect.signature(quality._parser_manifest).parameters:
        parser.error("installed Zotero package lacks report-pinned manifest verification; deploy managed overlay first")
    try:
        local_embedder_ready()
        if not args.no_enrich:
            local_vlm_ready()
    except (OSError, ValueError, RuntimeError) as exc:
        parser.error(str(exc))
    args.run_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    if stat.S_IMODE(args.run_dir.stat().st_mode) & 0o077:
        parser.error("run directory holds private paper text and backups; chmod it to 0700 before executing")
    with (args.run_dir / ".lock").open("w") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error("another runner already owns this run directory")
        scope_path = args.run_dir / "scope.json"
        if args.resume:
            if scope.get("enrich") != (not args.no_enrich):
                parser.error("--resume must retain the same enrichment setting")
        else:
            if scope_path.exists():
                parser.error("run directory already has a frozen scope; use --resume or a new directory")
            save_json(scope_path, {
                "keys": keys, "attachments": attachments,
                "source_sidecars": source_sidecars, "excluded_keys": excluded_keys,
                "enrich": not args.no_enrich, "created_at": time.time(),
            })
        save_json(args.run_dir / "runner-pid.json", {
            "pid": os.getpid(), "start_ticks": process_start_ticks(os.getpid()),
            "runner": str(Path(__file__).resolve()), "run_dir": str(args.run_dir),
            "at": time.time(),
        })
        return run_batch(keys, args.run_dir, enrich=not args.no_enrich, attachments=attachments)


if __name__ == "__main__":
    raise SystemExit(main())
