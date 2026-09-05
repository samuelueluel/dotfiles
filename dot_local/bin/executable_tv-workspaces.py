#!/usr/bin/env python3
"""
tv-workspaces.py - Helper for Television 'Workspaces (Pi)' cable
Handles source list generation, previews, folder drill-downs, and launcher actions.
"""

import sys
import os
import glob
import json
import shutil
import subprocess
import time
from datetime import datetime

FOLDERS_DIR = os.path.expanduser("~/.pi/agent/folders")
UNFILED_DIR = os.path.expanduser("~/.pi/agent/sessions/--var-home-samuel--")

def format_relative_time(mtime):
    diff = time.time() - mtime
    if diff < 60:
        return "just now"
    if diff < 3600:
        return f"{int(diff // 60)}m ago"
    if diff < 86400:
        return f"{int(diff // 3600)}h ago"
    if diff < 86400 * 7:
        return f"{int(diff // 86400)}d ago"
    dt = datetime.fromtimestamp(mtime)
    return dt.strftime("%b %d")

def parse_session_meta(file_path):
    meta = {
        "path": file_path,
        "filename": os.path.basename(file_path),
        "mtime": os.path.getmtime(file_path),
        "id": "",
        "cwd": "",
        "name": "",
        "first_prompt": "",
        "last_assistant": "",
        "turn_count": 0,
    }
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if not line.strip():
                    continue
                if '"session_info"' in line:
                    try:
                        entry = json.loads(line)
                        if entry.get("type") == "session_info" and entry.get("name"):
                            meta["name"] = entry.get("name").strip()
                    except Exception:
                        pass
                elif '"session"' in line and '"type":"session"' in line:
                    try:
                        entry = json.loads(line)
                        if entry.get("type") == "session":
                            meta["id"] = entry.get("id", "")
                            meta["cwd"] = entry.get("cwd", "")
                    except Exception:
                        pass
                elif '"role":"user"' in line:
                    meta["turn_count"] += 1
                    if not meta["first_prompt"]:
                        try:
                            entry = json.loads(line)
                            if entry.get("type") == "message":
                                c = entry.get("message", {}).get("content", "")
                                if isinstance(c, list) and c and isinstance(c[0], dict):
                                    meta["first_prompt"] = c[0].get("text", "").strip().replace("\n", " ")
                                elif isinstance(c, str):
                                    meta["first_prompt"] = c.strip().replace("\n", " ")
                        except Exception:
                            pass
                elif '"role":"assistant"' in line:
                    meta["turn_count"] += 1
                    try:
                        entry = json.loads(line)
                        if entry.get("type") == "message":
                            c = entry.get("message", {}).get("content", "")
                            if isinstance(c, list) and c and isinstance(c[0], dict):
                                meta["last_assistant"] = c[0].get("text", "").strip().replace("\n", " ")
                            elif isinstance(c, str):
                                meta["last_assistant"] = c.strip().replace("\n", " ")
                    except Exception:
                        pass
    except Exception:
        pass

    display_title = meta["name"] if meta["name"] else (meta["first_prompt"] if meta["first_prompt"] else "Untitled conversation")
    meta["title"] = display_title
    return meta

def get_session_title(file_path):
    """Extract authoritative session name (session_info name prioritized over prompt)."""
    name = None
    first_msg = None
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as fp:
            for line in fp:
                if not line.strip():
                    continue
                if '"session_info"' in line:
                    try:
                        d = json.loads(line)
                        if d.get("type") == "session_info" and d.get("name"):
                            name = d.get("name").strip()
                    except Exception:
                        pass
                elif not first_msg and '"role":"user"' in line:
                    try:
                        d = json.loads(line)
                        if d.get("type") == "message":
                            c = d.get("message", {}).get("content", "")
                            if isinstance(c, list) and c and isinstance(c[0], dict):
                                first_msg = c[0].get("text", "").strip().replace("\n", " ")
                            elif isinstance(c, str):
                                first_msg = c.strip().replace("\n", " ")
                    except Exception:
                        pass
    except Exception:
        pass
    return name if name else (first_msg if first_msg else "Untitled conversation")

