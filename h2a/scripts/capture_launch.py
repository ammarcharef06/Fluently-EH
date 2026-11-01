#!/usr/bin/env python3
"""Launch the probe and measure until its runtime checksum appears in Logcat."""
from __future__ import annotations
import re, subprocess, sys, time
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("usage: capture_launch.py LOGCAT_PATH SECONDS_PATH")
log_path, seconds_path = Path(sys.argv[1]), Path(sys.argv[2])
subprocess.run(["adb", "logcat", "-c"], check=True)
start = time.monotonic()
launch = subprocess.run(["adb","shell","monkey","-p","org.fluently.h2a","1"],
                        text=True,capture_output=True,timeout=30)
if launch.returncode != 0:
    print(launch.stdout, file=sys.stderr)
    print(launch.stderr, file=sys.stderr)
    raise SystemExit(launch.returncode)
last_log = ""
deadline = start + 120
while time.monotonic() < deadline:
    result = subprocess.run(["adb","logcat","-d","-v","threadtime","-s","FLUENTLY_H2A:I"],
                            text=True,capture_output=True,timeout=20)
    last_log = result.stdout
    if "CHECKSUM:" in last_log and "RESULT:" in last_log:
        break
    time.sleep(0.5)
elapsed = time.monotonic() - start
log_path.parent.mkdir(parents=True, exist_ok=True)
log_path.write_text(last_log, encoding="utf-8")
seconds_path.write_text(f"{elapsed:.3f}\n", encoding="utf-8")
if not re.search(r"CHECKSUM:[0-9a-fA-F]{64}", last_log) or "RESULT:" not in last_log:
    print("timed out waiting for CHECKSUM and RESULT markers", file=sys.stderr)
    raise SystemExit(1)
print(f"launch_to_checksum_seconds={elapsed:.3f}")
