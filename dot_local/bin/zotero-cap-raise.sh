#!/usr/bin/env bash
# zotero-cap-raise.sh — after the full force-rebuild completes:
#   1) identify items truncated by max_chunks_per_item (n_chunks > cap OR doc_count == cap)
#   2) bump chunking.max_chunks_per_item 1000 -> 3000 (config backup first)
#   3) delete those items' docs from ChromaDB (makes update-db re-queue exactly them)
#   4) run update-db --fulltext (targeted re-embed with the new cap)
#   5) verify final doc counts
# Log: ~/.cache/zotero-mcp/logs/cap-raise.log
set -u

LOG_DIR="$HOME/.cache/zotero-mcp/logs"
RUN_LOG="$LOG_DIR/backfill-run.log"
CAP_LOG="$LOG_DIR/cap-raise.log"
TLOG="$LOG_DIR/cap-raise-run.log"
CFG="$HOME/.config/zotero-mcp/config.json"
PY="$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python"
BIN="$HOME/.local/share/uv/tools/zotero-mcp-server/bin/zotero-mcp-server"
OLD_CAP=1000
NEW_CAP=3000

log() { echo "$(date '+%F %T') $*" | tee -a "$CAP_LOG"; }

log "cap-raise watcher start: waiting for rebuild (pid 483667) to exit"

# 1) wait for the rebuild process to exit
while kill -0 483667 2>/dev/null; do sleep 60; done
log "rebuild process exited"
sleep 5

if grep -q "Database update completed:" "$RUN_LOG"; then
  log "rebuild completed cleanly"
else
  log "REBUILD DID NOT COMPLETE CLEANLY — aborting (no config change, no deletes). Log tail:"
  tail -5 "$RUN_LOG" | tee -a "$CAP_LOG"
  exit 1
fi

# 2) identify truncated items
ITEMS=$($PY - <<'EOF' 2>/dev/null
import chromadb, pathlib
from collections import Counter
c = chromadb.PersistentClient(path=str(pathlib.Path.home()/'.config/zotero-mcp/chroma_db'))
col = c.get_collection('zotero_library')
cnt = Counter(); nchunks = {}
off = 0
while True:
    r = col.get(limit=1000, offset=off, include=['metadatas'])
    ms = r['metadatas'] or []
    for m in ms:
        k = m.get('item_key')
        if k:
            cnt[k] += 1
            nchunks[k] = max(nchunks.get(k, 0), int(m.get('n_chunks') or 0))
    off += len(ms)
    if len(ms) < 1000: break
trunc = sorted(k for k in cnt if nchunks.get(k, 0) > 1000 or cnt[k] >= 1000)
print(' '.join(trunc))
EOF
)
log "truncated items: ${ITEMS:-none}"
if [ -z "$ITEMS" ]; then
  log "no truncated items found — done"
  exit 0
fi

# 3) bump the cap
cp "$CFG" "$CFG.bak-cap-$(date +%Y%m%d-%H%M%S)"
python3 - "$CFG" <<'PY'
import json, sys
p = sys.argv[1]
cfg = json.load(open(p))
cfg["semantic_search"]["chunking"]["max_chunks_per_item"] = 3000
json.dump(cfg, open(p, "w"), indent=2)
print("max_chunks_per_item -> 3000")
PY
log "max_chunks_per_item: $OLD_CAP -> $NEW_CAP"
# persist to chezmoi so a 'chezmoi apply' / new-machine setup keeps 3000
chezmoi add "$CFG" 2>>"$CAP_LOG" && log "chezmoi add $CFG (source now carries $NEW_CAP)" || log "WARNING: chezmoi add failed — run manually: chezmoi add $CFG"

# 4) delete truncated items' docs so update-db re-queues them
# (chroma count() takes no where kwarg — get ids first, then delete by ids)
$PY - "$ITEMS" <<'EOF' 2>&1 | tee -a "$CAP_LOG"
import chromadb, pathlib, sys
keys = sys.argv[1].split()
c = chromadb.PersistentClient(path=str(pathlib.Path.home()/'.config/zotero-mcp/chroma_db'))
col = c.get_collection('zotero_library')
total_deleted = 0
for k in keys:
    ids = col.get(where={'item_key': k}, include=[])['ids']
    if not ids:
        print(f"WARNING: no docs found for {k} — nothing to delete")
        continue
    col.delete(ids=ids)
    total_deleted += len(ids)
    print(f"deleted {len(ids)} docs for {k}")
print(f"total deleted: {total_deleted}; collection now: {col.count()}")
if total_deleted == 0:
    raise SystemExit("no docs deleted — aborting targeted re-embed")
EOF
[ ${PIPESTATUS[0]} -eq 0 ] || { log "delete step failed — aborting (no re-embed)"; exit 1; }

# 5) targeted re-embed (normal update-db; only the deleted items re-queue)
: > "$TLOG"
PYTHONFAULTHANDLER=1 setsid nohup "$BIN" update-db --fulltext >> "$TLOG" 2>&1 < /dev/null &
TPID=$!
log "targeted re-embed launched (pid $TPID) -> $TLOG"
while kill -0 "$TPID" 2>/dev/null; do sleep 60; done
log "targeted run exited"
if grep -q "Database update completed:" "$TLOG"; then
  log "targeted re-embed COMPLETED"
else
  log "targeted run did NOT complete cleanly. Log tail:"
  tail -5 "$TLOG" | tee -a "$CAP_LOG"
fi

# 6) verify
$PY - <<'EOF' 2>&1 | tee -a "$CAP_LOG"
import chromadb, pathlib
from collections import Counter
c = chromadb.PersistentClient(path=str(pathlib.Path.home()/'.config/zotero-mcp/chroma_db'))
col = c.get_collection('zotero_library')
print('final total docs:', col.count())
EOF
log "DONE — cap raised to $NEW_CAP, truncated items re-embedded"
