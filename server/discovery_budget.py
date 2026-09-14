"""One finite I/O budget shared by all adapters in a discovery pass."""
import os
import time


class DiscoveryBudget:
    def __init__(self, entries=5000, bytes_limit=64 * 1024 * 1024, seconds=2.0):
        self.entries = entries
        self.bytes = bytes_limit
        self.deadline = time.monotonic() + seconds

    def available(self):
        # Exhausting enumeration must not forbid reading candidates already found.
        return self.bytes > 0 and time.monotonic() < self.deadline

    def take_bytes(self, count):
        if not self.available() or count > self.bytes:
            return False
        self.bytes -= count
        return True

    def names(self, directory):
        # scandir is lazy; listdir allocates the entire stranger's archive.
        with os.scandir(directory) as entries:
            while self.entries > 0 and self.available():
                try:
                    entry = next(entries)
                except StopIteration:
                    break
                self.entries -= 1
                yield entry.name
