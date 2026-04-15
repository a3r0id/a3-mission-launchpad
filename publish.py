#!/usr/bin/env python3
"""Compatibility wrapper. Use `python util.py --publish`."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


if __name__ == "__main__":
    repo = Path(__file__).resolve().parent
    subprocess.run([sys.executable, "util.py", "--publish"], cwd=str(repo), check=True)
