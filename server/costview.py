"""CV-3: deterministic CostView aggregation and read-only HTTP projection.

``snapshot(root, prices, buckets, now)`` joins CV-1 usage observations to the
CV-2 price table.  The four arguments are deliberately injectable so fixture
trees do not depend on the host clock, home directory, or rate configuration.

The projection never exposes transcript paths, session identifiers, prompts,
or completions.  Unknown providers and prices remain explicit; they are never
turned into a zero-cost or synthetic rollup.
"""
from __future__ import annotations

import json
import math
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_EVEN
from pathlib import Path
from typing import Iterable, Mapping, Optional
from urllib.parse import parse_qsl

from server import costview_ingest, costview_pricing


DEFAULT_BUCKET_SECONDS = 900
DEFAULT_STALE_AFTER_SECONDS = 300
DEFAULT_REFRESH_HINT_MS = 15_000
_MILLION = Decimal("1000000")
_SIX_PLACES = Decimal("0.000001")
_TOKEN_FIELDS = {
    "input": "tok_in",
    "output": "tok_out",
    "cache_create": "tok_cache_create",
    "cache_read": "tok_cache_read",
}
_VARIANT_FIELDS = ("inference_geo", "speed", "service_tier")


class CostViewQueryError(ValueError):
    """A route query does not match the strict CostView selector grammar."""


def _parse_timestamp(value: object, *, require_utc: bool = False) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    if require_utc and not (value.endswith("Z") or value.endswith("+00:00")):
        return None
    candidate = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    parsed = parsed.astimezone(timezone.utc)
    if require_utc and parsed.utcoffset() != timedelta(0):
        return None
    return parsed


def _format_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _safe_int(value: object) -> Optional[int]:
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return None


def _positive_int(value: object, default: int) -> int:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    if isinstance(value, str):
        try:
            parsed = int(value)
        except ValueError:
            return default
        if parsed > 0:
            return parsed
    return default


def _decimal_number(value: Decimal, places: str = "0.000001") -> object:
    rounded = value.quantize(Decimal(places), rounding=ROUND_HALF_EVEN)
    if rounded == rounded.to_integral_value():
        return int(rounded)
    return float(rounded)


def _usd(value: Decimal) -> str:
    return format(value.quantize(_SIX_PLACES, rounding=ROUND_HALF_EVEN), "f")


def _event_value(event: Mapping[str, object], key: str) -> object:
    if key in event:
        return event[key]
    evidence = event.get("pricing_evidence")
    if isinstance(evidence, Mapping):
        return evidence.get(key)
    return None


def _load_prices(prices: object) -> Optional[Mapping[str, object]]:
    try:
        if prices is None:
            return costview_pricing.load_price_table()
        if isinstance(prices, (str, os.PathLike)):
            return costview_pricing.load_price_table(prices)
        return costview_pricing.validate_price_table(prices)
    except (costview_pricing.PriceTableError, TypeError, ValueError):
        return None


def _price_row(
    event: Mapping[str, object], table: Optional[Mapping[str, object]]
) -> Optional[Mapping[str, object]]:
    """Resolve the same exact model/variant/effective row required by CV-2."""
    if table is None:
        return None
    model = event.get("model")
    timestamp = _parse_timestamp(event.get("ts"))
    counts = [_safe_int(event.get(field)) for field in _TOKEN_FIELDS.values()]
    if not isinstance(model, str) or timestamp is None or any(v is None for v in counts):
        return None
    prompt_tokens = counts[0] + counts[2] + counts[3]  # type: ignore[operator]
    matches = []
    for candidate in table["rows"]:  # type: ignore[index]
        row = candidate  # validated by CV-2
        if row["model"] != model:
            continue
        effective_from = _parse_timestamp(row["effective_from"])
        effective_until = _parse_timestamp(row.get("effective_until"))
        if effective_from is None or timestamp < effective_from:
            continue
        if effective_until is not None and timestamp >= effective_until:
            continue
        if any(_event_value(event, key) != row.get(key) for key in _VARIANT_FIELDS):
            continue
        maximum = row.get("max_standard_prompt_tokens")
        if isinstance(maximum, int) and prompt_tokens > maximum:
            continue
        matches.append(row)
    return matches[0] if len(matches) == 1 else None


