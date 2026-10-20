"""ECON-VIEW-01: the read-only economy feed behind ``GET /api/economy``.

Pure shaping over sources that already exist: the world snapshot (agent
``wallet_usd``, office ``office_wallet_usd``), the market wallet snapshot
(office/credits balances, ``office_hold``) and the economy ledger journals.
Nothing here writes. A source that is missing leaves its field ABSENT; the
feed never invents a number.

Plug-in seams for seats that have not landed yet (AGENT-SPEND-01, PET-DOG-01):
agent spending arrives as negative ``scrip`` journal entries keyed by lane;
any ledger writer may set ``metadata["what"]`` to name a row; upkeep arrives
through ``UPKEEP_PROVIDERS``. None of them needs a UI change.
"""

from __future__ import annotations

from typing import Any, Callable, Iterable

LEDGER_LIMIT = 50
WHAT_MAX = 120
# Ledger book -> the book name the UI shows.
BOOK_LABELS = {"office": "office", "scrip": "agent", "credits": "credits"}
# Append-only: zero-arg callables returning upkeep row dicts (see upkeep_rows).
UPKEEP_PROVIDERS: list[Callable[[], Iterable[dict]]] = []
# Append-only: vendor ids registered on this floor. "WHERE MONEY GOES" shows the
# Taco truck only once a vendor seat appends "taco-truck" here.
VENDOR_IDS: list[str] = []
_JOURNAL_PAGE = 1000
_JOURNAL_MAX_PAGES = 20


def _safe_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) \
        and -((1 << 53) - 1) <= value <= (1 << 53) - 1


def economy_view_enabled() -> bool:
    """Resolve the economy_view flag for the current release; missing metadata is off."""
    import importlib.metadata
    from server import feature_flags
    try:
        return feature_flags.is_feature_enabled(
            "economy_view", feature_flags.current_release())
    except (OSError, ValueError, KeyError, importlib.metadata.PackageNotFoundError):
        return False


def _flag_on(name: str) -> bool:
    """One resolved flag; a flag this release does not define is off."""
    import importlib.metadata
    from server import feature_flags
    try:
        return feature_flags.is_feature_enabled(name, feature_flags.current_release())
    except (OSError, ValueError, KeyError, importlib.metadata.PackageNotFoundError):
        return False


# "WHERE MONEY GOES" entry id -> zero-arg liveness check. The copy is
# explanation, not data, but an entry is shown only while its feature is live.
WHERE_CHECKS: dict[str, Callable[[], bool]] = {
    "vending": lambda: _flag_on("agent_spending"),
    "taco_truck": lambda: "taco-truck" in VENDOR_IDS,
    "marketplace": lambda: _flag_on("store_live"),
    "office_dog": lambda: _flag_on("office_pet_dog"),
}


def live_where(checks: dict[str, Callable[[], bool]] | None = None) -> list[str]:
    """Ids of the WHERE_CHECKS entries whose feature is live, in check order.

    A check that raises counts as not live.
    """
    live: list[str] = []
    for key, check in (WHERE_CHECKS if checks is None else checks).items():
        try:
            if check() is True:
                live.append(key)
        except Exception:
            continue
    return live


def read_entries(wallet: Any) -> list[dict] | None:
    """Every journal entry of the three books through the wallet's read view.

    ``wallet`` is a ``MarketWallet`` (``store`` + ``read_factory``); the read
    view never persists. Returns None when the ledger cannot be read.
    """
    store = getattr(wallet, "store", None)
    factory = getattr(wallet, "read_factory", None)
    if store is None or factory is None:
        return None
    try:
        entries: list[dict] = []
        with store.transaction():
            with factory() as ledger:
                for book in (ledger.office, ledger.credits, ledger.scrip):
                    cursor = 0
                    for _ in range(_JOURNAL_MAX_PAGES):
                        page = book.journal(after_entry_id=cursor, limit=_JOURNAL_PAGE)
                        entries.extend(page)
                        if len(page) < _JOURNAL_PAGE:
                            break
                        cursor = page[-1]["entry_id"]
        return entries
    except Exception:  # an unreadable ledger is an absent source, not a 500
        return None


