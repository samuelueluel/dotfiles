# Index Maintenance & Pipeline Recovery

**Load this file when** running the sidecar ingestion pipeline, managing memory watchdogs, recovering from ChromaDB/BM25 desync, or repairing corrupted indexes.

## Dedicated Graph & Reference Maintenance

Do not run the sidecar pipeline on `external_reference` nodes. Use dedicated maintenance tools:

- `zotero_rebuild_citation_graph`: Rebuilds graph nodes and citation edges from SQLite metadata and existing sidecars without touching ChromaDB.
- `zotero_rebuild_reference_index`: Rebuilds the separate per-entry BM25 reference index.
- `zotero_get_reference_index_status`: Reports parsing coverage and initializes the reference index if absent.

**Desktop Closed / WAL Requirement:** Perform graph/reference rebuilds only when Zotero Desktop is fully closed and WAL checkpointing has finished (`immutable=1` ignores active WAL files).

**Graph Node Filtering:** Nodes are parent items filtered by `itemTypes.typeName NOT IN ('attachment','note','annotation')` (not hardcoded IDs, ensuring resilience across Zotero schema versions).

**Metadata-only filter rule:** Do not run `reembed` solely for tag, native `itemType`, `source_group`, or collection changes. Semantic filters use existing parent `item_key` identity plus live local metadata; re-embed only when source text, parsed content, or chunking changes.

## 1. Sidecar Pipeline Execution & Watching

Use the staged per-item workflow for a complete parse-to-index run. Both commands preview their frozen scopes by default; execution requires a separately approved live mutation:

```bash
zotero-sidecar.sh process --key <ITEM_KEY>  # new PDF: preview one exact parent item
zotero-sidecar.sh reprocess               # existing sidecars: preview all current keys
# Pin any ambiguous PDF and explicitly omit only a confirmed retired parent:
zotero-sidecar.sh reprocess --attachment <PARENT_KEY>=<PDF_ATTACHMENT_KEY> \
  --exclude-key <RETIRED_PARENT_KEY>
# After Samuel approves the exact live scope and consequences, start the dedicated
# ROCm VLM (never the shared Vulkan :8084 service) and run detached:
zotero-vlm-rocm.sh start  # status and stop are also supported; endpoint :18084
setsid nohup "$HOME/.local/bin/zotero-sidecar.sh" reprocess \
  --attachment <PARENT_KEY>=<PDF_ATTACHMENT_KEY> \
  --exclude-key <RETIRED_PARENT_KEY> \
  --run-dir "$HOME/.cache/zotero-mcp/batches/<RUN_ID>" \
  --execute --confirm-live-reembed REEMBED \
  > "$HOME/.cache/zotero-mcp/logs/<RUN_ID>.log" 2>&1 </dev/null &
# After scope.json and runner-pid.json appear, start the run-scoped GTT watchdog:
setsid nohup "$HOME/.local/bin/zotero-sidecar-batch-watch.py" \
  "$HOME/.cache/zotero-mcp/batches/<RUN_ID>" --stop-vlm-on-exit \
  > "$HOME/.cache/zotero-mcp/batches/<RUN_ID>/watcher.out" 2>&1 </dev/null &
# Resume the same frozen scope, using the same --run-dir, with --resume and
# without --attachment, --exclude-key or --existing-sidecars; restart the watcher.
```

