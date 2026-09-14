# First Ship WebGL 56 — asset inventory

Provenance: the portable source bundle `the-office-first-ship-webgl-56.zip`
(CEO drop, landed 2026-09-02, packet BURN-ASSETS). It froze the exact 56
placeable assets admitted to the first-ship showroom — 56 procedural WebGL
meshes, 0 sprites: 12 cars, 5 equipment items, 10 furniture items, 29 office
amenities, including the newly modeled Toilet (`sku-1306`) and Urinal
(`sku-1307`). The 333 gated generated definitions were deliberately excluded
from the bundle: they were never admitted first-ship assets and were not
verified as finished WebGL meshes.

Files here:

- `MANIFEST.csv` / `MANIFEST.json` — the frozen 56-asset inventory, verbatim
  from the bundle (sku, name, category, footprint, mesh family, painter ref).

The bundle's renderer-ready placeable catalog is NOT here: it is a runtime
asset, so it lives at `static/first-ship-webgl-catalog.json`. `server/http.py`
404s every `/data/*` path by design, so a showroom fetching across into `data/`
loads the page but renders zero assets. `qa/tools/first_ship_56_probe.mjs`
pins the served path.

What landed where:

- Mesh source modules `static/office.webgl.mesh.*.js` were already in the
  product and byte-identical to the bundle, except the lounge family: the
  bundle's newer `office.webgl.mesh.lounge.js` / `office.webgl.families.js`
  (adding the toilet and urinal) were ported in.
- Both new SKUs are minted by `static/office.sku.pack.lounge.js`, admitted in
  `data/standard-office-customization-catalog.json`, measured in
  `data/real_world_heights.json`, and priced by the standard deterministic
  priceRef rule like every other placeable.
- The showroom ships as the standalone dev route
  `static/first-ship-showroom.html` (same pattern as `lounge-showroom.html`,
  `outdoor-showroom.html`, `train-showroom.html`), wired to the production
  mesh registry via `office.item.thumbnails.js`. The bundle's portable
  `showroom.mesh.runtime.js` was NOT imported — it duplicates
  `static/office.webgl.registry.js` and exists only so the zip runs
  standalone.
- The bundle's `vendor/three.module.js` was byte-identical to the copy the
  product already ships at `static/vendor/three.module.js`; no second copy
  was added.

Gate: `qa/tools/first_ship_56_probe.mjs` asserts every one of the 56 SKUs is
admitted, family-mapped, and builds a real THREE mesh through the production
registry.
