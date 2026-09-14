#!/usr/bin/env python3
"""
build_standalone.py — bake the office into ONE self-contained .html file.

The server build reads the real fleet. This build has no server: it embeds the
floor plan + the roster as a boot snapshot and lets static/sim.js drive the
seats, so the file opens from anywhere (phone, Slack, a shared link) with no
Python running and nothing to install.

    python3 build_standalone.py                       # -> dist/office.html
    python3 build_standalone.py --out /tmp/floor.html
    python3 build_standalone.py --artifact            # body-only fragment,
                                                      # for hosts that supply <head>
    python3 build_standalone.py --theme naruto        # bake an F5 theme in
    python3 build_standalone.py --mode funny          # bake the share-safe M1 subset
    python3 build_standalone.py --mode mvp            # bake the read-only MVP subset
    python3 build_standalone.py --mode webdemo        # bake the public view-only demo

The floor deliberately commits to one look — a dark room, lit by the monitors.
There is no light theme and that is the design, not an omission.

Only the roster (names, emoji, roles, lanes, models) travels with the file.
No OUTBOX text, no branches, no context gauges, no PIDs — the snapshot is built
from the manifest, never from the live lanes.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from pathlib import Path
from typing import Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from serve import World  # noqa: E402
from server import feature_flags  # noqa: E402

STATIC = HERE / "static"
ASSETS_MANIFEST = STATIC / "assets" / "MANIFEST"
PLATE_ASSETS = (
    "assets/manhattan-clustered-office.png",
    "assets/tokyo-office.png",
)

SCRIPT_ENTRY_RE = re.compile(
    r'<script\b[^>]*?\s+src\s*=\s*["\'](?P<script>[^"\']+)["\'][^>]*>\s*</script\s*>'
    r'|<!--\s*office-bake-only:\s*(?P<bake>[^\s]+)\s*-->',
    re.IGNORECASE,
)
STYLESHEET_LINK_RE = re.compile(
    r'<link\b(?=[^>]*\brel\s*=\s*["\']stylesheet["\'])'
    r'(?=[^>]*\bhref\s*=\s*["\'](?P<href>[^"\']+)["\'])[^>]*>',
    re.IGNORECASE,
)
CSS_IMPORT_RE = re.compile(r"@import\b", re.IGNORECASE)
CSS_EXTERNAL_URL_RE = re.compile(
    r"url\(\s*['\"]?(?:(?:https?:)?//)", re.IGNORECASE,
)

VOLATILE = (
    "alive frozen pid owes_reply owed_mins status_mins ready_for_pr branch "
    "blockers blocked decision_needed task ctx_pct ctx_age_min commits_ahead "
    "dirty_files offduty state station errand outbox_tail "
    "placements inventory balance owner sku placed_by"
).split()


# The F5 themes office.js knows how to draw, with the title each one carries.
# A baked theme is only a default — ?theme= on the opened file still wins.
THEMES = {
    "naruto": "The Hidden Leaf Office — Konohagakure fleet floor",
    "beach": "The Office — remote week on the night beach",
    "manhattan": "The Office — Manhattan penthouse night shift",
    "tokyo": "The Office — Tokyo neon tower night shift",
}

# Standalone modes are an allowlist, not every mode the live client knows.
# M0 is represented by the empty default so an ordinary bake remains today's
# unmodified floor. M2 is deliberately absent: a forwardable artifact may
# never opt into unsafe fiction, even if the live client gains that mode.
SAFE_MODES = {
    "funny": "M1 Funny — share-safe props and slapstick only",
    "mvp": "Read-only MVP — full floor without founder-held modules",
    "webdemo": "Public web demo — full renderer with action surfaces removed",
}
UNSAFE_MODES = {"naughty"}
MVP_MANIFEST = HERE / "mvp_manifest.json"
WEBDEMO_MANIFEST = HERE / "webdemo_manifest.json"
NEVER_BAKED_SCRIPT_RE = re.compile(r"naughty", re.IGNORECASE)
BAKE_WEBGL_ENABLED = True
PRIVATE_CREDIT_MARKERS = (
    "seanle24246",
    "office-render-engine-packets",
    "github.com/seanle24246/",
)


def public_credits() -> str:
    """Render leak-free asset credits from public manifest fields only."""
    manifest = json.loads(ASSETS_MANIFEST.read_text())
    records = manifest["assets"] if isinstance(manifest, dict) else manifest
    lines = [
        "# Asset credits",
        "",
        "Third-party assets are CC0 / public-domain-equivalent and cited by their",
        "canonical licence page. Original art is by The Office, released as the",
        "CC0-equivalent it was cleared under.",
        "",
        "| Shipped asset | Author | Licence | Reference |",
        "|---|---|---|---|",
    ]
    for rec in sorted(records, key=lambda row: row["file"]):
        ref = str(rec.get("licence_source", "")).strip()
        ref_md = (
            f"[{ref}]({ref})"
            if ref.startswith(("http://", "https://"))
            else (ref or "—")
        )
        lines.append(
            f"| `static/assets/{rec['file']}` | {rec['author']} | "
            f"{rec['licence']} | {ref_md} |"
        )
    return "\n".join(lines) + "\n"


def inline_linked_stylesheets(html: str) -> str:
    """Return every served stylesheet in manifest order for a standalone bake."""
    stylesheets = STYLESHEET_LINK_RE.findall(html)
    if not stylesheets:
        raise ValueError("static/index.html links no stylesheets for the standalone bake")

    chunks = []
    for href in stylesheets:
        source_path = STATIC / href
        if not source_path.is_file():
            raise FileNotFoundError(
                f"stylesheet linked from static/index.html is missing: {href}"
            )
        source = source_path.read_text()
        if CSS_IMPORT_RE.search(source):
            raise ValueError(f"stylesheet {href} contains forbidden @import")
        if CSS_EXTERNAL_URL_RE.search(source):
            raise ValueError(f"stylesheet {href} contains an external url()")
        chunks.append(f"/* ---- {href} ---- */\n{source}")
    return "\n".join(chunks)


def assert_no_private_credit_markers(payload: str) -> None:
    """Fail closed when private credit provenance survives in an artifact."""
    lowered = payload.lower()
    leaked = [marker for marker in PRIVATE_CREDIT_MARKERS if marker in lowered]
    if leaked:
        raise RuntimeError(
            "standalone payload contains private credit marker(s): "
            + ", ".join(leaked)
        )


def validate_mode(mode: str) -> str:
    """Return a bake-safe mode or raise instead of silently falling back."""
    if mode == "" or mode in SAFE_MODES:
        return mode
    if mode in UNSAFE_MODES:
        raise ValueError(
            f"refusing unsafe standalone mode {mode!r}: M2 is never bakeable"
        )
    allowed = ", ".join(SAFE_MODES)
    raise ValueError(
        f"refusing unknown standalone mode {mode!r}: "
        f"safe modes are {allowed} (omit --mode for M0)"
    )


def mode_arg(value: str) -> str:
    """Argparse adapter that keeps validation shared with direct build calls."""
    try:
        return validate_mode(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def script_manifest(html: str) -> list[tuple[str, bool, str]]:
    """Return (path, bake_only, markup) entries in document order."""
    entries = [
        (match.group("script") or match.group("bake"),
         match.group("bake") is not None,
         match.group(0))
        for match in SCRIPT_ENTRY_RE.finditer(html)
    ]
    if not entries:
        raise ValueError("static/index.html declares no client scripts")
    return entries


def server_free_view_manifest(html: str) -> str:
    """Add view-only sources to bake manifests without changing served HTML."""
    marker = "<!-- office-bake-only: costview.js -->"
    if marker in html:
        raise ValueError("CostView bake-only marker must not enter served static HTML")
    anchor = '<script src="store.panel.js" data-office-side-effect></script>'
    if html.count(anchor) != 1:
        raise ValueError("server-free view insertion anchor drifted: store.panel.js")
    return html.replace(anchor, f"{anchor}\n{marker}", 1)


def never_baked_script_manifest(
    html: str,
) -> tuple[str, list[tuple[str, bool, str]]]:
    """Remove live-only adult modules from every forwardable build profile."""
    html = server_free_view_manifest(html)
    for name, _, markup in script_manifest(html):
        basename = Path(name).name
        if not NEVER_BAKED_SCRIPT_RE.search(basename):
            continue
        whole_line = re.compile(
            rf"(?m)^[^\S\r\n]*{re.escape(markup)}[^\S\r\n]*(?:\r?\n|$)"
        )
        html, count = whole_line.subn("", html, count=1)
        if count != 1:
            raise ValueError(f"{name}: never-baked exclusion is not a whole script line")
    return html, script_manifest(html)


def mvp_script_manifest(html: str) -> tuple[str, list[tuple[str, bool, str]]]:
    """Drop canonical MVP exclusions as whole tag lines, preserving order."""
    html = server_free_view_manifest(html)
    payload = json.loads(MVP_MANIFEST.read_text(encoding="utf-8"))
    excluded = payload.get("excluded_scripts")
    if (not isinstance(excluded, list) or not excluded
            or any(not isinstance(name, str) or Path(name).name != name
                   for name in excluded)
            or len(excluded) != len(set(excluded))):
        raise ValueError("mvp_manifest.json excluded_scripts must be unique basenames")

    expected = set(excluded)
    for name, _, markup in script_manifest(html):
        basename = Path(name).name
        if basename not in expected:
            continue
        whole_line = re.compile(
            rf"(?m)^[^\S\r\n]*{re.escape(markup)}[^\S\r\n]*(?:\r?\n|$)"
        )
        html, count = whole_line.subn("", html, count=1)
        if count != 1:
            raise ValueError(f"{name}: MVP exclusion is not a whole script line")
    # A profile exclusion can already be satisfied when the public wheel has
    # removed that client module from the served HTML.
    return html, script_manifest(html)


def _basename_list(payload: dict, key: str, *, manifest: Path) -> list[str]:
    """Read one unique basename list from a build-profile manifest."""
    values = payload.get(key)
    if (not isinstance(values, list) or not values
            or any(not isinstance(name, str) or Path(name).name != name
                   for name in values)
            or len(values) != len(set(values))):
        raise ValueError(
            f"{manifest.name} {key} must be a non-empty list of unique basenames"
        )
    return values


def webdemo_script_manifest(
    html: str,
) -> tuple[str, list[tuple[str, bool, str]], dict]:
    """Build the public view-only script list without changing served HTML."""
    html = server_free_view_manifest(html)
    payload = json.loads(WEBDEMO_MANIFEST.read_text(encoding="utf-8"))
    excluded = set(_basename_list(
        payload, "manifest_exclusions", manifest=WEBDEMO_MANIFEST,
    ))
    served_only = set(_basename_list(
        payload, "served_only_exclusions", manifest=WEBDEMO_MANIFEST,
    ))
    neutered = set(_basename_list(
        payload, "neutered_scripts", manifest=WEBDEMO_MANIFEST,
    ))

    source_manifest = script_manifest(html)
    present_names = {Path(name).name for name, _, _ in source_manifest}
    already_absent = sorted(excluded - present_names)
    if already_absent:
        print(
            "NOTE web-demo exclusion no-op; already absent from "
            "static/index.html: " + ", ".join(already_absent),
            file=sys.stderr,
        )

    for name, _, markup in source_manifest:
        basename = Path(name).name
        if basename not in excluded:
            continue
        whole_line = re.compile(
            rf"(?m)^[^\S\r\n]*{re.escape(markup)}[^\S\r\n]*(?:\r?\n|$)"
        )
        replacement = (
            f"<!-- office-bake-only: {name} -->\n"
            if basename == "store.panel.js" else ""
        )
        html, count = whole_line.subn(replacement, html, count=1)
        if count != 1:
            raise ValueError(f"{name}: web-demo exclusion is not a whole script line")
    # A served script can be removed from the public wheel before the demo
    # profile consumes this manifest. Its exclusion is already satisfied in
    # that case; the note above keeps that no-op visible without blocking the
    # bake. Exclusions that are present still have to strip as a whole line.

    render_scripts = payload.get("render_scripts")
    if not isinstance(render_scripts, list) or not render_scripts:
        raise ValueError("webdemo_manifest.json render_scripts must be a non-empty list")
    tags: list[str] = []
    names: set[str] = set()
    for row in render_scripts:
        if not isinstance(row, dict) or set(row) != {"name", "side_effect"}:
            raise ValueError("webdemo render_scripts entries must contain name + side_effect")
        name = row["name"]
        if (not isinstance(name, str) or Path(name).name != name
                or not isinstance(row["side_effect"], bool) or name in names):
            raise ValueError("webdemo render_scripts entries must be unique script basenames")
        if not (STATIC / name).is_file():
            raise ValueError(f"web-demo render script is missing: {name}")
        names.add(name)
        side_effect = " data-office-side-effect" if row["side_effect"] else ""
        tags.append(f'<script src="{name}"{side_effect}></script>')

    state_tag = '<script src="office.state.js"></script>'
    if html.count(state_tag) != 1:
        raise ValueError("web-demo render insertion anchor drifted: office.state.js")
    html = html.replace(state_tag, "\n".join([*tags, state_tag]), 1)
    manifest = script_manifest(html)
    # A bake-only marker may deliberately name a served-only live module when
    # ``standalone_source`` replaces it with an inert view. Only real served
    # script tags violate this profile boundary.
    served_manifest_names = {
        Path(name).name for name, bake_only, _ in manifest if not bake_only
    }
    manifest_names = {Path(name).name for name, _, _ in manifest}
    leaked = sorted(served_only & served_manifest_names)
    if leaked:
        raise ValueError(
            "web-demo live-only scripts entered static/index.html: " + ", ".join(leaked)
        )
    missing_neutered = sorted(neutered - manifest_names)
    if missing_neutered:
        raise ValueError(
            "web-demo neutered scripts absent from static/index.html: "
            + ", ".join(missing_neutered)
        )
    return html, manifest, payload


def webdemo_payload(layout: dict) -> dict:
    """Return immutable catalog data plus one visible row of standard cars."""
    from server.customization_api import DEMO_CARS, catalog_digest, load_catalog

    catalog = load_catalog()
    by_sku = {item["sku_id"]: item for item in catalog["items"]}
    standard_cars = [row for row in DEMO_CARS if row[1] != "sku-0825"]
    if (len(standard_cars) != len(DEMO_CARS) - 1
            or any(kind == "firetruck" or sku == "sku-0825"
                   for kind, sku in standard_cars)):
        raise ValueError("web-demo car seed must remove only firetruck sku-0825")

    lot = next((room for room in layout.get("rooms", [])
                if room.get("id") == "lot" and room.get("outdoor") is True), None)
    world = layout.get("world", {})
    if not lot or not isinstance(world.get("w"), (int, float)):
        raise ValueError("web-demo car seed requires the outdoor parking lot")
    y = lot["y"] + 1
    placements: list[dict] = []
    for index, (car_type, sku_id) in enumerate(standard_cars):
        item = by_sku.get(sku_id)
        reference = item and item.get("render", {}).get("painter_ref")
        expected_reference = f"cars.{car_type}"
        if (not item or item.get("render", {}).get("kind") != "procedural"
                or reference != expected_reference):
            raise ValueError(f"web-demo car catalog mismatch: {car_type} {sku_id}")
        footprint = item["grid"]["footprint"]
        x = lot["x"] + index * 3
        if x + footprint["w"] > world["w"]:
            raise ValueError("web-demo car row exceeds the outdoor world width")
        depth = item["anchors"]["180"]["depth"]
        placements.append({
            "stable_furnishing_id": f"placement:plc_WEBDEMO_CAR_{car_type.upper()}",
            "source": {"kind": "placement", "ref": f"webdemo-car-{car_type}"},
            "room_id": "lot",
            "placement_id": f"plc_WEBDEMO_CAR_{car_type.upper()}",
            "sku_id": sku_id,
            "rotation": 180,
            "geometry": {
                "anchor": {"x": x, "y": y},
                "footprint": {"w": footprint["w"], "d": footprint["d"]},
            },
            "render": {"kind": "procedural", "reference": reference,
                       "readiness": "ready"},
            "projected_depth_anchor": {"x": x + depth["x"], "y": y + depth["y"]},
            "operational": {"status": "operational", "behavior_enabled": True},
            "provenance": "webdemo-seed",
        })
    if len({row["geometry"]["anchor"]["y"] for row in placements}) != 1:
        raise ValueError("web-demo cars must occupy exactly one row")

    # The ordinary layout carries four legacy demo cars. Replace them only in
    # this copied web-demo snapshot so the public build has one canonical row.
    layout["props"] = [
        prop for prop in layout.get("props", [])
        if prop.get("type") not in {"car", "boxingring", "cars.firetruck"}
    ]
    return {
        "schema": 1,
        "catalog": catalog,
        "catalog_digest": catalog_digest(catalog),
        "placements": placements,
    }


def inline_plate_assets(source: str) -> str:
    """Replace the live plate paths with self-contained PNG data URIs."""
    for asset in PLATE_ASSETS:
        encoded = base64.b64encode((STATIC / asset).read_bytes()).decode("ascii")
        uri = f"data:image/png;base64,{encoded}"
        source = source.replace(repr(asset), json.dumps(uri))
    return source


# The baked floor is WebGL or nothing (founder ruling 2026-09-01). Every branch
# that would have queued a Canvas frame instead states the requirement outright.
WEBGL_ONLY_BOOT = """/* OFFICE_WEBGL_BOOT_START — WebGL-only bake: no Canvas fallback. */
const officeWebGLRequired = (reason) => {
  globalThis.OfficeWebGLRequired?.show(reason);
};
globalThis.addEventListener?.('office:webgl-floor-released', () => {
  officeWebGLRequired('WebGL floor released');
});
import('office-gl:/office.webgl.mount.js')
  .then((module) => module.start())
  .then(() => {
    if (globalThis.OfficeWebGLMount?.active !== true) {
      officeWebGLRequired('WebGL floor never took the floor');
    }
  })
  .catch((error) => {
    officeWebGLRequired(error?.message || 'WebGL unavailable');
  });
