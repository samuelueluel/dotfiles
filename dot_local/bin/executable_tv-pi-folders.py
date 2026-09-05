#!/usr/bin/env python3
"""
tv-pi-folders.py - Helper for Television 'Pi Folders' cable
Handles source list generation, previews, and launcher actions.
"""

import sys
import os
import glob
import json
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
                try:
                    entry = json.loads(line)
                except Exception:
                    continue

                etype = entry.get("type")
                if etype == "session":
                    meta["id"] = entry.get("id", "")
                    meta["cwd"] = entry.get("cwd", "")
                elif etype == "session_info":
                    if entry.get("name"):
                        meta["name"] = entry.get("name").strip()
                elif etype == "message":
                    msg = entry.get("message", {})
                    meta["turn_count"] += 1
                    role = msg.get("role")
                    content = msg.get("content", [])
                    text = ""
                    if isinstance(content, list):
                        for part in content:
                            if isinstance(part, dict) and part.get("type") == "text":
                                text = part.get("text", "").strip().replace("\n", " ")
                                break
                            elif isinstance(part, str):
                                text = part.strip().replace("\n", " ")
                                break
                    elif isinstance(content, str):
                        text = content.strip().replace("\n", " ")

                    if role == "user" and not meta["first_prompt"] and text:
                        meta["first_prompt"] = text
                    elif role == "assistant" and text:
                        meta["last_assistant"] = text
    except Exception:
        pass

    display_title = meta["name"] if meta["name"] else (meta["first_prompt"][:65] if meta["first_prompt"] else "Untitled conversation")
    meta["title"] = display_title
    return meta

def cmd_source():
    os.makedirs(FOLDERS_DIR, exist_ok=True)
    os.makedirs(UNFILED_DIR, exist_ok=True)

    folder_names = sorted([d for d in os.listdir(FOLDERS_DIR) if os.path.isdir(os.path.join(FOLDERS_DIR, d)) and not d.startswith(".")])

    # First list all folders as top-level containers
    for folder in folder_names:
        fdir = os.path.join(FOLDERS_DIR, folder)
        files = glob.glob(os.path.join(fdir, "*.jsonl"))
        count = len(files)
        latest_mtime = max([os.path.getmtime(f) for f in files]) if files else os.path.getmtime(fdir)
        rel_time = format_relative_time(latest_mtime)
        display = f"\033[1;36m📁 [Folder] {folder:<16}\033[0m \033[2m({count} chats · {rel_time})\033[0m"
        print(f"{display}\tfolder:{folder}")

    # Top-level entry for unfiled
    unfiled_files = glob.glob(os.path.join(UNFILED_DIR, "*.jsonl"))
    unfiled_count = len(unfiled_files)
    latest_unfiled_mtime = max([os.path.getmtime(f) for f in unfiled_files]) if unfiled_files else time.time()
    rel_unfiled_time = format_relative_time(latest_unfiled_mtime)
    print(f"\033[1;33m📥 [Folder] Unfiled         \033[0m \033[2m({unfiled_count} chats · {rel_unfiled_time})\033[0m\tfolder:Unfiled")

    # Now list individual conversations inside user folders
    for folder in folder_names:
        fdir = os.path.join(FOLDERS_DIR, folder)
        files = glob.glob(os.path.join(fdir, "*.jsonl"))
        files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
        for f in files:
            meta = parse_session_meta(f)
            rel_time = format_relative_time(meta["mtime"])
            tag = f"[{folder}]"
            display = f"  \033[1;32m{tag:<14}\033[0m \033[2m{rel_time:<8}\033[0m {meta['title'][:55]}"
            print(f"{display}\tsession:{f}")

    # List the 20 most recent unfiled conversations
    unfiled_files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
    for f in unfiled_files[:20]:
        meta = parse_session_meta(f)
        rel_time = format_relative_time(meta["mtime"])
        tag = "[Unfiled]"
        display = f"  \033[2m{tag:<14} {rel_time:<8} {meta['title'][:55]}\033[0m"
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
            print("\n\033[2mPress Ctrl+N to start a new conversation in this folder.\033[0m")
        else:
            for f in files[:12]:
                meta = parse_session_meta(f)
                rel_time = format_relative_time(meta["mtime"])
                print(f" • \033[32m{rel_time:<8}\033[0m {meta['title']}")

        print("\n" + "─" * 50)
        print("\033[1;33mActions:\033[0m")
        print("  Enter  → Resume latest chat in this folder")
        print("  Ctrl+N → Start a new conversation in this folder")
        print("  Ctrl+R → Rename this folder")
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
        print("  Ctrl+B → Resume chat with beta (Stata container)")
        print("  Ctrl+H → Resume chat with pihat (cloud frontier)")
        print("  Ctrl+M → Move/stash this chat into another folder")

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

def cmd_action(action_type, target):
    if target.startswith("folder:"):
        folder = target[7:]
        if folder == "Unfiled":
            fdir = UNFILED_DIR
        else:
            fdir = os.path.join(FOLDERS_DIR, folder)

        if action_type == "open" or action_type == "resume":
            files = glob.glob(os.path.join(fdir, "*.jsonl"))
            if files:
                latest = max(files, key=os.path.getmtime)
                spawn_terminal(f"pi --session '{latest}'")
            else:
                spawn_terminal(f"pi --session-dir '{fdir}'")
        elif action_type == "new":
            spawn_terminal(f"pi --session-dir '{fdir}'")
        elif action_type == "rename":
            spawn_terminal("pif rename")
        return

    if target.startswith("session:"):
        session_path = target[8:]
        meta = parse_session_meta(session_path)
        cwd = meta["cwd"] if meta["cwd"] and os.path.isdir(meta["cwd"]) else os.path.expanduser("~")

        if action_type == "open":
            spawn_terminal(f"pi --session '{session_path}'", cwd=cwd)
        elif action_type == "beta":
            spawn_terminal(f"beta --session '{session_path}'", cwd=cwd)
        elif action_type == "pihat":
            spawn_terminal(f"pihat --session '{session_path}'", cwd=cwd)
        elif action_type == "move":
            spawn_terminal(f"pif stash '{session_path}'")

def main():
    if len(sys.argv) < 2:
        cmd_source()
        return

    sub = sys.argv[1]
    if sub == "list":
        cmd_source()
    elif sub == "preview":
        target = sys.argv[2] if len(sys.argv) > 2 else ""
        cmd_preview(target)
    elif sub == "action":
        act = sys.argv[2] if len(sys.argv) > 2 else "open"
        target = sys.argv[3] if len(sys.argv) > 3 else ""
        cmd_action(act, target)

if __name__ == "__main__":
    main()
