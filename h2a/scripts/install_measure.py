#!/usr/bin/env python3
from __future__ import annotations
import json, subprocess, sys, time
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("usage: install_measure.py APK OUTPUT_JSON")
apk, output = Path(sys.argv[1]), Path(sys.argv[2])
start = time.monotonic()
proc = subprocess.run(["adb", "install", str(apk)], text=True, capture_output=True)
elapsed = time.monotonic() - start
record = {"command":"adb install","apk":str(apk),"seconds":round(elapsed,3),
          "returncode":proc.returncode,"stdout":proc.stdout,"stderr":proc.stderr}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
print(json.dumps(record, indent=2))
raise SystemExit(proc.returncode)
