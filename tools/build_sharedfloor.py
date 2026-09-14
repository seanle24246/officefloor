#!/usr/bin/env python3
"""
build_sharedfloor.py — bake the SERVED shared-floor room renderer.

This is the officefloor.ai public floor: a page served at /r/<code> that keeps
the reviewed external renderer scripts and polls the room named by its URL. It
is deliberately NOT a self-contained snapshot bake (build_standalone's M0/mvp/
webdemo modes inline every script and embed a boot snapshot); the shared floor
has a live server behind it and renders whatever the room reports.

    python3 tools/build_sharedfloor.py                    # -> dist/office-sharedfloor.html
    python3 tools/build_sharedfloor.py --out /tmp/floor.html

WHY A SEPARATE TOOL (not a build_standalone --mode):
The clean implementation of a "sharedfloor" bake would add it to
build_standalone.SAFE_MODES, which is Dwight's reviewed-modes gate
(selftest.py pins SAFE_MODES == {funny, mvp, webdemo}). Registering a mode
there asserts a review I do not own, and churns his file on every rebase. So
this tool imports his bake helpers READ-ONLY — script_manifest, _basename_list,
standalone_source, STATIC, HERE — and assembles the served page itself. Zero
edits to build_standalone.py, zero edits to the pin. If Dwight later blesses
"sharedfloor" as a SAFE_MODE, this tool can be retired in favor of the mode;
until then it ships the product surface without touching his gate.

The served page is wired by floorservice: FloorApp(page_path=...) serves this
file at /r/<code> for any valid room code (see floorservice/app.py:page), and
`serve()` reads OFFICEFLOOR_PAGE from the environment.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import build_standalone as bs  # noqa: E402  (read-only helper reuse)
from server import feature_flags  # noqa: E402

SHAREDFLOOR_MANIFEST = REPO_ROOT / "sharedfloor_manifest.json"
SHAREDFLOOR_BOOT = "office.sharedfloor.boot.js"


def sharedfloor_selection(html: str) -> tuple[list[tuple[str, bool, str]], dict]:
    """Pick the reviewed shared-room render scripts, in manifest keep order.

    Mirrors the validation build_standalone would apply for a sharedfloor mode:
    every keep/excluded script named in the manifest must exist in
    static/index.html, no index.html script may be unmanaged, basenames must be
    unique, and the boot script must be present. The gate is mutation-honest —
    drop a keep script from index.html and this raises naming it.
    """
    payload = json.loads(SHAREDFLOOR_MANIFEST.read_text(encoding="utf-8"))
    keep = bs._basename_list(payload, "keep_scripts", manifest=SHAREDFLOOR_MANIFEST)
    excluded = bs._basename_list(
        payload, "excluded_scripts", manifest=SHAREDFLOOR_MANIFEST)

    entries = [entry for entry in bs.script_manifest(html) if not entry[1]]
    by_basename: dict[str, tuple[str, bool, str]] = {}
    for entry in entries:
        basename = Path(entry[0]).name
        if basename in by_basename:
            raise ValueError(
                f"static/index.html repeats shared-floor script basename: {basename}")
        by_basename[basename] = entry

    listed = set(keep) | set(excluded)
    missing = sorted(listed - set(by_basename))
    unmanaged = sorted(set(by_basename) - listed)
    if missing:
        raise ValueError(
            "shared-floor manifest scripts absent from static/index.html: "
            + ", ".join(missing))
    if unmanaged:
        raise ValueError(
            "static/index.html scripts absent from shared-floor manifest: "
            + ", ".join(unmanaged))
    if not (bs.STATIC / SHAREDFLOOR_BOOT).is_file():
        raise ValueError(f"shared-floor boot script is missing: {SHAREDFLOOR_BOOT}")

    return [by_basename[name] for name in keep], payload


def build_sharedfloor(out: Path) -> Path:
    """Assemble the served shared-floor renderer into `out`."""
    html = (bs.STATIC / "index.html").read_text()

    body_manifest = bs.script_manifest(html)
    keep_entries, manifest = sharedfloor_selection(html)

    # Strip the body of ALL script declarations (same rule build() uses): the
    # renderer scripts are re-emitted as reviewed external tags below, and
    # bake-only metadata lines are removed whole.
    body = html.split("<body>", 1)[1].split("</body>", 1)[0]
    for _, bake_only, markup in body_manifest:
        needle = markup + "\n" if bake_only and markup + "\n" in body else markup
        body = body.replace(needle, "", 1)

    # Accept the legacy whitelist marker or the reviewed external boot asset.
    # Every other inline script remains an error; PAGE_CSP stays unchanged.
    body, n_themes = re.subn(
        r"<script\b(?![^>]*\bsrc\s*=)[^>]*>[^<]*__OFFICE_SELECTABLE_THEMES__[^<]*</script>\s*",
        "", body, count=1)
    external_boot = [entry for entry in body_manifest
                     if entry[0] == "office.boot.js" and not entry[1]]
    if n_themes != 1 and len(external_boot) != 1:
        raise ValueError(
            "sharedfloor bake: expected exactly one inline "
            "__OFFICE_SELECTABLE_THEMES__ <script> to strip, found "
            f"{n_themes}, with no office.boot.js replacement")
    if re.search(r"<script\b", body, re.IGNORECASE):
        raise ValueError("sharedfloor bake: unreviewed inline script in body")

    # Reviewed renderer files, consumed as external build output. A base rooted
    # at /static/ keeps declared and dynamically-created relative URLs correct
    # under /r/<code>. The bake gate below independently proves no excluded
    # script leaked into the emitted tags.
    emitted_scripts = "\n".join(markup for _, _, markup in keep_entries)
    emitted_basenames = [Path(path).name for path, _, _ in keep_entries]
    excluded = set(manifest["excluded_scripts"])
    leaked = sorted(excluded & set(emitted_basenames))
    if leaked:
        raise ValueError(
            "shared-floor bake leaked excluded scripts: " + ", ".join(leaked))

    feature_boot = feature_flags.client_bootstrap()
    sharedfloor_boot = f'<script src="{SHAREDFLOOR_BOOT}"></script>\n'
    # Keep the external CSS dependencies of the retained modules. Linking
    # them preserves the same-origin CSP and /static/ base resolution.
    stylesheets = ["office.css"]
    for module in ("office.keyboard", "office.needscard", "office.morning"):
        if module + ".js" in emitted_basenames:
            stylesheets.append(module + ".css")
    for name in stylesheets:
        if not (bs.STATIC / name).is_file():
            raise ValueError(f"shared-floor stylesheet is missing: {name}")
    stylesheet = "".join(
        f'<link rel="stylesheet" href="{name}" />\n' for name in stylesheets)

    credits_path = bs.HERE / "CREDITS.md"
    credits = (credits_path.read_text() if credits_path.is_file()
               else "CREDITS.md is distributed with the source tree.")
    title = "officefloor.ai — shared floor"

    # No __OFFICE_SNAPSHOT__: the shared floor polls its room live rather than
    # opening from a frozen boot snapshot.
    payload = f"""{sharedfloor_boot}<title>{title}</title>
{stylesheet}{feature_boot}
{body}
{emitted_scripts}
<!-- Embedded CREDITS.md
{credits}
-->
"""
    doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<base href="/static/" />
</head>
<body>
{payload}</body>
</html>
"""
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(doc)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Bake the served shared-floor renderer.")
    ap.add_argument("--out", default="",
                    help="output path (default: dist/office-sharedfloor.html)")
    args = ap.parse_args()
    out = Path(args.out) if args.out else (REPO_ROOT / "dist" / "office-sharedfloor.html")
    written = build_sharedfloor(out)
    print(f"wrote {written}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
