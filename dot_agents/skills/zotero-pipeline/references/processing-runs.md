# Processing Runs (Surya Batch)

**Load this file when** starting, monitoring, resuming or finishing a Surya processing run, planning a seeded rerun after a code change, estimating run time, or deploying a new fork tag.

## Stages

`zotero-process start` launches `python -m zotero_mcp.surya_batch` from the fork's virtual environment (`~/.local/src/zotero-mcp/.venv`) against the live config with `--allow-live`. The batch runs four stages in order, with per-item checkpoints:

| Stage | What it does | GPU server |
|---|---|---|
| `ocr` | Renders pages, runs Surya OCR 2 in page-bounded chunks (`--chunk-pages`, default 160), assembles and checks each sidecar | Surya container `zotero-surya` on `:18090`, stopped afterwards |
| `repair` | One Qwen re-read per unresolved table; deterministic fixes from the PDF text layer | Qwen via `zotero-vlm-rocm.sh` on `:18084` |
| `enrich` | Figure schemas and captions through `~/.local/bin/zotero-vlm-enrich.py`; must follow repair | Same Qwen server, stopped afterwards |
| `index` | `update-db --fulltext --no-batch --item-key ...` against the live config, then BM25 | Embedder `:8082` (not started by the batch) |

The batch stops every server it started on exit, including on `SIGTERM`. It refuses the live config without `--allow-live`.

## Run Directory

Each run lives in `~/.cache/zotero-mcp/surya-work/runs/<name>/`:

- `state.json`: scope, sidecar directory, and per-item `done` stages, `level`, `errors` and PDF hash.
- `run.log`: stage progress and the final `done in N min: X/Y complete` line.
- `index.log`: output of the index stage.
- `ocr/`: raw Surya artifacts. These are the seeds for later reassembly; never delete them.
- `live-backup.txt`: written by `zotero-process start` when it took the `*.pre-run` backup.

## Timing

Use past runs as rough guidance, then check the actual page counts:

- Journal articles: a few minutes each (one 90-article run averaged under four minutes per article).
- Books: one to two hours each.
- Long software manuals: up to ten hours for a 1,200-page manual.

Most time is OCR; scanned pages and dense tables are slowest. A seeded rerun skips OCR but still spends GPU time on repair, enrichment and indexing.

## Stopping and Resuming

- Stop a run with `systemctl --user stop zotero-surya-<name>`. Stopping during `index` is safe: the item being indexed keeps its old chunks (or has none if it is new) until the run is resumed.
- Resume by rerunning `zotero-process start` with the same `--run` name and the same keys. Completed stages are skipped. If an item's PDF hash changed, its stages restart.
- A run name with a different scope is refused; choose a new name instead of editing `state.json`.
- After a crash, check `podman ps` for a leftover `zotero-surya` or Qwen container before resuming, and stop only that container.

## Finishing and Verifying

`zotero-process finish --run <name>` requires the unit to have exited. It checks for each item:

1. All four stages are in `done` and `errors` is empty.
2. `<KEY>.md`, `<KEY>.blocks.json` and `<KEY>.reliability.json` exist in the live sidecar directory.
3. The live Chroma index holds chunks for the key.

It then refuses if `~/Zotero/zotero.sqlite-wal` is not empty, rebuilds the citation graph and reference index with the installed package, and restarts `zotero-mcp.service` so the server reloads the index. If any check fails, it stops before rebuilding; diagnose and resume.

After finishing, run one exact-item retrieval (for example `zotero_find_in_item`) and confirm it reports `sidecar_parser: surya` and a `reliability` block.

## Seeded Reruns

A seeded rerun reassembles sidecars from an earlier run's saved OCR instead of running Surya:

```bash
cd ~/.local/src/zotero-mcp
systemd-run --user --unit zotero-surya-<name> --collect --same-dir \
    .venv/bin/python -m zotero_mcp.surya_batch \
    --config "$HOME/.config/zotero-mcp-shadow/config.json" \
    --item <KEY> --run <name> --seed-from <source-run>
```

- Run it on the shadow config (`~/.config/zotero-mcp-shadow/config.json`, collection `zotero_library_shadow`) first, and compare before and after.
- The seed run must hold every item's OCR with the same PDF hash; a missing seed is an error.
- For the live rollout, use the live config with `--allow-live` only after Samuel approves the exact keys, take the same backups `zotero-process start` takes, and finish with `zotero-process finish`.

## Deploying a Fork Tag

The live server runs the fork from `~/.Uvfile`'s pinned tag through `uv tool`. After a tested change on branch `samuel`:

1. Commit and push the branch; create and push an annotated tag `samuel-v0.11.0.<N>`.
2. Update the tag in `~/.Uvfile`, then `chezmoi add ~/.Uvfile`.
3. Stop `zotero-mcp.service`, reinstall with `uv tool install --force 'zotero-mcp-server[semantic,pdf] @ git+https://github.com/samuelueluel/zotero-mcp.git@<tag>'`, and start the service.
4. Confirm `~/.local/share/uv/tools/zotero-mcp-server/uv-receipt.toml` names the new tag, then probe one search and one exact-item read.
5. Recheck `~/.agents/references/zotero/tool-params.md` if tool parameters changed.

Deployment needs Samuel's authorization. `sjust uv` reinstalls whatever `~/.Uvfile` pins, so a stale pin silently downgrades the server.
