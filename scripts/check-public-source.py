#!/usr/bin/env python3
"""Reject local links and machine paths in the public source inventory."""
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[1]


def check_file(name, mode=None):
    path = root / name
    if mode == b"120000" or path.is_symlink():
        raise SystemExit("Public source contains a filesystem link: " + name)
    # A working deletion is a valid candidate, before or after it is staged.
    if not path.exists():
        return
    data = path.read_bytes()
    if b"\0" in data:
        return
    if re.search(rb"/(?:home|Users)/[A-Za-z0-9_.-]+/", data):
        raise SystemExit("Public source contains an absolute machine path: " + name)


entries = subprocess.check_output(["git", "ls-files", "--stage", "-z"], cwd=root)
for entry in entries.split(b"\0"):
    if entry:
        metadata, name = entry.split(b"\t", 1)
        check_file(name.decode(), metadata.split()[0])
# Check new publication inputs before they are added to the Git index too.
new = subprocess.check_output(
    ["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=root
)
for name in new.split(b"\0"):
    if name:
        check_file(name.decode())
print("Public source inventory has no filesystem links or absolute machine paths.")
