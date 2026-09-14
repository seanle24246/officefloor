# Content recipes

This folder contains the reusable decomposition templates for the four content
archetypes in [CONTENT-PIPELINES.md](../docs/design/CONTENT-PIPELINES.md): THEME, ROOM,
ACTIVITY, and VENUE.

[SCHEMA.md](SCHEMA.md) defines the Markdown contract. Copy the matching
`*.recipe.md` template, replace its placeholders, and save it as
`<recipe_id>.recipe.md`. A recipe describes work to dispatch; it does not
generate, approve, assemble, or ship content.

The artifact table is the recipe's dependency graph. Each `dependsOn` value
must name an earlier artifact in the same table. The deterministic gates stay
attached to the artifact that they validate, while the final blessing gates
remain human-owned and unchecked.
