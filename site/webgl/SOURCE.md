# site/webgl — verbatim copies of product WebGL modules

Copied byte-for-byte from `static/` so the marketing site can draw the real
avatar and furniture meshes on turntables without reaching outside `site/`.
Never edit here; re-copy from `static/` when the product changes.

- vendor/three.module.js
- office.webgl.primitives.js
- office.webgl.palette.js
- office.webgl.mesh.agent.js
- office.webgl.avatar.variants.js
- office.webgl.mesh.games.js

Site-only files:

- `fun.showcase.js` — the turntables.
- `office.webgl.mesh.npc.js` — the NPC-visitor figure builder. `figurePart` and
  the figure-plan branch of `buildVignetteFigure` are copied verbatim from
  `static/office.webgl.vig.surface.js`; that file cannot be copied whole because
  it imports the camera, overlay and scene runtime the live floor owns.
- `npc.figures.js` — the `figurePlan` each NPC bank in `static/` registers with
  `vig.avatars`, copied as data because the banks are `OFFICE.module` scripts
  that cannot load inside `site/`. Generated, not hand-written; regenerate when
  a bank changes. Sources:
  `office.npcvig.bank.{einstein,moosk,muckerberg,kimjongillest,santa,lincoln,denny}.js`
  and `office.vig.avatar.bump.js`.