def describe_entry(entry: dict) -> str:
    """One human line for a ledger entry, at most WHAT_MAX characters.

    Precedence:
    1. ``metadata["what"]`` when it is a non-empty str (the plug-in seam).
    2. reason ``office_earned`` -> ``f"Earnings sync · {amount:,} shipped lines"``.
    3. reason ``customization_purchase`` -> ``f"Marketplace · {metadata['sku_id']}"``
       when sku_id is a non-empty str, else ``"Marketplace purchase"``.
    4. otherwise the reason with ``_`` -> space and the first letter upper-cased
       (``"dog_food"`` -> ``"Dog food"``); a missing/non-str reason -> ``"Ledger entry"``.
    Longer results are cut to WHAT_MAX characters, the last one replaced by ``…``.
    """
    metadata = entry.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    what = metadata.get("what")
    reason = entry.get("reason")
    if isinstance(what, str) and what:
        text = what
    elif reason == "office_earned":
        text = f"Earnings sync · {entry.get('amount', 0):,} shipped lines"
    elif reason == "customization_purchase":
        sku = metadata.get("sku_id")
        text = f"Marketplace · {sku}" if isinstance(sku, str) and sku else "Marketplace purchase"
    elif isinstance(reason, str) and reason:
        text = reason.replace("_", " ").capitalize()
    else:
        text = "Ledger entry"
    if len(text) > WHAT_MAX:
        text = text[:WHAT_MAX - 1] + "…"
    return text


def ledger_rows(entries: Iterable[dict], limit: int = LEDGER_LIMIT) -> list[dict]:
    """Newest-first display rows, at most ``limit``.

    Row: ``{"time": created_at, "book": BOOK_LABELS[book], "what": describe_entry(e),
    "amount": amount, "entry_id": entry_id}``. Entries whose book is not in
    BOOK_LABELS, or whose amount is not a safe int (bools are not ints), are
    skipped. Order: created_at descending, then entry_id descending.
    """
    kept = [e for e in entries
            if e.get("book") in BOOK_LABELS and _safe_int(e.get("amount"))]
    kept.sort(key=lambda e: (e.get("created_at"), e.get("entry_id")), reverse=True)
    return [{"time": e.get("created_at"), "book": BOOK_LABELS[e["book"]],
             "what": describe_entry(e), "amount": e["amount"], "entry_id": e["entry_id"]}
            for e in kept[:limit]]


def upkeep_rows(providers: Iterable[Callable[[], Iterable[dict]]] | None = None) -> list[dict]:
    """Collect daily-upkeep rows from ``providers`` (default UPKEEP_PROVIDERS).

    A valid row has ``name`` (non-empty str), ``cost_per_day`` (safe int >= 0)
    and ``status`` (non-empty str). Output rows keep exactly those keys plus
    ``detail`` and ``badge`` when they are str, and ``book`` (``"office"`` or
    ``"credits"``, default ``"office"``; any other value -> ``"office"``).
    Invalid rows are dropped; a provider that raises contributes nothing.
    Provider order is preserved.
    """
    if providers is None:
        providers = UPKEEP_PROVIDERS
    rows: list[dict] = []
    for provider in providers:
        try:
            raw = list(provider())
        except Exception:
            continue
        for item in raw:
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            cost = item.get("cost_per_day")
            status = item.get("status")
            if not (isinstance(name, str) and name
                    and _safe_int(cost) and cost >= 0
                    and isinstance(status, str) and status):
                continue
            row = {"name": name, "cost_per_day": cost, "status": status}
            if isinstance(item.get("detail"), str):
                row["detail"] = item["detail"]
            if isinstance(item.get("badge"), str):
                row["badge"] = item["badge"]
            row["book"] = "credits" if item.get("book") == "credits" else "office"
            rows.append(row)
    return rows


