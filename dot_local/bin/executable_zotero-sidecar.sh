#!/usr/bin/env bash
# zotero-sidecar.sh — create / enrich / embed / reembed MinerU+VLM sidecars.
# Separates "create sidecar" (MinerU parse) from "embed" (chunk+embed+index).
#
# Usage:
#   zotero-sidecar.sh create  <COLLECTION_KEY | KEY...>   # MinerU parse ONLY -> <key>.md (GPU, background)
#   zotero-sidecar.sh enrich  <COLLECTION_KEY | KEY...>   # VLM [Figure Schema] blocks (needs :8084)
#   zotero-sidecar.sh check   <KEY...>                    # write/review sidecar quality reports
#   zotero-sidecar.sh embed   <COLLECTION_KEY...>         # chunk+embed+index NEW sidecars
#   zotero-sidecar.sh reembed <COLLECTION_KEY...>         # exact-item refresh after quality preflight
#   zotero-sidecar.sh process --key KEY [batch options]   # new document: staged parse/enrich/check/index
#   zotero-sidecar.sh reprocess [batch options]            # regenerate all existing sidecars and re-embed
#
# - create/enrich accept a collection key OR explicit item keys (any collection).
# - embed/reembed take one or more collection keys (scoped so nothing outside is touched).
# - All custom patches (MinerU ROCm fixes, AST chunker + DCR breadcrumbs, hybrid
#   filter, VLM caption stamping) are inherited automatically because these call
#   the same production code paths (run_mineru / vlm-enrich / update-db).
#
# Prereqs: embedder :8082 up. process/reprocess use the dedicated ROCm VLM
# :18084 by default; standalone enrich uses the shared :8084 by default.
# Collection key from references/collections.md or `zotero_read_zotero_collections`.
set -u
UVPY="$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python"
BIN="$HOME/.local/share/uv/tools/zotero-mcp-server/bin/zotero-mcp-server"
CFG="$HOME/.config/zotero-mcp/config.json"
SCOPED="/tmp/zotero-sidecar-scoped.json"
QUALITY="$HOME/.local/bin/zotero-sidecar-quality.py"

cmd="${1:-}"; shift || true
if [ -z "$cmd" ] || { [ "$#" -eq 0 ] && [ "$cmd" != reprocess ]; }; then
  echo "usage: zotero-sidecar.sh {create|enrich|check|embed|reembed|process|reprocess} <COLLECTION_KEY | KEY...>"
  exit 1
fi

