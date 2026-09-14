schema_version: 1
recipe_id: <lowercase-kebab-room-id>
kind: ROOM
source_request_id: <matching-room-request-id>
status: draft

## Intent

Create a room candidate for <room name>; this recipe describes the room contract and its read-side content work without committing placement or persisted state.

## Inputs

- room ID: `<lowercase-kebab-room-id>`
- room kind: `<kind or pending>`
- capacity: `<positive integer or pending>`
- allowed activities: `<activity IDs or pending>`
- state enum: `<states or pending>`

## Artifacts

| artifact_id | description | path | tier | gate | dependsOn |
|---|---|---|---|---|---|
| room-geometry | Room rectangle, spots, and walkable geometry | `floorplan.ROOMS` | luna | pytest | — |
| room-descriptor | Room ID, kind, capacity, allowed activities, and state enum | room registry | luna | room validator | room-geometry |
| room-state-truth | Truth-side room state block | office-state `rooms` block | luna | CH-P3 burn-in diff | room-descriptor |
| props-furniture | Props and furniture for the room | AST pipeline and `PROP_REGISTRY` | luna | manifest + render golden | room-geometry |
| room-choreo | Activity descriptors scoped to the room | activity registry | luna/terra | per-type ruling | room-descriptor |
| fixture-placement | Preview and authorized placement of fixtures | W0 placement path | senior | W0 ledger + preview | room-geometry, props-furniture |

## Completion

- [ ] Geometry, descriptor, and truth fields agree on room identity and bounds.
- [ ] Props resolve through the manifest and pass provenance/licence and render gates.
- [ ] Choreography is scoped to this room and has its required per-type ruling.
- [ ] Any placement write is held for the senior W0 path; this recipe does not authorize it.
- [ ] All three Bless gates remain unchecked until their authorized human review.

## Bless gates

- [ ] Coherence and taste
- [ ] Cultural sensitivity (when applicable)
- [ ] Doctrine, licence, and provenance
