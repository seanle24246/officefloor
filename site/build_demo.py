#!/usr/bin/env python3
"""build_demo.py — bake site/embed/demo.html from DEMO_ROSTER, and only DEMO_ROSTER,
then audit everything in site/ before any of it is allowed to ship.

`build_standalone.py` bakes whatever roster the office resolves. Run from a
lane checkout that sits inside a real org, it resolves the *real* manifest —
which is exactly the file that may never leave the building. This wrapper
removes that possibility instead of relying on where it happens to be run:

  1. it points `$OFFICE_ALLREPOS` at an empty directory before `serve` is
     imported, so root resolution finds no `ceo/bootstrap.sh` and demo mode
     falls back to the synthetic `DEMO_ROSTER` (`serve.load_roster`);
  2. it then audits the file it just wrote and deletes it unless every baked
     lane is a `DEMO_ROSTER` lane.

Step 2 is the one that matters. Step 1 is how it is supposed to work; step 2
is what proves it did.

    python3 site/build_demo.py            # -> site/embed/demo.html
    python3 site/build_demo.py --out site/demo.html  # -> static screenshot page
    python3 site/build_demo.py --check    # audit what is committed, write nothing

Two tiers of finding:
  LEAK  a real fact about a real org reached a public file — fails, exit 1
  NOTE  org vocabulary in product copy — reported, does not fail

Nothing here edits the product. It imports it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path

SITE = Path(__file__).resolve().parent
REPO = SITE.parent
OUT = SITE / "embed" / "demo.html"
SCREENSHOT_OUT = SITE / "demo.html"
SCREENSHOT_ASSET = SITE / "assets" / "demo-screenshot.png"

SCREENSHOT_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Officefloor demo: 22 synthetic agent seats</title>
<meta name="description" content="A clean screenshot of the Officefloor synthetic demo fleet, with 22 agent seats and four parked cars.">
<link rel="canonical" href="https://officefloor.ai/demo">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Officefloor">
<meta property="og:title" content="Officefloor demo: 22 synthetic agent seats">
<meta property="og:description" content="A clean screenshot of the Officefloor synthetic demo fleet, with 22 agent seats and four parked cars.">
<meta property="og:url" content="https://officefloor.ai/demo">
<meta property="og:image" content="https://officefloor.ai/assets/demo-screenshot.png">
<meta property="og:image:alt" content="Screenshot of the Officefloor synthetic demo floor with 22 agent seats and four parked cars. Not live.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Officefloor demo: 22 synthetic agent seats">
<meta name="twitter:description" content="A clean screenshot of the Officefloor synthetic demo fleet, with 22 agent seats and four parked cars.">
<meta name="twitter:image" content="https://officefloor.ai/assets/demo-screenshot.png">
<meta name="theme-color" content="#15140D">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%2315140D'/%3E%3Cpath d='M16 5 27 11.5 16 18 5 11.5Z M5 11.5v6L16 24l11-6.5v-6' fill='none' stroke='%23F2EFDA' stroke-width='2' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="site.css">
</head>
<body>
<nav aria-label="Primary">
  <a class="wordmark" href="index.html">
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <g fill="none" stroke="#F2EFDA" stroke-width="1.8" stroke-linejoin="round">
        <path d="M15 3 27 10 15 17 3 10Z"></path>
        <path d="M15 9 21 12.5 15 16 9 12.5Z" fill="#F7D24A" stroke="none"></path>
        <path d="M3 10v6l12 7 12-7v-6"></path>
      </g>
    </svg>
    <span>officefloor</span>
  </a>
  <div class="navlinks" data-primary-navlinks></div>
  <a class="pill" href="demo.html" aria-current="page">Demo</a>
</nav>

<main class="demo-screenshot">
  <img src="assets/demo-screenshot.png" width="1440" height="900"
    alt="Screenshot of the officefloor demo floor: an isometric office with 22 synthetic agent seats. Not a live view.">
  <p class="micro">Screenshot of the demo floor (22 synthetic seats). Not live. Run it yourself: pip install officefloor &amp;&amp; officefloor --demo</p>
</main>

<footer>
  <div class="foot-grid">
    <div>
      <a class="wordmark" href="index.html">
        <svg width="26" height="26" viewBox="0 0 30 30" aria-hidden="true"><g fill="none" stroke="#F1EFDA" stroke-width="1.8" stroke-linejoin="round"><path d="M15 3 27 10 15 17 3 10Z"></path><path d="M15 9 21 12.5 15 16 9 12.5Z" fill="#F7D24A" stroke="none"></path><path d="M3 10v6l12 7 12-7v-6"></path></g></svg>
        <span>officefloor</span>
      </a>
      <div class="tagline">EVERY PIXEL HAS A RECEIPT</div>
    </div>
    <div class="foot-col"><h2>Product</h2><a href="index.html#how">How it works</a><a href="index.html#receipt">The receipt</a><a href="index.html#afterhours">After hours</a><a href="fun.html">Fun</a></div>
    <div class="foot-col"><h2>Pages</h2><a href="about.html">About</a><a href="soon.html">Coming soon</a></div>
    <div class="foot-col"><h2>Company</h2><span>hello@officefloor.ai</span></div>
  </div>
  <nav class="foot-legal" aria-label="Legal links"><a href="about.html">About</a><span aria-hidden="true">·</span><a href="legal.html">Legal &amp; privacy</a><span aria-hidden="true">·</span><a href="legal.html#license">FSL-1.1-ALv2 license</a><span aria-hidden="true">·</span><a href="legal.html#security">Security</a></nav>
  <div class="foot-base"><span>© 2026 OFFICEFLOOR</span><span>HELLO@OFFICEFLOOR.AI</span></div>
</footer>
<script defer src="nav.js"></script>
</body>
</html>
"""