def _raw_kind_cost(
    event: Mapping[str, object], row: Optional[Mapping[str, object]], kind: str
) -> Optional[Decimal]:
    if row is None:
        return None
    token_field = _TOKEN_FIELDS[kind]
    count = _safe_int(event.get(token_field))
    if count is None:
        return None
    rates = row["usd_per_million"]
    if kind != "cache_create":
        rate_key = {"input": "input", "output": "output", "cache_read": "cache_read"}[kind]
        return Decimal(count) * Decimal(rates[rate_key]) / _MILLION

    if count == 0:
        return Decimal(0)
    write_5m = _safe_int(_event_value(event, "tok_cache_create_5m"))
    write_1h = _safe_int(_event_value(event, "tok_cache_create_1h"))
    if write_5m is not None and write_1h is not None and write_5m + write_1h == count:
        return (
            Decimal(write_5m) * Decimal(rates["cache_write_5m"])
            + Decimal(write_1h) * Decimal(rates["cache_write_1h"])
        ) / _MILLION
    if "cache_write" in rates:
        return Decimal(count) * Decimal(rates["cache_write"]) / _MILLION
    return None


def _raw_total_cost(
    event: Mapping[str, object], table: Optional[Mapping[str, object]]
) -> Optional[Decimal]:
    row = _price_row(event, table)
    parts = [_raw_kind_cost(event, row, kind) for kind in _TOKEN_FIELDS]
    if any(part is None for part in parts):
        return None
    return sum(parts, Decimal(0))  # type: ignore[arg-type]


def _empty_estimate(table: Optional[Mapping[str, object]], total: int = 0) -> dict:
    return {
        "usd": None,
        "est": True,
        "basis": "unpriced",
        "rate_table_id": table["table_id"] if table is not None else None,
        "rate_table_as_of": table["as_of"] if table is not None else None,
        "priced_events": 0,
        "total_events": total,
    }


def _estimate(
    events: Iterable[Mapping[str, object]],
    table: Optional[Mapping[str, object]],
    kind: Optional[str] = None,
) -> dict:
    event_list = list(events)
    if not event_list:
        return _empty_estimate(table)
    if table is None:
        return _empty_estimate(None, len(event_list))
    if kind is None:
        # CV-2 remains the authority for aggregate token-cost arithmetic.
        return costview_pricing.cost_of_events(event_list, table)
    raw_total = Decimal(0)
    priced = 0
    for event in event_list:
        raw = _raw_kind_cost(event, _price_row(event, table), kind)
        if raw is not None:
            raw_total += raw
            priced += 1
    complete = priced == len(event_list)
    return {
        "usd": _usd(raw_total) if complete else None,
        "est": True,
        "basis": "published_token_rates" if complete else "unpriced",
        "rate_table_id": table["table_id"],
        "rate_table_as_of": table["as_of"],
        "priced_events": priced,
        "total_events": len(event_list),
    }


def _cost_kinds(events: Iterable[Mapping[str, object]], table: object) -> dict:
    event_list = list(events)
    return {
        kind: _estimate(event_list, table, kind)
        for kind in _TOKEN_FIELDS
    } | {"total": _estimate(event_list, table)}


def _tokens(events: Iterable[Mapping[str, object]]) -> dict:
    totals = {kind: 0 for kind in _TOKEN_FIELDS}
    for event in events:
        for kind, field in _TOKEN_FIELDS.items():
            value = _safe_int(event.get(field))
            if value is not None:
                totals[kind] += value
    totals["total"] = sum(totals.values())
    return totals


def _nearest_rank(values: Iterable[object], percentile: Decimal) -> object:
    measured = sorted(
        value for value in values
        if isinstance(value, (int, float, Decimal))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
        and value >= 0
    )
    if not measured:
        return None
    index = max(0, math.ceil(len(measured) * float(percentile)) - 1)
    return measured[index]


