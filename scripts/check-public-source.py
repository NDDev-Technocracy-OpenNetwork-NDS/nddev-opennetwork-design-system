#!/usr/bin/env python3
"""Reject local links and machine paths in the public source inventory."""
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[1]
entries = subprocess.check_output(["git", "ls-files", "--stage", "-z"], cwd=root)
for entry in entries.split(b"\0"):
    if not entry:
        continue
    metadata, name = entry.split(b"\t", 1)
    mode = metadata.split()[0]
    if mode == b"120000":
        raise SystemExit("Public source contains a filesystem link: " + name.decode())
    data = (root / name.decode()).read_bytes()
    if b"\0" in data:
        continue
    if re.search(rb"/(?:home|Users)/[A-Za-z0-9_.-]+/", data):
        raise SystemExit("Public source contains an absolute machine path: " + name.decode())
print("Public source inventory has no filesystem links or absolute machine paths.")