# Fields the standalone bake strips. Re-checked here because the audit has to
# stand on its own: if VOLATILE ever loses an entry, this still fails.
FORBIDDEN_KEYS = (
    "outbox_tail branch blockers decision_needed task pid ctx_pct ctx_age_min "
    "dirty_files"
).split()

# `commits_ahead` is the one exception: the bake strips it and writes back a
# literal 0 so the renderer has the key it expects. Zero is not a fact about
# anybody. Any other number would be one, so any other number fails.
ZEROED_KEYS = ("commits_ahead",)

SNAPSHOT_RE = re.compile(r"window\.__OFFICE_SNAPSHOT__\s*=\s*(\{.*?\});", re.S)
WEBDEMO_RE = re.compile(r"window\.__OFFICE_WEBDEMO__\s*=\s*(\{.*?\});", re.S)

# Anything that would make a page reach off the machine it was opened on. The
# whole site has to work from a bare clone, offline, from file://.
EXTERNAL_RE = re.compile(r"""(?:src|href)\s*=\s*["']\s*(?:https?:)?//""", re.I)

# `<link rel="canonical|icon|alternate">` carries an absolute URL that is
# metadata, not a resource the page fetches to render — the canonical URL and
# social-card hints must be absolute to be useful. These do not break offline
# opening, so they are exempt from the external-resource scan. A stylesheet or
# script pointing off-machine is NOT a link of this kind and still fails.
META_LINK_RE = re.compile(
    r"""<link\b[^>]*\brel\s*=\s*["']\s*(?:canonical|icon|shortcut icon|alternate|apple-touch-icon)\s*["'][^>]*>""",
    re.I,
)

# A real fact about the real org. Any hit is a leak.
LEAK_PATTERNS = [
    (re.compile(r"\b(?:claude|codex)-office-[a-z0-9-]+"), "an org lane name"),
    (re.compile(r"\bAllRepos\b"), "the org root directory name"),
    (re.compile(r"/Users/[a-z0-9._-]+", re.I), "an absolute path off someone's machine"),
    (re.compile(r"\broster-extra\b"), "the roster overflow file"),
    (re.compile(r"\bbootstrap\.sh\b"), "the org's roster manifest script"),
    # SB-1: the asset MANIFEST's `source` records point at the founder's PRIVATE
    # repo — real github handle, internal packet paths, commit SHAs. The bake
    # used to carry these inside the embedded credits comment. Scan the WHOLE
    # file text for them so a regressed bake is refused, not shipped.
    (re.compile(r"github\.com/[A-Za-z0-9_-]+/the-office\b", re.I), "the org's private repo URL"),
    (re.compile(r"\boffice-render-engine-packets\b"), "an internal repo directory"),
    (re.compile(r"\bseanle[0-9]+\b", re.I), "the founder's github handle"),
]