def _runtime(events: Iterable[Mapping[str, object]]) -> dict:
    event_list = list(events)
    values = [_event_value(event, "turn_interval_ms") for event in event_list]
    measured = [value for value in values if _safe_int(value) is not None]
    return {
        "observed_turn_interval_p95_ms": _nearest_rank(measured, Decimal("0.95")),
        "measured_events": len(measured),
        "total_events": len(event_list),
    }


def _context_remaining(
    event: Mapping[str, object], table: Optional[Mapping[str, object]]
) -> object:
    observed = _event_value(event, "prompt_context_remaining_pct")
    if isinstance(observed, (int, float, Decimal)) and not isinstance(observed, bool):
        if math.isfinite(float(observed)) and 0 <= observed <= 100:
            return observed
    row = _price_row(event, table)
    if row is None:
        return None
    window = row.get("context_window_tokens")
    tok_in = _safe_int(event.get("tok_in"))
    cache_create = _safe_int(event.get("tok_cache_create"))
    cache_read = _safe_int(event.get("tok_cache_read"))
    if not isinstance(window, int) or None in (tok_in, cache_create, cache_read):
        return None
    prompt = tok_in + cache_create + cache_read  # type: ignore[operator]
    if prompt > window:
        return None
    return _decimal_number(
        Decimal(100) * Decimal(window - prompt) / Decimal(window)
    )


def _last_seen(events: Iterable[Mapping[str, object]]) -> str:
    return max(str(event["ts"]) for event in events)


def _rate(events: Iterable[Mapping[str, object]], numerator: int, seconds: int) -> object:
    del events  # Call shape documents the rate's event scope.
    if seconds <= 0:
        return 0
    return _decimal_number(Decimal(numerator) * Decimal(60) / Decimal(seconds))


def _rollup_common(
    events: list[Mapping[str, object]], table: Optional[Mapping[str, object]]
) -> dict:
    return {
        "tokens": _tokens(events),
        "runtime": _runtime(events),
        "cost": _estimate(events, table),
        "last_seen": _last_seen(events),
    }


def _agent_rollups(
    events: list[Mapping[str, object]],
    table: Optional[Mapping[str, object]],
    window_seconds: int,
) -> list[dict]:
    grouped: dict[str, list[Mapping[str, object]]] = {}
    for event in events:
        lane = event.get("lane")
        if isinstance(lane, str) and lane:
            grouped.setdefault(lane, []).append(event)
    output = []
    for lane in sorted(grouped):
        rows = grouped[lane]
        providers = sorted({
            row["provider"] for event in rows
            for row in [_price_row(event, table)] if row is not None
        })
        contexts = [
            value for event in rows
            for value in [_context_remaining(event, table)] if value is not None
        ]
        unpriced = sum(_raw_total_cost(event, table) is None for event in rows)
        common = _rollup_common(rows, table)
        output.append({
            "lane": lane,
            "models": sorted({str(event["model"]) for event in rows}),
            "providers": providers,
            "tokens": common["tokens"],
            "runtime": common["runtime"],
            "cost": common["cost"],
            "output_tokens_per_minute": _rate(
                rows, common["tokens"]["output"], window_seconds
            ),
            "prompt_context_remaining_p50_pct_est": _nearest_rank(
                contexts, Decimal("0.50")
            ),
            "unknown_rate_pct": _decimal_number(
                Decimal(100) * Decimal(unpriced) / Decimal(len(rows))
            ),
            "last_seen": common["last_seen"],
        })
    return output


def _model_rollups(
    events: list[Mapping[str, object]], table: Optional[Mapping[str, object]]
) -> list[dict]:
    grouped: dict[str, list[Mapping[str, object]]] = {}
    for event in events:
        grouped.setdefault(str(event["model"]), []).append(event)
    output = []
    for model in sorted(grouped):
        rows = grouped[model]
        resolved = [_price_row(event, table) for event in rows]
        providers = {row["provider"] for row in resolved if row is not None}
        provider = next(iter(providers)) if len(providers) == 1 and all(resolved) else None
        common = _rollup_common(rows, table)
        output.append({
            "model": model,
            "provider": provider,
            "tokens": common["tokens"],
            "runtime": common["runtime"],
            "cost": common["cost"],
            "agents": len({event["lane"] for event in rows if event.get("lane")}),
            "last_seen": common["last_seen"],
        })
    return output


