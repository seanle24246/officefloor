# Agent integration guide

## Objective

Integrate the fixed executive-wing WebGL billboard and let a user configure its
text from the existing **Edit Office → select item → Options** interface.

The implementation was prepared against a worktree that had fetched
`origin/main` at `8c67601`. Do not blindly replace shared files on another
branch: port the focused changes described below and preserve concurrent work.

## Package layout

Billboard-owned code is isolated in `static/billboardIntegrations/`:

- `controller.js` builds, positions, updates, and disposes the WebGL assembly.
- `item-options.js` supplies the selected-item Options form.
- `item-options.css` styles that form.
- `README.md` documents the user flow and extension contract.

The ZIP also contains the shared files whose small integration hooks are needed:

- `static/office.webgl.scene.js`
- `static/office.webgl.pick.js`
- `static/office.webgl.edit.pick.leaf.js`
- `static/office.webgl.edit.selection.js`
- `static/office.webgl.edit.selection.css`
- `tests/test_gl_vault.py`
- `qa/tools/webgl_perf_budget_probe.mjs`

## Integration sequence

1. Copy `static/billboardIntegrations/` into the target repository.
2. In `static/office.webgl.scene.js`, import `createBillboardController`, create
   one controller with the WebGL scene, retain it on the runtime, pass each new
   scene spec to `setSceneSpec`, and call `dispose` during scene teardown.
3. In `static/office.webgl.pick.js`, include scene children marked with
   `userData.officeEditPickRoot === true` in edit-mode raycasting. Keep the
   normal runtime-content raycast intact.
4. In `static/office.webgl.edit.pick.leaf.js`, honor
   `officeEditMovable === false` and `officeEditRemovable === false` when
   creating an item payload. A fixed item must not enter move mode.
5. In `static/office.webgl.edit.selection.js`, fall back from runtime content to
   the runtime scene when resolving a selected object. If an object exposes
   `userData.officeItemOptions.mount`, mount it in the selected item's secondary
   Options area and run its returned cleanup function when selection changes.
6. In `static/office.webgl.edit.selection.css`, ensure a fixed custom item can
   hide the generic movement key hints with
   `.office-webgl-edit-actions-keys[hidden] { display: none; }`.
7. Update the WebGL vault inventory and CSS-asset expectations in
   `tests/test_gl_vault.py`; nested modules and their CSS must be present in the
   standalone module vault.
8. Account for the billboard's eight meshes in the pinned WebGL draw budget.

## Runtime contract

`controller.js` attaches these fields to the billboard group:

```js
group.userData.officeEditPickRoot = true;
group.userData.officeEditMovable = false;
group.userData.officeEditRemovable = false;
group.userData.officeItemOptions = {
  id: 'billboard-text',
  name: 'Company billboard',
  mount({ document, host, view }) { /* return optional cleanup */ },
};
```

Text is normalized, limited to 48 characters, painted into a `CanvasTexture`,
and stored under the browser-local key `office-billboard-text`. The default is
`YOUR OFFICE INC.`.
The optional `?billboard=...` query parameter overrides the saved value for previewing.

The billboard is intentionally fixed and aligned parallel to the executive and
conference-suite north wall. Do not add rotate, move, or remove controls unless
the product model changes.

## Verification

Run from the repository root:

```sh
node --check static/billboardIntegrations/controller.js
node --check static/billboardIntegrations/item-options.js
node qa/tools/webgl_edit_selection_probe.mjs
node qa/tools/webgl_edit_pick_leaf_probe.mjs
node qa/tools/webgl_edit_pick_interaction_probe.mjs
node qa/tools/webgl_edit_lifecycle_probe.mjs
node qa/tools/editmode_shell_probe.js
python3 -m unittest tests.test_gl_vault
python3 build_standalone.py --out /tmp/the-office-billboard.html
node qa/tools/webgl_perf_budget_probe.mjs
```

Then perform one browser check:

1. Open the app and enter **Edit Office**.
2. Select the billboard itself.
3. Confirm the selected object is titled **Company billboard**, with no move,
   rotate, or remove controls.
4. Open **Options**, enter a test label, and apply it.
5. Confirm the WebGL texture updates immediately.
6. Reload and confirm the saved label remains.
7. Use **Reset** and confirm `YOUR OFFICE INC.` returns.

At packaging time the performance probe passed at 779/779 draws, 777 meshes,
243 geometries, and 54,500 triangles.
