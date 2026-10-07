# Authored Blender offices

Optional 3D office scenes for officefloor. They are evaluated Blender meshes, not image backgrounds. This repository ships
**TOKYO3d office**: 10 developer desks, 5 review desks and 1 CEO desk, plus its animated conveyor. Pick it from the theme
picker when the scene files below are present; the server only offers a key whose manifest and every chunk validate.

Each `scene.json` references hashed binary chunks no larger than 16 MiB. Concatenate chunks in listed order before
interpreting mesh offsets. Materials are simplified for real-time WebGL; Blender procedural textures, volumetrics and
offline Cycles lighting are not baked into this export. Dynamic Tokyo meshes are local to 66 separately sampled rigid roots.

Navigation comes from evaluated obstacle bounds, with 0.42 m agent clearance. Desks carry semantic zones, authored chair
centers and valid navigation approaches. Chair centers do not imply walkable cells. Tokyo excludes sealed room interiors.
Static furniture is authored and not independently placeable.

`provenance.json` records the source scene hash and per-chunk SHA-256 checksums. No Blender runtime is required by the
browser. The geometry (~110 MB) is excluded from the PyPI wheel/sdist; run from a source checkout to use it.