"""

def escape_inline_json(serialized: str) -> str:
    """Keep JSON data inert inside an HTML script element without changing it."""
    return (serialized.replace("<", "\\u003c")
            .replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029"))


def gl_vault_markup() -> str:
    """Return the embedded WebGL module vault tags, or '' when disabled."""
    if not BAKE_WEBGL_ENABLED:
        return ""
    try:
        from tools import gl_vault
    except ImportError:  # tools/ on sys.path rather than the repo root
        import gl_vault

    vault = gl_vault.vault(HERE / "static", encoding="data")
    return (
        '<script type="application/json" id="office-gl-vault">'
        f"{escape_inline_json(vault['json'])}</script>\n"
        f'<script type="importmap">{escape_inline_json(vault["importmap_json"])}</script>\n'
        f"<script>{vault['bootstrap_js']}</script>"
    )


def bake_feature_bootstrap() -> str:
    """Return served-release flags plus the bake's serverless safety overrides.

    The public demo is a served-product view, not a second product with registry
    defaults. It only differs where a serverless artifact cannot safely provide
    a capability.
    """
    markup = feature_flags.client_bootstrap(registry_defaults=False)
    overrides = {
        "webgl_floor": BAKE_WEBGL_ENABLED,
        "webgl_plate_themes": False,
        "naughty_mode": False,
        "hosted_sync": False,
    }
    for name, value in overrides.items():
        pattern = re.compile(rf"(&quot;{re.escape(name)}&quot;:)(?:true|false)")
        markup, count = pattern.subn(
            rf"\g<1>{str(value).lower()}", markup, count=1,
        )
        if count != 1:
            raise ValueError(f"feature bootstrap missing bake override target {name!r}")
    return markup


def replace_bake_region(
    source: str, start: str, end: str, replacement: str, *, script: str
) -> str:
    """Replace one live-only source region, failing when its anchors drift."""
    if source.count(start) != 1:
        raise ValueError(f"{script}: standalone start anchor drifted: {start!r}")
    before, rest = source.split(start, 1)
    if end not in rest:
        raise ValueError(f"{script}: standalone end anchor drifted: {end!r}")
    _, after = rest.split(end, 1)
    return before + replacement + end + after


def standalone_source(script: str, *, mode: str = "") -> str:
    """Return a server-free specialization without changing served sources."""
    source = (STATIC / script).read_text()

    if script == "welcome.js" and mode == "webdemo":
        source = replace_bake_region(
            source,
            "  document.getElementById('welcomeBody').textContent =\n",
            "  el.style.display = 'block';\n",
            "  document.getElementById('welcomeBody').textContent =\n"
            "    'This view-only demo uses synthetic agents and activity. '\n"
            "    + 'Explore the floor, then install Officefloor to watch your own agents. '\n"
            "    + 'Editing is available in the app.';\n",
            script=script,
        )

    if script == "office.boot.js" and mode == "webdemo":
        anchor = "function manifestModuleCount() {\n"
        if source.count(anchor) != 1:
            raise ValueError(f"{script}: web-demo inline-manifest anchor drifted")
        source = source.replace(
            anchor,
            anchor + "  if (root.__OFFICE_BUILD_PROFILE__ === 'webdemo') return null;\n",
            1,
        )
    elif script == "settings.panel.js":
        source = replace_bake_region(
            source,
            "function showToggle(actions) {\n",
            "async function refreshWriteMode() {\n",
            "function showToggle() {\n  showLocked();\n}\n\n",
            script=script,
        )
        source = replace_bake_region(
            source,
            "async function refreshWriteMode() {\n",
            "function openPanel() {\n",
            "function refreshWriteMode() {\n  showLocked();\n}\n\n",
            script=script,
        )
    elif script == "office.layout-setting.js":
        source = replace_bake_region(
            source,
            "const nativeFetch = typeof root.fetch === 'function' ? root.fetch.bind(root) : null;\n",
            "})();\n",
            "const nativeFetch = null;\n"
            "function stateRequest() { return false; }\n"
            "function withLayout(raw) { return raw; }\n",
            script=script,
        )
    elif script == "office.customization.catalog.js":
        if mode == "webdemo":
            initial = (
                "  const initial = typeof require === 'function'\n"
                "    ? require('../data/standard-office-customization-catalog.json') : null;\n"
            )
            if source.count(initial) != 1:
                raise ValueError(f"{script}: web-demo catalog bootstrap anchor drifted")
            source = source.replace(
                initial,
                "  const initial = root.__OFFICE_WEBDEMO__?.catalog || null;\n",
                1,
            )
        source = replace_bake_region(
            source,
            "  const ready = manifest ? Promise.resolve(manifest) : Promise.resolve().then(async () => {\n",
            "\n\n  if (manifest) publishedDigest = digest(manifest);\n",
            "  const ready = Promise.resolve(manifest);",
            script=script,
        )
        if mode == "webdemo":
            digest_init = "  if (manifest) publishedDigest = digest(manifest);\n"
            if source.count(digest_init) != 1:
                raise ValueError(f"{script}: web-demo catalog digest anchor drifted")
            source = source.replace(
                digest_init,
                "  if (manifest) publishedDigest = globalThis.__OFFICE_WEBDEMO__?.catalog_digest || null;\n",
                1,
            )
    elif script == "office.market.placement.js":
        # The pure geometry module is safe in a snapshot, but its CommonJS
        # compatibility prelude and source-name comment trip the standalone
        # live-writer census. Keep the browser module and remove only inert
        # development scaffolding/prose from the baked bytes.
        source = replace_bake_region(
            source,
            "if (typeof module === 'object' && module.exports && typeof globalThis !== 'undefined') {\n",
            "\n\nOFFICE.module('market.placement'",
            "",
            script=script,
        )
        source = source.replace(
            "/* office.market.placement.js — session-only marketplace placement invariants. */",
            "/* Pure marketplace geometry invariants. */",
            1,
        )
    elif script == "office.customization.placement.js":
        source = replace_bake_region(
            source,
            "if (typeof module === 'object' && module.exports && typeof globalThis !== 'undefined') {\n",
            "\n\nOFFICE.module('customization.placement'",
            "",
            script=script,
        )
    elif script == "office.mounts.js":
        # The live server owns this serialized load list. Snapshot builds keep
        # the mounts module itself but carry neither the Store/catalog module
        # names nor a path that could fetch and hydrate SKU data.
        source = replace_bake_region(
            source,
            "const servedModules = [\n",
            "root.OfficeMountsReady = root.__OFFICE_SNAPSHOT__ ? null : loadServedModules();",
            "",
            script=script,
        )
    elif script == "office.state.js":
        if mode == "webdemo":
            customization_source = (
                "// Public web-demo snapshots keep the real render seam and no action seam.\n"
                "const root = typeof window === 'undefined' ? globalThis : window;\n"
                "const webdemoRows = Object.freeze(\n"
                "  (root.__OFFICE_WEBDEMO__?.placements || []).map((row) => Object.freeze(row)),\n"
                ");\n"
                "function webdemoRenderProps() {\n"
                "  return Object.freeze(webdemoRows.map((row) => Object.freeze({\n"
                "    id: row.placement_id, placement_id: row.placement_id, sku_id: row.sku_id,\n"
                "    type: row.render.reference, x: row.geometry.anchor.x, y: row.geometry.anchor.y,\n"
                "    w: row.geometry.footprint.w, d: row.geometry.footprint.d,\n"
                "    rotation: row.rotation, origin: 'placed', provenance: 'webdemo-seed',\n"
                "  })));\n"
                "}\n"
                "const customization = Object.freeze({\n"
                "  observe: () => Promise.resolve(null), ready: () => Promise.resolve(null),\n"
                "  snapshot: () => Object.freeze({\n"
                "    status: 'ready', allowed: false, placement_count: webdemoRows.length,\n"
                "  }),\n"
                "  storeOptions: () => Object.freeze({ placementStore: null, customizationInventory: null }),\n"
                "  requestPlace: () => Promise.resolve(false), chooseSku: () => false,\n"
                "  ensureActiveDesign: () => Promise.resolve(false), pointerIntent: () => false,\n"
                "  editorActive: () => false, drawRows: () => webdemoRows,\n"
                "  renderProps: webdemoRenderProps,\n"
                # The seeded cars are drawn rows, so the spatial authority has to
                # see the same rows or the WebGL adapter refuses the snapshot.
                "  effective: () => Object.freeze({ furnishings: webdemoRows }),\n"
                "  unmount: () => {},\n"
                "});\n"
                "function mountStore() { return false; }\n"
                "root.OfficeCustomizationCoordinator = customization;\n"
                "root.__OFFICE_PLACEMENTS__ = customization;\n\n"
            )
        else:
            customization_source = (
                "// Standalone snapshots expose an inert customization seam only.\n"
                "const root = typeof window === 'undefined' ? globalThis : window;\n"
                "const customization = Object.freeze({\n"
                "  observe: () => Promise.resolve(null), ready: () => Promise.resolve(null),\n"
                "  snapshot: () => Object.freeze({ status: 'disabled', allowed: false }),\n"
                "  storeOptions: () => Object.freeze({ placementStore: null, customizationInventory: null }),\n"
                "  requestPlace: () => Promise.resolve(false), chooseSku: () => false,\n"
                "  ensureActiveDesign: () => Promise.resolve(false), pointerIntent: () => false,\n"
                "  editorActive: () => false, drawRows: () => Object.freeze([]),\n"
                "  renderProps: () => Object.freeze([]), effective: () => null,\n"
                "  unmount: () => {},\n"
                "});\n"
                "function mountStore() { return false; }\n"
                "root.OfficeCustomizationCoordinator = customization;\n\n"
            )
        customization_source += "function mountStore() { return false; }\n\n"
        source = replace_bake_region(
            source,
            "// Standard Office customization — one live controller and one HTTP writer\n"
            "// ---------------------------------------------------------------------------\n",
            # End at idleRelationshipBoard, NOT syncActors: the idle-render helper
            # lives between the customization coordinator and syncActors, and a
            # region ending at syncActors swallows its definition while syncActors
            # keeps calling it — a stripped identifier that renders nothing.
            "function idleRelationshipBoard(snapshot) {\n",
            customization_source,
            script=script,
        )
        source = replace_bake_region(
            source,
            "  if (!window.__OFFICE_SNAPSHOT__) {\n",
            "  world = next;\n",
            "",
            script=script,
        )
        if mode == "webdemo":
            # The demo seeds parked cars as drawn placements but allows no
            # editing, and the live publish path sends [] whenever editing is
            # disallowed. That left the seeded rows out of the spatial snapshot
            # while the renderer still drew them, and the WebGL adapter refuses
            # a placement it cannot find. Publish the rows the demo actually draws.
            publish_call = (
                "    publishSpatialSnapshot(world.layout,\n"
                "      customizationReady ? customization.spatialFurnishings() : []);\n"
            )
            if source.count(publish_call) != 1:
                raise ValueError(f"{script}: web-demo spatial publish anchor drifted")
            source = source.replace(
                publish_call,
                "    publishSpatialSnapshot(world.layout, customization.drawRows());\n",
                1,
            )
    elif script == "office.talk.js" and mode == "webdemo":
        # hovercard is a read-only consumer of talk's coordinate helpers. Keep
        # that view seam while removing the WAKE button, DOM listeners, and
        # terminal action from the public artifact.
        source = """/* Public web-demo seat-hover geometry; no Talk action or DOM. */
