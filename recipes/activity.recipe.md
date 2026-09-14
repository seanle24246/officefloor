schema_version: 1
recipe_id: <lowercase-kebab-activity-id>
kind: ACTIVITY
source_request_id: <matching-activity-request-id>
status: draft

## Intent

Create one activity candidate for <activity name> in <room scope>; the recipe requires a per-type ruling and leaves any optional art explicit.

## Inputs

- activity ID: `<lowercase-kebab-activity-id>`
- room scope: `<room IDs or pending>`
- activity type: `<type or pending>`
- per-type ruling: `<ruling ID or pending human/CEO decision>`
- optional props: `<none or prop IDs>`

## Artifacts

| artifact_id | description | path | tier | gate | dependsOn |
|---|---|---|---|---|---|
| activity-descriptor | Choreography descriptor, room scope, lifecycle, and per-type ruling reference | activity registry (`CHOREO-ENGINE §2`) | luna/terra | activity golden + per-type ruling | — |
| optional-props-furniture | Optional props or furniture required by the activity; remove this row when none are needed | AST pipeline and `PROP_REGISTRY` | luna | manifest + licence + render golden | activity-descriptor |
| activity-assembly | Register the descriptor and resolve any optional props | activity file and manifest | terra | activity loads + props resolve + `/state` unchanged | activity-descriptor, optional-props-furniture |

## Completion

- [ ] The activity descriptor has a concrete room scope and a recorded ruling, or is explicitly pending and blocked from dispatch.
- [ ] Optional props are either omitted or carry manifest, provenance/licence, and render evidence.
- [ ] The assembled candidate loads without changing `/state`.
- [ ] All three Bless gates remain unchecked until their authorized human review.

## Bless gates

- [ ] Coherence and taste
- [ ] Cultural sensitivity (when applicable)
- [ ] Doctrine, licence, and provenance
