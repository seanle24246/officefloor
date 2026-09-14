# Tokyo Office — source record

- Nature: AI-generated raster; founder's office-setting render.
- Source commit: [`d82fcb7` — Add CTO office render engine packets](../../../../.git) (source artifact is byte-identical to that commit).
- Canonical raster: `tokyo-office-empty-1610x977.png`
- SHA-256: `4c2ab2afce9ed13fdb0ebc90bdc13b6a7f52a643ca5fea67766cc7ea197ff1a7`
- Dimensions and grid: 1610×977; 32×32; tile 0 at screen `(805, 220)`.
- Related in-repo mockup: `shots/setting-mockups/tokyo-neon-tower.png`.
- Generation prompt: not recorded in-repo; AI-generated per founder direction 2026-08-10.
- Pixel-true revision: `qa/tools/tokyo_clean_probe.mjs` verifies that the approved mask removes the baked HUD, demo agents, bubbles, ticker, and legend while every pixel outside that mask remains unchanged.
- Ship note: the original demo composite and calibration grid remain authoring artifacts and never ship to the product tree.
