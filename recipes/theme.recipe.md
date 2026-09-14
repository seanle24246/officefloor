schema_version: 1
recipe_id: <lowercase-kebab-theme-id>
kind: THEME
source_request_id: <matching-theme-request-id>
status: draft

## Intent

Create a coherent theme candidate for <theme name>; this recipe only decomposes the work and does not approve cultural meaning, assets, or shipment.

## Inputs

- theme name: `<theme name>`
- rooms in scope: `<room IDs or pending>`
- palette/backdrop brief: `<brief or pending>`
- cultural reference review: `<not applicable or pending human review>`

## Artifacts

| artifact_id | description | path | tier | gate | dependsOn |
|---|---|---|---|---|---|
| palette-tint-ramp | Palette and tint ramp for the theme | `office.geom.js` mix/ramp and theme file | luna | golden colours | — |
| backdrop-sky | Backdrop, skyline, and sky treatment | `clock.js` sky and theme backdrop | luna/terra | render-resolve probe | palette-tint-ramp |
| room-reskins | Theme-specific room re-skins | room registry (`CHOREO-ENGINE §3`) | terra | room validator | palette-tint-ramp |
| props-furniture | Licensed or procedural themed prop and furniture art | AST pipeline and managed asset manifest | luna | manifest + licence + bake-clean | — |
| prop-draw-functions | Draw functions and prop descriptors for the themed props | `PROP_REGISTRY` descriptors | luna | render golden | props-furniture |
| avatar-skins-looks | Theme-appropriate avatar skins and looks | roster `look_for` and avatar registry | terra | avatar probe | palette-tint-ramp |
| theme-choreo | Theme-appropriate choreography descriptors | activity registry (`CHOREO-ENGINE §2`) | luna/terra | activity golden + per-type ruling | — |
| theme-assembly | Register descriptors and wire the theme manifest | theme file and `index.html` manifest | terra | theme loads + `/state` unchanged | palette-tint-ramp, backdrop-sky, room-reskins, prop-draw-functions, avatar-skins-looks, theme-choreo |

## Completion

- [ ] Every artifact has a named owner tier, path, deterministic gate, and valid dependencies.
- [ ] All asset artifacts carry provenance/licence evidence and pass the bake-clean gate.
- [ ] The assembled candidate loads and preserves `/state` byte-for-byte.
- [ ] All three Bless gates remain unchecked until their authorized human review.

## Bless gates

- [ ] Coherence and taste
- [ ] Cultural sensitivity (when applicable)
- [ ] Doctrine, licence, and provenance
