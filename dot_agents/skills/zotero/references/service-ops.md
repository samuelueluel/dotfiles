# Service Operations & Troubleshooting

**Load this file when** resolving connection errors, recovering wedged services, operating with Zotero Desktop closed, or executing SQLite database diagnostics.

## Service Gating & Invariants

- **Embedder (`127.0.0.1:8082`):** Quantized embedding model loaded into unified RAM. Ask Samuel to run `serve-embedder`; **never auto-start**.
- **Reranker (`127.0.0.1:8083`):** Mandatory and fail-closed. If down, ask Samuel to run `serve-reranker`, then retry. Never substitute unranked results or remote models.
- **Zotero Desktop (`127.0.0.1:23119`):** Required for metadata writes, CSL exports, and live full-text extraction. Read-only vector search works without Desktop (omitting live title/creator metadata).
- **Live semantic tag filters:** Require readable local SQLite. After Zotero writes or sync, close Desktop and allow WAL checkpointing before relying on changed tags or item types; never retry without the supplied filter.
- **VLM (`127.0.0.1:8084`):** Offline figure enrichment. Run `serve-vlm` for processing and `stop-vlm` immediately after to release RAM.

## Error Diagnostic Map

| Error Message | Root Cause | Remediation |
|---|---|---|
| `Semantic search error: Connection error.` | Embedder `:8082` down | Ask Samuel to run `serve-embedder`; retry once port answers. |
| `Error enriching result for item <key>: Connection refused` | Zotero Desktop not running | Ask Samuel to open Zotero Desktop. (If Samuel authorizes offline work, use SQLite fallback; writes and live full text remain unavailable). |
| `HTTP 500` from `localhost:23119` metadata/enrichment | Zotero Desktop local API wedged | Ask Samuel to restart Zotero Desktop, then retry. |
| `Local reranker endpoint failed` / `HTTP reranker error` | Reranker `:8083` down | Ask Samuel to run `serve-reranker`, then retry. |
| Semantic results omit `Rerank` field | Stale service process or incomplete patch | Treat results as discovery-only; restart/repair service before citing evidence. |
| `Live tag-filtered semantic search requires local Zotero mode` | Local SQLite unavailable or not configured | Restore local SQLite access and retry the same filtered call; never silently fall back to unfiltered search. |
| `Connection error in upsert` during indexing | Embedder wedged | Probe embedder responsiveness (below) and restart container. |
| Missing Python module in tool | Outdated package environment | Run `sjust update` to reinstall `zotero-mcp-server[semantic,pdf]`. |

## Embedder Probe & Recovery

Probe container responsiveness:
```bash
time curl -s http://127.0.0.1:8082/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"input":"probe","model":"embed"}' >/dev/null
```
If unresponsive or deadlocked: `podman restart embedder`.

## Process Safety & Container Isolation

- **Never host-wide `pkill llama-server`:** Containerized Podman engines run as host processes. Host-wide kills terminate embedder, reranker, and VLM engines simultaneously.
- **Target specific containers instead:**
  ```bash
  podman exec lemonade pkill -9 llama-server
  ```
- **Sandbox check:** Host tools in `~/.local/bin` require the host shell. Check environment with `command -v ramalama` (empty output indicates sandboxed environment).

## Offline SQLite Operations (Desktop Closed)

When Zotero Desktop is closed, read-only graph/reference rebuilds and verification may proceed when authorized.

**WAL Rule:** SQLite `immutable=1` ignores `zotero.sqlite-wal`. After library writes or syncs, quit Zotero Desktop completely and allow WAL checkpointing before reading, otherwise queries will return stale snapshots.

Query command:
```bash
sqlite3 "file:$HOME/Zotero/zotero.sqlite?immutable=1" "<SQL_QUERY>"
```

### Item Metadata & Creators Query
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

Verify database consistency (excluding trash):
```sql
-- Live standalone attachments (expected: 0)
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
*Link modes:* `0` imported_file, `1` imported_url, `2` linked_file, `3` linked_url.

## Live Status Tools

- `zotero_zotero_get_search_database_status`: Reports indexed document counts, active embedding model, and last update timestamp.
- `zotero_zotero_list_libraries`: Displays accessible libraries and item counts.