def _provider_rollups(
    events: list[Mapping[str, object]], table: Optional[Mapping[str, object]]
) -> list[dict]:
    grouped: dict[str, list[Mapping[str, object]]] = {}
    for event in events:
        row = _price_row(event, table)
        if row is not None:
            grouped.setdefault(str(row["provider"]), []).append(event)
    output = []
    for provider in sorted(grouped):
        rows = grouped[provider]
        common = _rollup_common(rows, table)
        output.append({
            "provider": provider,
            "models": sorted({str(event["model"]) for event in rows}),
            "tokens": common["tokens"],
            "runtime": common["runtime"],
            "cost": common["cost"],
            "agents": len({event["lane"] for event in rows if event.get("lane")}),
            "last_seen": common["last_seen"],
        })
    return output


def _series(
    events: list[Mapping[str, object]],
    table: Optional[Mapping[str, object]],
    bucket_seconds: int,
) -> list[dict]:
    grouped: dict[int, list[Mapping[str, object]]] = {}
    for event in events:
        timestamp = _parse_timestamp(event["ts"])
        if timestamp is None:
            continue
        epoch = math.floor(timestamp.timestamp())
        bucket = epoch - (epoch % bucket_seconds)
        grouped.setdefault(bucket, []).append(event)
    output = []
    for bucket in sorted(grouped):
        rows = grouped[bucket]
        tokens = _tokens(rows)
        output.append({
            "bucket_start": _format_timestamp(datetime.fromtimestamp(bucket, timezone.utc)),
            "bucket_end": _format_timestamp(
                datetime.fromtimestamp(bucket + bucket_seconds, timezone.utc)
            ),
            "tokens": tokens,
            "tokens_per_minute": _rate(rows, tokens["total"], bucket_seconds),
            "usage_turns": len(rows),
            "usage_turns_per_minute": _rate(rows, len(rows), bucket_seconds),
            "cost": _cost_kinds(rows, table),
        })
    return output


def _root_config(root: object) -> tuple[list[str], Optional[dict[str, str]]]:
    roster = None
    roots = root
    if isinstance(root, Mapping):
        roots = root.get("roots", root.get("root", []))
        raw_roster = root.get("roster")
        if isinstance(raw_roster, Mapping):
            roster = {
                str(lane): os.fspath(path)
                for lane, path in raw_roster.items()
                if isinstance(lane, str) and isinstance(path, (str, os.PathLike))
            }
    if isinstance(roots, (str, bytes, os.PathLike)):
        values = [os.fspath(roots)]
    else:
        try:
            values = [os.fspath(value) for value in roots]  # type: ignore[union-attr]
        except (TypeError, ValueError):
            values = []
    return values, roster


def _root_readable(value: str) -> bool:
    path = Path(value)
    if path.is_symlink() or not path.is_dir():
        return False
    try:
        iterator = os.scandir(path)
        iterator.close()
    except OSError:
        return False
    return True


def _window_config(options: Mapping[str, object], anchor: Optional[datetime]):
    start_value = options.get("start")
    end_value = options.get("end")
    window = options.get("window")
    if start_value is not None or end_value is not None:
        if start_value is None or end_value is None or window not in (None, "custom"):
            raise CostViewQueryError("custom window requires exactly start and end")
        start = _parse_timestamp(start_value, require_utc=True)
        end = _parse_timestamp(end_value, require_utc=True)
        if start is None or end is None or start >= end:
            raise CostViewQueryError("custom window needs increasing UTC timestamps")
        return start, end, True
    window = window or "24h"
    durations = {"6h": 6 * 3600, "24h": 24 * 3600, "7d": 7 * 86400}
    if window not in durations:
        raise CostViewQueryError("window must be 6h, 24h, or 7d")
    if anchor is None:
        return None, None, False
    return anchor - timedelta(seconds=durations[window]), anchor, False