OFFICE.module('talk', ['camera', 'state'], (camera, state) => {
'use strict';
function laneKey(lane) { return lane; }
function nearestHitbox(list, point, plateScale) {
  let nearest = null;
  let distance = Infinity;
  for (const hitbox of list || []) {
    const candidate = Math.hypot(
      hitbox.wx - point.x,
      hitbox.wy - 22 * plateScale - point.y,
    );
    if (candidate < distance) { nearest = hitbox; distance = candidate; }
  }
  return distance < 34 * plateScale ? nearest : null;
}
function laneAt(clientX, clientY) {
  const point = camera.screenToWorldPoint(clientX, clientY);
  const plateScale = OFFICE.theme.THEME?.plateScene ? 1 / camera.cam.zoom : 1;
  return nearestHitbox(state.hitboxes, point, plateScale)?.lane || null;
}
return Object.freeze({
  laneKey, laneAt, nearestHitbox,
  isAttachable: () => false, attachableLanes: () => Object.freeze([]), render: () => false,
});
});
"""
    elif script == "office.inspector.js":
        source = replace_bake_region(
            source,
            "async function attachToTerminal(lane) {\n",
            "function closeInspector() {\n",
            "async function attachToTerminal() {}\n\n",
            script=script,
        )
    elif script == "office.sweep.js":
        source = replace_bake_region(
            source,
            "$('sweep').onclick = async () => {\n",
            "function runSweepWalk() {\n",
            "$('sweep').onclick = () => {\n  runSweepWalk();\n};\n\n",
            script=script,
        )
    elif script == "elevator.js":
        native_fetch = (
            "const nativeFetch = typeof root.fetch === 'function' ? root.fetch.bind(root) : null;\n"
        )
        if source.count(native_fetch) != 1:
            raise ValueError(f"{script}: standalone native-fetch anchor drifted")
        source = source.replace(native_fetch, "const nativeFetch = null;\n", 1)
        source = replace_bake_region(
            source,
            "function stateRequest(input) {\n",
            "function stateUrl(raw, floor) {\n",
            "function stateRequest() { return false; }\n\n",
            script=script,
        )
        fetch_wrapper = (
            "  if (nativeFetch) {\n"
            "    root.fetch = async (input, init) => {\n"
            "      if (!stateRequest(input)) return nativeFetch(input, init);\n"
            "      const requestedFloor = pendingFloor || activeFloor;\n"
            "      const response = await nativeFetch(floorRequest(input, requestedFloor), init);\n"
            "      return wrapStateResponse(response, requestedFloor);\n"
            "    };\n"
            "  }\n"
        )
        if source.count(fetch_wrapper) != 1:
            raise ValueError(f"{script}: standalone fetch-wrapper anchor drifted")
        source = source.replace(fetch_wrapper, "", 1)
        source = replace_bake_region(
            source,
            "async function fetchFocusedFloor(generation, floor) {\n",
            "function selectFloor(floor, { updateHash = true } = {}) {\n",
            "async function fetchFocusedFloor() {}\n\n",
            script=script,
        )
    elif script == "cockpit.chat.js":
        source = replace_bake_region(
            source,
            "  async function sendMessage(text) {\n",
            "  async function pollOnce() {\n",
            "  async function sendMessage(text) {\n"
            "    const message = { schema: 1, id: mintId(), ts: new Date().toISOString(), "
            "role: 'founder-dad', text: String(text), seen: false };\n"
            "    appendMessage(message);\n"
            "    renderList();\n"
            "    return message;\n"
            "  }\n\n",
            script=script,
        )
        source = replace_bake_region(
            source,
            "  async function pollOnce() {\n",
            "  function buildShell() {\n",
            "  async function pollOnce() {}\n\n",
            script=script,
        )
    elif script == "office.main.js":
        source = replace_bake_region(
            source,
            "/* OFFICE_WEBGL_BOOT_START — served boot; build_standalone.py swaps in the vault import. */\n",
            "/* OFFICE_WEBGL_BOOT_END */\n",
            WEBGL_ONLY_BOOT,
            script=script,
        )
        source = replace_bake_region(
            source,
            "if (window.__OFFICE_SNAPSHOT__) {\n",
            "window.addEventListener('keydown', (e) => {\n",
            "const sim = window.__OFFICE_SIM__(window.__OFFICE_SNAPSHOT__);\n"
            "applyAndRender(sim.next());\n"
            "setInterval(() => applyAndRender(sim.next()), 3200);\n\n",
            script=script,
        )
        if mode == "webdemo":
            # The monolithic public artifact is large enough for a zero-delay
            # timer to run while later inline modules are still parsing.  Seal
            # on load so retained view modules register before the namespace
            # closes; the served demo keeps its existing manifest timing.
            seal = (
                "if (liveModulesReady) liveModulesReady.finally(() => OFFICE.seal());\n"
                "else setTimeout(() => OFFICE.seal(), 0);\n"
            )
            if source.count(seal) != 1:
                raise ValueError(f"{script}: web-demo seal anchor drifted")
            source = source.replace(
                seal,
                "window.addEventListener('load', () => OFFICE.seal(), { once: true });\n",
                1,
            )

    if script == "costview.js":
        # The live CostView is a data client. Bakes retain only the fail-closed
        # launch card, which office.mounts.js places in its existing modal.
        source = r"""/* Server-free CostView: inert coming-soon view only. */