The runner stages fresh MinerU artifacts under the run directory and enriches figure-bearing sidecars with the already-running dedicated local VLM. It defaults to `http://127.0.0.1:18084/v1/chat/completions` for both preflight and the enrichment child; a non-default loopback endpoint requires `ZOTERO_VLM_URL` on the batch invocation. An ineligible staged parse cannot overwrite the old sidecar or reach the index. Passing items preserve the former sidecar/report in `<RUN_ID>/backups/<KEY>/`, publish the new raw run and eligible report, and re-embed by exact key. Each key has a checkpoint in `<RUN_ID>/state/`; `summary.json` and per-item logs distinguish indexed, blocked, index-failed, service-unavailable, and recovery-required items. Before indexing, the runner saves that item's existing chunks, metadata, and vectors under `<RUN_ID>/snapshots/`. On an embedding error or interrupted run, it restores those chunks before retrying. If restoration cannot be verified, it stops the entire batch as `recovery_required`; inspect that item before resuming, and rebuild BM25 after a diagnosed sparse-index interruption. A lost VLM or local embedder stops the batch as `service_unavailable`; bring the service back, then resume the same frozen scope. An item with multiple resolvable PDFs remains blocked unless its exact child attachment is passed with repeatable `--attachment PARENT=ATTACHMENT` flags; the pins are stored in `scope.json` and cannot change on resume. The staged report, published report, and installed index gate verify the selected PDF's hash and parent-child link. A sidecar whose parent item is no longer in the local Zotero library cannot be reprocessed or claimed complete merely because a similarly named PDF exists elsewhere in Zotero storage. After a separately approved live-scope decision, `--exclude-key KEY` (repeatable) removes only a named existing sidecar from that batch and freezes/reports its exclusion. It does **not** delete or update the excluded sidecar or old index chunks, and is not a substitute for later orphan cleanup approval. Repeat all pins/exclusions for the initial `--execute` run; pass no scope flags on `--resume`. For `VNG5RAE7`, the runner carries forward three previously page-verified table corrections only when the old report/sidecar and source PDF hashes match and the fresh table markup matches the approved before/after hashes exactly. It records this transfer in the staged run and published raw run; any changed/unknown table blocks the item before publication. New parser provenance and a fresh eligible report are still required for indexing. Any incomplete item makes the batch exit nonzero; a resumed run skips verified successes. This is not a full-index reset, and no live run should start until the managed quality overlay includes report-pinned manifest verification and the run scope is approved. Keep the embedder on `:8082` and dedicated ROCm VLM on `:18084` available throughout a figure-bearing live run. The launcher uses the cached model with its BF16 projector, binds only loopback, pulls no image, and leaves the configured `serve-vlm` at `:8084` untouched. Use `zotero-vlm-rocm.sh status` during a run and `zotero-vlm-rocm.sh stop` after it; logs are in `podman logs zotero-vlm-rocm`. Never auto-start either service from an agent session.

The older split-stage helpers remain available; `create` now generates a quality report after each successful parse, but enrichment makes it stale and requires `check` again:

```bash
# Ingestion Stages
zotero-sidecar.sh create  <COLLECTION_KEY | KEY...>   # Stage 1: capability-aware MinerU parse -> Markdown sidecar
zotero-sidecar.sh enrich  <COLLECTION_KEY | KEY...>   # Stage 2: standalone default :8084; override via ZOTERO_VLM_URL
zotero-sidecar.sh check   <ITEM_KEY...>                # Stage 2.5: write provenance-bound quality reports
zotero-sidecar.sh embed   <COLLECTION_KEY...>         # Stage 3: Chunk + embed into ChromaDB & BM25

# Maintenance
zotero-sidecar.sh reembed <COLLECTION_KEY...>         # Refresh only after quality preflight and deletion approval
```

Collection helpers resolve keys through the local Zotero reader and refuse unknown or empty collection scopes. Stop if resolution fails; never retry with an unscoped command.

### Sidecar Quality Gate

Run the quality check after parsing or figure enrichment and before any embed/re-embed:

```bash
zotero-sidecar.sh check <ITEM_KEY...>
# If an item has multiple PDFs, pin the intended attachment:
zotero-sidecar.sh check <ITEM_KEY> --attachment-key <ATTACHMENT_KEY>
```

The report binds the current Markdown sidecar to the exact PDF, parser manifest, raw Markdown, and page-indexed `content_list.json`. Any later change makes the report stale. A nonzero result or status other than `eligible` stops indexing; inspect critical findings against the rendered source, make only approved page-verified corrections, and run `check` again. A legacy parse with unknown parser version remains ineligible. Do not invent provenance or fall back to Zotero API/PDF extraction after a sidecar is rejected.

When patched `update-db` completes a fresh MinerU parse in the same call, it writes a report bound to that new run and indexes only if the report is `eligible`. For figure-bearing PDFs, use the staged `process` command so enrichment runs before the final report and index operation. Existing, manual, and legacy sidecars with missing or stale reports never receive automatic approval; use `reprocess` to create new provenance rather than invent a parser version. A report that detects changed or missing raw artifacts is critical even if it is generated after the change.

Before relying on the shared gate after a package update, confirm that the installed package contains both the quality module and patched extractor:

```bash
"$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python" - <<'PY'
import inspect
from zotero_mcp import sidecar_quality, semantic_search
assert "[sidecar quality patch]" in inspect.getsource(semantic_search._extract_fulltext_batch)
assert "manifest_path" in inspect.signature(sidecar_quality._parser_manifest).parameters
print("shared sidecar gate and report-pinned run verification are installed")
PY
```

If this check fails, stop before indexing and ask before package deployment. A shell-only preflight does not protect direct `update-db` calls.

### MinerU CLI compatibility and upgrade guardrail

The sidecar creator must call the production `zotero_mcp.mineru.run_mineru` path through `zotero-sidecar.sh`; do not copy a command line from a different MinerU virtual environment. The runner is intentionally **capability-aware**:

- It probes the selected binary's `--help` output and adds `-b/--backend` only when that binary advertises the option. MinerU 3.x (`mineru`) and the retained 1.x (`magic-pdf`) CLI are both supported.
- It exports the configured `semantic_search.mineru.config_json` as `MINERU_TOOLS_CONFIG_JSON` and selects the matching legacy/new VRAM variable.
- The managed patcher byte-synchronizes `mineru.py` on every application, so an installed package cannot silently retain an older patch after `sjust uv`.

After changing the MCP tag, MinerU virtual environment, or MinerU config, run the maintained fast preflight before a batch:

```bash
ZOTERO_LOCAL=true "$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python" \
  "$HOME/.agents/skills/zotero-pipeline/scripts/mineru-preflight.py"
```

The preflight catches the previous failure immediately: a legacy `magic-pdf` must report `backend_flag_supported=False` and its command must contain no `-b`; a modern `mineru` may report `True`. For higher confidence, run one representative single-item `create`, wait for its detached log to report `DONE`, require a non-empty `<key>.md`, and inspect the log for `No such option`, `Traceback`, or `(null): No such file or directory` before launching a batch.

### Formula handling

Zotero's MinerU sidecar creator uses `-m txt` for native-text PDFs. This skips ordinary prose OCR but still runs enabled formula detection and UniMERNet formula recognition, so detected equations are emitted as LaTeX in the Markdown sidecar. Scanned PDFs use the OCR path; both paths intend the same equation representation. Do not infer missing formula recognition from `-m txt` alone.

### Dynamic Batch Enumeration
Always derive missing items dynamically from live SQLite membership rather than static notes:
```python
# keys = collection_membership(COLL_KEY) − {k for k in sidecar_dir if k.md exists}
with LocalZoteroReader(db_path=db) as r:
    members = r.resolve_collection_item_keys(COLL_KEY)
if not members:
    raise SystemExit(f"Collection {COLL_KEY} is empty; refusing an unscoped operation.")
keys = sorted(k for k in members if not (sidecar_dir / f"{k}.md").is_file())
```

### Detached Execution Rule
Always run `create` detached (`setsid nohup ... &`) to prevent incomplete parses if the calling shell terminates.

### GTT Memory Protection
For staged `process`/`reprocess`, use **`zotero-sidecar-batch-watch.py RUN_DIR --stop-vlm-on-exit`** after the guarded runner starts. It validates the frozen run directory, runner PID and Linux birth tick, watches GTT at 20-second intervals (default 105 GiB, 3 consecutive high samples), and stops only the identified MinerU child process tree of that runner on a balloon or parser hang. Failed items remain checkpointed. The watcher writes `<RUN_DIR>/watchdog.log` and stops only the dedicated pipeline VLM after the runner exits. Restart it when resuming. Do not use `zotero-sidecar-watch.sh` for a staged batch: that legacy watcher is tied to `zotero-sidecar-create.py`, and would misidentify a healthy new runner as finished and kill its parser. Use that legacy watcher only with the old split-stage `create` helper.

### Handling Transient DB Locks
If an immutable read encounters a mid-checkpoint write, SQLite may report `database disk image is malformed`. This is transient. Verify integrity:
```bash
sqlite3 "file:$HOME/Zotero/zotero.sqlite?immutable=1" "PRAGMA integrity_check;"
```
Rerun the idempotent `create` command or wrap in a retry loop.

## 2. Embedder Responsiveness & Wedge Recovery

Probe `:8082` responsiveness:
```bash
time curl -s http://127.0.0.1:8082/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"input":"probe","model":"embed"}' >/dev/null
```
If deadlocked (0% CPU or slow crawl), restart the container: `podman restart embedder`.

## 3. Pausing & Resuming Batch Jobs

1. **Preview In-Flight Processes:** Run the helper without confirmation and inspect every matched process:
   ```bash
   "$HOME/.agents/skills/zotero-pipeline/scripts/pause-sidecar-jobs.sh"
   ```
2. **Stop the Reviewed Processes:** After Samuel approves the displayed targets, rerun with `--confirm`:
   ```bash
   "$HOME/.agents/skills/zotero-pipeline/scripts/pause-sidecar-jobs.sh" --confirm
   ```
3. **Preview Interrupted-Item Cleanup:** Replace `<IN_FLIGHT_KEY>` with one exact parent item key. The first call is a dry run:
   ```bash
   "$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python" \
     "$HOME/.agents/skills/zotero-pipeline/scripts/delete-item-chunks.py" <IN_FLIGHT_KEY>
   ```
