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

Run the 3-stage pipeline via `zotero-sidecar.sh`:

```bash
# Ingestion Stages
zotero-sidecar.sh create  <COLLECTION_KEY | KEY...>   # Stage 1: capability-aware MinerU parse -> Markdown sidecar
zotero-sidecar.sh enrich  <COLLECTION_KEY | KEY...>   # Stage 2: Inject [Figure Schema] blocks (requires :8084)
zotero-sidecar.sh embed   <COLLECTION_KEY...>         # Stage 3: Chunk + embed into ChromaDB & BM25

# Maintenance
zotero-sidecar.sh reembed <COLLECTION_KEY...>         # Delete Chroma chunks first, then re-index
```

### MinerU CLI compatibility and upgrade guardrail

The sidecar creator must call the production `zotero_mcp.mineru.run_mineru` path through `zotero-sidecar.sh`; do not copy a command line from a different MinerU virtual environment. The runner is intentionally **capability-aware**:

- It probes the selected binary's `--help` output and adds `-b/--backend` only when that binary advertises the option. MinerU 3.x (`mineru`) and the retained 1.x (`magic-pdf`) CLI are both supported.
- It exports the configured `semantic_search.mineru.config_json` as `MINERU_TOOLS_CONFIG_JSON` and selects the matching legacy/new VRAM variable.
- The managed patcher byte-synchronizes `mineru.py` on every application, so an installed package cannot silently retain an older patch after `sjust uv`.

After changing the MCP tag, MinerU virtual environment, or MinerU config, run the maintained fast preflight before a batch:

```bash
ZOTERO_LOCAL=true "$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python" \
  "$HOME/.agents/skills/zotero/scripts/mineru-preflight.py"
```

The preflight catches the previous failure immediately: a legacy `magic-pdf` must report `backend_flag_supported=False` and its command must contain no `-b`; a modern `mineru` may report `True`. For higher confidence, run one representative single-item `create`, wait for its detached log to report `DONE`, require a non-empty `<key>.md`, and inspect the log for `No such option`, `Traceback`, or `(null): No such file or directory` before launching a batch.

### Formula handling

Zotero's MinerU sidecar creator uses `-m txt` for native-text PDFs. This skips ordinary prose OCR but still runs enabled formula detection and UniMERNet formula recognition, so detected equations are emitted as LaTeX in the Markdown sidecar. Scanned PDFs use the OCR path; both paths intend the same equation representation. Do not infer missing formula recognition from `-m txt` alone.

### Dynamic Batch Enumeration
Always derive missing items dynamically from live SQLite membership rather than static notes:
```python
# keys = collection_membership(COLL_KEY) − {k for k in sidecar_dir if k.md exists}
with LocalZoteroReader(db_path=db) as r:
    ic = r.get_item_collections()
    keys = sorted(k for k, cols in ic.items() if COLL_KEY in cols)
```

### Detached Execution Rule
Always run `create` detached (`setsid nohup ... &`) to prevent incomplete parses if the calling shell terminates.

### GTT Memory Protection (`zotero-sidecar-watch.sh`)
For large batch runs, launch the memory watchdog in the background:
```bash
setsid nohup ~/.local/bin/zotero-sidecar-watch.sh > /dev/null 2>&1 < /dev/null &
```
- **Threshold:** `WATCHDOG_GTT_THRESHOLD_MB=105000` (105 GB, 3 samples @ 20 s).
- **Action:** Terminates runaway `mineru` processes if memory balloons, allowing `create.py` to log failure and proceed safely.
- **Log Path:** `~/.cache/zotero-mcp/logs/sidecar-watch.log`.

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
   "$HOME/.agents/skills/zotero/scripts/pause-sidecar-jobs.sh"
   ```
2. **Stop the Reviewed Processes:** After Samuel approves the displayed targets, rerun with `--confirm`:
   ```bash
   "$HOME/.agents/skills/zotero/scripts/pause-sidecar-jobs.sh" --confirm
   ```
3. **Preview Interrupted-Item Cleanup:** Replace `<IN_FLIGHT_KEY>` with one exact parent item key. The first call is a dry run:
   ```bash
   "$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python" \
     "$HOME/.agents/skills/zotero/scripts/delete-item-chunks.py" <IN_FLIGHT_KEY>
   ```
4. **Delete Only the Reviewed Item's Chunks:** After Samuel confirms that key, repeat it through the confirmation argument:
   ```bash
   "$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python" \
     "$HOME/.agents/skills/zotero/scripts/delete-item-chunks.py" <IN_FLIGHT_KEY> \
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

`--item-key` is repeatable. It accepts live parent-item keys only; `--limit`, `--force-rebuild`, and Batch API mode are rejected so an explicit request cannot broaden into a partial or destructive library update. Verify Chroma metadata (`item_key`, `fulltext_source`, and chunk count), rebuild sparse BM25 only if the run was interrupted, and reload the service if it was stopped.

## 5. Sparse (BM25) Index Synchronization

Completed `zotero-sidecar.sh embed` runs converge BM25 automatically. Rebuild manually after interrupted batches, classifier adjustments, or suspected drift:

```bash
"$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python" \
  "$HOME/.agents/skills/zotero/scripts/rebuild-bm25.py"
systemctl --user restart zotero-mcp.service
```

## 6. Re-keying Sidecars after Item Re-import

When an item is re-imported under a new key with an identical PDF:
1. Verify that the old and new PDF MD5 values match.
2. Copy the sidecar: `cp ~/.config/zotero-mcp/mineru-sidecars/<OLD>.md ~/.config/zotero-mcp/mineru-sidecars/<NEW>.md`.
3. Preview deletion of the old item's chunks with `delete-item-chunks.py <OLD>`. After Samuel confirms the old key, rerun with `--confirm-key <OLD>` as shown in §3.
4. Embed the new item with `zotero-sidecar.sh embed <COLLECTION>` and verify its Chroma metadata and chunk count.
5. Rebuild BM25 with the helper in §5. Remove the old sidecar only after the new item and sparse index verify successfully.

## 7. ChromaDB Corruption Recovery

Use this only after confirming unrecoverable ChromaDB corruption. The helper previews its exact stop, archive, rebuild, BM25, and restart sequence by default:

```bash
"$HOME/.agents/skills/zotero/scripts/recover-chroma.sh"
```

Show the plan to Samuel. Run the confirmed recovery only after explicit approval:

```bash
"$HOME/.agents/skills/zotero/scripts/recover-chroma.sh" --confirm
```

The helper archives rather than deletes the damaged database and stops if rebuilding fails. Never run the underlying `--allow-mass-deletion` command directly.

## 8. Figure Schema Maintenance (`zotero-vlm-enrich.py`)

Operational modes (requires `:8084` up):
- **Default (`zotero-vlm-enrich.py`):** Adds `[Figure Schema]` blocks and captions below unenriched images.
- **`--force`:** Re-runs VLM on all figures (use after upgrading the vision model).
- **`--captions-only`:** Local extraction only; stamps captions without querying VLM.
- **`--relocate`:** Moves legacy schemas directly beneath corresponding images.
*Note:* Re-embed affected items via `zotero-sidecar.sh reembed <COLLECTION>`.

## 9. CPU Fallback Runner

For anomalous PDFs failing on GPU:
```bash
~/.local/share/uv/tools/zotero-mcp-server/bin/python ~/.local/bin/zotero-cpu-rescue.py <ITEM_KEY>
```
Rescued files write directly to `~/.config/zotero-mcp/mineru-sidecars/<key>.md`.
