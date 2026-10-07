# Changelog

## Unreleased

- New optional theme **TOKYO3d office**: a real 3D Blender-authored Japanese office (10 developer desks,
  5 review desks, CEO desk, animated conveyor) with agents walking real navigation. Pick it from the theme
  picker. The ~110 MB scene geometry lives in `static/assets/blender-offices/tokyo3d/` in this repository and
  is not in the PyPI wheel; run from a source checkout to use it.

- The Canvas-2D floor renderer is deleted; the floor renders with WebGL/three.js only,
  and a WebGL failure shows the requirement notice instead of falling back to 2D.
- Docs collapsed: 73 root documents moved into `docs/design/`,
  `docs/business/`, and `docs/org/`; README and STATUS rewritten to describe
  only the current tree; a dead-link probe now runs in the selftest.
- Startup logs live lane discovery and names folders skipped for reserved
  characters in their name. Engine prefixes on lane folders are not required.
- The first-run terms text reports the served release version.
- The site's install page no longer lists an `eta:` key the parser ignores.

## 0.2.0

- First PyPI release of the `officefloor` launcher.