def _valid_budget(value: object) -> Optional[dict[str, object]]:
    if not isinstance(value, Mapping):
        return None
    raw_limit = value.get("limit_usd")
    start = _parse_timestamp(value.get("period_start"), require_utc=True)
    end = _parse_timestamp(value.get("period_end"), require_utc=True)
    try:
        limit = Decimal(str(raw_limit))
    except Exception:
        return None
    if not limit.is_finite() or limit < 0 or start is None or end is None or start >= end:
        return None
    return {"limit": limit, "start": start, "end": end}


def _budget_forecast(
    selected: list[Mapping[str, object]],
    all_events: list[Mapping[str, object]],
    table: Optional[Mapping[str, object]],
    options: Mapping[str, object],
    coverage_complete: bool,
    as_of: Optional[datetime],
) -> dict:
    budget = _valid_budget(options.get("budget"))
    if budget is None:
        return {
            "budget": {
                "limit_usd": None, "period_start": None,
                "period_end": None, "source": None,
            },
            "spent": _estimate(selected, table),
            "remaining": {"usd": None, "est": True, "basis": "unavailable"},
            "forecast": {
                "usd": None, "est": True, "label": "FORECAST (EST)",
                "method": "linear_budget_period_v1", "as_of": None,
                "coverage_complete": False,
            },
            "over_budget_alert": None,
        }

    start = budget["start"]
    end = budget["end"]
    limit = budget["limit"]
    period_events = [
        event for event in all_events
        if start <= _parse_timestamp(event["ts"]) <= (as_of or end)
        and _parse_timestamp(event["ts"]) < end
    ]
    spent = _estimate(period_events, table)
    remaining = None
    if spent["usd"] is not None:
        remaining = limit - Decimal(spent["usd"])
    forecast = None
    forecast_complete = False
    if as_of is not None and start < as_of < end and coverage_complete:
        raw_parts = [_raw_total_cost(event, table) for event in period_events]
        if raw_parts and all(value is not None for value in raw_parts):
            elapsed = Decimal(str((as_of - start).total_seconds()))
            period = Decimal(str((end - start).total_seconds()))
            if elapsed > 0:
                forecast = sum(raw_parts, Decimal(0)) * period / elapsed  # type: ignore[arg-type]
                forecast_complete = True
    alert = None
    if forecast is not None and forecast > limit:
        alert = {
            "active": True,
            "over_by_usd_est": _usd(forecast - limit),
            "est": True,
        }
    return {
        "budget": {
            "limit_usd": _usd(limit),
            "period_start": _format_timestamp(start),
            "period_end": _format_timestamp(end),
            "source": "config",
        },
        "spent": spent,
        "remaining": {
            "usd": _usd(remaining) if remaining is not None else None,
            "est": True,
            "basis": (
                "configured_budget_minus_published_token_rates"
                if remaining is not None else "unavailable"
            ),
        },
        "forecast": {
            "usd": _usd(forecast) if forecast is not None else None,
            "est": True,
            "label": "FORECAST (EST)",
            "method": "linear_budget_period_v1",
            "as_of": _format_timestamp(as_of) if forecast is not None else None,
            "coverage_complete": forecast_complete,
        },
        "over_budget_alert": alert,
    }