4. **Delete Only the Reviewed Item's Chunks:** After Samuel confirms that key, repeat it through the confirmation argument:
   ```bash
   "$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python" \
     "$HOME/.agents/skills/zotero-pipeline/scripts/delete-item-chunks.py" <IN_FLIGHT_KEY> \
     --confirm-key <IN_FLIGHT_KEY>
   ```
5. **Relaunch:** Re-run the pipeline for the remaining items.

## 4. Item-Scoped Re-embed (No Full Rebuild)

Use the exact-key path for one or more parent items; it bypasses global DOI/title deduplication, refreshes existing chunks, does not run the library deletion pass, and does not advance the library sync watermark:

```bash
ZOTERO_LOCAL=true "$HOME/.local/share/uv/tools/zotero-mcp-server/bin/zotero-mcp-server" \
  update-db --fulltext --no-batch \
  --item-key <ITEM_KEY> [--item-key <ANOTHER_ITEM_KEY>]
```

`--item-key` is repeatable. It accepts live parent-item keys only; `--limit`, `--force-rebuild`, and Batch API mode are rejected so an explicit request cannot broaden into a partial or destructive library update. A current eligible report is checked during full-text extraction before any affected chunks are replaced. For a collection-wide forced rebuild, the collection reset is deferred until every requested sidecar passes preflight. Verify Chroma metadata (`item_key`, `fulltext_source`, and chunk count), rebuild sparse BM25 only if the run was interrupted, and reload the service if it was stopped.

## 5. Sparse (BM25) Index Synchronization

Completed `zotero-sidecar.sh embed` runs converge BM25 automatically. Rebuild manually after interrupted batches, classifier adjustments, or suspected drift:

```bash
"$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python" \
  "$HOME/.agents/skills/zotero-pipeline/scripts/rebuild-bm25.py"
systemctl --user restart zotero-mcp.service
```

## 6. Re-keying Sidecars after Item Re-import

When an item is re-imported under a new key with an identical PDF:
1. Verify that the old and new PDF MD5 values match.
2. Copy the sidecar: `cp ~/.config/zotero-mcp/mineru-sidecars/<OLD>.md ~/.config/zotero-mcp/mineru-sidecars/<NEW>.md`.
3. Preview deletion of the old item's chunks with `delete-item-chunks.py <OLD>`. After Samuel confirms the old key, rerun with `--confirm-key <OLD>` as shown in §3.
4. Re-create the sidecar under the new item key so its raw parse manifest is bound to that key, run `zotero-sidecar.sh check <NEW>`, and embed only if the report is `eligible`. Then verify Chroma metadata and chunk count.
5. Rebuild BM25 with the helper in §5. Remove the old sidecar only after the new item and sparse index verify successfully.

## 7. ChromaDB Corruption Recovery

Use this only after confirming unrecoverable ChromaDB corruption. The helper previews its exact stop, archive, rebuild, BM25, and restart sequence by default:

```bash
"$HOME/.agents/skills/zotero-pipeline/scripts/recover-chroma.sh"
```

Show the plan to Samuel. Run the confirmed recovery only after explicit approval:

```bash
"$HOME/.agents/skills/zotero-pipeline/scripts/recover-chroma.sh" --confirm
```

The helper archives rather than deletes the damaged database and stops if rebuilding fails. Never run the underlying `--allow-mass-deletion` command directly.

## 8. Figure Schema Maintenance (`zotero-vlm-enrich.py`)

Standalone modes (default shared `:8084`; use `ZOTERO_VLM_URL=http://127.0.0.1:18084/v1/chat/completions` with an already-running dedicated ROCm VLM instead):
- **Default (`zotero-vlm-enrich.py`):** Adds `[Figure Schema]` blocks and captions below unenriched images.
- **`--force`:** Re-runs VLM on all figures (use after upgrading the vision model).
- **`--captions-only`:** Local extraction only; stamps captions without querying VLM.
- **`--relocate`:** Moves legacy schemas directly beneath corresponding images.
*Note:* Run the quality check for every changed sidecar, then re-embed affected items via `zotero-sidecar.sh reembed <COLLECTION>` after the required deletion approval.

## 9. CPU Fallback Runner

For anomalous PDFs failing on GPU:
```bash
~/.local/share/uv/tools/zotero-mcp-server/bin/python ~/.local/bin/zotero-cpu-rescue.py <ITEM_KEY>
```
Rescued files write directly to `~/.config/zotero-mcp/mineru-sidecars/<key>.md`. Until the rescue path also records a verified parser manifest and page-indexed source, the quality gate will mark that sidecar's parser provenance unknown; do not fabricate a manifest or index it through a fallback route.
