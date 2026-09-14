# Changelog

## Unreleased

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
