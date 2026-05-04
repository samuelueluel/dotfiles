#!/usr/bin/python3
"""Shared helpers for multi-format tag reading/writing (MP3, FLAC)."""
import os
import sys
import mutagen
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.id3 import TIT1, TCON

EXTENSIONS = ('.mp3', '.flac')
UNSAFE_EXTENSIONS = ('.m4a', '.mp4', '.aac', '.wma', '.ogg', '.opus', '.ape', '.wv')

_ID3    = {'grouping': ('TIT1', TIT1), 'genres': ('TCON', TCON)}
_VORBIS = {'grouping': 'grouping', 'genres': 'genre'}

def check_for_unsafe_files(path, recursive=False):
    """Exit with error if any unsupported audio formats are found."""
    found = []
    if recursive:
        for dirpath, _, filenames in os.walk(path, followlinks=True):
            for f in filenames:
                if f.lower().endswith(UNSAFE_EXTENSIONS):
                    found.append(os.path.join(dirpath, f))
    else:
        for f in os.listdir(path):
            if f.lower().endswith(UNSAFE_EXTENSIONS):
                found.append(os.path.join(path, f))
    if found:
        print("Error: unsupported audio files found — aborting without making changes.", file=sys.stderr)
        for f in found:
            print(f"  {f}", file=sys.stderr)
        sys.exit(1)

def open_audio(filepath):
    try:
        return mutagen.File(filepath, easy=False)
    except Exception:
        return None

def get_values(audio, field):
    if audio is None or audio.tags is None:
        return []
    if isinstance(audio, MP3):
        tag_name, _ = _ID3[field]
        if tag_name not in audio.tags:
            return []
        return list(audio.tags[tag_name].text)
    elif isinstance(audio, FLAC):
        return list(audio.tags.get(_VORBIS[field], []))
    return []

def set_values(audio, field, values):
    if isinstance(audio, MP3):
        tag_name, tag_class = _ID3[field]
        encoding = audio.tags[tag_name].encoding if tag_name in audio.tags else 3
        audio.tags[tag_name] = tag_class(encoding=encoding, text=values)
    elif isinstance(audio, FLAC):
        audio.tags[_VORBIS[field]] = values

def save_audio(audio):
    if isinstance(audio, MP3):
        audio.save(v2_version=4)
    else:
        audio.save()
