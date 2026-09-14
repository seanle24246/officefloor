"""Contract tests for the generic spool-file validator."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.check import check_file


class CheckFileTests(unittest.TestCase):
    def check(self, content: str) -> list[str]:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "agent.json"
            path.write_text(content)
            return check_file(path)

    def test_five_malformed_inputs_have_friendly_stable_messages(self) -> None:
        cases = {
            "{": "invalid JSON; write to a temporary file, then rename it into place",
            "[]": "the agent file must contain one JSON object",
            '{"office": 2}': "`office` must be the integer 1",
            '{"id": 4}': "`id` must be a non-empty string when supplied",
            '{"ttl_s": 0}': "`ttl_s` must be a positive integer when supplied",
        }
        for content, expected in cases.items():
            with self.subTest(content=content):
                self.assertEqual(check_file_result := self.check(content), [expected])

    def test_scalar_json_values_rejected(self) -> None:
        """Scalar JSON values (number, string, boolean, null) must be rejected.

        The agent file contract requires a single JSON object; a bare scalar
        is not an object and must produce the stable 'one JSON object' error.
        """
        cases = {
            "42": "the agent file must contain one JSON object",
            '"hello"': "the agent file must contain one JSON object",
            "true": "the agent file must contain one JSON object",
            "null": "the agent file must contain one JSON object",
        }
        for content, expected in cases.items():
            with self.subTest(content=content):
                self.assertEqual(self.check(content), [expected])

    def test_permissive_defaults_and_unknown_fields_pass(self) -> None:
        self.assertEqual(self.check('{"future_field": true}'), [])

    def test_unreadable_file_is_contained_with_stable_message(self) -> None:
        expected = ["could not read the file; check the path and UTF-8 encoding"]
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "does-not-exist.json"
            with self.subTest(trigger="missing path"):
                self.assertEqual(check_file(missing), expected)
            invalid_utf8 = Path(tmp) / "agent.json"
            invalid_utf8.write_bytes(b"\xff\xfe\x00{")
            with self.subTest(trigger="invalid utf-8"):
                self.assertEqual(check_file(invalid_utf8), expected)

    def test_fully_valid_record_passes(self) -> None:
        """A well-formed agent spool file with all optional fields set must pass."""
        content = '{"office": 1, "id": "agent-42", "ttl_s": 300}'
        self.assertEqual(self.check(content), [])

    def test_boolean_values_rejected_for_office_and_ttl_s(self) -> None:
        """Booleans are ints in Python; the validator must reject them explicitly."""
        cases = {
            '{"office": true}': "`office` must be the integer 1",
            '{"office": false}': "`office` must be the integer 1",
            '{"ttl_s": true}': "`ttl_s` must be a positive integer when supplied",
            '{"ttl_s": false}': "`ttl_s` must be a positive integer when supplied",
        }
        for content, expected in cases.items():
            with self.subTest(content=content):
                self.assertEqual(self.check(content), [expected])

    def test_empty_id_string_rejected(self) -> None:
        """An empty string for `id` must be rejected as it is not a non-empty string."""
        self.assertEqual(self.check('{"id": ""}'), ["`id` must be a non-empty string when supplied"])

    def test_null_optional_fields_rejected(self) -> None:
        """Null values for optional fields are rejected by the validator."""
        cases = {
            '{"office": null}': ["`office` must be the integer 1"],
            '{"id": null}': ["`id` must be a non-empty string when supplied"],
            '{"ttl_s": null}': ["`ttl_s` must be a positive integer when supplied"],
            '{"office": null, "id": null, "ttl_s": null}': ["`office` must be the integer 1"],
        }
        for content, expected in cases.items():
            with self.subTest(content=content):
                self.assertEqual(self.check(content), expected)

    def test_float_office_rejected(self) -> None:
        """Float values for `office` must be rejected; only integer 1 is valid."""
        self.assertEqual(self.check('{"office": 1.0}'), ["`office` must be the integer 1"])

    def test_string_values_rejected_for_numeric_fields(self) -> None:
        """String values for numeric fields must be rejected; only integers are valid."""
        cases = {
            '{"office": "1"}': ["`office` must be the integer 1"],
            '{"ttl_s": "100"}': ["`ttl_s` must be a positive integer when supplied"],
        }
        for content, expected in cases.items():
            with self.subTest(content=content):
                self.assertEqual(self.check(content), expected)

    def test_negative_ttl_s_rejected(self) -> None:
        """Negative ttl_s values must be rejected; only positive integers are valid."""
        cases = {
            '{"ttl_s": -1}': ["`ttl_s` must be a positive integer when supplied"],
            '{"ttl_s": -100}': ["`ttl_s` must be a positive integer when supplied"],
        }
        for content, expected in cases.items():
            with self.subTest(content=content):
                self.assertEqual(self.check(content), expected)

    def test_float_ttl_s_rejected(self) -> None:
        """Float ttl_s values must be rejected; only true integers are valid.

        A float like 1.5 is not a positive integer, even though it is positive.
        This protects the boundary that time-based fields accept only exact
        integer seconds, not fractional or imprecise numeric types.
        """
        cases = {
            '{"ttl_s": 1.5}': ["`ttl_s` must be a positive integer when supplied"],
            '{"ttl_s": 100.0}': ["`ttl_s` must be a positive integer when supplied"],
        }
        for content, expected in cases.items():
            with self.subTest(content=content):
                self.assertEqual(self.check(content), expected)

    def test_first_error_wins_when_multiple_issues_exist(self) -> None:
        """When multiple validation issues exist, only the first error is reported.

        This protects the user-visible guarantee that the validator returns
        exactly one actionable error message, not a list of all problems.
        """
        # Invalid JSON should be reported before any field validation
        self.assertEqual(
            self.check("{invalid json"),
            ["invalid JSON; write to a temporary file, then rename it into place"],
        )
        # Non-object JSON should be reported before field validation
        self.assertEqual(
            self.check("[1, 2, 3]"),
            ["the agent file must contain one JSON object"],
        )
        # Office validation should come before id/ttl_s validation
        self.assertEqual(
            self.check('{"office": 2, "id": 4, "ttl_s": 0}'),
            ["`office` must be the integer 1"],
        )
        # Id validation should come before ttl_s validation
        self.assertEqual(
            self.check('{"office": 1, "id": 4, "ttl_s": 0}'),
            ["`id` must be a non-empty string when supplied"],
        )


if __name__ == "__main__":
    unittest.main()