def snapshot(root: object, prices: object, buckets: object, now: object) -> dict:
    """Return one deterministic ``costview.v1`` response.

    ``root`` is a path/list or ``{"roots": ..., "roster": ...}``. ``buckets``
    is an integer bucket size or an options mapping containing
    ``bucket_seconds`` and optional window/model/provider/budget selectors.
    Only source freshness consumes ``now``.
    """
    roots, roster = _root_config(root)
    options = dict(buckets) if isinstance(buckets, Mapping) else {
        "bucket_seconds": buckets
    }
    bucket_seconds = _positive_int(
        options.get("bucket_seconds"), DEFAULT_BUCKET_SECONDS
    )
    stale_after = _positive_int(
        options.get("stale_after_seconds"), DEFAULT_STALE_AFTER_SECONDS
    )
    refresh_hint = _positive_int(
        options.get("refresh_hint_ms"), DEFAULT_REFRESH_HINT_MS
    )
    checked_at = (
        now.astimezone(timezone.utc)
        if isinstance(now, datetime) and now.tzinfo is not None
        else _parse_timestamp(now, require_utc=True)
    )
    if checked_at is None:
        raise ValueError("now must be an aware datetime or UTC RFC 3339 timestamp")

    readable_roots = [value for value in roots if _root_readable(value)]
    events, tally = costview_ingest.scan(readable_roots, roster)
    table = _load_prices(prices)
    event_rows = [event for event in events if isinstance(event, Mapping)]
    anchor = max(
        (_parse_timestamp(event["ts"]) for event in event_rows),
        default=None,
    )
    start, end, custom_window = _window_config(options, anchor)
    selected = []
    for event in event_rows:
        timestamp = _parse_timestamp(event["ts"])
        if timestamp is None or start is None or end is None:
            continue
        if custom_window:
            if not (start <= timestamp < end):
                continue
        elif not (start <= timestamp <= end):
            continue
        if options.get("model") is not None and event.get("model") != options["model"]:
            continue
        row = _price_row(event, table)
        event_provider = row["provider"] if row is not None else None
        if options.get("provider") is not None and event_provider != options["provider"]:
            continue
        selected.append(event)

    files_seen = int(tally["files_seen"])
    files_failed = int(tally["files_failed"])
    events_rejected = int(tally["skipped"])
    unmapped = sum(_price_row(event, table) is None for event in event_rows)
    unpriced = sum(_raw_total_cost(event, table) is None for event in event_rows)
    coverage = {
        "roots_configured": len(roots),
        "roots_readable": len(readable_roots),
        "roots_failed": len(roots) - len(readable_roots),
        "files_seen": files_seen,
        "files_readable": max(0, files_seen - files_failed),
        "files_failed": files_failed,
        "lines_seen": int(tally["lines_seen"]),
        "usage_records_seen": int(tally["usage_records_seen"]),
        "events_accepted": int(tally["events_accepted"]),
        "events_rejected": events_rejected,
        "events_deduplicated": 0,
        "events_unattributed": int(tally["events_unattributed"]),
        "events_unmapped_provider": unmapped,
        "events_unpriced": unpriced,
        "rejection_counts": {
            key: tally["skip_reasons"][key]
            for key in sorted(tally["skip_reasons"])
        },
    }

    last_seen = _format_timestamp(anchor) if anchor is not None else None
    if not readable_roots:
        fresh_state, age = "unavailable", None
    elif anchor is None:
        fresh_state, age = "unknown", None
    elif checked_at < anchor:
        fresh_state, age = "unknown", None
    else:
        age_decimal = Decimal(str((checked_at - anchor).total_seconds()))
        age = _decimal_number(age_decimal)
        fresh_state = "fresh" if age_decimal <= stale_after else "stale"
    source_fresh = {
        "state": fresh_state,
        "last_seen": last_seen,
        "freshness_checked_at": _format_timestamp(checked_at),
        "age_seconds": age,
        "stale_after_seconds": stale_after,
    }

    total_cost = _estimate(selected, table)
    partial = any((
        coverage["roots_failed"], coverage["files_failed"],
        coverage["events_rejected"], coverage["events_unattributed"],
        coverage["events_unmapped_provider"], coverage["events_unpriced"],
    )) or (bool(selected) and total_cost["usd"] is None)
    if not readable_roots or not event_rows:
        status = "unavailable"
    else:
        status = "partial" if partial else "ready"

    window_seconds = (
        max(1, math.ceil((end - start).total_seconds()))
        if start is not None and end is not None else 1
    )
    coverage_complete = not any((
        coverage["roots_failed"], coverage["files_failed"],
        coverage["events_rejected"],
    ))
    return {
        "schema": "costview.v1",
        "status": status,
        "as_of": last_seen,
        "currency": "USD",
        "window": {
            "start": _format_timestamp(start) if start is not None else None,
            "end": _format_timestamp(end) if end is not None else None,
            "bucket_seconds": bucket_seconds,
        },
        "refresh_hint_ms": refresh_hint,
        "agents_with_usage": len({
            event["lane"] for event in selected if event.get("lane")
        }),
        "total_tokens": _tokens(selected),
        "total_cost": total_cost,
        "series": _series(selected, table, bucket_seconds),
        "agents": _agent_rollups(selected, table, window_seconds),
        "models": _model_rollups(selected, table),
        "providers": _provider_rollups(selected, table),
        "budget_forecast": _budget_forecast(
            selected, event_rows, table, options, coverage_complete, anchor
        ),
        "source_coverage": coverage,
        "source_fresh": source_fresh,
    }


