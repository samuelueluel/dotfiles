# Index Maintenance & Recovery

**Load this file when** refreshing exact items in the index, rebuilding the sparse BM25 index, deleting an interrupted item's chunks, re-keying a re-imported item, maintaining figure schemas, rebuilding the citation graph or reference index, or recovering a corrupted Chroma index.

## Citation Graph and Reference Index

Do not run the processing pipeline on `external_reference` nodes. Use the dedicated tools:

- `zotero_rebuild_citation_graph`: rebuilds graph nodes and citation edges from Zotero SQLite metadata and the live sidecars, without touching Chroma.
- `zotero_rebuild_reference_index`: rebuilds the per-entry BM25 reference index from the same sidecars.
- `zotero_get_reference_index_status`: reports parsing coverage (entries, split methods, resolved entries).

Both builders read the sidecar directory named by `semantic_search.mineru.sidecar_dir` in the live config. Rebuild only with Zotero Desktop fully closed and `~/Zotero/zotero.sqlite-wal` empty; `immutable=1` reads ignore pending WAL writes. Restart `zotero-mcp.service` afterwards if the tools were run outside the server.

Graph nodes are parent items filtered by `itemTypes.typeName NOT IN ('attachment','note','annotation')`, not by hardcoded type IDs.

Metadata-only changes (tags, item type, `source_group`, collections) never require re-embedding; semantic filters use the parent `item_key` plus live local metadata.

## Exact-Item Re-embed

Use the exact-key path when an item's sidecar text changed but no new OCR is needed:

```bash
ZOTERO_LOCAL=true "$HOME/.local/share/uv/tools/zotero-mcp-server/bin/zotero-mcp-server" \
  update-db --fulltext --no-batch \
  --item-key <ITEM_KEY> [--item-key <ANOTHER_ITEM_KEY>]
```

`--item-key` is repeatable and accepts live parent keys only. `--limit`, `--force-rebuild` and Batch API mode are rejected, so the request cannot broaden into a partial or destructive library update. The route bypasses DOI/title deduplication, skips the library deletion pass and leaves the sync watermark alone. Back up `chroma_db` and `bm25_index.json` first, as `zotero-process start` does.

## Sparse (BM25) Index

Completed indexing keeps BM25 in step. Rebuild it only after an interrupted index stage or diagnosed drift:

```bash
"$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python" \
  "$HOME/.agents/skills/zotero-pipeline/scripts/rebuild-bm25.py"
systemctl --user restart zotero-mcp.service
```

The rebuild excludes bibliography chunks by design, so BM25 holds fewer IDs than Chroma.

## Interrupted Item Cleanup

If a run was stopped mid-`index` and will not be resumed, an item can be left with partial chunks.

1. Preview the deletion for one exact parent key (dry run):
   ```bash
   "$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python" \
     "$HOME/.agents/skills/zotero-pipeline/scripts/delete-item-chunks.py" <KEY>
   ```
2. After Samuel confirms that key, delete:
   ```bash
   "$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python" \
     "$HOME/.agents/skills/zotero-pipeline/scripts/delete-item-chunks.py" <KEY> \
     --confirm-key <KEY>
   ```
3. Re-index the item with the exact-item route, or resume its run, then rebuild BM25.

Resuming the original run is usually simpler: its index stage replaces the item's chunks.

## Re-keying after Item Re-import

When an item is re-imported under a new key with an identical PDF:

1. Verify that the old and new PDF SHA-256 values match.
2. Reprocess the new key with `zotero-process` (a seeded rerun from the run that holds the old key's OCR avoids fresh OCR only if the seed supports the new key; otherwise run fresh OCR after Samuel approves it).
3. Preview and, after confirmation, delete the old key's chunks with `delete-item-chunks.py` as above.
4. Rebuild BM25, the citation graph and the reference index. Remove the old key's sidecar files only after the new item verifies.

## Figure Schema Maintenance

`~/.local/bin/zotero-vlm-enrich.py` writes `[Figure Schema]` blocks and captions into the live Surya sidecars by default (`ZOTERO_SIDECAR_DIR` overrides). Processing runs call it automatically in the `enrich` stage. Standalone modes need a running Qwen server; set `ZOTERO_VLM_URL=http://127.0.0.1:18084/v1/chat/completions` after `zotero-vlm-rocm.sh start`, and run `zotero-vlm-rocm.sh stop` afterwards:

- Default: adds schemas and captions below unenriched images.
- `--force`: re-runs the VLM on every figure (after a vision-model upgrade).
- `--captions-only`: local caption extraction without the VLM.
- `--relocate`: moves legacy schemas directly beneath their images.

Re-index every changed item with the exact-item route afterwards. Do not re-enrich a collection because one figure query was unhelpful.

## Chroma Corruption Recovery

Use this only after confirming unrecoverable Chroma corruption.

1. Prefer restoring the newest verified backup: `~/.config/zotero-mcp/chroma_db.pre-run` (with `bm25_index.json.pre-run`) from the last processing run, or a `zotero-chroma-*.tar.gz` in `~/zotero-mcp-backups/`. Check `pragma quick_check` on the restored `chroma.sqlite3`, then re-index any items processed after that backup.
2. If no usable backup exists, preview the rebuild helper's plan:
   ```bash
   "$HOME/.agents/skills/zotero-pipeline/scripts/recover-chroma.sh"
   ```
3. Show the plan to Samuel and run it with `--confirm` only after explicit approval. It archives rather than deletes the damaged database, re-embeds from the live sidecars, rebuilds BM25 and restarts the service. Never run its underlying `--allow-mass-deletion` command directly.

Preserve the archive until recovery is verified.
