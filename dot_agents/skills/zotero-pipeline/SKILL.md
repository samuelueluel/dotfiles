---
name: zotero-pipeline
description: Processes new or changed Zotero papers through Surya OCR 2 sidecars, table repair, figure enrichment and live indexing, and maintains embeddings, the citation graph, the reference index and retrieval services. Use when Samuel asks to process, parse, OCR, ingest, index or re-embed a paper, run or resume a Surya batch, rebuild the citation graph or reference index, or diagnose or recover a Zotero pipeline or index failure.
---

# Zotero Paper Processing and Index Pipeline

## Request-Routing Playbook

```text
REQUEST
├─ Process a new or changed paper? ───────────→ PROCESS: confirm scope → zotero-process start → status → finish
├─ Resume or check a processing run? ─────────→ PROCESS: zotero-process status → diagnose → start (same run) → finish
├─ Roll out a fixed assembler or checker? ────→ RESEED: shadow seeded run → compare → approved live seeded run
├─ Refresh index text for exact items? ───────→ INDEX: exact-item update-db → verify chunks
├─ Rebuild citation graph or reference index? → DERIVED INDEX: WAL check → rebuild tools → verify counts
├─ Service or index failure? ─────────────────→ DIAGNOSE: scoped status/probe → report cause
├─ Interrupted run or corrupted index? ───────→ RECOVER: inspect plan → explicit approval → reviewed helper
└─ Read a paper or answer research? ──────────→ RESEARCH: load the matching task-specific Zotero skill
```

## Safety Boundaries

- MinerU is retired. Never run MinerU, `magic-pdf`, `run_mineru`, `zotero-sidecar.sh` or the other `zotero-sidecar-*` helpers; they refuse by design. Surya through `zotero-process` (or `zotero_mcp.surya_batch`) is the only parser route.
- Every processing run uses the GPU for hours or minutes. Before starting one, tell Samuel the exact item keys, the stages, and a rough time estimate, and get his explicit go-ahead. A research request never authorizes processing.
- Use exact parent item keys. Never turn an unresolved or empty collection into an unscoped run, embed or re-embed.
- Only one pipeline GPU server runs at a time. The batch starts and stops its own Surya (`:18090`) and Qwen (`:18084`) servers; never start them by hand for a live run, and never run a host-wide `pkill llama-server`.
- Ask Samuel to run `serve-embedder` or `serve-reranker` when they are down. Never start or stop them yourself.
- Do not stop a run during its `index` stage unless it is hung: indexing deletes an item's chunks before writing the new ones, so the item has no chunks until the run is resumed.
- Before deleting chunks, archiving an index, or approving a mass rebuild, show the exact targets and get Samuel's explicit approval. Use the reviewed helpers under `scripts/`; never substitute raw destructive shell commands.
- Never upload PDFs to Zotero Cloud. Adding and linking items belongs to [library management](../zotero-library/SKILL.md).
- Never download, parse or embed a paper merely because it appears in a bibliography.
- Do not enable or disable MCP servers, install native host packages, or run `chezmoi apply`.

## 1. Scope and Preconditions

1. Identify the exact parent item keys and what changed: a new PDF, a replaced PDF, a code fix, or metadata only.
2. Metadata, tag, item-type and collection changes need no processing or re-embedding.
3. Check that each item has exactly one intended PDF attachment. Fix ambiguous or missing attachments through [library management](../zotero-library/SKILL.md) first.
4. Zotero Desktop should be running when a run starts, so items resolve. It must be fully closed, with an empty `~/Zotero/zotero.sqlite-wal`, before graph or reference rebuilds; immutable SQLite reads ignore pending WAL writes.
5. The embedder (`:8082`) must answer before a run; the index stage needs it.
6. Inspect live state (run logs, `state.json`, the index) rather than trusting counts or dates in notes.

## 2. Process New or Changed Papers

Load [processing runs](references/processing-runs.md) for stage details, logs, timing and resume rules.

1. Preview the run without launching anything:
   ```bash
   zotero-process start --run <name> --item <KEY> [--item <KEY> ...] --dry-run
   ```
   It validates keys, refuses while another Surya run is active, checks the embedder, and notes items that are already indexed.
2. Give Samuel the keys, page counts if known, and a rough estimate: a journal article takes a few minutes, a book or manual several hours. Start only after his explicit go-ahead.
3. Start the run. It saves a rolling backup of the live index (`chroma_db`, `bm25_index.json`, `config.json` as `*.pre-run` in `~/.config/zotero-mcp/`), then launches the detached unit `zotero-surya-<name>`:
   ```bash
   zotero-process start --run <name> --item <KEY> [--item <KEY> ...]
   ```