def agent_rows(agents: Iterable[dict], scrip_entries: Iterable[dict] | None) -> list[dict]:
    """One wallet row per world agent that has a non-empty str ``lane``.

    ``{"lane", "name", "spent", ["earned", "balance"], ["last_purchase"]}``:
    - name: agent["name"] when a non-empty str, else the lane.
    - spent: sum of ``-amount`` over scrip entries with account == lane and
      amount < 0 (0 when none). scrip_entries None (ledger unreadable) -> spent,
      balance and last_purchase are ABSENT: an unread ledger is not $0 spent.
    - earned: agent["wallet_usd"] only when it is a safe int >= 0; else ABSENT,
      and then balance is ABSENT too. balance = earned - spent.
    - last_purchase: ``{"what": describe_entry(e), "time": e["created_at"]}`` for the
      newest (created_at, entry_id) negative scrip entry of that lane; ABSENT when none.
    Sorted by name (case-insensitive), then lane. Never ranked by money.
    """
    rows: list[dict] = []
    for agent in agents:
        if not isinstance(agent, dict):
            continue
        lane = agent.get("lane")
        if not isinstance(lane, str) or not lane:
            continue
        negatives = [e for e in scrip_entries or []
                     if isinstance(e, dict) and e.get("account") == lane
                     and _safe_int(e.get("amount")) and e["amount"] < 0]
        name = agent.get("name")
        row: dict = {"lane": lane,
                     "name": name if isinstance(name, str) and name else lane}
        if scrip_entries is not None:
            row["spent"] = sum(-e["amount"] for e in negatives)
        earned = agent.get("wallet_usd")
        if _safe_int(earned) and earned >= 0:
            row["earned"] = earned
            if "spent" in row:
                row["balance"] = earned - row["spent"]
        if negatives:
            newest = max(negatives, key=lambda e: (e.get("created_at"), e.get("entry_id")))
            row["last_purchase"] = {"what": describe_entry(newest),
                                    "time": newest.get("created_at")}
        rows.append(row)
    rows.sort(key=lambda r: (r["name"].casefold(), r["lane"]))
    return rows


def build_feed(*, wallet_on: bool, world: dict | None, snapshot: dict | None,
               entries: list[dict] | None, upkeep: list[dict],
               where: Iterable[str] = ()) -> dict:
    """The /api/economy payload.

    wallet_on False -> exactly ``{"ok": True, "available": False, "reason": "agent_wallet_off"}``.
    Otherwise ``{"ok": True, "available": True, "office": {...}, "upkeep": upkeep,
    "where": list(where)}`` (where = live_where() ids) plus:
    - office.balance = snapshot["office"] (safe int); office.hold = snapshot["office_hold"] (str);
      office.earned = world["office_wallet_usd"] (safe int >= 0);
      office.spent = sum(-amount) over book "office" entries with amount < 0 (only when entries is not None).
      Each key ABSENT when its source is missing/invalid.
    - "credits": {"balance": snapshot["credits"]} only when that is a safe int.
    - "agents": agent_rows(world.get("agents") or [], scrip entries, or None when entries
      is None) only when world is a dict.
    - "ledger": ledger_rows(entries) only when entries is not None.
    """
    if not wallet_on:
        return {"ok": True, "available": False, "reason": "agent_wallet_off"}
    feed: dict = {"ok": True, "available": True}
    office: dict = {}
    if isinstance(snapshot, dict):
        balance = snapshot.get("office")
        if _safe_int(balance):
            office["balance"] = balance
        hold = snapshot.get("office_hold")
        if isinstance(hold, str):
            office["hold"] = hold
    if isinstance(world, dict):
        earned = world.get("office_wallet_usd")
        if _safe_int(earned) and earned >= 0:
            office["earned"] = earned
    if entries is not None:
        office["spent"] = sum(-e["amount"] for e in entries
                              if isinstance(e, dict) and e.get("book") == "office"
                              and _safe_int(e.get("amount")) and e["amount"] < 0)
    feed["office"] = office
    if isinstance(snapshot, dict) and _safe_int(snapshot.get("credits")):
        feed["credits"] = {"balance": snapshot["credits"]}
    if isinstance(world, dict):
        scrip = None if entries is None else [
            e for e in entries if isinstance(e, dict) and e.get("book") == "scrip"]
        feed["agents"] = agent_rows(world.get("agents") or [], scrip)
    if entries is not None:
        feed["ledger"] = ledger_rows(entries)
    feed["upkeep"] = upkeep
    feed["where"] = list(where)
    return feed
