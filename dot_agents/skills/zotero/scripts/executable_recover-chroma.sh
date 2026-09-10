#!/usr/bin/env bash
set -euo pipefail

config_dir="$HOME/.config/zotero-mcp"
database="$config_dir/chroma_db"
server="$HOME/.local/share/uv/tools/zotero-mcp-server/bin/zotero-mcp-server"
python="$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python"
rebuild_bm25="$HOME/.agents/skills/zotero/scripts/rebuild-bm25.py"

if [[ ${1:-} != "--confirm" ]]; then
  echo "Recovery plan:" >&2
  echo "  1. Stop zotero-mcp.service" >&2
  echo "  2. Move $database to a timestamped .damaged archive" >&2
  echo "  3. Rebuild Chroma from sidecars with --allow-mass-deletion" >&2
  echo "  4. Rebuild BM25 and restart the service" >&2
  echo "Rerun with --confirm only after Samuel approves this exact recovery." >&2
  exit 0
fi

if [[ ! -d $database ]]; then
  echo "Chroma database not found: $database" >&2
  exit 1
fi
if [[ ! -x $server || ! -x $python ]]; then
  echo "Pinned zotero-mcp-server environment is unavailable." >&2
  exit 1
fi

archive="${database}.damaged-$(date +%Y%m%d-%H%M%S)"
systemctl --user stop zotero-mcp.service
mv -- "$database" "$archive"
echo "Archived damaged database at $archive"

if ! "$server" update-db --force-rebuild --allow-mass-deletion; then
  echo "Chroma rebuild failed; archived database remains at $archive." >&2
  exit 1
fi

"$python" "$rebuild_bm25"
systemctl --user restart zotero-mcp.service