4. Check progress with `zotero-process status --run <name>`. Do not report the run complete while the unit is active.
5. If the run stops with errors, read `run.log` and `index.log` in the run directory, fix the cause, then rerun the same `start` command with the same name and keys. It resumes from per-item checkpoints and keeps the first backup.
6. When the unit has exited, finish the run:
   ```bash
   zotero-process finish --run <name>
   ```
   It verifies every item (all stages done, sidecar files present, chunks in the live index), rebuilds the citation graph and reference index, and restarts `zotero-mcp.service`. It refuses while Zotero's WAL holds pending writes.
7. Read each item's reliability level in the `finish` output. For `warn` items, open `<KEY>.reliability.json` and report the listed problem tables and scanned pages; they are transcription limits, not failed processing.

## 3. What a Processed Paper Contains

Each item gets four outputs in the live sidecar directory (`semantic_search.mineru.sidecar_dir` in the live config):

- `<KEY>.md`: the text, with `<!-- pdf-page: N -->` anchors and status lines on checked tables and equations.
- `<KEY>.blocks.json`: one record per block with page, PDF box, label and check results.
- `<KEY>.reliability.json`: the item level (`ok`, `caution`, `warn`), problem tables and scanned pages.
- `<KEY>.images/`: page crops used for figure schemas.

Retrieval tools pass these signals on as `reliability`, `block_status` and `requires_pdf_check`. How to read them belongs to [citation integrity](../citation-integrity/SKILL.md). A `verified` table proves its numbers match the text layer, not that every header and label is right.

## 4. Roll Out a Fixed Assembler or Checker

A code change to assembly, verification or repair is rolled out without fresh OCR, by reassembling from a run's saved OCR (`--seed-from`). This still uses the GPU for table re-reads, figure enrichment and indexing.

1. Develop and test the change in a separate git worktree of `~/.local/src/zotero-mcp`; run the test suite.
2. Run the seeded rerun on the shadow config first and compare affected blocks against the rendered pages. Keep conservative flags rather than add a tolerance that hides real errors.
3. Deploy the fork tag (see [processing runs](references/processing-runs.md)), then run the approved live seeded rerun on exact keys with `--allow-live`, and finish it like a processing run.
4. Never delete raw OCR run directories under `~/.cache/zotero-mcp/surya-work/runs/`; they are the seeds for every future reassembly. A missing seed is an error, never permission for fresh OCR.

## 5. Embeddings and Derived Indexes

For exact-item refreshes of existing sidecar text, use `zotero_update_semantic_index(item_keys=[...])` or:

```text
zotero-mcp-server update-db --fulltext --no-batch --item-key KEY [--item-key OTHERKEY]
```

The exact-key route preserves every requested key, bypasses DOI/title deduplication, refreshes existing chunks and leaves the sync watermark alone. Never broaden it into a library rebuild.

Rebuild the citation graph and reference index with `zotero_rebuild_citation_graph` and `zotero_rebuild_reference_index` (or `zotero-process finish` after a run). Both read the live sidecar directory and need the WAL precondition, not Chroma re-embedding. They take seconds.

Completed indexing keeps sparse BM25 in step; rebuild it manually only for a diagnosed interruption or drift.

Verify the requested items' chunk counts and source metadata, then run a bounded exact-item retrieval. A positive relevance score is not proof of faithful OCR.

## 6. Diagnosis and Recovery

For errors, load [service operations](references/service-ops.md); for index mutation or recovery, load [index maintenance](references/index-maintenance.md).

- Use `zotero_get_semantic_index_status` after a readiness or index error, not before every research query.
- Name the failing layer: source file, Surya OCR, assembly, repair VLM, index, embedder, reranker, Zotero metadata access, or response formatting.
- A relevance miss does not establish corruption. Do not rebuild indexes to fix a clipped preview.
- Missing `Rerank` means semantic output is discovery-only; direct reading through `zotero-source-reading` still works.
- Prefer restoring a verified backup (`*.pre-run`, `*.pre-surya`, or `~/zotero-mcp-backups/`) over rebuilding. Run any recovery helper in dry-run mode first and proceed only after Samuel approves the shown targets.
- Package reinstalls and deployments need Samuel's authorization and follow the pin in `~/.Uvfile`.

## 7. Report Outcomes

Report what ran, what verification passed, and what remains unresolved. Keep processing success, index success and retrieval success separate, and list `warn` items with their problem pages. Do not claim the pipeline is repaired because a process started or a command returned.

Ordinary source reading belongs to [source reading](../zotero-source-reading/SKILL.md), paper lists to [paper discovery](../zotero-paper-discovery/SKILL.md), result ranking to [result comparison](../zotero-result-comparison/SKILL.md), and metadata changes to [library management](../zotero-library/SKILL.md).

## Reference Routing

- For run stages, run directories, logs, timing, resuming, seeded reruns and fork deployment, load [processing runs](references/processing-runs.md).
- For exact-key re-embeds, sparse index rebuilds, chunk deletion, re-keying, figure-schema maintenance or Chroma recovery, load [index maintenance](references/index-maintenance.md).
- For endpoint errors, offline SQLite diagnostics, service probes and deployment failures, load [service operations](references/service-ops.md).
