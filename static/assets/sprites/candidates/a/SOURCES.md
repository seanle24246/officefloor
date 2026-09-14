# SPR-A procedural candidate provenance

All nine files in this directory are deterministic alpha-PNG captures of the
repository's own canvas painters. The capture used the landed `office.geom`,
`office.gfx`, `office.furniture`, and `office.props` stack on a transparent
160×160 offscreen canvas, fixed at `t = 0`, then cropped to the visible bounds
with three transparent pixels of padding. There is no downloaded art, raster
source, random input, clock input, or third-party art dependency.

`procedural-in-repo` means the source is this repository's code and palette.
Small named overlays adapt an existing painter to the bake-off noun without
introducing a second art system: they use the same canvas primitives and are
recorded in `manifest.json` under `params.overlay`. Tints are fixed source-atop
color washes, also recorded in the manifest.

| Candidate | Provenance | Landed painter source | Adaptation |
|---|---|---|---|
| NYC arcade cabinet | procedural-in-repo | `office.props.office.js` rack painter + `office.sku.pack.rec.js` arcade definition | fixed arcade face |
| NYC server rack | procedural-in-repo | `office.props.office.js` rack painter + `office.sku.pack.tech.js` server-rack definition | none |
| NYC floor plant | procedural-in-repo | `office.furniture.js` plant painter + `office.sku.pack.greenery.js` | none |
| NYC swivel chair | procedural-in-repo | `office.furniture.js` high-back chair + `office.sku.pack.seating.js` | fixed five-star base |
| NYC standing pedestal | procedural-in-repo | `office.props.naruto.js` standing dummy + `office.sku.pack.tech.js` stand family | fixed pedestal top |
| Tokyo low table | procedural-in-repo | `office.props.office.js` table painter / `office.furniture.js` low-table vocabulary | fixed wood tint |
| Tokyo standing paper lantern | procedural-in-repo | `office.props.naruto.js` chōchin lantern | fixed floor stand |
| Tokyo potted bamboo | procedural-in-repo | `office.furniture.js` plant painter + `office.sku.pack.greenery.js` bamboo family | fixed bamboo stems/leaves |
| Tokyo stool | procedural-in-repo | `office.props.naruto.js` stool + `office.sku.pack.seating.js` | none |

These are comparison candidates only. They are not registered as SKUs and do
not change any live catalog, renderer, manifest, or floor state.
