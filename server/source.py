"""Structural contract for agent sources consumed by :mod:`server.world`."""

from __future__ import annotations

from typing import Protocol


class Source(Protocol):
    """Supply one floor's roster and normalized agent observations."""

    mode: str

    def seats(self) -> list[dict]:
        """Return roster rows used to build the floor layout."""

    def roster_stamp(self) -> int | None:
        """Return a version that changes when the seat set may have changed."""

    def agents(self, now: float, shared_scans=None) -> list[dict]:
        """Return normalized agent rows for one observation time."""

    def classify(self, agent: dict) -> str:
        """Return the rendered state for one normalized agent row."""

    def liveness_known(self) -> bool:
        """Return whether this source can measure liveness."""

    def pr_known(self) -> bool:
        """Return whether this source has a meaningful delivery gate."""

    def describe(self) -> str:
        """Return one source-specific startup-banner line."""


__all__ = ["Source"]