# Org vocabulary that is product copy, not a fact about anybody. Worth seeing
# in a public artifact; not worth failing a build over.
NOTE_PATTERNS = [
    (re.compile(r"\bsweep\.sh\b"), "an org script name in product UI copy"),
]


def demo_lanes() -> set[str]:
    """The lane set of the synthetic roster, read from the product itself."""
    import serve

    return {s["lane"] for s in serve.parse_roster_rows(serve.DEMO_ROSTER)}


def audit_bake(path: Path, lanes: set[str]) -> list[str]:
    """Rules that apply only to the baked floor: what is in the snapshot."""
    problems: list[str] = []
    doc = path.read_text(errors="replace")

    m = SNAPSHOT_RE.search(doc)
    if not m:
        return [f"{path.name}: no __OFFICE_SNAPSHOT__ — this is not a baked floor"]
    snap = json.loads(m.group(1))

    agents = snap.get("agents", [])
    if not agents:
        problems.append(f"{path.name}: snapshot carries no seats")
    for a in agents:
        lane = a.get("lane", "")
        if lane not in lanes:
            problems.append(f"{path.name}: NON-DEMO LANE baked in: {lane!r}")
        for k in FORBIDDEN_KEYS:
            if k in a:
                problems.append(f"{path.name}: volatile field {k!r} survived on {lane!r}")
        for k in ZEROED_KEYS:
            if a.get(k, 0):
                problems.append(f"{path.name}: {k!r} baked non-zero ({a[k]!r}) on {lane!r}")
    return problems


def audit_webdemo(path: Path) -> list[str]:
    """Pin the public artifact's view-only surface and parked-car projection."""
    problems: list[str] = []
    doc = path.read_text(errors="replace")
    if 'window.__OFFICE_BUILD_PROFILE__ = "webdemo"' not in doc:
        problems.append(f"{path.name}: missing the webdemo build profile")

    match = WEBDEMO_RE.search(doc)
    if not match:
        return [*problems, f"{path.name}: missing __OFFICE_WEBDEMO__ render data"]
    payload = json.loads(match.group(1))
    placements = payload.get("placements", [])
    sys.path.insert(0, str(REPO))
    from server.customization_api import DEMO_PLACED_CARS, OWNED_BY_DEFAULT

    expected = list(DEMO_PLACED_CARS)
    actual = [
        (str(row.get("render", {}).get("reference", "")).removeprefix("cars."),
         row.get("sku_id"))
        for row in placements
    ]
    if actual != expected:
        problems.append(f"{path.name}: web-demo car row drifted: {actual!r}")
    if len(OWNED_BY_DEFAULT) != 37:
        problems.append(
            f"{path.name}: default owned-SKU catalog drifted: {len(OWNED_BY_DEFAULT)}"
        )
    if len({row.get("geometry", {}).get("anchor", {}).get("y")
            for row in placements}) != 1:
        problems.append(f"{path.name}: web-demo cars do not share one y-offset")
    if any(row.get("sku_id") == "sku-0825"
           or row.get("render", {}).get("reference") == "cars.firetruck"
           for row in placements):
        problems.append(f"{path.name}: firetruck survived in the web-demo car row")

    snapshot_match = SNAPSHOT_RE.search(doc)
    if snapshot_match:
        layout_props = json.loads(snapshot_match.group(1)).get("layout", {}).get("props", [])
        leaked_props = [
            prop.get("type") for prop in layout_props
            if prop.get("type") in {"car", "boxingring", "cars.firetruck"}
        ]
        if leaked_props:
            problems.append(f"{path.name}: removed layout props survived: {leaked_props!r}")

    forbidden_sources = {
        "store/purchase UI": "const LOCAL_DEMO_DISCLOSURE",
        "CostView control": "const ENDPOINT = '/api/costview';",
        "dispatch board": "root.OfficeDispatchBoard",
        "cockpit chat": "root.OfficeCockpitChat = api;",
        "Talk-to-CEO control": "talk.textContent = '💬 WAKE';",
        "edit-mode core": "const EDIT_VERSION = 1;",
        "avatar customization": "const BUTTON_ID = 'office-avatar-picker-button';",
        "office picker interaction": "const BUTTON_ID = 'office-picker-button';",
        "boxing ring": "OFFICE.module('boxing.ring'",
        "boxing card": "OFFICE.module('boxing.card'",
        "boxing wire": "OFFICE.module('boxing.wire'",
        "boxing draw callback": "drawBoxingRing",
    }
    for label, marker in forbidden_sources.items():
        if marker in doc:
            problems.append(f"{path.name}: {label} source survived the web demo")

    required_render_sources = {
        "customization catalog": "/* SOC-01 immutable, renderer-capable starter catalog. */",
        "customization renderers": "root.OfficeCustomizationRenderers = api;",
        "furnishing renderer": "root.OfficeFurnishings = api;",
        "view-only placement seam": "Public web-demo snapshots keep the real render seam",
        "car painter": "/* office.cars.paint.js — THE GARAGE",
        "main renderer": "OFFICE.module('main', [], () => {",
    }
    for label, marker in required_render_sources.items():
        if marker not in doc:
            problems.append(f"{path.name}: missing {label}")
    return problems


