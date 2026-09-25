#!/usr/bin/env python3
"""GTT/hang watchdog scoped to one frozen zotero-sidecar-reprocess.py run.

Usage: zotero-sidecar-batch-watch.py RUN_DIR [--stop-vlm-on-exit]

Unlike the older sidecar-create watchdog, this never uses pkill, never infers
an item from another job's log, and never kills a parser outside the pinned
runner's process tree. MinerU's own timeout remains the last-resort guard.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

GTT = Path('/sys/class/drm/card1/device/mem_info_gtt_used')
SAMPLE_SECONDS = 20
BAD_SAMPLES = 3
GTT_LIMIT_MB = int(os.environ.get('WATCHDOG_GTT_THRESHOLD_MB', str(105 * 1024)))
PARSER_LIMIT_SECONDS = int(os.environ.get('ITEM_TIMEOUT_SEC', '3600'))


def process_info(pid: int) -> tuple[int, int] | None:
    """Return (parent PID, Linux start ticks), including for a reused PID."""
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return int(fields[1]), int(fields[19])
    except (OSError, IndexError, ValueError):
        return None


def children(pid: int) -> list[int]:
    try:
        return [int(value) for value in Path(f'/proc/{pid}/task/{pid}/children').read_text().split()]
    except (OSError, ValueError):
        return []


def cmdline(pid: int) -> list[str]:
    try:
        return [x.decode('utf-8', 'replace') for x in Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0') if x]
    except OSError:
        return []


def runner_alive(run_dir: Path, record: dict) -> bool:
    try:
        pid, born = int(record['pid']), int(record['start_ticks'])
        args = cmdline(pid)
        argument = args.index('--run-dir')
        return (
            pid > 1 and process_info(pid) is not None
            and process_info(pid)[1] == born
            and record.get('run_dir') == str(run_dir)
            and record.get('runner') in args
            and Path(args[argument + 1]).resolve() == run_dir
        )
    except (KeyError, ValueError, IndexError, TypeError):
        return False


def parser_children(runner_pid: int, parser_bin: str) -> list[int]:
    """Only direct MinerU children of the pinned runner, not host-wide jobs."""
    result = []
    for pid in children(runner_pid):
        if process_info(pid) and process_info(pid)[0] == runner_pid and parser_bin in cmdline(pid):
            result.append(pid)
    return result


def parser_tree(pid: int) -> list[tuple[int, int]]:
    """Collect descendants deepest first, then parser; pin every birth tick."""
    found = []
    for child in children(pid):
        if process_info(child) and process_info(child)[0] == pid:
            found.extend(parser_tree(child))
    info = process_info(pid)
    if info:
        found.append((pid, info[1]))
    return found


def stop_parser(pid: int, runner_pid: int) -> int:
    """Stop exactly one verified descendant parser tree, never an entire PGID."""
    if process_info(pid) is None or process_info(pid)[0] != runner_pid:
        return 0
    victims = parser_tree(pid)
    for target, born in victims:
        if process_info(target) and process_info(target)[1] == born:
            try:
                os.kill(target, signal.SIGTERM)
            except ProcessLookupError:
                pass
    time.sleep(2)
    for target, born in victims:
        if process_info(target) and process_info(target)[1] == born:
            try:
                os.kill(target, signal.SIGKILL)
            except ProcessLookupError:
                pass
    return len(victims)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('run_dir', type=Path)
    ap.add_argument('--stop-vlm-on-exit', action='store_true')
    args = ap.parse_args(argv)
    run_dir = args.run_dir.expanduser().resolve()
    if not (run_dir / 'scope.json').is_file() or stat.S_IMODE(run_dir.stat().st_mode) & 0o077:
        ap.error('require a private 0700 batch run directory with a frozen scope')
    if not GTT.is_file() or not os.access(GTT, os.R_OK):
        ap.error('GTT counter is unreadable; do not claim active memory protection')
    if not 1024 <= GTT_LIMIT_MB <= 125 * 1024 or PARSER_LIMIT_SECONDS < 60:
        ap.error('invalid GTT or parser timeout threshold')
    config = json.loads((Path.home() / '.config/zotero-mcp/config.json').read_text())
    parser_bin = str(Path(config['semantic_search']['mineru']['bin']).expanduser())
    record_path = run_dir / 'runner-pid.json'
    record = None
    for _ in range(90):
        if record_path.is_file():
            try:
                candidate = json.loads(record_path.read_text())
                if runner_alive(run_dir, candidate):
                    record = candidate
                    break
            except (OSError, ValueError, TypeError):
                pass
        time.sleep(1)
    if record is None:
        ap.error('no live pinned runner within 90s; refusing an unscoped watcher')
    log_path = run_dir / 'watchdog.log'
    bad = 0
    last_heartbeat = 0
    with log_path.open('a', encoding='utf-8') as log:
        def note(message: str) -> None:
            print(time.strftime('%Y-%m-%d %H:%M:%S'), message, file=log, flush=True)

        note(f'start pid={record["pid"]} gtt_limit_mb={GTT_LIMIT_MB} parser_limit_seconds={PARSER_LIMIT_SECONDS}')
        try:
            while runner_alive(run_dir, record):
                parser_pids = parser_children(int(record['pid']), parser_bin)
                gtt_mb = int(GTT.read_text()) // (1024 * 1024)
                bad = bad + 1 if gtt_mb > GTT_LIMIT_MB else 0
                if bad:
                    note(f'high GTT {gtt_mb} MB ({bad}/{BAD_SAMPLES}); scoped parser children={parser_pids}')
                for pid in parser_pids:
                    info = process_info(pid)
                    if not info:
                        continue
                    elapsed = float(Path('/proc/uptime').read_text().split()[0]) - info[1] / os.sysconf('SC_CLK_TCK')
                    if bad >= BAD_SAMPLES or elapsed > PARSER_LIMIT_SECONDS:
                        reason = 'GTT balloon' if bad >= BAD_SAMPLES else 'parser hang'
                        killed = stop_parser(pid, int(record['pid']))
                        note(f'{reason}: stopped {killed} processes under exact parser pid={pid}; runner will checkpoint failure')
                        bad = 0
                last_heartbeat += 1
                if last_heartbeat % 10 == 0:
                    note(f'heartbeat gtt_mb={gtt_mb} parser_children={parser_pids}')
                time.sleep(SAMPLE_SECONDS)
            note('runner exited or PID identity changed; watcher done')
        finally:
            if args.stop_vlm_on_exit:
                launcher = Path.home() / '.local/bin/zotero-vlm-rocm.sh'
                finished = subprocess.run([str(launcher), 'stop'], capture_output=True, text=True)
                note(f'dedicated VLM stop exit={finished.returncode}: {finished.stdout.strip()} {finished.stderr.strip()}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
