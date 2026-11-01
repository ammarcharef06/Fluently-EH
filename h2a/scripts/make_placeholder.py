#!/usr/bin/env python3
"""Generate the registered 128 MiB high-entropy H2a test payload."""
from __future__ import annotations
import os
import sys
from pathlib import Path

EXPECTED_BYTES = 134_217_728
CHUNK_BYTES = 1_048_576

def main() -> int:
    if len(sys.argv) != 2:
        print("usage: make_placeholder.py OUTPUT_PATH", file=sys.stderr)
        return 2
    target = Path(sys.argv[1])
    target.parent.mkdir(parents=True, exist_ok=True)
    remaining = EXPECTED_BYTES
    with target.open("wb") as output:
        while remaining:
            chunk_size = min(CHUNK_BYTES, remaining)
            output.write(os.urandom(chunk_size))
            remaining -= chunk_size
    actual = target.stat().st_size
    if actual != EXPECTED_BYTES:
        print(f"wrong placeholder size: {actual}", file=sys.stderr)
        return 1
    print(f"placeholder_bytes={actual}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