def audit_doc(path: Path) -> tuple[list[str], list[str]]:
    """Rules that apply to every file the site ships. (leaks, notes)"""
    doc = path.read_text(errors="replace")
    leaks, notes = [], []

    # Metadata links (canonical/icon/social) legitimately carry absolute URLs
    # without breaking offline opening — drop them before the resource scan.
    scan = META_LINK_RE.sub("", doc)
    if EXTERNAL_RE.search(scan):
        hits = sorted(set(EXTERNAL_RE.findall(scan)))[:3]
        leaks.append(f"{path.name}: external src/href — the site must open offline {hits}")

    for pattern, what in LEAK_PATTERNS:
        for hit in sorted(set(pattern.findall(doc))):
            leaks.append(f"{path.name}: {what} in a public file: {hit!r}")
    for pattern, what in NOTE_PATTERNS:
        for hit in sorted(set(pattern.findall(doc))):
            notes.append(f"{path.name}: {what}: {hit!r}")

    return leaks, notes


def screenshot_dimensions(path: Path) -> tuple[int, int] | None:
    """Read the dimensions from a PNG IHDR without adding an image dependency."""
    data = path.read_bytes()[:24] if path.is_file() else b""
    if len(data) != 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        return None
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def audit_screenshot_page(path: Path) -> list[str]:
    """Pin the public demo page to the approved static screenshot contract."""
    problems: list[str] = []
    doc = path.read_text(errors="replace")
    required = {
        "screenshot wrapper": '<main class="demo-screenshot">',
        "approved screenshot": 'src="assets/demo-screenshot.png"',
        "screenshot dimensions": 'width="1440" height="900"',
        "honest screenshot alt": "Not a live view.",
        "visible not-live disclosure": "Screenshot of the demo floor (22 synthetic seats). Not live.",
        "public navigation": '<nav aria-label="Primary">',
        "shared navigation links": "data-primary-navlinks",
        "public footer": "<footer>",
        "shared navigation script": 'src="nav.js"',
    }
    for label, marker in required.items():
        if marker not in doc:
            problems.append(f"{path.name}: missing {label}")

    forbidden = {
        "live demo iframe": "<iframe",
        "purple live-demo frame": "demo-floor-frame",
        "synthetic-demo banner": "live-chip",
        "embedded live floor": "window.__OFFICE_SNAPSHOT__",
    }
    lowered = doc.lower()
    for label, marker in forbidden.items():
        if marker.lower() in lowered:
            problems.append(f"{path.name}: {label} survived the screenshot-page split")

    dimensions = screenshot_dimensions(SCREENSHOT_ASSET)
    if dimensions != (1440, 900):
        problems.append(
            f"{SCREENSHOT_ASSET.name}: expected 1440x900 PNG, got {dimensions!r}"
        )
    if SCREENSHOT_ASSET.is_file() and SCREENSHOT_ASSET.stat().st_size > 600 * 1024:
        problems.append(
            f"{SCREENSHOT_ASSET.name}: exceeds the 600 KB public screenshot limit"
        )
    return problems


def sanitize_credits(path: Path) -> int:
    """Re-assert the source bake's fail-closed private-credit guard."""
    import build_standalone

    build_standalone.assert_no_private_credit_markers(path.read_text(errors="replace"))
    return 0


