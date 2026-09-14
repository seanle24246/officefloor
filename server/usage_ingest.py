"""Usage-record ingest — parse and validate a single measured usage record.

Extracts and validates ``lane``, ``model``, ``tokens_in``, ``tokens_out``,
and ``ts`` from a raw dict. Returns a validated measured record with
``measured=True`` hard-set, or ``None`` for any malformed input. Never
raises, never coerces.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path


MAX_TRANSCRIPT_FILES = 10_000
MAX_LINE_BYTES = 2 * 1024 * 1024
MAX_USAGE_RECORDS = 100_000


def _is_int(v: object) -> bool:
    """True when *v* is an ``int`` (not a ``bool``, which is a subclass)."""
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v: object) -> bool:
    """True when *v* is a finite non-negative ``int`` or ``float``."""
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return v >= 0 and v == v  # NaN check: NaN != itself
    return False


def parse_usage_record(raw: object) -> object:
    """Parse and validate a single measured usage record from *raw*.

    Returns a dict with keys ``lane``, ``model``, ``tokens_in``,
    ``tokens_out``, ``ts``, and ``measured`` (hard-set to ``True``) when
    every field is valid. Returns ``None`` (never raises) for anything
    malformed — missing fields, wrong types, bad values, coercible strings,
    booleans as token counts, etc.
    """
    if not isinstance(raw, dict):
        return None

    # --- lane: literal admitted filesystem name
    lane_raw = raw.get("lane")
    from server.lane_names import valid_lane_name
    if not valid_lane_name(lane_raw):
        return None
    lane = lane_raw

    # --- model: non-empty string, stripped
    model_raw = raw.get("model")
    if not isinstance(model_raw, str) or not model_raw.strip():
        return None
    model = model_raw.strip()

    # --- tokens_in: int >= 0 (bool is NOT int)
    tokens_in = raw.get("tokens_in")
    if not _is_int(tokens_in) or tokens_in < 0:
        return None

    # --- tokens_out: int >= 0 (bool is NOT int)
    tokens_out = raw.get("tokens_out")
    if not _is_int(tokens_out) or tokens_out < 0:
        return None

    # --- ts: finite non-negative number via _is_num (float ok)
    ts = raw.get("ts")
    if not _is_num(ts):
        return None

    # All valid — hard-set measured=True, ignore any caller-supplied measured
    return {
        "lane": lane,
        "model": model,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "ts": ts,
        "measured": True,
    }


def usage_fold(records: object) -> dict:
    """Fold *records* through parse_usage_record into lane/model buckets.

    Returns ``{"lanes": ..., "totals": ..., "skipped": ..., "measured": True}``
    where ``lanes`` is ``{lane: {model: {"tokens_in": int, "tokens_out": int,
    "records": int}}}``, ``totals`` is ``{"tokens_in": int, "tokens_out": int,
    "records": int}``, and ``skipped`` is the count of records that parsed to
    ``None``.  Non-list input produces the empty fold (``lanes`` empty,
    ``totals`` zero, ``skipped`` 0).  Invariant: every valid record contributes
    exactly to one bucket and to totals — no drift, no ghost rows.
    """
    if not isinstance(records, list):
        return {"lanes": {}, "totals": {"tokens_in": 0, "tokens_out": 0, "records": 0}, "skipped": 0, "measured": True}

    lanes: dict = {}
    tot_tokens_in = 0
    tot_tokens_out = 0
    tot_records = 0
    skipped = 0

    for raw in records:
        parsed = parse_usage_record(raw)
        if parsed is None:
            skipped += 1
            continue

        lane = parsed["lane"]
        model = parsed["model"]
        ti = parsed["tokens_in"]
        to = parsed["tokens_out"]

        # Accumulate per-lane bucket
        lane_bucket = lanes.get(lane)
        if lane_bucket is None:
            lane_bucket = {}
            lanes[lane] = lane_bucket

        model_bucket = lane_bucket.get(model)
        if model_bucket is None:
            model_bucket = {"tokens_in": 0, "tokens_out": 0, "records": 0}
            lane_bucket[model] = model_bucket

        model_bucket["tokens_in"] += ti
        model_bucket["tokens_out"] += to
        model_bucket["records"] += 1

        # Accumulate running totals
        tot_tokens_in += ti
        tot_tokens_out += to
        tot_records += 1

    return {
        "lanes": lanes,
        "totals": {"tokens_in": tot_tokens_in, "tokens_out": tot_tokens_out, "records": tot_records},
        "skipped": skipped,
        "measured": True,
    }


def costview_rows(fold: object, prices: object) -> dict:
    """Build cost-view rows from a usage-fold dict and a price table.

    *prices* is ``{model: {"in_per_mtok": num, "out_per_mtok": num}}``.

    For each (lane, model) bucket in ``fold["lanes"]``, sorted by lane then
    model, emits a row dict with keys ``lane``, ``model``, ``tokens_in``,
    ``tokens_out``, ``cost``, ``estimated``.

    A model is **PRICED** only when its price entry is a dict with **both**
    ``in_per_mtok`` and ``out_per_mtok`` passing ``_is_num`` — then
    ``cost = round(tokens_in/1e6 * in_per_mtok + tokens_out/1e6 * out_per_mtok, 6)``,
    ``estimated = False``.

    Otherwise (missing model in *prices* OR malformed price entry):
    **THE NEVER-$0 LAW** — ``cost = None``, ``estimated = True``.
    Never ``0.0`` for an unpriced model, never ``estimated = False``
    without a real price.

    Returns ``{"rows": [...], "total_cost": round(sum of PRICED rows' costs, 6),
    "unpriced_rows": <count>}``.

    Empty/invalid *fold* → ``{"rows": [], "total_cost": 0.0, "unpriced_rows": 0}``.
    Pure — never mutates inputs, never raises.
    """
    # --- Guard: fold must be dict with a "lanes" key that is a dict
    if not isinstance(fold, dict):
        return {"rows": [], "total_cost": 0.0, "unpriced_rows": 0}
    lanes = fold.get("lanes")
    if not isinstance(lanes, dict):
        return {"rows": [], "total_cost": 0.0, "unpriced_rows": 0}

    # --- Ensure prices is a dict (treat non-dict as empty)
    price_table: dict = prices if isinstance(prices, dict) else {}

    rows: list = []
    total_priced = 0.0
    unpriced_count = 0

    # --- Collect all (lane, model, bucket) tuples, then sort
    items: list = []
    for lane, model_buckets in lanes.items():
        if not isinstance(model_buckets, dict):
            continue
        for model_name, bucket in model_buckets.items():
            if not isinstance(bucket, dict):
                continue
            ti = bucket.get("tokens_in", 0)
            to = bucket.get("tokens_out", 0)
            if not isinstance(ti, (int, float)):
                ti = 0
            if not isinstance(to, (int, float)):
                to = 0
            items.append((lane, model_name, ti, to))

    items.sort(key=lambda x: (x[0], x[1]))

    for lane_name, model_name, ti, to in items:
        entry = price_table.get(model_name)
        priced = False
        if isinstance(entry, dict):
            in_rate = entry.get("in_per_mtok")
            out_rate = entry.get("out_per_mtok")
            if _is_num(in_rate) and _is_num(out_rate):
                cost = round(ti / 1_000_000.0 * in_rate + to / 1_000_000.0 * out_rate, 6)
                estimated = False
                priced = True
                total_priced += cost
            else:
                # Malformed price entry — treat as unpriced
                cost = None
                estimated = True
        else:
            # Model not in price table — unpriced
            cost = None
            estimated = True

        if not priced:
            unpriced_count += 1

        rows.append({
            "lane": lane_name,
            "model": model_name,
            "tokens_in": ti,
            "tokens_out": to,
            "cost": cost,
            "estimated": estimated,
        })

    return {
        "rows": rows,
        "total_cost": round(total_priced, 6),
        "unpriced_rows": unpriced_count,
    }


def _epoch(value: object) -> int | float | None:
    if _is_num(value):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        parsed = datetime.fromisoformat(
            text[:-1] + "+00:00" if text.endswith("Z") else text
        )
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc).timestamp()


def _lane_for(raw: dict, roster: object) -> str | None:
    """Attribute only an exact measured cwd; ambiguous or absent stays unknown."""
    cwd = raw.get("cwd")
    if not isinstance(cwd, str) or not cwd or not isinstance(roster, dict):
        return None
    try:
        observed = os.path.realpath(os.path.expanduser(cwd))
    except (OSError, TypeError, ValueError):
        return None
    matches = []
    for lane, path in roster.items():
        if not isinstance(lane, str) or not lane or not isinstance(path, (str, os.PathLike)):
            continue
        try:
            expected = os.path.realpath(os.path.expanduser(os.fspath(path)))
        except (OSError, TypeError, ValueError):
            continue
        if observed == expected:
            matches.append(lane)
    return matches[0] if len(matches) == 1 else None


def usage_records(roots: object, roster: object) -> dict:
    """Read measured Claude usage records locally, bounded and read-only."""
    records: list[dict] = []
    skipped = 0
    files_seen = 0
    source_available = False
    values = roots if isinstance(roots, list) else [roots]
    paths: list[Path] = []
    for value in values:
        if len(paths) >= MAX_TRANSCRIPT_FILES:
            break
        if not isinstance(value, (str, os.PathLike)):
            continue
        try:
            root = Path(value).expanduser()
            if root.is_dir():
                source_available = True
                for path in root.rglob("*.jsonl"):
                    paths.append(path)
                    if len(paths) >= MAX_TRANSCRIPT_FILES:
                        break
        except OSError:
            continue

    for path in sorted(paths, key=lambda item: os.fspath(item)):
        if len(records) >= MAX_USAGE_RECORDS:
            break
        if path.is_symlink() or not path.is_file():
            skipped += 1
            continue
        files_seen += 1
        try:
            from server.safe_read import safe_read
            import io
            observed = safe_read(path)
            if observed is None:
                skipped += 1
                continue
            with io.StringIO(observed.text) as stream:
                for line in stream:
                    if len(records) >= MAX_USAGE_RECORDS:
                        break
                    if len(line.encode("utf-8")) > MAX_LINE_BYTES:
                        skipped += 1
                        continue
                    try:
                        raw = json.loads(line)
                    except (ValueError, UnicodeError, RecursionError, MemoryError):
                        skipped += 1
                        continue
                    if not isinstance(raw, dict) or raw.get("type") != "assistant":
                        continue
                    message = raw.get("message")
                    if not isinstance(message, dict) or message.get("role") != "assistant":
                        continue
                    usage = message.get("usage")
                    if not isinstance(usage, dict):
                        continue
                    candidate = {
                        "lane": _lane_for(raw, roster),
                        "model": message.get("model"),
                        "tokens_in": usage.get("input_tokens"),
                        "tokens_out": usage.get("output_tokens"),
                        "ts": _epoch(raw.get("timestamp")),
                    }
                    parsed = parse_usage_record(candidate)
                    if parsed is None:
                        skipped += 1
                    else:
                        records.append(parsed)
        except (OSError, UnicodeError):
            skipped += 1

    records.sort(key=lambda row: (row["ts"], row["lane"], row["model"]))
    return {
        "records": records,
        "skipped": skipped,
        "files_seen": files_seen,
        "source_available": source_available,
    }


def load_prices(path: object) -> dict:
    """Load only a maintained local rate table; malformed or absent means unpriced."""
    if not isinstance(path, (str, os.PathLike)):
        return {}
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    if isinstance(payload.get("rows"), list):
        prices = {}
        for row in payload["rows"]:
            if not isinstance(row, dict) or not isinstance(row.get("model"), str):
                continue
            rates = row.get("usd_per_million")
            if not isinstance(rates, dict):
                continue
            try:
                incoming = float(rates["input"])
                outgoing = float(rates["output"])
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
            if not _is_num(incoming) or not _is_num(outgoing):
                continue
            prices[row["model"]] = {
                "in_per_mtok": incoming,
                "out_per_mtok": outgoing,
            }
        return prices
    return payload


def cost_payload(roots: object, roster: object, price_path: object = None) -> dict:
    """Compose the read-only `/api/cost` payload from measured local usage."""
    observed = usage_records(roots, roster)
    folded = usage_fold(observed["records"])
    costs = costview_rows(folded, load_prices(price_path))
    return {
        "ok": True,
        "source_available": observed["source_available"],
        "measured": bool(observed["records"]),
        "rows": costs["rows"],
        "totals": folded["totals"],
        "total_cost": costs["total_cost"],
        "unpriced_rows": costs["unpriced_rows"],
        "skipped": observed["skipped"] + folded["skipped"],
        "files_seen": observed["files_seen"],
    }


# ==== leaf surface
