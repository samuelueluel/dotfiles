# Service Operations (embedder, reranker, desktop)

**Load this file when** a search or index run fails with a connection error, when a service looks up but behaves abnormally (slow or wedged), when you need to work with Zotero desktop closed, or when running post-ingest SQL verification queries.

## Why the embedder is never auto-started

The :8082 embedder loads a multi-GB quantized model into unified memory. Auto-starting it has crashed the machine. This is an explicit standing rule that overrides convenience — even for an explicit "index this" request, ask Samuel to run `serve-embedder` first and wait for the port to answer.

The reranker (:8083) is different: it is small, only reorders candidates already retrieved, and if missing, search still returns correct results in dense-only order. The reranker may be auto-started via `serve-reranker`, but the embedder may not.

## What each service actually gates

- **Embedder :8082 — both indexing and search:** Embeds chunk text at index time and embeds query strings at query time before ChromaDB similarity search. If the embedder is down, search cannot execute.
- **Reranker :8083 — ranking precision only:** Cross-encoder reranking over dense+sparse candidates. When unavailable, search returns fused dense/sparse ranking with a harmless log warning (`HTTP reranker error ... returning unreranked order`).
- **Zotero desktop :23119 — enrichment and write operations:** Vector retrieval functions without it, but results omit title/creators/page metadata, `get_item_fulltext` fails, and write operations (add, update, delete, attach) cannot execute.
- **VLM :8084 — offline figure enrichment:** Serves Qwen3-VL-30B-A3B-Instruct (UD-Q8_K_XL, ~36 GB) for `zotero-vlm-enrich.py`. Never queried during search or standard indexing. Run `serve-vlm` for batch processing and `stop-vlm` immediately after to free RAM.

## Error-to-cause map

| Symptom | Cause | Action |
|---|---|---|
| `Semantic search error: Connection error.` | Embedder :8082 down | Ask Samuel to run `serve-embedder`; retry after port answers |
| `Error enriching result for item <key>: Connection refused` | Desktop down | Non-fatal; ask Samuel to open Zotero if citation metadata is needed, or use SQLite fallback below |
| `HTTP reranker error ... returning unreranked order` | Reranker :8083 down | Auto-start `serve-reranker`, or proceed with fused ranking |
| `Connection error in upsert` during index run | Embedder wedged or down | Probe for wedge (below), restart embedder container |
| Tool reports missing Python module | Optional extra missing | Install `zotero-mcp-server[semantic,pdf]` via `sjust update` |

## Embedder wedge detection and recovery

The :8082 server can wedge at container start in deadlock (0% CPU) or slow-crawl (~20+ s per embedding). Probe with:
```bash
time curl -s http://127.0.0.1:8082/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"input":"probe","model":"embed"}' >/dev/null
```
Recovery: `podman restart embedder`. Always re-probe before starting long batch jobs.

## Service interaction guidelines

- **Never host-wide `pkill llama-server`:** Containerized rootless podman engines run as host processes. Host-wide kills terminate embedder, reranker, and VLM engines simultaneously. Target specific containers instead (e.g. `podman exec lemonade pkill -9 llama-server`).
- Ramalama containers do not survive engine process termination. Recovery requires running the corresponding shell launcher (`serve-embedder` / `serve-reranker`).

## Sandbox detection

`serve-embedder` / `serve-reranker` and `~/.local/bin` index scripts exist only on the host shell; container sandboxes lack ramalama and podman. Detect sandbox:
```bash
command -v ramalama    # empty => sandboxed environment
```
From a sandbox, report which service is down and request Samuel to start it on the host.

## Working with Zotero desktop closed

Direct SQLite reads bypass desktop dependency.

**Lock Prevention:** Standard SQLite reads fail with `database is locked` when desktop is open. Use the immutable URI parameter, which works concurrently regardless of desktop state:
```bash
sqlite3 "file:$HOME/Zotero/zotero.sqlite?immutable=1" "<query>"
```

Query item metadata and creators:
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

Read full text from MinerU sidecars (`~/.config/zotero-mcp/mineru-sidecars/<item_key>.md`) when desktop is closed.

## Post-ingest verification SQL

Always exclude deleted items (`deletedItems`) to prevent trashed attachments from creating false positives:
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
`linkMode`: 0 imported_file, 1 imported_url, 2 linked_file, 3 linked_url.

## Live state verification

Retrieve live status from active tools rather than memorized numbers:
- `zotero_zotero_get_search_database_status` — index doc count, embedding model, last update timestamp.
- `zotero_zotero_list_libraries` — accessible libraries and item counts.
- Provenance and design rationale: `10_Projects/Local-LLMs/MCP-Servers/Zotero-MCP.md`.
