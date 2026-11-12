"""Agent wardrobe: catalog, appearance contract v2 and v1 migration (PKT:of-wardrobe-01).

Spec: ceo/packets/WARDROBE-SEAM-SPECS.md §2-3. Pure and stdlib only. The JavaScript twin in
static/office.avatar.appearance.js must give the same answers for tests/fixtures/wardrobe_looks.json.
Ownership is not a validation rule; looks_store checks it on write with ``owned``.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "wardrobe-catalog.json"
SCHEMA = "office.wardrobe.catalog.v1"
TOP_KEYS = frozenset({"v", "model", "tier", "skin", "hair", "wear"})
HAIR_KEYS = frozenset({"style", "color"})
WEAR_KEYS = frozenset({"id", "color"})
TIER = "stylized"
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class WardrobeError(ValueError):
    """A look that is not drawable. ``code`` is one of the v1 codes plus ``conflict``."""

    def __init__(self, code: str, field: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.field = field
        self.message = message

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "field": self.field, "message": self.message}


def load_catalog(path: Path | None = None) -> dict[str, Any]:
    """Read and sanity-check the catalog; raise ValueError on a wrong schema or duplicate item id."""
    source = path or CATALOG_PATH
    catalog = json.loads(Path(source).read_text())
    if catalog.get("schema") != SCHEMA:
        raise ValueError(f"catalog schema must be {SCHEMA!r}")
    seen: set[str] = set()
    for item in catalog["items"]:
        if item["id"] in seen:
            raise ValueError(f"duplicate item id {item['id']!r}")
        seen.add(item["id"])
    return catalog


def catalog_digest(catalog: dict[str, Any]) -> str:
    """sha256 hex of the catalog as canonical JSON (sort_keys=True, separators=(',', ':'), ensure_ascii=False)."""
    blob = json.dumps(catalog, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def item_index(catalog: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Map item id -> item row."""
    return {item["id"]: item for item in catalog["items"]}


def _fail(code: str, field: str, message: str) -> WardrobeError:
    return WardrobeError(code, field, message)


