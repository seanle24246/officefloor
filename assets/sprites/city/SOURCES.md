# City sprite sources

The files in this directory are deterministic extractions of the local source
set at:

`shots/setting-mockups/real-free-assets/kenney-isometric-city/PNG/`

Source attribution: **Isometric City**, by Kenney Vleugels / Kenney
([kenney.nl](https://kenney.nl)).  The bundled
[`License.txt`](../../../shots/setting-mockups/real-free-assets/kenney-isometric-city/License.txt)
states that the source set is dedicated to **CC0 1.0 Universal**:
<https://creativecommons.org/publicdomain/zero/1.0/>.

## Reproduction

Run from the repository root:

```sh
python3 tools/sprite_cut.py
```

The dependency-free cutter accepts only non-interlaced 8-bit RGBA PNGs. It
sorts `cityTiles_*.png` by name; retains each original image in a padded,
fixed-cell `city-sprites.png` atlas; writes a transparent-boundary-trimmed PNG
for every source image in `frames/`; and records source SHA-256 values plus
source, trim, and atlas rectangles in `manifest.json`. No image content is
generated or redrawn by the cutter.