def _query_options(query: str) -> dict[str, object]:
    for index, character in enumerate(query):
        if character == "%" and (
            index + 2 >= len(query)
            or any(value not in "0123456789abcdefABCDEF" for value in query[index + 1:index + 3])
        ):
            raise CostViewQueryError("malformed query encoding")
    try:
        pairs = parse_qsl(
            query, keep_blank_values=True, strict_parsing=True,
            encoding="utf-8", errors="strict",
        )
    except (UnicodeError, ValueError) as exc:
        raise CostViewQueryError("malformed query") from exc
    allowed = {"model", "provider", "window", "start", "end"}
    result: dict[str, object] = {}
    for key, value in pairs:
        if key not in allowed:
            raise CostViewQueryError("unknown query parameter")
        if not value:
            raise CostViewQueryError("blank query parameter")
        if key in result:
            raise CostViewQueryError("duplicate query parameter")
        result[key] = value
    has_custom = "start" in result or "end" in result
    if has_custom:
        if set(result).intersection({"start", "end"}) != {"start", "end"}:
            raise CostViewQueryError("custom window requires start and end")
        if "window" in result:
            raise CostViewQueryError("window cannot be mixed with start/end")
        result["window"] = "custom"
    elif result.get("window", "24h") not in {"6h", "24h", "7d"}:
        raise CostViewQueryError("invalid window")
    return result


def _environment_roots() -> list[str]:
    configured = os.environ.get("OFFICE_COSTVIEW_TRANSCRIPT_ROOTS")
    if configured is None:
        return [os.fspath(Path.home() / ".claude" / "projects")]
    return [value for value in configured.split(os.pathsep) if value]


def _environment_budget() -> object:
    values = {
        "limit_usd": os.environ.get("OFFICE_COSTVIEW_BUDGET_USD"),
        "period_start": os.environ.get("OFFICE_COSTVIEW_BUDGET_START"),
        "period_end": os.environ.get("OFFICE_COSTVIEW_BUDGET_END"),
    }
    return values if any(value is not None for value in values.values()) else None


def serve_http(handler: object, query: str) -> None:
    """Validate a GET query and emit the no-store response through Handler."""
    try:
        options = _query_options(query)
    except CostViewQueryError as exc:
        return handler._json(400, {"error": "invalid costview query", "detail": str(exc)})
    options.update({
        "bucket_seconds": _positive_int(
            os.environ.get("OFFICE_COSTVIEW_BUCKET_SECONDS"), DEFAULT_BUCKET_SECONDS
        ),
        "stale_after_seconds": _positive_int(
            os.environ.get("OFFICE_COSTVIEW_STALE_AFTER_SECONDS"),
            DEFAULT_STALE_AFTER_SECONDS,
        ),
        "budget": _environment_budget(),
    })
    world = handler.world
    roster = {
        seat["lane"]: os.fspath(world.ctx.allrepos / seat["lane"])
        for seat in world.seats
        if isinstance(seat.get("lane"), str) and seat["lane"]
    }
    price_path = os.environ.get("OFFICE_COSTVIEW_RATES")
    payload = snapshot(
        {"roots": _environment_roots(), "roster": roster},
        price_path if price_path is not None else None,
        options,
        datetime.now(timezone.utc),
    )
    return handler._json(200, payload)