def cmd_source():
    os.makedirs(FOLDERS_DIR, exist_ok=True)
    os.makedirs(UNFILED_DIR, exist_ok=True)

    folder_names = sorted([d for d in os.listdir(FOLDERS_DIR) if os.path.isdir(os.path.join(FOLDERS_DIR, d)) and not d.startswith(".")])

    # First list all folders as top-level containers (clean plain text for Television list)
    for folder in folder_names:
        fdir = os.path.join(FOLDERS_DIR, folder)
        files = glob.glob(os.path.join(fdir, "*.jsonl"))
        count = len(files)
        latest_mtime = max([os.path.getmtime(f) for f in files]) if files else os.path.getmtime(fdir)
        rel_time = format_relative_time(latest_mtime)
        chats_str = f"{count} chat" if count == 1 else f"{count} chats"
        display = f"📁 [Folder] {folder:<16} ({chats_str} · {rel_time})"
        print(f"{display}\tfolder:{folder}")

    # Top-level entry for unfiled
    unfiled_files = glob.glob(os.path.join(UNFILED_DIR, "*.jsonl"))
    unfiled_count = len(unfiled_files)
    latest_unfiled_mtime = max([os.path.getmtime(f) for f in unfiled_files]) if unfiled_files else time.time()
    rel_unfiled_time = format_relative_time(latest_unfiled_mtime)
    display = f"📥 [Folder] Unfiled          ({unfiled_count} chats · {rel_unfiled_time})"
    print(f"{display}\tfolder:Unfiled")

    # Now list individual conversations inside user folders
    for folder in folder_names:
        fdir = os.path.join(FOLDERS_DIR, folder)
        files = glob.glob(os.path.join(fdir, "*.jsonl"))
        files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
        for f in files:
            title = get_session_title(f)
            rel_time = format_relative_time(os.path.getmtime(f))
            tag = f"[{folder}]"
            display = f"  {tag:<14} {rel_time:<8} {title}"
            print(f"{display}\tsession:{f}")

    # List all unfiled conversations so top-level search finds every conversation
    unfiled_files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
    for f in unfiled_files:
        title = get_session_title(f)
        rel_time = format_relative_time(os.path.getmtime(f))
        tag = "[Unfiled]"
        display = f"  {tag:<14} {rel_time:<8} {title}"
        print(f"{display}\tsession:{f}")

def cmd_list_folder(folder):
    os.makedirs(FOLDERS_DIR, exist_ok=True)
    os.makedirs(UNFILED_DIR, exist_ok=True)

    if folder == "Unfiled":
        files = glob.glob(os.path.join(UNFILED_DIR, "*.jsonl"))
        files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
        print("➕ [New] Start fresh conversation (Unfiled)\tnew:Unfiled")
        for f in files:
            title = get_session_title(f)
            rel_time = format_relative_time(os.path.getmtime(f))
            display = f"  {rel_time:<8} │ {title}"
            print(f"{display}\tsession:{f}")
    else:
        fdir = os.path.join(FOLDERS_DIR, folder)
        os.makedirs(fdir, exist_ok=True)
        files = glob.glob(os.path.join(fdir, "*.jsonl"))
        files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
        print(f"➕ [New] Start fresh conversation in {folder}\tnew:{folder}")
        for f in files:
            title = get_session_title(f)
            rel_time = format_relative_time(os.path.getmtime(f))
            display = f"  {rel_time:<8} │ {title}"
            print(f"{display}\tsession:{f}")

