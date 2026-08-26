# Service Operations (Embedder, Reranker, Desktop & SQLite)

**Load this file when** a search or index run fails with a connection error, when a service behaves abnormally (slow or wedged), when Zotero item metadata or semantic enrichment returns HTTP 500 while Zotero is open, when operating with Zotero Desktop closed, or when running post-ingest SQL verification.

## Service Gating & Auto-Start Rules

- **Embedder (:8082) — Indexes and Search Queries:** Loads a multi-GB quantized model into unified RAM. Auto-starting can cause system instability. **Ask Samuel to run `serve-embedder`; NEVER auto-start.**
- **Reranker (:8083) — Ranking Precision:** The configured local HTTP reranker is mandatory and fail-closed. The MCP validates configuration at startup but does not launch the Ramalama container. If the port is down, ask Samuel to run `serve-reranker`, then retry. Never substitute Hugging Face, an in-process model, or an unranked result.
- **Zotero Desktop (:23119) — Metadata Writes & Enrichment:** Vector search works without it (omitting live title/creator metadata), but fulltext retrieval and write operations fail. Metadata writes and CSL exports require Desktop. Read-only graph/reference rebuilds and SQLite integrity checks may run with Desktop fully closed; see the WAL rule below. Do not silently use a fallback for failed live enrichment.
- **VLM (:8084) — Offline Figure Enrichment:** Serves the vision model for `zotero-vlm-enrich.py`. Run `serve-vlm` for batch processing and `stop-vlm` immediately after to free RAM.

## Error-to-Cause Diagnostic Map

| Symptom | Root Cause | Remediation |
|---|---|---|
| `Semantic search error: Connection error.` | Embedder :8082 down | Ask Samuel to run `serve-embedder`; retry after port answers |
| `Error enriching result for item <key>: Connection refused` | Zotero Desktop down | Stop and ask Samuel to open Zotero Desktop. If Samuel explicitly says to continue regardless, use the SQLite fallback below; live metadata enrichment, fulltext retrieval, and write operations remain unavailable |
| `HTTP 500` from `localhost:23119` item metadata or enrichment while ping works | Zotero Desktop local API is wedged even though the process and port are available | Ask Samuel to restart Zotero Desktop, then retry the same request |
| `Local reranker endpoint failed` / `HTTP reranker error` | Reranker :8083 down or local endpoint failed | Ask Samuel to run `serve-reranker`, verify the port, and retry. The MCP does not auto-start it; do not use a remote/in-process model or unranked results |
| Semantic results omit the `Rerank` field | Stale service process or incomplete local patch | Treat results as discovery-only, restart/repair the service, and retry before citing a passage; never invent a score |
| `Connection error in upsert` during index run | Embedder wedged or down | Probe for wedge (below) and restart embedder container |
| Tool reports missing Python module | Extra package missing | Run `sjust update` to reinstall `zotero-mcp-server[semantic,pdf]` |

## Zotero Desktop Local API Recovery

If Zotero Desktop is open but item metadata or semantic-search enrichment returns HTTP 500 from `localhost:23119`, the local API is wedged even though the process and port are available.

- Ask Samuel to restart Zotero Desktop.
- Retry the same metadata or semantic-search request after the restart.
- Do not rebuild the semantic index or silently treat the failed enrichment as successful before retrying.
- If the error persists, report the exact endpoint and HTTP status.
- A `403` indicates that Zotero’s local API permission is disabled; this is different from the HTTP 500 recovery case.

## Embedder Wedge Detection and Recovery

The `:8082` embedder can occasionally deadlock at container start (0% CPU) or slow-crawl (~20+ s per embedding). Probe responsiveness with:
```bash
time curl -s http://127.0.0.1:8082/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"input":"probe","model":"embed"}' >/dev/null
```
- **Recovery:** `podman restart embedder`. Always probe before starting long batch jobs.

## Service Safety Guidelines

- **Never host-wide `pkill llama-server`:** Containerized rootless Podman engines run as host processes. Host-wide kills terminate embedder, reranker, and VLM engines simultaneously. Target specific containers instead:
  ```bash
  podman exec lemonade pkill -9 llama-server
  ```
- **Sandbox detection:** Scripts in `~/.local/bin` and commands like `serve-embedder` run on the host shell. Detect if running inside a container sandbox:
  ```bash
  command -v ramalama    # empty output indicates sandboxed environment
  ```

## Working with Zotero Desktop Closed (SQLite fallback)

If Zotero Desktop is closed, live metadata enrichment, full-text retrieval, CSL exports, and writes are unavailable. Read-only graph/reference rebuilds and verification may proceed when Samuel has explicitly authorized them.

**WAL rule:** `immutable=1` ignores `zotero.sqlite-wal`. After a sync, deletion, or metadata change, quit Zotero Desktop completely and wait for its WAL to checkpoint before using an immutable read. Otherwise the query can return an older snapshot even though the live database has changed.

Once the database is fully closed and checkpointed, use the immutable URI for read-only checks:
```bash
sqlite3 "file:$HOME/Zotero/zotero.sqlite?immutable=1" "<SQL_QUERY>"
```

Never use immutable SQLite reads to perform writes, retrieve live full text, or infer that a failed live enrichment succeeded.

### Query Item Metadata and Creators
```sql
SELECT i.key, f.fieldName, idv.value
FROM items i
JOIN itemData id       ON id.itemID = i.itemID
JOIN itemDataValues idv ON idv.valueID = id.valueID
JOIN fields f          ON f.fieldID = id.fieldID
WHERE i.key IN ('KEY1','KEY2') AND f.fieldName IN ('title','date','publicationTitle','DOI');

SELECT i.key, c.lastName, c.firstName, ct.creatorType
FROM items i
JOIN itemCreators ic ON ic.itemID = i.itemID
JOIN creators c      ON c.creatorID = ic.creatorID
JOIN creatorTypes ct ON ct.creatorTypeID = ic.creatorTypeID
WHERE i.key IN ('KEY1','KEY2') ORDER BY i.key, ic.orderIndex;
```

## Post-Ingest Verification SQL

Verify database health and attachment consistency (excluding trashed items):
```sql
-- Live standalone attachments (expected count: 0)
SELECT COUNT(*) FROM itemAttachments a
LEFT JOIN deletedItems d ON d.itemID = a.itemID
WHERE a.parentItemID IS NULL AND d.itemID IS NULL;

-- Live regular items vs live attachments
SELECT
 (SELECT COUNT(*) FROM items i JOIN itemTypes t ON i.itemTypeID=t.itemTypeID
   LEFT JOIN deletedItems d ON d.itemID=i.itemID
   WHERE d.itemID IS NULL AND t.typeName NOT IN ('attachment','note','annotation')) AS regular_items,
 (SELECT COUNT(*) FROM itemAttachments a
   LEFT JOIN deletedItems d ON d.itemID=a.itemID WHERE d.itemID IS NULL) AS attachments;

-- Duplicate linked attachments
SELECT a.parentItemID, a.path, COUNT(*) c FROM itemAttachments a
WHERE a.linkMode = 2 GROUP BY 1,2 HAVING c > 1;

-- Linked attachments missing contentType
SELECT COUNT(*) FROM itemAttachments
WHERE linkMode = 2 AND COALESCE(contentType,'') = '';
```
*Note:* `linkMode` values: `0` imported_file, `1` imported_url, `2` linked_file, `3` linked_url.

## Live State Verification Tools

- `zotero_zotero_get_search_database_status` — Reports total indexed document count, active embedding model, and last update timestamp.
- `zotero_zotero_list_libraries` — Displays accessible libraries and item counts.
