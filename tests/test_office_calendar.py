"""OFFICE-EVENTS-01: the weekly calendar core + floor probes run green.

The calendar is JavaScript (static/office.calendar.js), so this unittest drives
the two registered node probes and asserts their success lines. Behaviour is
tested on the real modules; this file only wires the Python gate to them.
"""
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


@unittest.skipIf(NODE is None, "node is not available")
class OfficeCalendarTests(unittest.TestCase):
    def run_probe(self, name: str, marker: str) -> None:
        result = subprocess.run(
            [NODE, str(ROOT / "qa" / "tools" / name)],
            cwd=ROOT, capture_output=True, text=True, timeout=120,
        )
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, output)
        self.assertIn(marker, result.stdout, output)

    def test_calendar_table_and_window_math(self):
        self.run_probe("office_calendar_core_probe.cjs", "10 passed")

    def test_pill_and_cake_activity_are_flag_and_window_gated(self):
        self.run_probe("office_calendar_floor_probe.mjs", "office_calendar_floor_probe PASS")


if __name__ == "__main__":
    unittest.main()
