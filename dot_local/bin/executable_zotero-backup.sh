#!/usr/bin/env bash
# zotero-backup.sh — layered backups of the zotero-mcp RAG durable artifacts.
#
#   Layer 1 (sidecars):  ~/.config/zotero-mcp/surya-sidecars/ text  -> ~/Dropbox/zotero-mcp-backups/
#                        (<KEY>.md, .blocks.json, .reliability.json; ~213 MB raw;
#                         full parsed text + checks + figure schemas — the crown jewel;
#                         off-machine via Dropbox)
#   Layer 2 (crops):     ~/.config/zotero-mcp/surya-sidecars/*.images -> ~/zotero-mcp-backups/
#                        (~222 MB; page crops rendered from the PDFs, VLM enrichment inputs)
#   Layer 1b (OCR seeds): ~/.cache/zotero-mcp/surya-work/runs/ JSON -> ~/Dropbox/zotero-mcp-backups/
#                        (state.json, manifest.json, results.json; ~160 MB raw; the inputs
#                         seeded reruns reassemble from — losing them means days of fresh OCR.
#                         Page PNGs are skipped: they re-render from the PDFs)
#   Surya sidecars replaced MinerU on 2026-10-08; MinerU sidecars are no longer backed up.
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
SIDECAR_SRC="$HOME/.config/zotero-mcp/surya-sidecars"
RUNS_SRC="$HOME/.cache/zotero-mcp/surya-work/runs"
CHROMA_SRC="$HOME/.config/zotero-mcp/chroma_db"
LOCAL_DST="$HOME/zotero-mcp-backups"
DROPBOX_DST="$HOME/Dropbox/zotero-mcp-backups"
KEEP=3
LOG="$HOME/.cache/zotero-mcp/logs/backup.log"

mkdir -p "$LOCAL_DST" "$DROPBOX_DST"
log() { echo "$(date '+%F %T') $*" >>"$LOG"; echo "$(date '+%F %T') $*"; }
prune() { # prune <dir> <pattern> <keep>
  ls -1t "$1"/$2 2>/dev/null | tail -n +"$3" | while read -r old; do rm -f -- "$old"; log "pruned $old"; done
}

log "=== backup start $STAMP ==="

# Layer 1: sidecars -> Dropbox
if [ -d "$SIDECAR_SRC" ]; then
  tar -czf "$DROPBOX_DST/zotero-sidecars-$STAMP.tar.gz" -C "$SIDECAR_SRC" --exclude="*.images" . \
    && log "layer1 sidecars -> $DROPBOX_DST/zotero-sidecars-$STAMP.tar.gz ($(du -h "$DROPBOX_DST/zotero-sidecars-$STAMP.tar.gz" | cut -f1))"
  prune "$DROPBOX_DST" "zotero-sidecars-*.tar.gz" "$((KEEP + 1))"
fi

# Layer 1b: OCR seed JSON -> Dropbox
if [ -d "$RUNS_SRC" ]; then
  ( cd "$RUNS_SRC" && find . -type f \( -name state.json -o -name manifest.json -o -name results.json \) -print0 \
      | tar -czf "$DROPBOX_DST/zotero-ocr-seeds-$STAMP.tar.gz" --null -T - ) \
    && log "layer1b ocr seeds -> $DROPBOX_DST/zotero-ocr-seeds-$STAMP.tar.gz ($(du -h "$DROPBOX_DST/zotero-ocr-seeds-$STAMP.tar.gz" | cut -f1))"
  prune "$DROPBOX_DST" "zotero-ocr-seeds-*.tar.gz" "$((KEEP + 1))"
fi

# Layer 2: crops -> local
if [ -d "$SIDECAR_SRC" ]; then
  ( cd "$SIDECAR_SRC" && tar -czf "$LOCAL_DST/zotero-crops-$STAMP.tar.gz" ./*.images ) \
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
