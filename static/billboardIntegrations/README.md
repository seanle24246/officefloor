# Billboard integration

This folder owns the executive-wing WebGL billboard and its item-specific editor UI.

## User flow

1. Open **Edit Office**.
2. Select the billboard behind the executive and conference-room walls.
3. Open the selected item's **Options** panel.
4. Enter up to 48 characters and choose **Apply text**.

The text is redrawn into the billboard's `CanvasTexture` immediately and saved in
the current browser with `localStorage`. **Reset** restores `YOUR OFFICE INC.`.

## Files

- `controller.js` builds and positions the WebGL billboard, manages its texture,
  exposes the text controller, and registers the item-options integration.
- `item-options.js` mounts the billboard form inside the generic selected-item
  Options host.
- `item-options.css` styles only the billboard's selected-item controls.

The generic extension point lives on an editable object's
`userData.officeItemOptions` property. Its `mount({ document, host, view })`
function may return a cleanup function. This keeps billboard-specific behavior
out of the shared edit-selection UI while allowing other special WebGL items to
add their own Options panels later.