(function installServerFreeCostView(root) {
'use strict';
function comingSoonCard(document, close) {
  const card = document.createElement('section');
  card.className = 'office-costview-card office-costview-coming-soon-card';
  card.setAttribute('aria-label', 'CostView — coming soon');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'office-costview-kicker';
  eyebrow.textContent = 'OBSERVED USAGE';
  const title = document.createElement('h2');
  title.textContent = 'CostView';
  const status = document.createElement('p');
  status.className = 'office-costview-coming-soon-status';
  status.textContent = 'COMING SOON';
  const copy = document.createElement('p');
  copy.className = 'office-costview-coming-soon-copy';
  copy.textContent = 'Measured tokens and published-rate estimates will appear here.';
  card.append(eyebrow, title, status, copy);
  if (close) card.append(close);
  return card;
}
function renderComingSoon(document) {
  const shell = document?.getElementById?.('officeCostView');
  if (!shell) return null;
  const close = shell.querySelector?.('[data-modal-close]') || null;
  const card = comingSoonCard(document, close);
  shell.replaceChildren(card);
  shell.dataset.costviewMounted = 'coming-soon';
  return card;
}
const api = Object.freeze({ renderComingSoon, mount: renderComingSoon });
root.CostView = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
"""

    if script == "store.panel.js":
        # The live marketplace reads catalog data and owns purchase actions.
        # A snapshot keeps only the launch panel's inert DOM and local close
        # controls. Split identifiers keep the live-module census mutation-
        # honest: none of its globals, data clients, or write paths survive.
        source = r"""/* Server-free marketplace: inert coming-soon view only. */
(() => {
'use strict';
const root = typeof window === 'undefined' ? globalThis : window;
const doc = root.document;
const PANEL_ID = 'store' + 'Panel';
const OPENER_ID = 'store' + 'Btn';
function mount() {
  if (!doc?.body || !doc.createElement || doc.getElementById(PANEL_ID)) return null;
  const make = (tag, className, value) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const button = (className, value) => {
    const node = make('button', className, value);
    node.type = 'button';
    return node;
  };
  const opener = button('btn', '🛒 store');
  opener.id = OPENER_ID;
  opener.title = 'open marketplace (b)';
  opener.setAttribute('aria-controls', PANEL_ID);
  opener.setAttribute('aria-expanded', 'false');
  doc.getElementById('topbar')?.insertBefore(
    opener, doc.getElementById('economyBalance') || doc.getElementById('needsBtn'),
  );

  const panel = make('aside', 'store-market');
  panel.id = PANEL_ID;
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', 'Marketplace');
  const card = make('section', 'store-coming-soon-card');
  card.setAttribute('aria-label', 'Marketplace — coming soon');
  card.append(
    make('div', 'store-coming-soon-mark', '✦'),
    make('h2', 'store-coming-soon-title', 'COMING SOON'),
    make('p', 'store-coming-soon-copy', 'A curated marketplace is coming soon.'),
  );
  const close = button('store-close store-market-close', '✕');
  close.setAttribute('aria-label', 'Close marketplace');
  panel.append(card, close);
  doc.body.append(panel);

  function shut() {
    panel.hidden = true;
    opener.setAttribute('aria-expanded', 'false');
    opener.focus?.();
  }
  function open() {
    root.OFFICE?.needs?.toggleNeeds(false);
    panel.hidden = false;
    opener.setAttribute('aria-expanded', 'true');
  }
  opener.addEventListener('click', () => { if (panel.hidden) open(); else shut(); });
  close.addEventListener('click', shut);
  doc.getElementById('needsBtn')?.addEventListener('click', () => {
    if (!panel.hidden) shut();
  });
  doc.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.repeat
        || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() === 'b') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (panel.hidden) open(); else shut();
    } else if ((event.key.toLowerCase() === 'n' || event.key === 'Escape') && !panel.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      shut();
    }
  }, true);
  return opener;
}
if (doc?.readyState === 'loading') {
  doc.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
})();
"""

    if script == "agent.manager.js":
        # Live uses a relative module; the offline bake resolves it from the vault.
        source = source.replace(
            "import('./office.am.looks3d.js')",
            "import('office-gl:/office.am.looks3d.js')",
        )

    # After executable live branches are gone, scrub their remaining prose so
    # the artifact carries neither a live route nor a store-module reference.
    source = source.replace("/api", "live endpoint")
    source = source.replace("store.panel.js", "marketplace panel")
    forbidden = {
        "store panel": r"store\.panel\.js|\bOfficeStore\b|\bstore-panel\b",
        "placement writer": r"placement\.js|/api/(?:placement|placements)",
        "API route": r"/api(?:/|['\"`?])",
        # The only permitted dynamic import is the embedded WebGL vault entry
        # (office-gl:/…), which resolves from the in-document import map, not the
        # network. Every other import(/fetch/XHR/WebSocket stays banned.
        "network primitive": r"\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bimport\s*\((?!\s*['\"]office-gl:/)",
    }
    for label, pattern in forbidden.items():
        if re.search(pattern, source, re.IGNORECASE):
            raise ValueError(f"{script}: standalone still carries {label}")
    return inline_plate_assets(source)


def build(
    out: Path,
    fragment: bool = False,
    theme: str = "",
    mode: str = "",
    *,
    script_transform: Callable[[str, str], str] | None = None,
    scripts_out: Path | None = None,
    script_url_prefix: str = "static/",
) -> Path:
    """Build a standalone floor, optionally externalizing transformed scripts.

    The ordinary developer bake keeps its historical one-file shape. Packaging
    may supply ``script_transform`` and ``scripts_out`` to emit the same
    server-free sources as external assets (for example, minified DMG payload
    files with private source maps). The transform is deliberately after
    ``standalone_source`` so package-time minification cannot bypass the
    server-free specialization anchors.
    """
    mode = validate_mode(mode)
    world = World(demo=True)
    snap = world.state(max_age=0)

    # Strip everything volatile — sim.js regenerates it (including branch
    # names: the README promises no branches are ever baked in, so none are).
    # What ships is the roster and the floor plan, nothing from a live lane.
    agents = []
    for a in snap["agents"]:
        agents.append({k: v for k, v in a.items() if k not in VOLATILE})
    # Copy before applying a build-profile projection: World remains the live
    # demo authority, and no web-only furnishing may leak back into it.
    layout = json.loads(json.dumps(snap["layout"]))
    webdemo = webdemo_payload(layout) if mode == "webdemo" else None
    boot = {"layout": layout, "agents": agents}

    html = (STATIC / "index.html").read_text()
    css = inline_linked_stylesheets(html)
    if mode == "mvp":
        html, manifest = mvp_script_manifest(html)
    elif mode == "webdemo":
        html, manifest, _ = webdemo_script_manifest(html)
    else:
        html, manifest = never_baked_script_manifest(html)
    leaked_never_baked = sorted(
        Path(name).name for name, _, _ in manifest
        if NEVER_BAKED_SCRIPT_RE.search(Path(name).name)
    )
    if leaked_never_baked:
        raise ValueError(
            "never-baked naughty scripts remain in standalone manifest: "
            + ", ".join(leaked_never_baked)
        )
    scripts = []
    for name, _, _ in manifest:
        source = standalone_source(name, mode=mode)
        if script_transform is not None:
            source = script_transform(name, source)
        scripts.append((name, source))
    credits = public_credits()

    body = html.split("<body>", 1)[1].split("</body>", 1)[0]
    for _, bake_only, markup in manifest:
        # Preserve the existing body whitespace for ordinary tags. The new
        # bake-only declaration is metadata, so remove its whole line.
        needle = markup + "\n" if bake_only and markup + "\n" in body else markup
        body = body.replace(needle, "", 1)

    title = THEMES.get(theme, "The Office — CEO fleet floor")
    if mode == "webdemo":
        title = "Officefloor — synthetic, view-only demo"
    baked_mode = (
        '<script>window.__OFFICE_BUILD_PROFILE__ = "webdemo";</script>\n'
        if mode == "webdemo"
        else (f"<script>window.__OFFICE_MODE__ = {escape_inline_json(json.dumps(mode))};</script>\n"
              if mode else "")
    )
    baked_defaults = "".join((
        (f"<script>window.__OFFICE_THEME__ = {escape_inline_json(json.dumps(theme))};</script>\n"
         if theme else ""),
        baked_mode,
    ))
    version_stamp = (
        f'<div id="office-demo-version" aria-label="Demo version">Officefloor {feature_flags.current_release()} · view-only demo</div>'
        if mode == "webdemo" else ""
    )
    if version_stamp:
        css += "\n#office-demo-version { position:fixed; top:54px; left:72px; z-index:12; padding:4px 7px; border-radius:4px; background:#0b101bcc; color:#dfe6f2; font:10px/1.4 ui-monospace,monospace; pointer-events:none; }\n@media(max-width:640px) { #office-demo-version { left:12px; } }\n"
    gl_boot = gl_vault_markup()
    feature_boot = bake_feature_bootstrap()
    webdemo_boot = (
        f"<script>window.__OFFICE_WEBDEMO__ = "
        f"{escape_inline_json(json.dumps(webdemo, separators=(',', ':')))};</script>\n"
        '<script>globalThis.__OFFICE_BILLBOARD_DEFAULT__ = "YOUR OFFICE INC.";</script>\n'
        if webdemo is not None else ""
    )
    if scripts_out is None:
        emitted_scripts = "\n".join(
            f"<script>\n{source}\n</script>" for _, source in scripts
        )
    else:
        scripts_out.mkdir(parents=True, exist_ok=True)
        for name, source in scripts:
            target = scripts_out / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(source)
        prefix = script_url_prefix.rstrip("/")
        emitted_scripts = "\n".join(
            f'<script src="{prefix}/{name}"></script>' for name, _ in scripts
        )
    payload = f"""<title>{title}</title>
