#!/usr/bin/env python3
from __future__ import annotations
import re, sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("usage: validate_logcat.py LOGCAT_PATH EXPECTED_SHA256_PATH")
log_text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
expected = Path(sys.argv[2]).read_text(encoding="ascii").strip().lower()
checksums = re.findall(r"CHECKSUM:([0-9a-fA-F]{64})", log_text)
matches = re.findall(r"RESULT:MATCH\b", log_text)
mismatches = re.findall(r"RESULT:MISMATCH\b", log_text)
errors = []
if not re.fullmatch(r"[0-9a-f]{64}", expected):
    errors.append("expected.sha256 is not exactly one lowercase SHA-256 value")
if len(checksums) != 1:
    errors.append(f"expected exactly one CHECKSUM marker; found {len(checksums)}")
if len(matches) != 1:
    errors.append(f"expected exactly one RESULT:MATCH marker; found {len(matches)}")
if mismatches:
    errors.append(f"unexpected RESULT:MISMATCH marker count: {len(mismatches)}")
if checksums and checksums[0].lower() != expected:
    errors.append("runtime checksum differs from pre-packaging expected.sha256")
if errors:
    for error in errors:
        print(f"::error::{error}")
    raise SystemExit(1)
print(f"validated_checksum={checksums[0].lower()}")
print("validated_result=MATCH")
