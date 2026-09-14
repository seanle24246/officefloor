import os
import subprocess
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class GeneratorDriftTests(unittest.TestCase):

    def test_sharedfloor_manifest_check(self):
        result = subprocess.run(
            [sys.executable, "tools/gen_sharedfloor_manifest.py", "--check"],
            cwd=REPO_ROOT,
            capture_output=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn(b"SHAREDFLOOR-MANIFEST OK", result.stdout + result.stderr)

if __name__ == "__main__":
    unittest.main()
