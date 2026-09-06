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

LOCAL_LIB = os.path.expanduser("~/.local/lib")
if LOCAL_LIB not in sys.path:
    sys.path.insert(0, LOCAL_LIB)

from pi_session_summary import find_session_path, load_store, summary_search_text  # noqa: E402

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

def get_summary(meta, summary_store):
    session_id = meta.get("id", "")
    if not session_id:
        return {}
    record = summary_store.get("sessions", {}).get(session_id, {})
    return record if isinstance(record, dict) else {}


def session_display(meta, folder, rel_time, summary_store):
    summary = get_summary(meta, summary_store)
    display = f"  [{folder}] {rel_time:<8} {meta['title']}"
    snippet = summary_search_text(summary, limit=None)
    if snippet:
        display += f" — {snippet}"
    return display


def summary_display(record):
    stamp = (record.get("updated_at") or record.get("logged_at") or "")[:10]
    title = record.get("title") or record.get("session_id") or "Untitled summary"
    snippet = summary_search_text(record, limit=None)
    display = f"  [Summary] {stamp:<10} {title}"
    if snippet:
        display += f" — {snippet}"
    return display


def print_summary_sections(record):
    sections = (
        ("Overview", "summary"),
        ("What Changed", "what_changed"),
        ("Where It Lives", "where_it_lives"),
        ("Next Up", "next_up"),
    )
    for label, field in sections:
        value = record.get(field)
        if value:
            print(f"\033[1;36m[{label}]\033[0m")
            print(f"  {value}\n")


def cmd_source():
    os.makedirs(FOLDERS_DIR, exist_ok=True)
    os.makedirs(UNFILED_DIR, exist_ok=True)
    summary_store = load_store()
    live_ids = set()
    live_paths = set()

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

    # List individual conversations inside user folders.
    for folder in folder_names:
        fdir = os.path.join(FOLDERS_DIR, folder)
        files = glob.glob(os.path.join(fdir, "*.jsonl"))
        files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
        for f in files:
            meta = parse_session_meta(f)
            live_paths.add(os.path.realpath(f))
            if meta.get("id"):
                live_ids.add(meta["id"])
            rel_time = format_relative_time(meta["mtime"])
            display = session_display(meta, folder, rel_time, summary_store)
            print(f"{display}\tsession:{f}")

    # List all unfiled conversations so top-level search finds every conversation.
    unfiled_files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
    for f in unfiled_files:
        meta = parse_session_meta(f)
        live_paths.add(os.path.realpath(f))
        if meta.get("id"):
            live_ids.add(meta["id"])
        rel_time = format_relative_time(meta["mtime"])
        display = session_display(meta, "Unfiled", rel_time, summary_store)
        print(f"{display}\tsession:{f}")

    # Preserve searchable summaries even when their transcript is not in a visible
    # workspace (for example, a legacy or archived transcript).
    for session_id, record in sorted(
        summary_store.get("sessions", {}).items(),
        key=lambda item: item[1].get("updated_at", item[1].get("logged_at", "")) if isinstance(item[1], dict) else "",
        reverse=True,
    ):
        if session_id in live_ids or not isinstance(record, dict):
            continue
        transcript_path = record.get("transcript_path", "")
        if transcript_path and not os.path.isfile(transcript_path):
            transcript_path = ""
        if transcript_path and os.path.realpath(transcript_path) in live_paths:
            continue
        summary_record = dict(record)
        summary_record["session_id"] = session_id
        if transcript_path:
            summary_record["transcript_path"] = transcript_path
        print(f"{summary_display(summary_record)}\tsummary:{session_id}")

