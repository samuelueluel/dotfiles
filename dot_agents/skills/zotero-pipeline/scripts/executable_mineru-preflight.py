#!/usr/bin/env python3
"""Print the production Zotero MinerU invocation without running MinerU."""

from pathlib import Path

from zotero_mcp.mineru import _build_mineru_invocation, load_mineru_config


def main() -> None:
    config = load_mineru_config()
    binary = Path(config["bin"])
    if not binary.exists():
        raise SystemExit(f"MinerU binary missing: {binary}")

    command, environment, modern = _build_mineru_invocation(
        config,
        Path("/tmp/placeholder.pdf"),
        Path("/tmp/zotero-mineru-preflight"),
    )
    print(f"binary={binary}")
    print(f"backend_flag_supported={modern}")
    print(f"command={' '.join(command)}")
    print(f"config_env={environment.get('MINERU_TOOLS_CONFIG_JSON', 'default')}")


if __name__ == "__main__":
    main()