# Resolve a collection key to its item keys; pass explicit item keys through.
resolve_keys() {
  local arg="$1"
  if [ ${#arg} -eq 8 ] && [[ "$arg" =~ ^[A-Za-z0-9]+$ ]]; then
    "$UVPY" - "$arg" <<'EOF'
import json, sys
from pathlib import Path
from zotero_mcp.local_db import LocalZoteroReader
arg = sys.argv[1]
raw = json.loads(Path.home().joinpath('.config/zotero-mcp/config.json').read_text())
db = raw.get('semantic_search', {}).get('zotero_db_path')
with LocalZoteroReader(db_path=db) as r:
    if r.resolve_collection_keys(arg):
        item_keys = sorted(r.resolve_collection_item_keys(arg))
        if not item_keys:
            print(f'collection {arg} is empty; refusing an unscoped operation', file=sys.stderr)
            raise SystemExit(2)
        print(' '.join(item_keys))
    else:
        print(arg)
EOF
  else
    echo "$arg"
  fi
}

# Refuse to index until the package-level gate is installed. A shell-only check
# cannot protect direct `update-db` callers.
assert_quality_gate() {
  "$UVPY" <<'EOF'
import sys
from pathlib import Path
try:
    from zotero_mcp import semantic_search, sidecar_quality
except Exception as exc:
    print(f'shared sidecar quality gate is not installed; refusing indexing: {exc}', file=sys.stderr)
    raise SystemExit(2)
source = Path(semantic_search.__file__).read_text(encoding='utf-8')
markers = (
    '[sidecar quality patch]',
    '[sidecar quality rejection: do not fall back to API]',
    '[sidecar quality rejection: propagate update failure]',
)
missing = [marker for marker in markers if marker not in source]
if missing:
    print(f'shared sidecar quality gate is incomplete ({missing}); refusing indexing', file=sys.stderr)
    raise SystemExit(2)
EOF
}

# Validate every collection before using it as an embed scope.
validate_collections() {
  "$UVPY" - "$CFG" "$@" <<'EOF'
import json, sys
from pathlib import Path
from zotero_mcp.local_db import LocalZoteroReader
cfg = json.loads(Path(sys.argv[1]).read_text())
db = cfg.get('semantic_search', {}).get('zotero_db_path')
with LocalZoteroReader(db_path=db) as r:
    for key in sys.argv[2:]:
        if not r.resolve_collection_keys(key):
            print(f'not a live collection key: {key}', file=sys.stderr)
            raise SystemExit(2)
        if not r.resolve_collection_item_keys(key):
            print(f'collection {key} is empty; refusing an unscoped operation', file=sys.stderr)
            raise SystemExit(2)
EOF
}

# Build a scoped config limited to the given collection keys.
make_scoped() {
  "$UVPY" - "$CFG" "$SCOPED" "$@" <<'EOF'
import json, sys
cfg = json.load(open(sys.argv[1]))
cfg.setdefault("semantic_search", {})["collection_keys"] = sys.argv[3:]
json.dump(cfg, open(sys.argv[2], "w"))
EOF
}

case "$cmd" in
  process|reprocess)
    assert_quality_gate || exit $?
    batch_args=("$@")
    if [ "$cmd" = reprocess ]; then
      resumed=false
      for arg in "${batch_args[@]}"; do
        [ "$arg" = --resume ] && resumed=true
      done
      if [ "$resumed" = false ]; then
        batch_args=(--existing-sidecars "${batch_args[@]}")
      fi
    fi
    "$UVPY" "$HOME/.local/bin/zotero-sidecar-reprocess.py" "${batch_args[@]}"
    ;;
  create)
    setsid nohup "$UVPY" "$HOME/.local/bin/zotero-sidecar-create.py" "$@" >/dev/null 2>&1 </dev/null &
    echo "sidecar create launched (background). Log: ~/.cache/zotero-mcp/logs/sidecar-create.log"
    ;;
  enrich)
    for arg in "$@"; do
      resolved_text="$(resolve_keys "$arg")" || exit $?
      for k in $resolved_text; do
        echo "enriching $k"
        "$UVPY" "$HOME/.local/bin/zotero-vlm-enrich.py" --key "$k"
      done
    done
    ;;
  check)
    "$UVPY" "$QUALITY" check "$@"
    ;;
  embed)
    assert_quality_gate || exit $?
    validate_collections "$@" || exit $?
    make_scoped "$@"
    "$BIN" update-db --fulltext --config-path "$SCOPED" || exit $?
    systemctl --user restart zotero-mcp.service
    ;;
  reembed)
    assert_quality_gate || exit $?
    # Pass the frozen parent-key set explicitly. update-db extracts and checks
    # each sidecar before replacing that item's existing chunks; never delete
    # chunks in the wrapper before the shared gate has run.
    keys=()
    for arg in "$@"; do
      resolved_text="$(resolve_keys "$arg")" || exit $?
      read -r -a resolved <<< "$resolved_text"
      for k in "${resolved[@]}"; do
        [[ -n "$k" ]] && keys+=("$k")
      done
    done
    if [ "${#keys[@]}" -eq 0 ]; then
      echo "no parent items resolved for reembed scope" >&2
      exit 1
    fi
    make_scoped "$@"
    update_args=(update-db --fulltext --no-batch --config-path "$SCOPED")
    for k in "${keys[@]}"; do
      update_args+=(--item-key "$k")
    done
    "$BIN" "${update_args[@]}" || exit $?
    systemctl --user restart zotero-mcp.service
    ;;
  *)
    echo "unknown command: $cmd"; exit 1;;
esac
