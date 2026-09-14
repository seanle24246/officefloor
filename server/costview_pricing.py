"""CV-2: deterministic CostView provider lookup and token cost estimates.

Rates are loaded from the maintained static table in ``data/costview``.  This
module never fetches pricing, guesses a provider, aliases a model, or presents
an estimate as an invoice amount.  Unknown or ambiguous evidence is explicitly
unpriced.

The table and arithmetic implement ``docs/costview/CV-SOL-00-contract.md``:
rates are USD per million tokens, cache-write TTLs are distinct, and dollars
are rounded once to six places with decimal ROUND_HALF_EVEN.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN
from pathlib import Path
from typing import Dict, Iterable, Mapping, Optional, Union
from urllib.parse import urlsplit


DEFAULT_PRICE_TABLE = (
    Path(__file__).resolve().parent.parent / "data" / "costview" / "prices.json"
)

_RATE_KEYS = (
    "input",
    "output",
    "cache_write_5m",
    "cache_write_1h",
    "cache_read",
)
_VARIANT_KEYS = ("inference_geo", "speed", "service_tier")
_MILLION = Decimal("1000000")
_SIX_PLACES = Decimal("0.000001")


class PriceTableError(ValueError):
    """The configured static price table is not safe to use."""


def _utc_timestamp(value: object, field: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise PriceTableError("%s must be an RFC 3339 UTC timestamp" % field)
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise PriceTableError("%s must be an RFC 3339 UTC timestamp" % field) from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise PriceTableError("%s must be an RFC 3339 UTC timestamp" % field)
    return parsed


def _rate(value: object, field: str) -> Decimal:
    if not isinstance(value, str):
        raise PriceTableError("%s must be a decimal string" % field)
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise PriceTableError("%s must be a decimal string" % field) from exc
    if not parsed.is_finite() or parsed < 0:
        raise PriceTableError("%s must be a non-negative finite decimal" % field)
    return parsed


def validate_price_table(table: object) -> Mapping[str, object]:
    """Validate and return a CV-SOL-00 price table without changing it."""
    if not isinstance(table, Mapping):
        raise PriceTableError("price table must be an object")
    if table.get("schema") != 1 or isinstance(table.get("schema"), bool):
        raise PriceTableError("price table schema must be integer 1")
    if not isinstance(table.get("table_id"), str) or not table["table_id"]:
        raise PriceTableError("price table needs a non-empty table_id")
    _utc_timestamp(table.get("as_of"), "as_of")
    if table.get("currency") != "USD":
        raise PriceTableError("price table currency must be USD")
    if table.get("unit") != "usd_per_million_tokens":
        raise PriceTableError("price table unit must be usd_per_million_tokens")

    rows = table.get("rows")
    if not isinstance(rows, list):
        raise PriceTableError("price table rows must be an array")
    for index, row in enumerate(rows):
        prefix = "rows[%d]" % index
        if not isinstance(row, Mapping):
            raise PriceTableError("%s must be an object" % prefix)
        for key in ("model", "provider", "source_url"):
            if not isinstance(row.get(key), str) or not row[key]:
                raise PriceTableError("%s.%s must be a non-empty string" % (prefix, key))
        source = urlsplit(row["source_url"])
        if source.scheme != "https" or not source.netloc:
            raise PriceTableError("%s.source_url must be an HTTPS URL" % prefix)
        _utc_timestamp(row.get("as_of"), prefix + ".as_of")
        start = _utc_timestamp(row.get("effective_from"), prefix + ".effective_from")
        end_value = row.get("effective_until")
        if end_value is not None:
            end = _utc_timestamp(end_value, prefix + ".effective_until")
            if end <= start:
                raise PriceTableError("%s effective interval must be increasing" % prefix)
        _utc_timestamp(row.get("source_observed_at"), prefix + ".source_observed_at")

        context = row.get("context_window_tokens")
        if context is not None and (
            not isinstance(context, int) or isinstance(context, bool) or context <= 0
        ):
            raise PriceTableError(
                "%s.context_window_tokens must be a positive integer or null" % prefix
            )
        for key in _VARIANT_KEYS:
            value = row.get(key)
            if value is not None and (not isinstance(value, str) or not value):
                raise PriceTableError("%s.%s must be a string or null" % (prefix, key))

        maximum = row.get("max_standard_prompt_tokens")
        if maximum is not None and (
            not isinstance(maximum, int) or isinstance(maximum, bool) or maximum <= 0
        ):
            raise PriceTableError(
                "%s.max_standard_prompt_tokens must be a positive integer" % prefix
            )

        rates = row.get("usd_per_million")
        if not isinstance(rates, Mapping):
            raise PriceTableError("%s.usd_per_million must be an object" % prefix)
        for key in _RATE_KEYS:
            _rate(rates.get(key), "%s.usd_per_million.%s" % (prefix, key))
        if "cache_write" in rates:
            _rate(rates["cache_write"], prefix + ".usd_per_million.cache_write")
    return table


def load_price_table(
    path: Union[str, Path] = DEFAULT_PRICE_TABLE,
) -> Mapping[str, object]:
    """Load and validate a maintained local price table; never use the network."""
    try:
        with Path(path).open("r", encoding="utf-8") as handle:
            table = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise PriceTableError("unable to load price table") from exc
    return validate_price_table(table)


def _resolve_table(
    table: Optional[Union[Mapping[str, object], str, Path]],
) -> Mapping[str, object]:
    if table is None:
        return load_price_table()
    if isinstance(table, (str, Path)):
        return load_price_table(table)
    return validate_price_table(table)


def provider_of(
    model: object,
    table: Optional[Union[Mapping[str, object], str, Path]] = None,
) -> Optional[str]:
    """Return the provider for an exact model-table match, otherwise ``None``."""
    if not isinstance(model, str) or not model:
        return None
    try:
        resolved = _resolve_table(table)
    except PriceTableError:
        return None
    providers = {
        row["provider"]
        for row in resolved["rows"]  # type: ignore[union-attr]
        if row["model"] == model
    }
    if len(providers) != 1:
        return None
    return next(iter(providers))


def _event_value(event: Mapping[str, object], key: str) -> object:
    if key in event:
        return event[key]
    evidence = event.get("pricing_evidence")
    if isinstance(evidence, Mapping):
        return evidence.get(key)
    return None


def _token(value: object) -> Optional[int]:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        return None
    return value


def _token_counts(event: Mapping[str, object]) -> Optional[Dict[str, Optional[int]]]:
    tok_in = _token(event.get("tok_in"))
    tok_out = _token(event.get("tok_out"))
    aggregate = _token(event.get("tok_cache_create"))
    tok_cache_read = _token(event.get("tok_cache_read"))
    if None in (tok_in, tok_out, aggregate, tok_cache_read):
        return None

    write_5m_raw = _event_value(event, "tok_cache_create_5m")
    write_1h_raw = _event_value(event, "tok_cache_create_1h")
    if write_5m_raw is None and write_1h_raw is None:
        if aggregate == 0:
            write_5m: Optional[int] = 0
            write_1h: Optional[int] = 0
        else:
            # Some providers report only one cache-write kind.  Rating it is
            # allowed only when that row publishes an unambiguous singular rate.
            write_5m = None
            write_1h = None
    else:
        write_5m = _token(write_5m_raw)
        write_1h = _token(write_1h_raw)
        if write_5m is None or write_1h is None or write_5m + write_1h != aggregate:
            return None

    return {
        "input": tok_in,
        "output": tok_out,
        "cache_write": aggregate,
        "cache_write_5m": write_5m,
        "cache_write_1h": write_1h,
        "cache_read": tok_cache_read,
    }


def _select_row(
    event: Mapping[str, object],
    counts: Mapping[str, Optional[int]],
    table: Mapping[str, object],
) -> Optional[Mapping[str, object]]:
    model = event.get("model")
    if not isinstance(model, str) or not model:
        return None
    try:
        timestamp = _utc_timestamp(event.get("ts"), "event.ts")
    except PriceTableError:
        return None

    prompt_tokens = (
        counts["input"] + counts["cache_write"] + counts["cache_read"]
    )  # type: ignore[operator]
    matches = []
    for row in table["rows"]:  # type: ignore[union-attr]
        if row["model"] != model:
            continue
        start = _utc_timestamp(row["effective_from"], "effective_from")
        end_value = row.get("effective_until")
        if timestamp < start or (
            end_value is not None
            and timestamp >= _utc_timestamp(end_value, "effective_until")
        ):
            continue
        if any(_event_value(event, key) != row.get(key) for key in _VARIANT_KEYS):
            continue
        maximum = row.get("max_standard_prompt_tokens")
        if maximum is not None and prompt_tokens > maximum:
            # The static row holds only the standard tier.  A request in a
            # different published tier remains unpriced until that tier is a row.
            continue
        matches.append(row)
    if len(matches) != 1:
        return None
    return matches[0]


def _raw_cost(
    event: object, table: Mapping[str, object]
) -> Optional[Decimal]:
    if not isinstance(event, Mapping):
        return None
    counts = _token_counts(event)
    if counts is None:
        return None
    row = _select_row(event, counts, table)
    if row is None:
        return None
    rates = row["usd_per_million"]

    if counts["cache_write_5m"] is None:
        if "cache_write" not in rates:
            return None
        weighted = counts["cache_write"] * _rate(rates["cache_write"], "cache_write")
    else:
        weighted = (
            counts["cache_write_5m"]
            * _rate(rates["cache_write_5m"], "cache_write_5m")
            + counts["cache_write_1h"]
            * _rate(rates["cache_write_1h"], "cache_write_1h")
        )
    weighted += counts["input"] * _rate(rates["input"], "input")
    weighted += counts["output"] * _rate(rates["output"], "output")
    weighted += counts["cache_read"] * _rate(rates["cache_read"], "cache_read")
    return weighted / _MILLION


def _estimate(
    table: Optional[Mapping[str, object]],
    raw: Optional[Decimal],
    priced_events: int,
    total_events: int,
) -> Dict[str, object]:
    priced = raw is not None and priced_events == total_events
    return {
        "usd": (
            format(raw.quantize(_SIX_PLACES, rounding=ROUND_HALF_EVEN), "f")
            if priced
            else None
        ),
        "est": True,
        "basis": "published_token_rates" if priced else "unpriced",
        "rate_table_id": table["table_id"] if table is not None else None,
        "rate_table_as_of": table["as_of"] if table is not None else None,
        "priced_events": priced_events,
        "total_events": total_events,
    }


def cost_of_events(
    events: Iterable[object],
    table: Optional[Union[Mapping[str, object], str, Path]] = None,
) -> Dict[str, object]:
    """Rate events and round their aggregate once, or return explicit unpriced."""
    event_list = list(events)
    try:
        resolved = _resolve_table(table)
    except PriceTableError:
        return _estimate(None, None, 0, len(event_list))

    raw_total = Decimal("0")
    priced_events = 0
    for event in event_list:
        raw = _raw_cost(event, resolved)
        if raw is None:
            continue
        raw_total += raw
        priced_events += 1
    raw_result = raw_total if priced_events == len(event_list) else None
    return _estimate(resolved, raw_result, priced_events, len(event_list))


def cost_of(
    event: object,
    table: Optional[Union[Mapping[str, object], str, Path]] = None,
) -> Dict[str, object]:
    """Return a first-class estimated cost for one normalized usage event."""
    return cost_of_events([event], table)


def _selftest() -> None:
    import unittest

    class CostViewPricingTests(unittest.TestCase):
        def setUp(self) -> None:
            self.table = load_price_table()
            self.fixture = {
                "ts": "2026-08-13T17:00:00Z",
                "model": "claude-fable-5",
                "tok_in": 1_000_000,
                "tok_out": 1_000_000,
                "tok_cache_create": 2_000_000,
                "tok_cache_read": 1_000_000,
                "pricing_evidence": {
                    "tok_cache_create_5m": 1_000_000,
                    "tok_cache_create_1h": 1_000_000,
                    "inference_geo": None,
                    "speed": None,
                    "service_tier": None,
                },
            }

        def test_rows_are_sourced_and_table_is_valid(self) -> None:
            self.assertEqual(self.table["unit"], "usd_per_million_tokens")
            self.assertTrue(
                all(row["as_of"] and row["source_url"] for row in self.table["rows"])
            )

        def test_provider_lookup_is_exact(self) -> None:
            self.assertEqual(provider_of("claude-fable-5"), "anthropic")
            self.assertEqual(provider_of("gpt-5.6-sol"), "openai")
            self.assertIsNone(provider_of("claude-fable-5-suffix"))

        def test_fixture_event_uses_each_distinct_token_rate(self) -> None:
            self.assertEqual(
                cost_of(self.fixture),
                {
                    "usd": "93.500000",
                    "est": True,
                    "basis": "published_token_rates",
                    "rate_table_id": self.table["table_id"],
                    "rate_table_as_of": self.table["as_of"],
                    "priced_events": 1,
                    "total_events": 1,
                },
            )

        def test_unknown_model_is_unpriced_not_zero(self) -> None:
            unknown = dict(self.fixture, model="not-a-real-model")
            result = cost_of(unknown)
            self.assertIsNone(result["usd"])
            self.assertTrue(result["est"])
            self.assertEqual(result["basis"], "unpriced")

        def test_ambiguous_claude_cache_write_is_unpriced(self) -> None:
            event = dict(self.fixture)
            event.pop("pricing_evidence")
            self.assertIsNone(cost_of(event)["usd"])

        def test_unrecognized_price_variant_is_unpriced(self) -> None:
            event = dict(self.fixture)
            event["pricing_evidence"] = dict(
                self.fixture["pricing_evidence"], inference_geo="us"
            )
            self.assertIsNone(cost_of(event)["usd"])

        def test_openai_singular_cache_write_rate(self) -> None:
            event = {
                "ts": "2026-08-13T17:00:00Z",
                "model": "gpt-5.6-sol",
                "tok_in": 1_000,
                "tok_out": 500,
                "tok_cache_create": 200,
                "tok_cache_read": 100,
            }
            self.assertEqual(cost_of(event)["usd"], "0.021300")

        def test_same_input_and_table_are_deterministic(self) -> None:
            self.assertEqual(cost_of(self.fixture), cost_of(self.fixture))

    suite = unittest.defaultTestLoader.loadTestsFromTestCase(CostViewPricingTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)


if __name__ == "__main__":
    _selftest()
