# Manhattan production scenery — source record

Fetched 2026-08-05 under the founder-approved asset intake ruling. Both inputs
are CC0-1.0 static scenery. Neither contains an Office agent, fleet status,
name, label, or interaction state.

| Shipped file | Upstream work and author | Exact fetched source | Source SHA-256 | Derived SHA-256 | Transform |
|---|---|---|---|---|---|
| `manhattan-skyline-cc0.png` (1610 × 977) | *Clouds over Lower Manhattan skyscrapers at night*, Alfred Twu ([licence record](https://commons.wikimedia.org/wiki/File:Clouds_over_Lower_Manhattan_skyscrapers_at_night.jpg)) | [1280 px Wikimedia preview](https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Clouds_over_Lower_Manhattan_skyscrapers_at_night.jpg/1280px-Clouds_over_Lower_Manhattan_skyscrapers_at_night.jpg) | `2226f2fe0bfeba3c5f4ac134b5f8706128d695aed8d3aeb51c67abb1594a4bf9` | `2543d913e2d70e6704cf503b3fcacdf285437b323609dbe322c4b19e6629a7f0` | ffmpeg crop to `1280 × 776`, Lanczos scale to `1610 × 977`, then a 32-colour PNG palette with Bayer dithering |
| `manhattan-oak-floor-cc0.png` (256 × 256) | *Wood Floor 006*, ambientCG ([licence/source record](https://ambientcg.com/view?id=WoodFloor006)) | [2048 px colour preview](https://f003.backblazeb2.com/file/ambientCG-Web/media/surface-preview/WoodFloor006/WoodFloor006_SQ_Color.jpg) | `467266816821d26036ad8facabeb5d940e574f930f72e3a35cbd0a1a1ed2b107` | `94ef440a39cddc9264434b7852d8c1c63a244b4b3bea1281ae16cd98ac8b753e` | `sips -Z 256`, then PNG encoding |

The old `manhattan-penthouse.png` demo plate was retired rather than layered
under these assets: it was not CC0/equivalent and contained painted people,
labels, status UI, and fleet-like speech bubbles. Live procedural avatars are
now the only people in the Manhattan scene.