def cmd_list_folder(folder):
    os.makedirs(FOLDERS_DIR, exist_ok=True)
    os.makedirs(UNFILED_DIR, exist_ok=True)
    summary_store = load_store()

    if folder == "Unfiled":
        files = glob.glob(os.path.join(UNFILED_DIR, "*.jsonl"))
        files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
        print("➕ [New] Start fresh conversation (Unfiled)\tnew:Unfiled")
        for f in files:
            meta = parse_session_meta(f)
            rel_time = format_relative_time(meta["mtime"])
            display = session_display(meta, "Unfiled", rel_time, summary_store)
            print(f"{display}\tsession:{f}")
    else:
        fdir = os.path.join(FOLDERS_DIR, folder)
        os.makedirs(fdir, exist_ok=True)
        files = glob.glob(os.path.join(fdir, "*.jsonl"))
        files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
        print(f"➕ [New] Start fresh conversation in {folder}\tnew:{folder}")
        for f in files:
            meta = parse_session_meta(f)
            rel_time = format_relative_time(meta["mtime"])
            display = session_display(meta, folder, rel_time, summary_store)
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
        summary_store = load_store()

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
                summary = get_summary(meta, summary_store)
                snippet = summary_search_text(summary, limit=140)
                suffix = f" — {snippet}" if snippet else ""
                print(f" • \033[32m{rel_time:<8}\033[0m {meta['title']}{suffix}")

        print("\n" + "─" * 50)
        print("\033[1;33mActions:\033[0m")
        print("  Enter  → Open folder / drill down to sessions")
        print("  Ctrl+N → Start a fresh conversation in this folder")
        print("  Ctrl+R → Rename this workspace folder")
        print("  Session picker: Enter=pihat  Ctrl+B=betahat  Ctrl+L=pi  Ctrl+H=beta")
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
        print("  Enter  → Launch pihat (cloud)")
        print("  Ctrl+B → Launch betahat (Stata + cloud)")
        print("  Ctrl+L → Launch pi (local)")
        print("  Ctrl+H → Launch beta (Stata + local)")
        print("  Esc    → Cancel / Close")
        return

    if target.startswith("summary:"):
        session_id = target[8:]
        record = load_store().get("sessions", {}).get(session_id, {})
        if not isinstance(record, dict):
            print("Summary not found.")
            return
        transcript_path = find_session_path(session_id, record.get("transcript_path", ""))
        print(f"\033[1;36m{record.get('title', session_id)}\033[0m")
        print(f"\033[2mSummary archive entry  │  ID: {session_id}\033[0m\n")
        print_summary_sections(record)
        if transcript_path:
            print(f"\033[2mTranscript: {transcript_path}\033[0m\n")
            print("This summary has a resolvable transcript.")
            print("\033[1;33mActions:\033[0m")
            print("  Enter  → Resume with pihat (cloud)")
            print("  Ctrl+B → Resume with betahat (Stata + cloud)")
            print("  Ctrl+L → Resume with pi (local)")
            print("  Ctrl+H → Resume with beta (Stata + local)")
        else:
            print("Transcript is not currently available; this is an archived summary only.")
        return

    if target.startswith("session:"):
        session_path = target[8:]
        if not os.path.exists(session_path):
            print("Session file not found.")
            return

        meta = parse_session_meta(session_path)
        summary = get_summary(meta, load_store())
        rel_time = format_relative_time(meta["mtime"])
        dt = datetime.fromtimestamp(meta["mtime"]).strftime("%Y-%m-%d %H:%M")

        # Determine folder name from path
        parent = os.path.dirname(session_path)
        folder = os.path.basename(parent) if parent != UNFILED_DIR else "Unfiled"

        print(f"\033[1;36m{meta['title']}\033[0m")
        print(f"\033[2mFolder: {folder}  │  Updated: {dt} ({rel_time})  │  Turns: {meta['turn_count']}\033[0m")
        print(f"\033[2mCWD: {meta['cwd']}  │  ID: {meta['id'][:12]}...\033[0m\n")

        if summary:
            print_summary_sections(summary)

        print("─" * 50)
        print("\033[1mInitial User Prompt:\033[0m")
        print(f"  {meta['first_prompt'][:250] if meta['first_prompt'] else '(None)'}\n")

        if meta['last_assistant']:
            print("\033[1mRecent Assistant Turn:\033[0m")
            print(f"  {meta['last_assistant'][:300]}...\n")

        print("─" * 50)
        print("\033[1;33mActions:\033[0m")
        print("  Enter  → Resume with pihat (cloud)")
        print("  Ctrl+B → Resume with betahat (Stata + cloud)")
        print("  Ctrl+L → Resume with pi (local)")
        print("  Ctrl+H → Resume with beta (Stata + local)")
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
        "--expect=ctrl-b;ctrl-h;ctrl-l;ctrl-m",
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
    if len(lines) > 1 and lines[0] in ("ctrl-b", "ctrl-h", "ctrl-l", "ctrl-m"):
        expect_key = lines[0]

    home = os.path.realpath(os.path.expanduser("~"))

    if target_out.startswith("new:"):
        f_name = target_out[4:]
        if expect_key == "ctrl-h":
            spawn_terminal(f"piwork new '{f_name}' --agent beta")
        elif expect_key == "ctrl-b":
            spawn_terminal(f"piwork new '{f_name}' --agent betahat")
        elif expect_key == "ctrl-l":
            spawn_terminal(f"piwork new '{f_name}' --agent pi")
        elif f_name == "Unfiled":
            spawn_terminal("pihat")
        else:
            fdir = os.path.join(FOLDERS_DIR, f_name)
            spawn_terminal(f"pihat --session-dir '{fdir}'")
    elif target_out.startswith("session:"):
        session_path = target_out[8:]
        meta = parse_session_meta(session_path)
        cwd = meta["cwd"] if meta["cwd"] and os.path.isdir(meta["cwd"]) else ""

        if expect_key == "ctrl-b":
            if cwd and os.path.realpath(cwd) != home:
                spawn_terminal(f"betahat '{cwd}' --session '{session_path}'", cwd=cwd)
            else:
                spawn_terminal(f"piwork resume-betahat '{session_path}'")
        elif expect_key == "ctrl-h":
            if cwd and os.path.realpath(cwd) != home:
                spawn_terminal(f"beta '{cwd}' --session '{session_path}'", cwd=cwd)
            else:
                spawn_terminal(f"piwork resume-beta '{session_path}'")
        elif expect_key == "ctrl-l":
            spawn_terminal(f"pi --session '{session_path}'", cwd=cwd or home)
        elif expect_key == "ctrl-m":
            spawn_terminal(f"piwork stash '{session_path}'")
        else:
            spawn_terminal(f"pihat --session '{session_path}'", cwd=cwd or home)