def _selftest() -> None:
    """Fixture assertions for the CV-3 packet (no network or persistent write)."""
    import tempfile

    def record(ts: str, session: str, cwd: str, model: str, tin: int, tout: int) -> dict:
        return {
            "type": "assistant", "timestamp": ts, "sessionId": session,
            "cwd": cwd,
            "message": {
                "role": "assistant", "model": model,
                "usage": {
                    "input_tokens": tin, "output_tokens": tout,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                },
            },
        }

    with tempfile.TemporaryDirectory(prefix="cv3_fixture_") as tmp:
        root = Path(tmp) / "projects"
        lane_a = Path(tmp) / "agent-workspace-a"
        lane_b = Path(tmp) / "agent-workspace-b"
        roster = {"lane-a": str(lane_a), "lane-b": str(lane_b)}
        for lane, session, model, timestamp, tokens in (
            (lane_a, "session-a", "gpt-5.6-sol", "2026-08-13T17:00:00Z", (1000, 200)),
            (lane_b, "session-b", "unknown-model", "2026-08-13T17:10:00Z", (50, 10)),
        ):
            project = root / str(lane).replace("/", "-")
            project.mkdir(parents=True)
            payload = record(timestamp, session, str(lane), model, *tokens)
            (project / f"{session}.jsonl").write_text(json.dumps(payload) + "\n")

        fixed_now = datetime(2026, 8, 13, 17, 11, tzinfo=timezone.utc)
        base = snapshot(
            {"roots": [root], "roster": roster}, None,
            {"bucket_seconds": 300, "window": "24h"}, fixed_now,
        )
        assert set(base) == {
            "schema", "status", "as_of", "currency", "window",
            "refresh_hint_ms", "agents_with_usage", "total_tokens",
            "total_cost", "series", "agents", "models", "providers",
            "budget_forecast", "source_coverage", "source_fresh",
        }
        assert base["schema"] == "costview.v1"
        assert base["status"] == "partial"
        assert base["agents_with_usage"] == 2
        assert base["total_tokens"]["total"] == 1260
        assert [row["provider"] for row in base["providers"]] == ["openai"]
        assert base["source_coverage"]["events_unmapped_provider"] == 1
        assert base["source_fresh"]["age_seconds"] == 60
        assert "session-a" not in json.dumps(base)
        assert str(root) not in json.dumps(base)

        model_only = snapshot(
            {"roots": [root], "roster": roster}, None,
            {"bucket_seconds": 300, "model": "gpt-5.6-sol"}, fixed_now,
        )
        assert [row["model"] for row in model_only["models"]] == ["gpt-5.6-sol"]
        assert model_only["total_cost"]["usd"] == "0.011000"

        provider_only = snapshot(
            {"roots": [root], "roster": roster}, None,
            {"bucket_seconds": 300, "provider": "openai"}, fixed_now,
        )
        assert provider_only["total_tokens"]["total"] == 1200
        assert snapshot(
            {"roots": [root], "roster": roster}, None,
            {"bucket_seconds": 300, "provider": "openai"}, fixed_now,
        ) == provider_only

        custom = snapshot(
            {"roots": [root], "roster": roster}, None,
            {
                "bucket_seconds": 300,
                "start": "2026-08-13T17:05:00Z",
                "end": "2026-08-13T17:15:00Z",
            }, fixed_now,
        )
        assert [row["model"] for row in custom["models"]] == ["unknown-model"]

        assert _query_options("model=gpt-5.6-sol&window=6h")["window"] == "6h"
        for query in (
            "window=", "window=6h&window=7d", "bogus=x", "start=x",
            "model=%ZZ", "model=%FF",
        ):
            try:
                _query_options(query)
            except CostViewQueryError:
                pass
            else:
                raise AssertionError(f"query should be rejected: {query}")

    print("CV-3 FIXTURE PASS full-contract=yes filters=narrow deterministic=yes")


if __name__ == "__main__":
    _selftest()
