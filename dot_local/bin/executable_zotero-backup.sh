#!/usr/bin/env bash
# zotero-backup.sh — layered backups of the zotero-mcp RAG durable artifacts.
#
#   Layer 1 (sidecars):  ~/.config/zotero-mcp/mineru-sidecars/*.md  -> ~/Dropbox/zotero-mcp-backups/
#                        (28 MB; full parsed text + figure schemas — the crown jewel;
#                         off-machine via Dropbox; from this alone everything except
#                         image crops is regenerable)
#   Layer 2 (crops):     ~/.cache/zotero-mcp/mineru-work/           -> ~/zotero-mcp-backups/
#                        (VLM enrichment inputs — lose these and future schema work
#                         needs a MinerU re-run)
#   Layer 3 (chroma):    ~/.config/zotero-mcp/chroma_db/            -> ~/zotero-mcp-backups/
#                        (fast-restore: unpack instead of re-embedding ~19k chunks)
#
# SAFE to run during a rebuild: pure reads. Caveat: the chroma snapshot of a LIVE
# store is a partial/inconsistent copy (sqlite+hnsw mid-write) — acceptable for the
# workflow; re-run after any rebuild completes for a clean fast-restore layer.
# The corrupt store (chroma_db.corrupt-*) is never backed up.
#
# Retention: keeps the 3 most recent tarballs per layer. Log: ~/.cache/zotero-mcp/logs/backup.log
set -u
STAMP=$(date '+%Y%m%d-%H%M%S')
SIDECAR_SRC="$HOME/.config/zotero-mcp/mineru-sidecars"
CROPS_SRC="$HOME/.cache/zotero-mcp/mineru-work"
CHROMA_SRC="$HOME/.config/zotero-mcp/chroma_db"
LOCAL_DST="$HOME/zotero-mcp-backups"
DROPBOX_DST="$HOME/Dropbox/zotero-mcp-backups"
KEEP=3
LOG="$HOME/.cache/zotero-mcp/logs/backup.log"

mkdir -p "$LOCAL_DST" "$DROPBOX_DST"
log() { echo "$(date '+%F %T') $*" >>"$LOG"; echo "$(date '+%F %T') $*"; }
prune() { # prune <dir> <pattern> <keep>
  ls -1t "$1"/$2 2>/dev/null | tail -n +"$3" | while read -r old; do rm -f "$1/$old"; log "pruned $1/$old"; done
}

log "=== backup start $STAMP ==="

# Layer 1: sidecars -> Dropbox
if [ -d "$SIDECAR_SRC" ]; then
  tar -czf "$DROPBOX_DST/zotero-sidecars-$STAMP.tar.gz" -C "$SIDECAR_SRC" . \
    && log "layer1 sidecars -> $DROPBOX_DST/zotero-sidecars-$STAMP.tar.gz ($(du -h "$DROPBOX_DST/zotero-sidecars-$STAMP.tar.gz" | cut -f1))"
  prune "$DROPBOX_DST" "zotero-sidecars-*.tar.gz" "$((KEEP + 1))"
fi

# Layer 2: crops -> local
if [ -d "$CROPS_SRC" ]; then
  tar -czf "$LOCAL_DST/zotero-crops-$STAMP.tar.gz" -C "$CROPS_SRC" . \
    && log "layer2 crops -> $LOCAL_DST/zotero-crops-$STAMP.tar.gz ($(du -h "$LOCAL_DST/zotero-crops-$STAMP.tar.gz" | cut -f1))"
  prune "$LOCAL_DST" "zotero-crops-*.tar.gz" "$((KEEP + 1))"
fi

# Layer 3: chroma (live store only) -> local
if [ -d "$CHROMA_SRC" ]; then
  tar -czf "$LOCAL_DST/zotero-chroma-$STAMP.tar.gz" -C "$(dirname "$CHROMA_SRC")" "$(basename "$CHROMA_SRC")" \
    && log "layer3 chroma -> $LOCAL_DST/zotero-chroma-$STAMP.tar.gz ($(du -h "$LOCAL_DST/zotero-chroma-$STAMP.tar.gz" | cut -f1))"
  prune "$LOCAL_DST" "zotero-chroma-*.tar.gz" "$((KEEP + 1))"
fi

log "=== backup complete ==="