def validate(look: Any, catalog: dict[str, Any]) -> dict[str, Any]:
    """Return a normalized copy of ``look`` (hex lowercased) or raise WardrobeError.

    Order of checks, first failure wins (the fixtures pin it):
    1. not a dict -> ('type', 'look')
    2. missing key from TOP_KEYS (sorted) -> ('required', key); unknown key (sorted) -> ('unknown-field', key)
    3. v != 2 -> ('value', 'v'); tier != 'stylized' -> ('value', 'tier')
    4. model not in catalog models -> ('undrawable', 'model')
    5. skin not '#rrggbb' -> ('format', 'skin'); not in skin_tones -> ('undrawable', 'skin')
    6. hair not a dict -> ('type', 'hair'); missing/unknown hair keys -> ('required'|'unknown-field', 'hair.<k>');
       hair.color format/list -> ('format'|'undrawable', 'hair.color'); unknown style -> ('undrawable', 'hair.style');
       model not in the style's models: bear needs 'bald' else ('undrawable', 'hair.style'); a human model may use
       any style whose models include it
    7. wear not a dict -> ('type', 'wear'); for each slot key in sorted order:
       slot not in catalog slots -> ('unknown-field', 'wear.<slot>'); entry not a dict -> ('type', 'wear.<slot>');
       missing/unknown entry keys -> ('required'|'unknown-field', 'wear.<slot>.<k>');
       unknown item id -> ('undrawable', 'wear.<slot>.id'); item slot != slot -> ('value', 'wear.<slot>.id');
       model not in item models -> ('undrawable', 'wear.<slot>.id');
       color format / not in swatches -> ('format'|'undrawable', 'wear.<slot>.color')
    8. a 'full' item whose covers include another present slot -> ('conflict', 'wear.<covered slot>'),
       covered slots checked in sorted order
    Bear: hair.style must be 'bald' (any other style -> ('undrawable', 'hair.style')).
    """
    if not isinstance(look, dict):
        raise _fail("type", "look", "look must be an object")
    for key in sorted(TOP_KEYS - look.keys()):
        raise _fail("required", key, f"missing required key {key!r}")
    for key in sorted(set(look) - TOP_KEYS):
        raise _fail("unknown-field", key, f"unknown key {key!r}")
    if type(look["v"]) is not int or look["v"] != 2:
        raise _fail("value", "v", "v must be 2")
    if look["tier"] != TIER:
        raise _fail("value", "tier", "tier must be stylized")
    if not isinstance(look["model"], str) or look["model"] not in catalog["models"]:
        raise _fail("undrawable", "model", f"model {look['model']!r} is not drawable")
    skin = look["skin"]
    if not isinstance(skin, str) or not HEX_RE.match(skin):
        raise _fail("format", "skin", "skin must be a #rrggbb colour")
    skin = skin.lower()
    if skin not in catalog["skin_tones"]:
        raise _fail("undrawable", "skin", f"skin tone {skin} is not in the catalog")
    hair_in = look["hair"]
    if not isinstance(hair_in, dict):
        raise _fail("type", "hair", "hair must be an object")
    for key in sorted(HAIR_KEYS - hair_in.keys()):
        raise _fail("required", f"hair.{key}", f"missing required key {key!r}")
    for key in sorted(set(hair_in) - HAIR_KEYS):
        raise _fail("unknown-field", f"hair.{key}", f"unknown key {key!r}")
    hair_color = hair_in["color"]
    if not isinstance(hair_color, str) or not HEX_RE.match(hair_color):
        raise _fail("format", "hair.color", "hair.color must be a #rrggbb colour")
    hair_color = hair_color.lower()
    if hair_color not in catalog["hair"]["colors"]:
        raise _fail("undrawable", "hair.color", f"hair colour {hair_color} is not in the catalog")
    style = hair_in["style"]
    styles = {row["id"]: row for row in catalog["hair"]["styles"]}
    if not isinstance(style, str) or style not in styles:
        raise _fail("undrawable", "hair.style", f"hair style {style!r} is not in the catalog")
    model = look["model"]
    if model == "bear":
        if style != "bald":
            raise _fail("undrawable", "hair.style", "bear must be bald")
    elif model not in styles[style]["models"]:
        raise _fail("undrawable", "hair.style", f"style {style!r} does not fit model {model!r}")
    wear_in = look["wear"]
    if not isinstance(wear_in, dict):
        raise _fail("type", "wear", "wear must be an object")
    index = item_index(catalog)
    slots = set(catalog["slots"])
    wear: dict[str, Any] = {}
    for slot in sorted(wear_in):
        if slot not in slots:
            raise _fail("unknown-field", f"wear.{slot}", f"unknown slot {slot!r}")
        entry = wear_in[slot]
        if not isinstance(entry, dict):
            raise _fail("type", f"wear.{slot}", f"wear.{slot} must be an object")
        for key in sorted(WEAR_KEYS - entry.keys()):
            raise _fail("required", f"wear.{slot}.{key}", f"missing required key {key!r}")
        for key in sorted(set(entry) - WEAR_KEYS):
            raise _fail("unknown-field", f"wear.{slot}.{key}", f"unknown key {key!r}")
        item_id = entry["id"]
        if not isinstance(item_id, str) or item_id not in index:
            raise _fail("undrawable", f"wear.{slot}.id", f"unknown item {item_id!r}")
        item = index[item_id]
        if item["slot"] != slot:
            raise _fail("value", f"wear.{slot}.id", f"item {item_id!r} is not a {slot} item")
        if model not in item["models"]:
            raise _fail("undrawable", f"wear.{slot}.id", f"item {item_id!r} does not fit model {model!r}")
        color = entry["color"]
        if not isinstance(color, str) or not HEX_RE.match(color):
            raise _fail("format", f"wear.{slot}.color", f"wear.{slot}.color must be a #rrggbb colour")
        color = color.lower()
        if color not in item["swatches"]:
            raise _fail("undrawable", f"wear.{slot}.color", f"colour {color} is not a swatch of {item_id!r}")
        wear[slot] = {"id": item_id, "color": color}
    if "full" in wear:
        covers = index[wear["full"]["id"]].get("covers", [])
        for covered in sorted(covers):
            if covered in wear:
                raise _fail("conflict", f"wear.{covered}", f"{wear['full']['id']!r} covers {covered!r}")
    return {
        "v": 2,
        "model": model,
        "tier": TIER,
        "skin": skin,
        "hair": {"style": style, "color": hair_color},
        "wear": wear,
    }