def cmd_preview(target):
    if target.startswith("folder:"):
        folder = target[7:]
        if folder == "Unfiled":
            fdir = UNFILED_DIR
        else:
            fdir = os.path.join(FOLDERS_DIR, folder)

        files = glob.glob(os.path.join(fdir, "*.jsonl"))
        files.sort(key=lambda f: os.path.getmtime(f), reverse=True)

        print(f"\033[1;36m📁 Project Folder: {folder}\033[0m")
        print(f"\033[2mPath: {fdir}\033[0m")
        print(f"\033[2mTotal conversations: {len(files)}\033[0m\n")
        print("\033[1mRecent Conversations in this Folder:\033[0m")
        print("─" * 50)
        if not files:
            print("  (No conversations stashed yet)")
            print("\n\033[2mPress Enter to open session selection or Ctrl+N to start a new chat.\033[0m")
        else:
            for f in files[:12]:
                meta = parse_session_meta(f)
                rel_time = format_relative_time(meta["mtime"])
                print(f" • \033[32m{rel_time:<8}\033[0m {meta['title']}")

        print("\n" + "─" * 50)
        print("\033[1;33mActions:\033[0m")
        print("  Enter  → Open folder to select / resume a conversation")
        print("  Ctrl+N → Start a fresh conversation in this folder")
        print("  Ctrl+R → Rename this workspace folder")
        return

    if target.startswith("new:"):
        folder = target[4:]
        print(f"\033[1;32m➕ Start New Conversation\033[0m")
        print(f"\033[2mWorkspace: {folder}\033[0m")
        if folder == "Unfiled":
            print(f"\033[2mTarget Directory: ~/.pi/agent/sessions/--var-home-samuel--\033[0m\n")
        else:
            print(f"\033[2mTarget Directory: ~/.pi/agent/folders/{folder}\033[0m\n")
        print("─" * 50)
        print("Press Enter to launch a brand new conversation.")
        print("You will choose your agent environment:")
        print("  • \033[1mpihat\033[0m   (Cloud frontier - GPT-5.6 Luna / Claude / DeepSeek) [Default]")
        print("  • \033[1mpi\033[0m      (Local models - Qwen / DeepSeek / Mistral)")
        print("  • \033[1mbetahat\033[0m (Stata container + Cloud frontier)")
        print("  • \033[1mbeta\033[0m    (Stata container + Local models)")
        print("\nAll subsequent messages in this session will automatically be stored in this workspace folder.\n")
        print("─" * 50)
        print("\033[1;33mActions:\033[0m")
        print("  Enter  → Choose agent & launch in Ghostty (pihat default)")
        print("  Ctrl+H → Direct launch with pihat (cloud frontier)")
        print("  Ctrl+B → Direct launch with beta / betahat (Stata container)")
        print("  Esc    → Cancel / Close")
        return

    if target.startswith("session:"):
        session_path = target[8:]
        if not os.path.exists(session_path):
            print("Session file not found.")
            return

        meta = parse_session_meta(session_path)
        rel_time = format_relative_time(meta["mtime"])
        dt = datetime.fromtimestamp(meta["mtime"]).strftime("%Y-%m-%d %H:%M")

        # Determine folder name from path
        parent = os.path.dirname(session_path)
        folder = os.path.basename(parent) if parent != UNFILED_DIR else "Unfiled"

        print(f"\033[1;36m{meta['title']}\033[0m")
        print(f"\033[2mFolder: {folder}  │  Updated: {dt} ({rel_time})  │  Turns: {meta['turn_count']}\033[0m")
        print(f"\033[2mCWD: {meta['cwd']}  │  ID: {meta['id'][:12]}...\033[0m\n")
        print("─" * 50)
        print("\033[1mInitial User Prompt:\033[0m")
        print(f"  {meta['first_prompt'][:250] if meta['first_prompt'] else '(None)'}\n")

        if meta['last_assistant']:
            print("\033[1mRecent Assistant Turn:\033[0m")
            print(f"  {meta['last_assistant'][:300]}...\n")

        print("─" * 50)
        print("\033[1;33mActions:\033[0m")
        print("  Enter  → Resume chat with pi (local)")
        print("  Ctrl+H → Resume chat with pihat (cloud frontier)")
        print("  Ctrl+B → Resume chat with beta (Stata container)")
        print("  Ctrl+M → Move/stash this chat into another folder")
        return

def spawn_terminal(command_str, cwd=None):
    cmd = ["ghostty"]
    if cwd and os.path.isdir(cwd):
        cmd.extend([f"--working-directory={cwd}"])
    cmd.extend(["-e", "zsh", "-ic", command_str])

    if shutil.which("niri"):
        subprocess.run(["niri", "msg", "action", "spawn", "--"] + cmd)
    else:
        subprocess.Popen(cmd)
    sys.exit(0)