def cmd_action(action_type, target):
    home = os.path.realpath(os.path.expanduser("~"))

    if target.startswith("summary:"):
        session_id = target[8:]
        session_path = find_session_path(session_id)
        if session_path:
            cmd_action(action_type, f"session:{session_path}")
        else:
            print("This is an archived summary without an available transcript.")
        return

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
        elif action_type == "pi":
            if folder == "Unfiled":
                spawn_terminal("pi")
            else:
                spawn_terminal(f"pi --session-dir '{fdir}'")
        elif action_type == "beta":
            spawn_terminal(f"piwork new '{folder}' --agent beta")
        elif action_type == "betahat":
            spawn_terminal(f"piwork new '{folder}' --agent betahat")
        elif action_type == "rename":
            spawn_terminal("piwork rename")
        return

    if target.startswith("new:"):
        folder = target[4:]
        if action_type in ("open", "pihat"):
            if folder == "Unfiled":
                spawn_terminal("pihat")
            else:
                fdir = os.path.join(FOLDERS_DIR, folder)
                spawn_terminal(f"pihat --session-dir '{fdir}'")
        elif action_type == "pi":
            spawn_terminal(f"piwork new '{folder}' --agent pi")
        elif action_type == "beta":
            spawn_terminal(f"piwork new '{folder}' --agent beta")
        elif action_type == "betahat":
            spawn_terminal(f"piwork new '{folder}' --agent betahat")
        else:
            spawn_terminal(f"piwork new '{folder}'")
        return

    if target.startswith("session:"):
        session_path = target[8:]
        meta = parse_session_meta(session_path)
        cwd = meta["cwd"] if meta["cwd"] and os.path.isdir(meta["cwd"]) else ""

        if action_type in ("open", "pihat"):
            spawn_terminal(f"pihat --session '{session_path}'", cwd=cwd or home)
        elif action_type == "pi":
            spawn_terminal(f"pi --session '{session_path}'", cwd=cwd or home)
        elif action_type == "beta":
            if cwd and os.path.realpath(cwd) != home:
                spawn_terminal(f"beta '{cwd}' --session '{session_path}'", cwd=cwd)
            else:
                spawn_terminal(f"piwork resume-beta '{session_path}'")
        elif action_type == "betahat":
            if cwd and os.path.realpath(cwd) != home:
                spawn_terminal(f"betahat '{cwd}' --session '{session_path}'", cwd=cwd)
            else:
                spawn_terminal(f"piwork resume-betahat '{session_path}'")
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
