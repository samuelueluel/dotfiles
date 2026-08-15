# Service Operations (embedder, reranker, desktop)

**Load this file when** a search or index run fails with a connection error, when a service looks up but behaves wrong (slow/wedged), when you need to work with Zotero desktop closed, or when you need the SQL for the post-ingest verification checklist. The policy table lives in SKILL.md § Service preconditions — this file is the reasoning and the recovery detail.

## Why the embedder is never auto-started

The :8082 embedder loads a multi-GB quantized model into unified memory. Auto-starting it has **crashed the machine**. This is Samuel's explicit standing rule and overrides any local judgment that starting it would be convenient — even for an explicit "index this" request, ask first and wait for the port.

The reranker (:8083) is different in kind, not just degree: it is small, it only reorders candidates already retrieved, and if it is missing search still returns correct results in dense-only order. That asymmetry is why the reranker may be auto-started and the embedder may not.

## What each service actually gates

- **Embedder :8082 — both legs of search.** At index time it embeds each chunk; at query time it embeds the query string before the ChromaDB lookup. Corpus vectors are persisted, so a query does NOT re-embed the corpus — but it always embeds the query. Therefore: embedder down = no searching at all, not merely no indexing.
- **Reranker :8083 — precision only.** A cross-encoder over the dense+sparse candidate set. Adds roughly a second per search. When absent, the service log records `HTTP reranker error ... returning unreranked order` and results come back in fused order. Harmless.
- **Zotero desktop :23119 — enrichment and writes.** Retrieval works without it, but results lose title/creators/page/citation, `get_item_fulltext` fails, and every write path (add/update/delete/attach) is unavailable.
- **VLM :8084 — offline figure enrichment only.** Serves Qwen2.5-VL-72B (Q6_K, ~58 GB) for `zotero-vlm-enrich.py`; never consulted during search or index runs. Samuel starts it (`serve-vlm` — never auto-start; it pulls a multi-GB model into unified RAM), and it should be stopped (`stop-vlm`) as soon as a batch ends.

## Error-to-cause map

| Symptom | Cause | Action |
|---|---|---|
| `Semantic search error: Connection error.` | Embedder :8082 down (`openai.APIConnectionError` from the query-embedding call) | Ask Samuel to run `serve-embedder`; re-run after the port answers |
| `Error enriching result for item <key>: Connection refused` | Desktop down | Non-fatal; ask Samuel to open Zotero if citations matter, else use the DB fallback below |
| `HTTP reranker error ... returning unreranked order` (log only) | Reranker :8083 down | Auto-start `serve-reranker`, or proceed and mention it |
| `Connection error in upsert` during an index run | Embedder down or wedged mid-run | Probe for a wedge (below), then restart or ask |
| Tool reports a missing Python module | Optional extra not installed | See `library-ops.md` — do not try to install it yourself |

## Embedder wedge (the recurring gremlin)

The :8082 server can wedge at ANY container start, in two flavors:

- **Deadlock** — 0% CPU, ignores SIGTERM.
- **Slow-crawl** — looks healthy by CPU/GPU, but takes ~24 s per tiny embedding and upserts fail.

Probe with a tiny embedding request: healthy is well under a second, wedged is 20 s+.

```bash
time curl -s http://127.0.0.1:8082/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"input":"probe","model":"embed"}' >/dev/null
```

Fix: `podman restart embedder` (may need SIGKILL). **Always re-probe after a restart, before launching a long job** — a fresh container can come up wedged again.

## Service interaction gotchas

- ~={magenta}Host-wide `pkill -9 llama-server` kills every engine, including the ones inside the ramalama containers=~ — under rootless podman the container processes ARE host processes. Observed 2026-08-15: `lem-unload`'s old host pkill destroyed the embedder, reranker and VLM engines at once; the embedder/reranker containers then self-removed (`--rm`) and the vlm container restarted and reloaded its ~58 GB model. `lem-unload` now scopes its kill to the lemonade container (`podman exec lemonade pkill -9 llama-server`) — never reintroduce a host-wide pkill.
- Ramalama containers do not survive engine death: killing their llama-server removes (embedder/reranker) or restarts (vlm) the container. Recovery is always re-serve (`serve-embedder` / `serve-reranker`; the vlm container restarts itself), never `podman start`.

## Sandbox gate

`serve-embedder` / `serve-reranker` and the `~/.local/bin` index scripts exist only on the HOST shell; the pi-safe container image deliberately ships no ramalama/podman. Detect it:

```bash
command -v ramalama    # empty => sandboxed
```

`/run/.containerenv` also exists there. From a sandbox, NEVER attempt `serve-*` — report which service is down and ask Samuel to start it on the host, then wait for the port to respond.

## Working with Zotero desktop closed

Reads can be served entirely from local files.

**Critical gotcha:** with desktop running, plain `sqlite3 ~/Zotero/zotero.sqlite` fails with `database is locked` — and so does `?mode=ro`. Use an **immutable** URI, which works whether or not desktop is open:

```bash
sqlite3 "file:$HOME/Zotero/zotero.sqlite?immutable=1" "<query>"
```

Metadata for a set of item keys (title/date/journal + authors):

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

Full text comes from the MinerU sidecar `~/.config/zotero-mcp/mineru-sidecars/<item_key>.md`, since `get_item_fulltext` shares the web-API-first dependency (`deep-dive-reading.md`).

## Verification SQL (checklist in SKILL.md §5)

**Always exclude trash.** Trashed attachments are legitimately parentless, and a large share of this library's attachment rows are trashed — a raw `parentItemID IS NULL` count looks alarming and means nothing.

```sql
-- Live standalone attachments; expect 0
SELECT COUNT(*) FROM itemAttachments a
LEFT JOIN deletedItems d ON d.itemID = a.itemID
WHERE a.parentItemID IS NULL AND d.itemID IS NULL;

-- Live regular items vs live attachments (sanity: attachments >= items)
SELECT
 (SELECT COUNT(*) FROM items i JOIN itemTypes t ON i.itemTypeID=t.itemTypeID
   LEFT JOIN deletedItems d ON d.itemID=i.itemID
   WHERE d.itemID IS NULL AND t.typeName NOT IN ('attachment','note','annotation')) AS regular_items,
 (SELECT COUNT(*) FROM itemAttachments a
   LEFT JOIN deletedItems d ON d.itemID=a.itemID WHERE d.itemID IS NULL) AS attachments;

-- Duplicate linked attachments: same parent pointing at the same file
SELECT a.parentItemID, a.path, COUNT(*) c FROM itemAttachments a
WHERE a.linkMode = 2 GROUP BY 1,2 HAVING c > 1;

-- Linked attachments missing contentType (the zotero-link issue)
SELECT COUNT(*) FROM itemAttachments
WHERE linkMode = 2 AND COALESCE(contentType,'') = '';
```

`linkMode`: 0 imported_file, 1 imported_url, 2 linked_file, 3 linked_url. Anything created by `zotero-link` is mode 2.

## Live-state checks, not remembered numbers

Never assert counts from memory. Get current state from:

- `zotero_zotero_get_search_database_status` — index doc count, model, last update, whether an update is due.
- `zotero_zotero_list_libraries` — library IDs and item counts.
- The SQL above — live item/attachment composition.

Historical narrative (which failure happened when, and the evidence behind each design choice) lives in the vault: `10_Projects/Local-LLMs/Memories/New-RAG-Setup.md` and `10_Projects/Local-LLMs/MCP-Servers/Zotero-MCP.md`. Those are provenance, not operating procedure — read them for context, not for commands.
