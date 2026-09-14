"""AGNOSTIC-22: all live lane-file readers reject nonregular/oversized input."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from server.safe_read import open_regular, safe_read

ROOT = Path(__file__).resolve().parents[1]


class LaneFileBoundary(unittest.TestCase):
    @unittest.skipUnless(hasattr(os, 'mkfifo'), 'requires POSIX')
    def test_readers_reject_fifo_sparse_and_invalid_utf8_in_real_shell(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = """
import sys
from pathlib import Path
from server.safe_read import safe_read
from server.check import check_file
from server.costview_ingest import iter_events
from server.usage_ingest import usage_records
from tools.lane_worker import _read_target, _append_outbox, WorkerError
root=Path(sys.argv[1]); path=root/'trace.jsonl'
assert safe_read(path) is None
assert check_file(path)
assert list(iter_events(str(root))) == []
assert usage_records([root], {})['records'] == []
try: _read_target(root, Path('trace.jsonl'))
except WorkerError: pass
else: raise AssertionError('worker read invalid target')
try: _append_outbox(path, 'test')
except (OSError, WorkerError): pass
else: raise AssertionError('worker appended invalid target')
"""
            path = root / 'trace.jsonl'
            for fixture in ('fifo', 'sparse', 'invalid_utf8', 'directory'):
                if path.exists():
                    path.unlink()
                if fixture == 'fifo':
                    os.mkfifo(path)
                elif fixture == 'sparse':
                    with path.open('wb') as stream:
                        stream.truncate(2 * 1024 ** 3)
                elif fixture == 'directory':
                    path.mkdir()
                else:
                    path.write_bytes(b'\xff')
                with self.subTest(fixture=fixture):
                    subprocess.run([sys.executable, '-c', script, str(root)], cwd=ROOT,
                                   check=True, capture_output=True, text=True, timeout=5)

    def test_invalid_descriptors_close_before_return_and_sparse_is_never_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'large'
            with path.open('wb') as stream:
                stream.truncate(2 * 1024 ** 3)
            with patch('server.safe_read.os.read', side_effect=AssertionError('must not allocate')), \
                    patch('server.safe_read.os.close', wraps=os.close) as close:
                self.assertIsNone(safe_read(path))
                close.assert_called_once()
            with self.assertRaises(OSError):
                open_regular(path, flags=os.O_RDWR | os.O_APPEND)


if __name__ == '__main__':
    unittest.main()
