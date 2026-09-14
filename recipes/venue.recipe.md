schema_version: 1
recipe_id: <lowercase-kebab-venue-id>
kind: VENUE
source_request_id: <matching-venue-request-id>
status: draft

## Intent

Create a venue candidate by scoping a theme and its activity set to <room name>; this recipe does not expand the room boundary or approve the venue's meaning.

## Inputs

- venue ID: `<lowercase-kebab-venue-id>`
- room ID: `<existing room ID or pending>`
- theme brief: `<brief or pending>`
- activity set: `<activity IDs or pending>`
- cultural reference review: `<not applicable or pending human review>`

## Artifacts

| artifact_id | description | path | tier | gate | dependsOn |
|---|---|---|---|---|---|
| venue-descriptor | Venue identity and binding to one room | venue descriptor and room registry | terra | venue validator | — |
| palette-tint-ramp | Palette and tint ramp for the scoped venue | theme file and `office.geom.js` mix/ramp | luna | golden colours | venue-descriptor |
| backdrop-sky | Scoped backdrop, skyline, and sky treatment | `clock.js` sky and theme backdrop | luna/terra | render-resolve probe | palette-tint-ramp |
| room-reskin | Venue treatment for the bound room | room registry | terra | room validator | venue-descriptor, palette-tint-ramp |
| props-furniture | Licensed or procedural venue props and furniture | AST pipeline and managed asset manifest | luna | manifest + licence + bake-clean | venue-descriptor |
| prop-draw-functions | Draw functions and prop descriptors for venue art | `PROP_REGISTRY` descriptors | luna | render golden | props-furniture |
| venue-choreo | Activity descriptors scoped to the bound room and venue | activity registry | luna/terra | activity golden + per-type ruling | venue-descriptor |
| venue-assembly | Register the venue and wire its manifest | venue/theme file and `index.html` manifest | terra | venue loads + `/state` unchanged | venue-descriptor, backdrop-sky, room-reskin, prop-draw-functions, venue-choreo |

## Completion

- [ ] The venue remains scoped to exactly one room and references an existing or explicitly pending room ID.
- [ ] Palette, room treatment, props, and choreography resolve through their declared paths and gates.
- [ ] All asset artifacts carry provenance/licence evidence and pass the bake-clean gate.
- [ ] The assembled candidate loads and preserves `/state` byte-for-byte.
- [ ] All three Bless gates remain unchecked until their authorized human review.

## Bless gates

- [ ] Coherence and taste
- [ ] Cultural sensitivity (when applicable)
- [ ] Doctrine, licence, and provenance
