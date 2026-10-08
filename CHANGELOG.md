# Changelog

## 0.2.4 — 2026-10-08

- Idle agents play ping-pong: they walk to a placed table, wait for a partner,
  hold paddles and rally. Real work interrupts immediately.
- The default rec-room ping-pong table is now the owned table; demo and fresh
  offices start with it placed.
- Up to five idle activities run at once (was two); smokers face the camera;
  beer glasses are yellow with white foam.
- Edit Office: cars are scenery and can no longer be placed or selected.
- Saving and reloading honor stored or moved built-in furniture, so placing over
  a stored prop no longer fails and a reload no longer brings the prop back.
- `make_release.sh` runs on the public tree.

## 0.2.3 — 2026-10-08

- PyPI page now carries the full setup guide: lane folders and per-agent git clones,
  OUTBOX STATUS block, INBOX directives, roster/rooms, state legend, CLI and troubleshooting.

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
