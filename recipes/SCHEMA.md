# Recipe schema

Schema version 1 is a Markdown decomposition contract. The first five lines of
every recipe are this exact ordered header block:

```text
schema_version: 1
recipe_id: <lowercase-kebab-id>
kind: THEME|ROOM|ACTIVITY|VENUE
source_request_id: <lowercase-kebab-id>
status: draft
```

`source_request_id` names the intake record that supplied the recipe. The
recipe kind must match that request's `kind`. A recipe is not valid without a
source request, even when the request is only a fixture.

The header is followed by these headings in order:

1. `## Intent` — one non-empty plain-language paragraph.
2. `## Inputs` — the parameters needed to fill the template. Keep unresolved
   choices explicit as `<placeholder>` or `pending`; do not turn a pending
   ruling into an approval.
3. `## Artifacts` — one Markdown table with this exact column order:

   ```markdown
   | artifact_id | description | path | tier | gate | dependsOn |
   |---|---|---|---|---|---|
   ```

   Every `artifact_id` is unique and lowercase-kebab. `path`, `tier`, and
   `gate` are non-empty. `tier` is one of `luna`, `terra`, `luna/terra`, or
   `senior`. Use `—` for an artifact with no dependencies; otherwise list
   comma-separated artifact IDs. Dependencies must refer to earlier rows and
   must not form a cycle.
4. `## Completion` — the deterministic handoff checks for the recipe.
5. `## Bless gates` — the three unchecked human gates below, in this order:

   ```markdown
   - [ ] Coherence and taste
   - [ ] Cultural sensitivity (when applicable)
   - [ ] Doctrine, licence, and provenance
   ```

The filename must equal `<recipe_id>.recipe.md`. `status: draft` records a
recipe ready for review; it does not authorize dispatch or a write. Later
stages may copy the contract and define their own status transitions, but a
recipe must never mark a human blessing gate as complete on its own.
