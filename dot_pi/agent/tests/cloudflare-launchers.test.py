#!/usr/bin/env python3
"""Exercise launcher arguments without starting Pi, models, or containers."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

HOME = Path.home()
source = (HOME / '.zshrc').read_text()
names = ['_pi_is_cloudflare_skill', '_pi_nonstata_skills', '_pi_stata_skills',
         'pi', 'pihat', 'cf', 'beta', 'betahat']
functions = '\n'.join(re.search(r'^' + re.escape(n) + r'\(\) \{\n.*?^\}',
                                 source, re.M | re.S).group() for n in names)
# Remove terminal notifications only in the test copy.
functions = functions.replace("printf '\\a' > /dev/tty", ':')
cloudflare_skills = {p.name for p in (HOME / '.pi/agent/skills').iterdir()
                     if (p / 'SKILL.md').exists()}
assert cloudflare_skills, 'Missing Cloudflare skill fixtures'
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    (root / 'target').mkdir()
    (root / 'target' / 'file.txt').touch()
    capture = root / 'args'
    mode = root / 'mode'
    mock = root / 'pi'
    mock.write_text('#!/bin/sh\nprintf "%s\\0" "$@" > "$CAPTURE"\nprintf "%s" "$PI_MCP_CONFIG_MODE" > "$MODE_CAPTURE"\n')
    mock.chmod(0o755)
    for name in ('halogen', 'strix-llama'):
        p = root / name
        p.write_text('#!/bin/sh\nexit 0\n')
        p.chmod(0o755)
    prelude = '''
_pi_subagent_concurrency() { :; }
_pi_theme_args() { typeset -ga _PI_THEME_ARGS=(); }
_pi_cloud_model_scope() { print cloud-models; }
_pi_non_bridge_model_scope() { print local-models; }
_pi_pick_local_model() { print test-local; }
_lem_preload() { :; }
gum() {
  if [[ "$3" == *'run in container?' ]]; then
    print "$TEST_SANDBOX"
  else
    print "$TEST_LEVEL"
  fi
}
_capture_safe() {
  printf '%s\\0' "$@" > "$CAPTURE"
  printf '%s' "$PI_MCP_CONFIG_MODE" > "$MODE_CAPTURE"
}
pi-safe-1() { _capture_safe "$@"; }
pi-safe-2() { _capture_safe "$@"; }
pi-safe-3() { _capture_safe "$@"; }
pi-safe-stata-1() { _capture_safe "$@"; }
pi-safe-stata-2() { _capture_safe "$@"; }
'''
    script = prelude + functions.replace('$HOME/.pi/running', str(root / 'running'))
    env = dict(os.environ, PATH=str(root) + ':' + os.environ['PATH'],
               CAPTURE=str(capture), MODE_CAPTURE=str(mode), PI_MCP_CONFIG_MODE='')
    count = 0
    for launcher in ('pi', 'pihat', 'cf', 'beta', 'betahat'):
        levels = (1, 2) if launcher in ('beta', 'betahat') else (0, 1, 2, 3)
        for level in levels:
            target = root / 'target' / 'file.txt' if level == 3 else root / 'target'
            run_env = dict(env, TEST_SANDBOX='yes' if level else 'no', TEST_LEVEL=str(level))
            subprocess.run(['zsh', '-f', '-c', script + f'\n{launcher} "{target}"\n'],
                           env=run_env, check=True, stdout=subprocess.DEVNULL)
            args = capture.read_bytes().decode().strip('\0').split('\0')
            assert '--no-skills' in args, (launcher, level)
            skills = {Path(args[i+1]).name for i, a in enumerate(args) if a == '--skill'}
            visible = skills & cloudflare_skills
            assert visible == (cloudflare_skills if launcher == 'cf' else set()), (launcher, level, visible)
            config = Path(args[args.index('--mcp-config') + 1])
            expected = ('mcp-cloudflare.json' if launcher == 'cf' else
                        'mcp-beta.json' if launcher in ('beta', 'betahat') else 'mcp-adapter.json')
            assert config.name == expected, (launcher, level, config)
            assert mode.read_text() == ('exclusive' if launcher == 'cf' else ''), (launcher, level)
            data = json.loads(config.read_text())
            assert all(v.get('disabled') is True for k, v in data['mcpServers'].items()
                       if k.startswith('cloudflare')), config
            count += 1
    # cf's local profile must not leak into a later pihat invocation.
    subprocess.run(['zsh', '-f', '-c', script + '\ncf\npihat\n'],
                   env=dict(env, TEST_SANDBOX='no', TEST_LEVEL='1'),
                   check=True, stdout=subprocess.DEVNULL)
    args = capture.read_bytes().decode().strip('\0').split('\0')
    assert Path(args[args.index('--mcp-config') + 1]).name == 'mcp-adapter.json'
    assert not any(Path(args[i+1]).name in cloudflare_skills for i, a in enumerate(args) if a == '--skill')
    # Existing container wrappers forward the isolation environment.
    for name in ('pi-safe-1', 'pi-safe-2', 'pi-safe-3', 'pi-safe-stata-1', 'pi-safe-stata-2'):
        block = re.search(r'^' + re.escape(name) + r'\(\) \{\n.*?^\}', source, re.M | re.S).group()
        assert '-e PI_MCP_CONFIG_MODE' in block, name
print(f'PASS: {count} launcher/sandbox profiles, sequential cf → pihat isolation, 5 container environment passthroughs')