def run_folder_session_picker(folder):
    tv_bin = "/home/linuxbrew/.linuxbrew/bin/tv"
    script_bin = "/var/home/samuel/.local/bin/tv-workspaces.py"

    cmd = [
        tv_bin,
        f"--source-command={script_bin} list-folder '{folder}'",
        "--source-display={split:\t:0}",
        "--source-output={split:\t:1}",
        f"--input-prompt={folder} > ",
        f"--preview-command={script_bin} preview '{{split:\t:1}}'",
        "--layout=portrait",
        "--preview-size=60",
        "--preview-word-wrap",
        "--preview-border=thick",
        "--expect=ctrl-b;ctrl-h;ctrl-m",
    ]

    try:
        with open("/dev/tty", "r") as tty_in:
            proc = subprocess.Popen(cmd, stdin=tty_in, stdout=subprocess.PIPE, text=True)
            stdout, _ = proc.communicate()
    except Exception:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True)
        stdout, _ = proc.communicate()

    if proc.returncode != 0 or not stdout:
        return

    lines = [line.strip() for line in stdout.strip().splitlines() if line.strip()]
    if not lines:
        return

    expect_key = None
    target_out = lines[-1]
    if len(lines) > 1 and lines[0] in ("ctrl-b", "ctrl-h", "ctrl-m"):
        expect_key = lines[0]

    home = os.path.realpath(os.path.expanduser("~"))

    if target_out.startswith("new:"):
        f_name = target_out[4:]
        if expect_key == "ctrl-h":
            if f_name == "Unfiled":
                spawn_terminal("pihat")
            else:
                fdir = os.path.join(FOLDERS_DIR, f_name)
                spawn_terminal(f"pihat --session-dir '{fdir}'")
        elif expect_key == "ctrl-b":
            spawn_terminal(f"piwork new '{f_name}' --agent beta")
        else:
            spawn_terminal(f"piwork new '{f_name}'")
    elif target_out.startswith("session:"):
        session_path = target_out[8:]
        meta = parse_session_meta(session_path)
        cwd = meta["cwd"] if meta["cwd"] and os.path.isdir(meta["cwd"]) else ""

        if expect_key == "ctrl-b":
            if cwd and os.path.realpath(cwd) != home:
                spawn_terminal(f"beta '{cwd}' --session '{session_path}'", cwd=cwd)
            else:
                spawn_terminal(f"piwork resume-beta '{session_path}'")
        elif expect_key == "ctrl-h":
            spawn_terminal(f"pihat --session '{session_path}'", cwd=cwd or home)
        elif expect_key == "ctrl-m":
            spawn_terminal(f"piwork stash '{session_path}'")
        else:
            spawn_terminal(f"pi --session '{session_path}'", cwd=cwd or home)

def cmd_action(action_type, target):
    home = os.path.realpath(os.path.expanduser("~"))

    if target.startswith("folder:"):
        folder = target[7:]
        if folder == "Unfiled":
            fdir = UNFILED_DIR
        else:
            fdir = os.path.join(FOLDERS_DIR, folder)

        if action_type == "open":
            run_folder_session_picker(folder)
        elif action_type == "resume":
            files = glob.glob(os.path.join(fdir, "*.jsonl"))
            if files:
                latest = max(files, key=os.path.getmtime)
                spawn_terminal(f"pi --session '{latest}'")
            else:
                spawn_terminal(f"piwork new '{folder}'")
        elif action_type == "new":
            spawn_terminal(f"piwork new '{folder}'")
        elif action_type == "pihat":
            if folder == "Unfiled":
                spawn_terminal("pihat")
            else:
                spawn_terminal(f"pihat --session-dir '{fdir}'")
        elif action_type == "beta":
            spawn_terminal(f"piwork new '{folder}' --agent beta")
        elif action_type == "rename":
            spawn_terminal("piwork rename")
        return

    if target.startswith("new:"):
        folder = target[4:]
        if action_type == "pihat":
            if folder == "Unfiled":
                spawn_terminal("pihat")
            else:
                fdir = os.path.join(FOLDERS_DIR, folder)
                spawn_terminal(f"pihat --session-dir '{fdir}'")
        elif action_type == "beta":
            spawn_terminal(f"piwork new '{folder}' --agent beta")
        else:
            spawn_terminal(f"piwork new '{folder}'")
        return

    if target.startswith("session:"):
        session_path = target[8:]
        meta = parse_session_meta(session_path)
        cwd = meta["cwd"] if meta["cwd"] and os.path.isdir(meta["cwd"]) else ""

        if action_type == "open":
            spawn_terminal(f"pi --session '{session_path}'", cwd=cwd or home)
        elif action_type == "beta":
            if cwd and os.path.realpath(cwd) != home:
                spawn_terminal(f"beta '{cwd}' --session '{session_path}'", cwd=cwd)
            else:
                spawn_terminal(f"piwork resume-beta '{session_path}'")
        elif action_type == "pihat":
            spawn_terminal(f"pihat --session '{session_path}'", cwd=cwd or home)
        elif action_type == "move":
            spawn_terminal(f"piwork stash '{session_path}'")
        return

def main():
    if len(sys.argv) < 2:
        cmd_source()
        return

    sub = sys.argv[1]
    if sub == "list":
        cmd_source()
    elif sub == "list-folder":
        folder = sys.argv[2] if len(sys.argv) > 2 else "Unfiled"
        cmd_list_folder(folder)
    elif sub == "preview":
        target = sys.argv[2] if len(sys.argv) > 2 else ""
        cmd_preview(target)
    elif sub == "action":
        act = sys.argv[2] if len(sys.argv) > 2 else "open"
        target = sys.argv[3] if len(sys.argv) > 3 else ""
        cmd_action(act, target)

if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        try:
            devnull = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, sys.stdout.fileno())
        except Exception:
            pass
        sys.exit(0)