def build_screenshot_page(out: Path) -> Path:
    """Write the public nav + screenshot + footer page, never the live embed."""
    dimensions = screenshot_dimensions(SCREENSHOT_ASSET)
    if dimensions != (1440, 900):
        raise ValueError(
            f"approved screenshot must be a 1440x900 PNG, got {dimensions!r}"
        )
    if SCREENSHOT_ASSET.stat().st_size > 600 * 1024:
        raise ValueError("approved screenshot exceeds the 600 KB limit")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(SCREENSHOT_HTML)
    return out


def build(out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    # Empty root => no ceo/bootstrap.sh => demo mode takes the DEMO_ROSTER
    # fallback. Set before `serve` is imported: it resolves roots at import.
    with tempfile.TemporaryDirectory(prefix="office-nowhere-") as nowhere:
        os.environ["OFFICE_ALLREPOS"] = nowhere
        sys.path.insert(0, str(REPO))
        import build_standalone

        built = build_standalone.build(out, mode="webdemo")

    # The source builder carries the complete owned car catalog in its public
    # payload. The site presentation uses only the bounded parked subset; the
    # remaining car SKUs stay in the embedded catalog and entitlement seed.
    doc = built.read_text()
    match = WEBDEMO_RE.search(doc)
    if not match:
        raise ValueError("web-demo placement projection is missing")
    payload = json.loads(match.group(1))
    from server.customization_api import DEMO_PLACED_CARS

    expected = list(DEMO_PLACED_CARS)
    by_key = {
        (str(row.get("render", {}).get("reference", "")).removeprefix("cars."),
         row.get("sku_id")): row
        for row in payload.get("placements", [])
    }
    if any(key not in by_key for key in expected):
        raise ValueError("web-demo parked subset is absent from the source projection")
    payload["placements"] = [by_key[key] for key in expected]
    projected = json.dumps(payload, separators=(",", ":"))
    built.write_text(doc[:match.start(1)] + projected + doc[match.end(1):])
    return built


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="audit the committed site and write nothing")
    ap.add_argument("--out")
    args = ap.parse_args()
    out = Path(args.out) if args.out else OUT
    screenshot_page = out.resolve() == SCREENSHOT_OUT.resolve()

    if args.check:
        if not out.exists():
            print(f"missing {out} — run: python3 site/build_demo.py")
            return 1
        if not screenshot_page:
            sys.path.insert(0, str(REPO))
    else:
        if screenshot_page:
            out = build_screenshot_page(out)
        else:
            out = build(out)
            # SB-1: source bake owns credits redaction; independently re-assert it.
            sanitize_credits(out)

    if screenshot_page:
        leaks = audit_screenshot_page(out)
    else:
        lanes = demo_lanes()
        leaks = [*audit_bake(out, lanes), *audit_webdemo(out)]
    notes: list[str] = []
    top_level_pages = sorted(SITE.glob("*.html"))
    audit_paths = [*top_level_pages, OUT]
    if out.resolve() not in {path.resolve() for path in audit_paths}:
        audit_paths.append(out)
    for page in audit_paths:
        if not page.is_file():
            leaks.append(f"{page}: missing public artifact")
            continue
        page_leaks, page_notes = audit_doc(page)
        leaks += page_leaks
        notes += page_notes

    for n in notes:
        print(f"NOTE  {n}")
    if leaks:
        for p in leaks:
            print(f"LEAK  {p}")
        if not args.check:
            out.unlink()
            print(f"\nrefused to keep {out.name} — deleted it. Nothing shipped.")
        return 1

    # `site/embed/demo.html` is the audited live artifact. `site/demo.html` is
    # deliberately a screenshot page with the public nav and footer. They have
    # two different jobs, so a default bake must never mirror one over the other.

    pages = len(top_level_pages)
    audited = f"{pages} top-level pages + embed/demo.html"
    if out.resolve() not in {path.resolve() for path in [*top_level_pages, OUT]}:
        audited += f" + {out}"
    verb = "audited" if args.check else "wrote"
    if screenshot_page:
        print(f"{verb} {out.name} (static 1440x900 screenshot, nav + footer) "
              f"· {audited} clean, 0 external references")
    else:
        seats = len(json.loads(SNAPSHOT_RE.search(out.read_text()).group(1))["agents"])
        print(f"{verb} {out.name} ({out.stat().st_size // 1024} KB, {seats} demo seats, 0 real) "
              f"· {audited} clean, 0 external references")
    return 0


if __name__ == "__main__":
    sys.exit(main())
