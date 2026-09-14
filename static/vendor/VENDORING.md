# Vendored client dependencies

The office client is **stdlib/dependency-free by doctrine** on the 2D shipping path.
The single sanctioned exception is the WebGL parallel renderer, which loads three.js
**only when the `webgl_floor` feature flag is ON** (dynamic `import()` from
`office.webgl.mount.js`). With the flag off, three.js is never fetched or parsed and
the 2D render is byte-identical.

## three.module.js

| field | value |
|-------|-------|
| library | [three.js](https://threejs.org/) |
| version | **r0.160.0** |
| source | `https://unpkg.com/three@0.160.0/build/three.module.js` |
| build | prebuilt ESM (`build/three.module.js`) — no local build step |
| sha256 | `76dea8151bc9352aef3528b4262e249b2604f62543828328db978d060d61a495` |
| license | MIT (Copyright 2010–2023 Three.js Authors) — header retained in the file |

### How to refresh
1. Download the pinned release artifact:
   `curl -fsSL https://unpkg.com/three@<VER>/build/three.module.js -o static/vendor/three.module.js`
2. Re-hash: `sha256sum static/vendor/three.module.js` and update the table above.
3. Update the version tag; note the change in RELEASE notes (WebGL path only).

Do **not** load this via a static `<script>` tag or a CDN URL — only via the
flag-gated dynamic import, so the 2D path stays dependency-free.

## GLTFLoader.js and BufferGeometryUtils.js

| field | value |
|-------|-------|
| library | [three.js GLTFLoader addon](https://threejs.org/docs/#examples/en/loaders/GLTFLoader) |
| version | **r0.160.0** |
| loader source | `https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js` |
| loader upstream sha256 | `d073b438e6a07e1359741dd5d6c76c953420cc0d4fd84eb1bdde94315540e6a3` |
| loader vendored sha256 | `1f9b02acfbf219a6ebb77f09e355500449a3ba9e6a77d87e0de72c0b9315ea4e` |
| utility source | `https://unpkg.com/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js` |
| utility upstream sha256 | `9be041e96308775d00e2695cc607645b9a9b64fd7c0e759dd8f7c00a8d92becb` |
| utility vendored sha256 | `3a6701d824adfe05dc28c09b6c1d64aeab9a183bc3b944d85f15f596e5c6c2b3` |
| local transform | bare `three` and addon-relative imports point at files in `static/vendor/`; code is otherwise unchanged |
| license | MIT (Copyright 2010–2023 Three.js Authors) |

`office.webgl.gltf.js` imports `GLTFLoader.js` dynamically during the already
flag-gated WebGL mount. The loader is never requested on the 2D path. Approved
CC0 binaries belong under `static/assets/kenney/`; the checked-in manifest is
deliberately empty until those file hashes are staged and reviewed, so this
commit performs no speculative GLB fetch.

### How to refresh
1. Download both pinned addon sources shown above.
2. Change only their bare/parent module specifiers to the local vendor paths.
3. Re-hash the upstream downloads and transformed files, then update this table.
4. Run the GLTF bridge probe and the full selftest before committing.