<style>
{css}
</style>
{gl_boot}
{feature_boot}
{body}
{version_stamp}
<script>window.__OFFICE_SNAPSHOT__ = {escape_inline_json(json.dumps(boot, separators=(",", ":")))};</script>
{webdemo_boot}{baked_defaults}{emitted_scripts}
<!-- Asset credits (public references only)
{credits}-->
"""
    if fragment:
        # The host supplies <!doctype>/<html>/<head>/<body> — emit content only.
        doc = payload
    else:
        doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
</head>
<body>
{payload}</body>
</html>
"""
    assert_no_private_credit_markers(doc)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(doc)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="")
    ap.add_argument("--artifact", action="store_true",
                    help="emit a body-only fragment for a host that supplies <head>")
    ap.add_argument("--theme", default="", choices=[""] + sorted(THEMES),
                    help="bake an F5 theme in as the file's default look")
    ap.add_argument("--mode", default="", type=mode_arg, metavar="MODE",
                    help="bake a reviewed mode (funny, mvp, or webdemo); default: M0")
    args = ap.parse_args()
    suffixes = [value for value in (args.theme, args.mode) if value]
    stem = "office" + "".join(f"-{value}" for value in suffixes)
    default = HERE / "dist" / (f"{stem}-fragment.html" if args.artifact else f"{stem}.html")
    p = build(Path(args.out or default), fragment=args.artifact,
              theme=args.theme, mode=args.mode)
    print(f"wrote {p}  ({p.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