def nearest(color: str, choices: list[str]) -> str:
    """The entry of ``choices`` nearest ``color`` by squared RGB distance; ties go to the earliest entry."""
    target = tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))
    best = choices[0]
    best_dist = None
    for choice in choices:
        candidate = tuple(int(choice[i:i + 2], 16) for i in (1, 3, 5))
        dist = sum((a - b) ** 2 for a, b in zip(target, candidate))
        if best_dist is None or dist < best_dist:
            best = choice
            best_dist = dist
    return best


def migrate_v1(v1: dict[str, Any], catalog: dict[str, Any]) -> dict[str, Any]:
    """Map a valid v1 look (model, fit, hair, palette, tier, optional accessory) to a valid v2 look.

    model kept; skin = nearest(palette.skin, skin_tones); hair = {style: 'bun-classic' for june, 'bald' for bear,
    else 'classic'; color: nearest(v1 hair, hair.colors)}; wear.top = office-shirt in nearest(palette.shirt);
    wear.bottom = slacks in nearest(fit.pants); wear.outer = suit-vest in nearest(fit.vest) only when the fit has a
    vest; v1 accessory -> wear.head with that item's first swatch. Colours always snap to the item's own swatches.
    The result must pass ``validate``.
    """
    index = item_index(catalog)
    model = v1["model"]
    skin = nearest(v1["palette"]["skin"], catalog["skin_tones"])
    if model == "june":
        style = "bun-classic"
    elif model == "bear":
        style = "bald"
    else:
        style = "classic"
    hair_color = nearest(v1["hair"], catalog["hair"]["colors"])
    shirt_item = index["office-shirt"]
    pants_item = index["slacks"]
    wear: dict[str, Any] = {
        "top": {"id": "office-shirt", "color": nearest(v1["palette"]["shirt"], shirt_item["swatches"])},
        "bottom": {"id": "slacks", "color": nearest(v1["fit"]["pants"], pants_item["swatches"])},
    }
    fit = v1["fit"]
    if "vest" in fit:
        vest_item = index["suit-vest"]
        wear["outer"] = {"id": "suit-vest", "color": nearest(fit["vest"], vest_item["swatches"])}
    if "accessory" in v1:
        accessory = index[v1["accessory"]]
        wear["head"] = {"id": accessory["id"], "color": accessory["swatches"][0]}
    return {
        "v": 2,
        "model": model,
        "tier": TIER,
        "skin": skin,
        "hair": {"style": style, "color": hair_color},
        "wear": wear,
    }


def owned(item: dict[str, Any], store_document: dict[str, Any] | None = None) -> bool:
    """True only for items that need no purchase (``free``). Store entitlements never grant clothes: founder
    2026-10-29, "Standard office wear is paid for by what the employee has credit wise" (server/wardrobe_shop.py
    owns per-agent ownership). ``store_document`` is accepted and ignored for older callers."""
    return bool(item.get("free"))


def paid_items(look: dict[str, Any], catalog: dict[str, Any]) -> list[str]:
    """Item ids in ``look['wear']`` that are not free, sorted."""
    index = item_index(catalog)
    return sorted(entry["id"] for entry in look["wear"].values() if not index[entry["id"]].get("free"))
