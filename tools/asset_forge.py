#!/usr/bin/env python3
"""Run the isolated Asset Forge procedural candidate conductor."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
root_text = str(ROOT)
sys.path[:] = [entry for entry in sys.path if entry != root_text]
sys.path.insert(0, root_text)

from asset_forge.conductor import main  # noqa: E402


if __name__ == "__main__":
    sys.exit(main())
