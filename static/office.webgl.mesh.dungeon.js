/* office.webgl.mesh.dungeon.js — deterministic low-poly modular dungeon kit. */

const HALF_PI = Math.PI / 2;
const QUARTER_PI = Math.PI / 4;

function at(object, x = 0, y = 0, z = 0) {
  object.position.set(x, y, z);
  return object;
}

function turn(object, x = 0, y = 0, z = 0) {
  object.rotation.set(x, y, z);
  return object;
}

function box(ctx, w, d, h, material, x = 0, y = 0, z = 0) {
  return at(ctx.tileBox(w, d, h, material), x, y, z);
}

function rod(ctx, radius, length, material, x, y, z, rx = 0, ry = 0, rz = 0, sides = 6) {
  return at(turn(ctx.cylinder(radius * 0.82, radius, length, material, sides), rx, ry, rz), x, y, z);
}

function part(ctx, name, ...objects) {
  const root = ctx.group(...objects);
  root.name = 'dungeon-part:' + name;
  return root;
}

function model(w, d, heightUnits, parts) {
  return { footprint: { w, d }, heightUnits, parts };
}

function finish(ctx, spec, value) {
  const geometry = ctx.group(value.parts);
  geometry.name = 'dungeon-geometry:' + spec.kind;
  const root = ctx.group(
    ctx.contactShadow(value.footprint.w * 0.86, value.footprint.d * 0.86),
    geometry,
  );
  root.name = 'dungeon:' + spec.kind;
  root.userData.kind = spec.kind;
  root.userData.footprint = Object.freeze({ ...value.footprint });
  root.userData.heightUnits = value.heightUnits;
  root.userData.pivotLocal = Object.freeze({
    u: value.footprint.w / 2,
    v: value.footprint.d / 2,
    z: 0,
  });
  root.userData.placeable = true;
  root.userData.category = spec.category;
  return root;
}

function paletteFor(style = 'stone') {
  if (style === 'sandstone') {
    return {
      main: 'dungeon-sandstone',
      light: 'dungeon-sandstone-light',
      dark: 'dungeon-sandstone-dark',
      mortar: 'dungeon-mortar',
    };
  }
  return {
    main: 'dungeon-stone',
    light: 'dungeon-stone-light',
    dark: 'dungeon-stone-dark',
    mortar: 'dungeon-mortar',
  };
}

function catalogItem(kind, category, shape, options = {}) {
  return Object.freeze({
    kind,
    category,
    shape,
    options: Object.freeze({ ...options }),
  });
}

const CATALOG = Object.freeze([
  catalogItem('wall-straight-stone', 'masonry', 'wall', { layout: 'straight' }),
  catalogItem('wall-straight-stone-tall', 'masonry', 'wall', { layout: 'straight', tall: true }),
  catalogItem('wall-straight-stone-low', 'masonry', 'wall', { layout: 'straight', low: true }),
  catalogItem('wall-straight-stone-cracked', 'masonry', 'wall', { layout: 'straight', cracked: true }),
  catalogItem('wall-straight-stone-mossy', 'masonry', 'wall', { layout: 'straight', mossy: true }),
  catalogItem('wall-straight-sandstone', 'masonry', 'wall', { layout: 'straight', style: 'sandstone' }),
  catalogItem('wall-straight-sandstone-tall', 'masonry', 'wall', { layout: 'straight', style: 'sandstone', tall: true }),
  catalogItem('wall-corner-stone', 'masonry', 'wall', { layout: 'corner' }),
  catalogItem('wall-corner-stone-tall', 'masonry', 'wall', { layout: 'corner', tall: true }),
  catalogItem('wall-corner-stone-broken', 'masonry', 'wall', { layout: 'corner', broken: true }),
  catalogItem('wall-corner-sandstone', 'masonry', 'wall', { layout: 'corner', style: 'sandstone' }),
  catalogItem('wall-end-stone', 'masonry', 'wall', { layout: 'end' }),
  catalogItem('wall-end-stone-broken', 'masonry', 'wall', { layout: 'end', broken: true }),
  catalogItem('wall-t-stone', 'masonry', 'wall', { layout: 'tee' }),
  catalogItem('wall-cross-stone', 'masonry', 'wall', { layout: 'cross' }),
  catalogItem('wall-buttress-stone', 'masonry', 'wall', { layout: 'buttress' }),

  catalogItem('archway-stone', 'gateways', 'gateway', { form: 'arch' }),
  catalogItem('archway-stone-tall', 'gateways', 'gateway', { form: 'arch', tall: true }),
  catalogItem('archway-stone-cracked', 'gateways', 'gateway', { form: 'arch', cracked: true }),
  catalogItem('archway-stone-mossy', 'gateways', 'gateway', { form: 'arch', mossy: true }),
  catalogItem('archway-sandstone', 'gateways', 'gateway', { form: 'arch', style: 'sandstone' }),
  catalogItem('archway-rune', 'gateways', 'gateway', { form: 'arch', rune: true }),
  catalogItem('doorway-iron-door', 'gateways', 'gateway', { form: 'door', door: 'iron' }),
  catalogItem('doorway-wooden-door', 'gateways', 'gateway', { form: 'door', door: 'wood' }),
  catalogItem('gate-wooden', 'gateways', 'gateway', { form: 'gate', door: 'wood' }),
  catalogItem('gate-iron', 'gateways', 'gateway', { form: 'gate', door: 'iron' }),
  catalogItem('portcullis-iron', 'gateways', 'gateway', { form: 'portcullis' }),
  catalogItem('portcullis-rust-raised', 'gateways', 'gateway', { form: 'portcullis', rust: true, raised: true }),

  catalogItem('column-round-stone', 'columns', 'column', { form: 'round' }),
  catalogItem('column-round-stone-fluted', 'columns', 'column', { form: 'round', fluted: true }),
  catalogItem('column-round-stone-broken-high', 'columns', 'column', { form: 'round', broken: 'high' }),
  catalogItem('column-round-stone-broken-low', 'columns', 'column', { form: 'round', broken: 'low' }),
  catalogItem('column-round-sandstone', 'columns', 'column', { form: 'round', style: 'sandstone' }),
  catalogItem('column-round-sandstone-broken', 'columns', 'column', { form: 'round', style: 'sandstone', broken: 'high' }),
  catalogItem('column-square-stone', 'columns', 'column', { form: 'square' }),
  catalogItem('column-square-stone-cracked', 'columns', 'column', { form: 'square', cracked: true }),
  catalogItem('pillar-rune', 'columns', 'column', { form: 'square', rune: true }),
  catalogItem('pillar-skull', 'columns', 'column', { form: 'square', skull: true }),

  catalogItem('statue-horse-rearing-stone', 'statues', 'statue', { subject: 'horse' }),
  catalogItem('statue-horse-rearing-sandstone', 'statues', 'statue', { subject: 'horse', style: 'sandstone' }),
  catalogItem('statue-horse-rearing-broken', 'statues', 'statue', { subject: 'horse', broken: true }),
  catalogItem('statue-knight-stone', 'statues', 'statue', { subject: 'knight' }),
  catalogItem('statue-knight-broken', 'statues', 'statue', { subject: 'knight', broken: true }),
  catalogItem('statue-gargoyle', 'statues', 'statue', { subject: 'gargoyle' }),
  catalogItem('statue-serpent', 'statues', 'statue', { subject: 'serpent' }),
  catalogItem('statue-hooded', 'statues', 'statue', { subject: 'hooded' }),

  catalogItem('brazier-iron', 'fire', 'fire', { form: 'brazier' }),
  catalogItem('brazier-rust', 'fire', 'fire', { form: 'brazier', rust: true }),
  catalogItem('brazier-stone', 'fire', 'fire', { form: 'brazier', stone: true }),
  catalogItem('brazier-sandstone', 'fire', 'fire', { form: 'brazier', stone: true, style: 'sandstone' }),
  catalogItem('brazier-tall', 'fire', 'fire', { form: 'brazier', tall: true }),
  catalogItem('brazier-hanging', 'fire', 'fire', { form: 'brazier', hanging: true }),
  catalogItem('fire-pit-stone', 'fire', 'fire', { form: 'pit' }),
  catalogItem('fire-pit-sandstone', 'fire', 'fire', { form: 'pit', style: 'sandstone' }),
  catalogItem('fire-pit-embers', 'fire', 'fire', { form: 'pit', embers: true }),
  catalogItem('torch-floor-iron', 'fire', 'fire', { form: 'floor-torch' }),
  catalogItem('wall-torch-single', 'fire', 'fire', { form: 'wall-torch' }),
  catalogItem('wall-torch-double', 'fire', 'fire', { form: 'wall-torch', double: true }),

  catalogItem('crate-small', 'storage', 'storage', { form: 'crate', size: 'small' }),
  catalogItem('crate-large', 'storage', 'storage', { form: 'crate', size: 'large' }),
  catalogItem('crate-reinforced', 'storage', 'storage', { form: 'crate', reinforced: true }),
  catalogItem('crate-open', 'storage', 'storage', { form: 'crate', open: true }),
  catalogItem('crate-stack', 'storage', 'storage', { form: 'crate-stack' }),
  catalogItem('barrel-wood', 'storage', 'storage', { form: 'barrel' }),
  catalogItem('barrel-iron-banded', 'storage', 'storage', { form: 'barrel', reinforced: true }),
  catalogItem('barrel-stack', 'storage', 'storage', { form: 'barrel-stack' }),
  catalogItem('chest-wood', 'storage', 'storage', { form: 'chest' }),
  catalogItem('chest-iron', 'storage', 'storage', { form: 'chest', iron: true }),
  catalogItem('chest-treasure', 'storage', 'storage', { form: 'chest', treasure: true }),
  catalogItem('chest-open', 'storage', 'storage', { form: 'chest', open: true }),

  catalogItem('banner-red-short', 'decor', 'decor', { form: 'banner', length: 'short' }),
  catalogItem('banner-red-long', 'decor', 'decor', { form: 'banner', length: 'long' }),
  catalogItem('banner-red-torn', 'decor', 'decor', { form: 'banner', torn: true }),
  catalogItem('banner-red-split', 'decor', 'decor', { form: 'banner', split: true }),
  catalogItem('banner-rune', 'decor', 'decor', { form: 'banner', rune: true }),
  catalogItem('cobweb-corner-small', 'decor', 'decor', { form: 'web', size: 'small' }),
  catalogItem('cobweb-corner-large', 'decor', 'decor', { form: 'web', size: 'large' }),
  catalogItem('cobweb-wall', 'decor', 'decor', { form: 'web', wall: true }),
  catalogItem('chain-hanging-single', 'decor', 'decor', { form: 'chain' }),
  catalogItem('chain-hanging-double', 'decor', 'decor', { form: 'chain', double: true }),

  catalogItem('floor-tile-stone', 'floors-traversal', 'floor', { form: 'tile' }),
  catalogItem('floor-tile-cracked', 'floors-traversal', 'floor', { form: 'tile', cracked: true }),
  catalogItem('floor-tile-broken', 'floors-traversal', 'floor', { form: 'tile', broken: true }),
  catalogItem('floor-tile-mossy', 'floors-traversal', 'floor', { form: 'tile', mossy: true }),
  catalogItem('floor-tile-sandstone', 'floors-traversal', 'floor', { form: 'tile', style: 'sandstone' }),
  catalogItem('floor-tile-sandstone-cracked', 'floors-traversal', 'floor', { form: 'tile', style: 'sandstone', cracked: true }),
  catalogItem('floor-tile-rune', 'floors-traversal', 'floor', { form: 'tile', rune: true }),
  catalogItem('floor-tile-blood', 'floors-traversal', 'floor', { form: 'tile', blood: true }),
  catalogItem('stairs-stone-short', 'floors-traversal', 'floor', { form: 'stairs', count: 3 }),
  catalogItem('stairs-stone-tall', 'floors-traversal', 'floor', { form: 'stairs', count: 6 }),
  catalogItem('stairs-sandstone', 'floors-traversal', 'floor', { form: 'stairs', count: 4, style: 'sandstone' }),
  catalogItem('stairs-broken', 'floors-traversal', 'floor', { form: 'stairs', count: 4, broken: true }),
  catalogItem('bridge-wood-short', 'floors-traversal', 'floor', { form: 'bridge', length: 3 }),
  catalogItem('bridge-wood-long', 'floors-traversal', 'floor', { form: 'bridge', length: 4.4 }),
  catalogItem('bridge-wood-broken', 'floors-traversal', 'floor', { form: 'bridge', length: 4, broken: true }),
  catalogItem('platform-wood', 'floors-traversal', 'floor', { form: 'platform' }),

  catalogItem('sarcophagus-stone', 'ritual-funerary', 'ritual', { form: 'sarcophagus' }),
  catalogItem('sarcophagus-sandstone', 'ritual-funerary', 'ritual', { form: 'sarcophagus', style: 'sandstone' }),
  catalogItem('sarcophagus-open', 'ritual-funerary', 'ritual', { form: 'sarcophagus', open: true }),
  catalogItem('sarcophagus-broken', 'ritual-funerary', 'ritual', { form: 'sarcophagus', broken: true }),
  catalogItem('sarcophagus-rune', 'ritual-funerary', 'ritual', { form: 'sarcophagus', rune: true }),
  catalogItem('altar-stone', 'ritual-funerary', 'ritual', { form: 'altar' }),
  catalogItem('altar-sandstone', 'ritual-funerary', 'ritual', { form: 'altar', style: 'sandstone' }),
  catalogItem('altar-blood', 'ritual-funerary', 'ritual', { form: 'altar', blood: true }),
  catalogItem('altar-rune', 'ritual-funerary', 'ritual', { form: 'altar', rune: true }),
  catalogItem('ritual-circle', 'ritual-funerary', 'ritual', { form: 'circle' }),

  catalogItem('cage-small', 'prison', 'prison', { form: 'cage', size: 'small' }),
  catalogItem('cage-tall', 'prison', 'prison', { form: 'cage', size: 'tall' }),
  catalogItem('cage-hanging', 'prison', 'prison', { form: 'cage', hanging: true }),
  catalogItem('cage-broken', 'prison', 'prison', { form: 'cage', broken: true }),
  catalogItem('jail-bars-straight', 'prison', 'prison', { form: 'bars' }),
  catalogItem('jail-bars-corner', 'prison', 'prison', { form: 'bars', corner: true }),
  catalogItem('jail-door', 'prison', 'prison', { form: 'bars', door: true }),
  catalogItem('manacle-wall', 'prison', 'prison', { form: 'manacle' }),

  catalogItem('rubble-stone-small', 'remains', 'remains', { form: 'rubble', size: 'small' }),
  catalogItem('rubble-stone-large', 'remains', 'remains', { form: 'rubble', size: 'large' }),
  catalogItem('rubble-sandstone', 'remains', 'remains', { form: 'rubble', style: 'sandstone' }),
  catalogItem('skull-single', 'remains', 'remains', { form: 'skull' }),
  catalogItem('skull-pile', 'remains', 'remains', { form: 'skull', pile: true }),
  catalogItem('bones-scattered', 'remains', 'remains', { form: 'bones' }),
  catalogItem('skeleton-partial', 'remains', 'remains', { form: 'skeleton' }),
  catalogItem('bone-pile', 'remains', 'remains', { form: 'bones', pile: true }),
  catalogItem('tomb-slab', 'remains', 'remains', { form: 'tomb' }),

  catalogItem('trapdoor-closed', 'traps', 'trap', { form: 'trapdoor' }),
  catalogItem('trapdoor-open', 'traps', 'trap', { form: 'trapdoor', open: true }),
  catalogItem('floor-grate', 'traps', 'trap', { form: 'grate' }),
  catalogItem('spike-trap-floor', 'traps', 'trap', { form: 'spikes' }),
  catalogItem('spike-trap-wall', 'traps', 'trap', { form: 'spikes', wall: true }),
  catalogItem('pressure-plate', 'traps', 'trap', { form: 'pressure' }),
  catalogItem('dart-trap-wall', 'traps', 'trap', { form: 'dart' }),
  catalogItem('blade-trap', 'traps', 'trap', { form: 'blade' }),
  catalogItem('flame-jet-trap', 'traps', 'trap', { form: 'flame' }),
]);

function masonryHeight(options) {
  const rows = options.low ? 3 : options.tall ? 7 : 5;
  return rows * 0.41 + 0.12;
}

function masonryRun(ctx, length, options = {}) {
  const colors = paletteFor(options.style);
  const rows = options.low ? 3 : options.tall ? 7 : 5;
  const height = masonryHeight(options);
  const pieces = [];
  const coreHeight = options.broken ? Math.min(height, 1.30) : height - 0.05;
  pieces.push(box(ctx, length - 0.06, 0.34, coreHeight, colors.mortar, 0, 0.02, 0));

  for (let row = 0; row < rows; row += 1) {
    const columns = row % 2 === 0 ? 6 : 5;
    const cell = length / columns;
    for (let column = 0; column < columns; column += 1) {
      const brokenAway = options.broken && (
        (row === rows - 1 && (column < 2 || column === columns - 1))
        || (row === rows - 2 && column === 0)
      );
      if (brokenAway) continue;
      const material = (row + column) % 5 === 0
        ? colors.light
        : (row * 3 + column) % 7 === 0 ? colors.dark : colors.main;
      const width = cell - 0.045;
      const x = -length / 2 + cell * (column + 0.5);
      const z = (((row * 11 + column * 7) % 3) - 1) * 0.012;
      pieces.push(box(ctx, width, 0.43, 0.34, material, x, 0.08 + row * 0.41, z));
    }
  }

  if (!options.broken) {
    pieces.push(box(ctx, length + 0.06, 0.50, 0.12, colors.light, 0, height - 0.04, 0));
  } else {
    pieces.push(
      turn(box(ctx, 0.42, 0.48, 0.20, colors.light, -length * 0.34, 0.10, 0), 0, 0, 0.18),
      turn(box(ctx, 0.34, 0.42, 0.16, colors.dark, -length * 0.16, 0.10, 0.26), 0, 0.3, -0.12),
    );
  }

  if (options.cracked) {
    pieces.push(
      at(turn(ctx.strip(0.045, 0.025, 0.62, colors.dark), 0, 0, 0.48), -0.54, 0.82, 0.225),
      at(turn(ctx.strip(0.035, 0.025, 0.48, colors.dark), 0, 0, -0.62), 0.48, 1.28, 0.225),
      box(ctx, 0.52, 0.025, 0.035, colors.dark, 0.15, 1.44, 0.225),
    );
  }

  if (options.mossy) {
    pieces.push(
      box(ctx, length * 0.42, 0.045, 0.13, 'dungeon-moss', -length * 0.20, 0.10, 0.238),
      box(ctx, length * 0.22, 0.045, 0.08, 'dungeon-moss', length * 0.32, 0.48, 0.238),
      box(ctx, 0.24, 0.045, 0.32, 'dungeon-moss', -length * 0.42, 0.12, 0.238),
    );
  }

  return part(ctx, 'masonry run', pieces);
}

function buildWall(spec, ctx) {
  const options = spec.options;
  const height = masonryHeight(options);
  const pieces = [];
  let footprint = { w: 4.2, d: 0.72 };

  if (options.layout === 'straight') {
    pieces.push(masonryRun(ctx, 4.0, options));
  } else if (options.layout === 'corner') {
    pieces.push(
      at(masonryRun(ctx, 3.40, options), 0, 0, -1.45),
      at(turn(masonryRun(ctx, 3.40, options), 0, HALF_PI, 0), -1.45, 0, 0),
      box(ctx, 0.66, 0.66, height + 0.14, paletteFor(options.style).dark, -1.45, 0, -1.45),
    );
    footprint = { w: 3.6, d: 3.6 };
  } else if (options.layout === 'end') {
    pieces.push(
      masonryRun(ctx, 2.35, options),
      box(ctx, 0.68, 0.76, height + 0.18, paletteFor(options.style).dark, -1.02, 0, 0),
      box(ctx, 0.86, 0.92, 0.18, paletteFor(options.style).light, -1.02, 0, 0),
    );
    footprint = { w: 2.7, d: 1.02 };
  } else if (options.layout === 'tee') {
    pieces.push(
      at(masonryRun(ctx, 4.05, options), 0, 0, -1.42),
      at(turn(masonryRun(ctx, 3.25, options), 0, HALF_PI, 0), 0, 0, 0),
    );
    footprint = { w: 4.3, d: 3.6 };
  } else if (options.layout === 'cross') {
    pieces.push(
      masonryRun(ctx, 4.05, options),
      turn(masonryRun(ctx, 3.25, options), 0, HALF_PI, 0),
      box(ctx, 0.66, 0.66, height + 0.12, paletteFor(options.style).dark),
    );
    footprint = { w: 4.3, d: 3.6 };
  } else {
    const colors = paletteFor(options.style);
    pieces.push(
      masonryRun(ctx, 3.55, options),
      box(ctx, 0.62, 1.12, height * 0.88, colors.dark, -1.25, 0, 0.34),
      box(ctx, 0.82, 1.35, 0.20, colors.light, -1.25, 0, 0.34),
      at(turn(ctx.wedge(0.82, 1.10, 0.78, colors.main), 0, 0, 0), 1.24, 0, 0.34),
    );
    footprint = { w: 3.9, d: 1.7 };
  }

  return model(footprint.w, footprint.d, height + 0.18, [
    part(ctx, options.layout + ' wall', pieces),
  ]);
}

function brickPier(ctx, x, height, colors) {
  const blocks = [];
  const rows = Math.max(4, Math.round(height / 0.42));
  for (let row = 0; row < rows; row += 1) {
    const width = row % 2 === 0 ? 0.68 : 0.76;
    blocks.push(box(
      ctx,
      width,
      0.66,
      0.36,
      row % 3 === 0 ? colors.light : colors.main,
      x,
      row * 0.41,
      0,
    ));
  }
  blocks.push(box(ctx, 0.86, 0.76, 0.16, colors.dark, x, height - 0.04, 0));
  return part(ctx, 'gateway pier', blocks);
}

function archFrame(ctx, options = {}) {
  const colors = paletteFor(options.style);
  const tall = options.tall === true;
  const outerWidth = tall ? 3.45 : 3.25;
  const opening = tall ? 1.72 : 1.62;
  const pierX = (opening + 0.68) / 2;
  const spring = tall ? 2.48 : 2.12;
  const top = tall ? 3.42 : 3.03;
  const pieces = [
    brickPier(ctx, -pierX, spring, colors),
    brickPier(ctx, pierX, spring, colors),
    box(ctx, outerWidth, 0.70, 0.44, colors.dark, 0, spring + 0.28, 0),
    box(ctx, outerWidth - 0.24, 0.74, 0.34, colors.main, 0, spring + 0.71, 0),
    at(turn(ctx.wedge(0.44, 0.74, 0.54, colors.light), 0, 0, -0.62), -0.79, spring + 0.15, 0),
    at(turn(ctx.wedge(0.44, 0.74, 0.54, colors.light), 0, Math.PI, 0.62), 0.79, spring + 0.15, 0),
    at(turn(ctx.wedge(0.44, 0.78, 0.58, colors.light), 0, 0, 0), 0, spring + 0.48, 0),
    box(ctx, outerWidth + 0.12, 0.78, 0.13, colors.light, 0, top - 0.10, 0),
  ];

  if (options.cracked) {
    pieces.push(
      at(turn(ctx.strip(0.04, 0.025, 0.72, colors.dark), 0, 0, 0.50), -pierX, 0.88, 0.345),
      at(turn(ctx.strip(0.04, 0.025, 0.52, colors.dark), 0, 0, -0.42), 0.36, spring + 0.48, 0.395),
    );
  }
  if (options.mossy) {
    pieces.push(
      box(ctx, 0.55, 0.04, 0.18, 'dungeon-moss', -pierX, 0.08, 0.355),
      box(ctx, 0.70, 0.04, 0.12, 'dungeon-moss', 0.84, spring + 0.31, 0.355),
    );
  }
  if (options.rune) {
    const runeMat = ctx.screenMat('dungeon-rune');
    pieces.push(
      box(ctx, 0.10, 0.025, 0.46, runeMat, 0, spring + 0.48, 0.405),
      box(ctx, 0.38, 0.025, 0.08, runeMat, 0, spring + 0.66, 0.405),
      at(turn(ctx.strip(0.06, 0.025, 0.28, runeMat), 0, 0, 0.65), 0.14, spring + 0.42, 0.405),
    );
  }
  return { pieces, outerWidth, opening, spring, top };
}

function woodenDoor(ctx, width, height, gate = false) {
  const slats = [];
  const count = gate ? 7 : 6;
  const slatWidth = width / count - 0.035;
  for (let index = 0; index < count; index += 1) {
    const x = -width / 2 + width * (index + 0.5) / count;
    slats.push(box(ctx, slatWidth, 0.13, height, index % 2 ? 'wood' : 'wood-light', x, 0, 0.05));
  }
  slats.push(
    box(ctx, width + 0.08, 0.10, 0.15, 'wood-dark', 0, 0.36, 0.14),
    box(ctx, width + 0.08, 0.10, 0.15, 'wood-dark', 0, height - 0.48, 0.14),
    at(turn(ctx.strip(0.14, 0.10, height * 0.92, 'wood-dark'), 0, 0, -0.58), 0, 0.10, 0.14),
    at(ctx.cylinder(0.07, 0.09, 0.09, 'brass', 8), width * 0.30, height * 0.48, 0.22),
  );
  return part(ctx, gate ? 'wooden gate' : 'wooden door', slats);
}

function ironDoor(ctx, width, height, gate = false) {
  const pieces = [
    box(ctx, width, 0.14, height, 'dungeon-iron-dark', 0, 0, 0.03),
    box(ctx, width - 0.18, 0.04, height - 0.20, 'dungeon-iron', 0, 0.10, 0.13),
  ];
  const columns = gate ? 5 : 4;
  for (let index = 0; index < columns; index += 1) {
    const x = -width * 0.38 + width * 0.76 * index / Math.max(1, columns - 1);
    pieces.push(box(ctx, 0.10, 0.06, height - 0.12, 'dungeon-iron-light', x, 0.06, 0.17));
  }
  pieces.push(
    box(ctx, width + 0.08, 0.09, 0.14, 'dungeon-iron-light', 0, height * 0.34, 0.17),
    box(ctx, width + 0.08, 0.09, 0.14, 'dungeon-iron-light', 0, height * 0.69, 0.17),
    at(ctx.cylinder(0.07, 0.09, 0.08, 'brass', 8), width * 0.28, height * 0.48, 0.22),
  );
  return part(ctx, gate ? 'iron gate' : 'iron door', pieces);
}

function buildGateway(spec, ctx) {
  const options = spec.options;
  const frame = archFrame(ctx, options);
  const pieces = [...frame.pieces];

  if (options.form === 'door') {
    pieces.push(options.door === 'wood'
      ? at(woodenDoor(ctx, frame.opening - 0.12, frame.spring - 0.06), 0, 0.06, 0)
      : at(ironDoor(ctx, frame.opening - 0.12, frame.spring - 0.06), 0, 0.06, 0));
  } else if (options.form === 'gate') {
    const gateWidth = 2.12;
    pieces.push(
      options.door === 'wood'
        ? at(woodenDoor(ctx, gateWidth, 2.12, true), 0, 0.06, 0)
        : at(ironDoor(ctx, gateWidth, 2.12, true), 0, 0.06, 0),
      box(ctx, 0.16, 0.84, 2.56, 'dungeon-iron-dark', -1.34, 0, 0),
      box(ctx, 0.16, 0.84, 2.56, 'dungeon-iron-dark', 1.34, 0, 0),
    );
  } else if (options.form === 'portcullis') {
    const metal = options.rust ? 'dungeon-rust' : 'dungeon-iron';
    const baseY = options.raised ? 1.08 : 0.18;
    const barHeight = options.raised ? 1.48 : 2.18;
    for (let index = 0; index < 7; index += 1) {
      const x = -0.72 + index * 0.24;
      pieces.push(
        box(ctx, 0.065, 0.12, barHeight, metal, x, baseY, 0.05),
        at(turn(ctx.wedge(0.13, 0.15, 0.24, metal), 0, 0, Math.PI), x, baseY + 0.06, 0.05),
      );
    }
    pieces.push(
      box(ctx, 1.62, 0.15, 0.09, 'dungeon-iron-light', 0, baseY + barHeight * 0.35, 0.05),
      box(ctx, 1.62, 0.15, 0.09, 'dungeon-iron-light', 0, baseY + barHeight * 0.72, 0.05),
      box(ctx, 1.92, 0.18, 0.18, 'dungeon-iron-dark', 0, frame.spring + 0.04, 0.02),
    );
  }

  const width = options.form === 'gate' ? 3.85 : frame.outerWidth + 0.22;
  return model(width, 1.02, frame.top + 0.06, [
    part(ctx, options.form + ' gateway', pieces),
  ]);
}

function skullShape(ctx, material, x = 0, y = 0, z = 0, scale = 1) {
  const cranium = ctx.cylinder(0.22 * scale, 0.27 * scale, 0.34 * scale, material, 8);
  const jaw = ctx.wedge(0.30 * scale, 0.24 * scale, 0.20 * scale, material);
  return at(part(ctx, 'carved skull',
    cranium,
    at(jaw, 0, 0.05 * scale, 0.12 * scale),
    box(ctx, 0.075 * scale, 0.035 * scale, 0.075 * scale, 'graphite-dark', -0.085 * scale, 0.20 * scale, 0.25 * scale),
    box(ctx, 0.075 * scale, 0.035 * scale, 0.075 * scale, 'graphite-dark', 0.085 * scale, 0.20 * scale, 0.25 * scale),
    box(ctx, 0.055 * scale, 0.035 * scale, 0.06 * scale, 'graphite-dark', 0, 0.11 * scale, 0.28 * scale),
  ), x, y, z);
}

function buildColumn(spec, ctx) {
  const options = spec.options;
  const colors = paletteFor(options.style);
  const fullHeight = 3.18;
  const height = options.broken === 'low' ? 1.08 : options.broken ? 2.08 : fullHeight;
  const pieces = [
    box(ctx, 1.12, 1.12, 0.18, colors.dark),
    box(ctx, 0.92, 0.92, 0.18, colors.light, 0, 0.18, 0),
  ];

  if (options.form === 'round') {
    pieces.push(
      at(ctx.cylinder(0.38, 0.46, Math.max(0.42, height - 0.60), colors.main, 10), 0, 0.36, 0),
      at(ctx.cylinder(0.54, 0.42, 0.22, colors.light, 10), 0, Math.max(0.58, height - 0.24), 0),
    );
    if (options.fluted) {
      for (let index = 0; index < 8; index += 1) {
        const angle = index * Math.PI / 4;
        pieces.push(box(
          ctx,
          0.08,
          0.08,
          height - 0.72,
          index % 2 ? colors.light : colors.dark,
          Math.cos(angle) * 0.40,
          0.42,
          Math.sin(angle) * 0.40,
        ));
      }
    }
  } else {
    pieces.push(
      box(ctx, 0.68, 0.68, Math.max(0.38, height - 0.62), colors.main, 0, 0.36, 0),
      box(ctx, 0.92, 0.92, 0.20, colors.light, 0, Math.max(0.56, height - 0.25), 0),
      box(ctx, 0.78, 0.78, 0.14, colors.dark, 0, Math.max(0.75, height - 0.06), 0),
    );
  }

  if (options.broken) {
    pieces.push(
      at(turn(ctx.wedge(0.46, 0.46, 0.34, colors.dark), 0, 0.42, 0), -0.16, height - 0.16, 0.04),
      turn(box(ctx, 0.40, 0.32, 0.25, colors.main, 0.48, 0.12, 0.30), 0.12, 0.35, 0.28),
      turn(box(ctx, 0.30, 0.42, 0.20, colors.light, -0.40, 0.12, -0.26), -0.18, 0.12, -0.30),
    );
  }
  if (options.cracked) {
    pieces.push(
      at(turn(ctx.strip(0.045, 0.025, 0.66, colors.dark), 0, 0, 0.48), -0.12, 1.02, 0.355),
      at(turn(ctx.strip(0.04, 0.025, 0.46, colors.dark), 0, 0, -0.64), 0.16, 1.76, 0.355),
    );
  }
  if (options.rune) {
    const rune = ctx.screenMat('dungeon-rune');
    pieces.push(
      box(ctx, 0.09, 0.025, 0.74, rune, 0, 1.18, 0.355),
      box(ctx, 0.48, 0.025, 0.09, rune, 0, 1.48, 0.355),
      at(turn(ctx.strip(0.07, 0.025, 0.34, rune), 0, 0, 0.72), 0.14, 1.25, 0.355),
    );
  }
  if (options.skull) {
    pieces.push(
      skullShape(ctx, 'dungeon-bone', 0, 1.46, 0.48, 1.12),
      box(ctx, 0.12, 0.12, 0.66, 'dungeon-bone-dark', 0, 0.84, 0.41),
    );
  }

  return model(1.35, 1.35, height + 0.12, [
    part(ctx, options.form + ' column', pieces),
  ]);
}

function pedestal(ctx, colors, width = 1.54, depth = 1.38) {
  return part(ctx, 'statue pedestal',
    box(ctx, width, depth, 0.20, colors.dark),
    box(ctx, width - 0.18, depth - 0.18, 0.22, colors.main, 0, 0.20, 0),
    box(ctx, width + 0.08, depth + 0.08, 0.13, colors.light, 0, 0.42, 0));
}

function horseStatue(ctx, options) {
  const colors = paletteFor(options.style);
  const pieces = [pedestal(ctx, colors, 1.72, 1.52)];
  pieces.push(
    rod(ctx, 0.13, 1.08, colors.dark, -0.25, 0.48, -0.30, -0.20, 0, -0.08, 7),
    rod(ctx, 0.13, 1.02, colors.main, 0.25, 0.48, -0.28, -0.28, 0, 0.08, 7),
    at(turn(ctx.tileBox(0.72, 1.08, 0.62, colors.main), -0.14, 0, 0), 0, 1.32, 0.03),
    at(turn(ctx.wedge(0.74, 0.74, 0.36, colors.light), Math.PI, 0, 0), 0, 1.69, -0.18),
    rod(ctx, 0.20, 0.92, colors.main, 0, 1.64, 0.35, 0.54, 0, 0, 8),
    at(turn(ctx.tileBox(0.48, 0.60, 0.42, colors.main), -0.16, 0, 0), 0, 2.25, 0.74),
    box(ctx, 0.37, 0.38, 0.25, colors.light, 0, 2.26, 1.05),
    box(ctx, 0.42, 0.13, 0.12, colors.dark, 0, 2.33, 1.25),
    at(turn(ctx.wedge(0.12, 0.18, 0.28, colors.dark), 0.10, 0, 0), -0.15, 2.61, 0.79),
    at(turn(ctx.wedge(0.12, 0.18, 0.28, colors.dark), 0.10, 0, 0), 0.15, 2.61, 0.79),
    box(ctx, 0.07, 0.035, 0.07, 'graphite-dark', -0.14, 2.43, 1.04),
    box(ctx, 0.07, 0.035, 0.07, 'graphite-dark', 0.14, 2.43, 1.04),
    rod(ctx, 0.095, 0.82, colors.light, -0.29, 1.57, 0.38, 1.02, 0, -0.10, 7),
    rod(ctx, 0.095, 0.76, colors.main, 0.29, 1.58, 0.37, 0.88, 0, 0.10, 7),
    rod(ctx, 0.09, 0.58, colors.dark, 0, 1.48, -0.52, -1.00, 0, 0, 7),
    rod(ctx, 0.07, 0.48, colors.dark, 0, 1.78, -0.96, -0.62, 0, 0, 7),
    at(turn(ctx.strip(0.10, 0.10, 0.70, colors.dark), 0.48, 0, 0), 0, 1.92, 0.50),
  );

  if (options.broken) {
    const headParts = pieces.splice(7, 6);
    headParts.length = 0;
    pieces.push(
      turn(box(ctx, 0.42, 0.50, 0.28, colors.main, 0.58, 0.12, 0.40), 0.24, 0.46, -0.20),
      turn(box(ctx, 0.28, 0.34, 0.20, colors.light, -0.52, 0.12, -0.38), -0.18, 0.12, 0.34),
      at(turn(ctx.wedge(0.34, 0.30, 0.27, colors.dark), 0, 0.28, 0), 0.38, 0.10, -0.46),
    );
  }

  return model(2.0, options.broken ? 2.65 : 2.75, 2.92, [
    part(ctx, 'rearing horse statue', pieces),
  ]);
}

function knightStatue(ctx, options) {
  const colors = paletteFor();
  const pieces = [
    pedestal(ctx, colors, 1.48, 1.30),
    box(ctx, 0.24, 0.30, 0.82, colors.dark, -0.22, 0.50, 0),
    box(ctx, 0.24, 0.30, 0.82, colors.main, 0.22, 0.50, 0),
    at(ctx.wedge(0.92, 0.52, 0.98, colors.main), 0, 1.24, 0),
    box(ctx, 0.82, 0.48, 0.18, colors.light, 0, 1.62, 0),
    rod(ctx, 0.12, 0.82, colors.main, -0.50, 1.34, 0, 0, 0, 0.16),
    rod(ctx, 0.12, 0.78, colors.dark, 0.50, 1.34, 0, 0, 0, -0.16),
    at(ctx.cylinder(0.25, 0.28, 0.38, colors.light, 8), 0, 2.13, 0),
    box(ctx, 0.60, 0.44, 0.12, colors.dark, 0, 2.49, 0),
    box(ctx, 0.08, 0.05, 0.24, 'graphite-dark', 0, 2.20, 0.24),
    rod(ctx, 0.055, 1.68, colors.dark, 0.58, 0.64, 0.18, 0, 0, -0.08),
    at(turn(ctx.wedge(0.28, 0.12, 0.42, colors.light), 0, 0, Math.PI), 0.67, 2.18, 0.18),
    at(ctx.cylinder(0.31, 0.31, 0.13, colors.main, 10), -0.62, 1.30, 0.18),
  ];
  if (options.broken) {
    pieces.splice(7, 3);
    pieces.splice(8, 2);
    pieces.push(
      turn(box(ctx, 0.40, 0.34, 0.25, colors.light, -0.48, 0.12, 0.34), 0.18, 0.42, 0.28),
      at(turn(ctx.wedge(0.30, 0.32, 0.24, colors.dark), 0, 0.22, 0), 0.46, 0.08, -0.35),
    );
  }
  return model(1.8, 1.7, options.broken ? 2.35 : 2.72, [
    part(ctx, 'armored knight statue', pieces),
  ]);
}

function gargoyleStatue(ctx) {
  const colors = paletteFor();
  return model(2.80, 1.7, 2.15, [
    part(ctx, 'crouching gargoyle statue',
      pedestal(ctx, colors, 1.55, 1.34),
      box(ctx, 0.76, 0.66, 0.60, colors.main, 0, 0.58, 0),
      at(turn(ctx.wedge(0.74, 0.50, 0.72, colors.dark), Math.PI, 0, 0), 0, 1.12, 0.16),
      box(ctx, 0.64, 0.48, 0.48, colors.main, 0, 1.28, 0.34),
      box(ctx, 0.46, 0.32, 0.22, colors.light, 0, 1.30, 0.69),
      at(turn(ctx.wedge(0.18, 0.22, 0.40, colors.dark), 0, 0, -0.18), -0.25, 1.72, 0.30),
      at(turn(ctx.wedge(0.18, 0.22, 0.40, colors.dark), 0, 0, 0.18), 0.25, 1.72, 0.30),
      box(ctx, 0.07, 0.035, 0.07, 'graphite-dark', -0.14, 1.48, 0.58),
      box(ctx, 0.07, 0.035, 0.07, 'graphite-dark', 0.14, 1.48, 0.58),
      at(turn(ctx.wedge(0.82, 0.26, 0.92, colors.dark), 0.20, 0, -0.55), -0.72, 0.92, -0.06),
      at(turn(ctx.wedge(0.82, 0.26, 0.92, colors.dark), 0.20, Math.PI, 0.55), 0.72, 0.92, -0.06),
      rod(ctx, 0.13, 0.64, colors.dark, -0.36, 0.46, 0.30, 0.88, 0, -0.18),
      rod(ctx, 0.13, 0.64, colors.dark, 0.36, 0.46, 0.30, 0.88, 0, 0.18),
    ),
  ]);
}

function serpentStatue(ctx) {
  const colors = paletteFor('sandstone');
  return model(1.75, 1.65, 2.62, [
    part(ctx, 'coiled serpent statue',
      pedestal(ctx, colors, 1.48, 1.34),
      at(ctx.cylinder(0.54, 0.62, 0.22, colors.dark, 10), 0, 0.50, 0),
      at(ctx.cylinder(0.43, 0.54, 0.22, colors.main, 10), 0.08, 0.70, 0),
      at(ctx.cylinder(0.34, 0.44, 0.24, colors.light, 10), -0.06, 0.90, 0.02),
      rod(ctx, 0.22, 1.20, colors.main, 0, 1.08, 0.02, 0.12, 0, 0, 8),
      at(turn(ctx.wedge(0.54, 0.72, 0.36, colors.light), 0, 0, Math.PI), 0, 2.16, 0.16),
      box(ctx, 0.07, 0.035, 0.07, 'graphite-dark', -0.14, 2.33, 0.68),
      box(ctx, 0.07, 0.035, 0.07, 'graphite-dark', 0.14, 2.33, 0.68),
      box(ctx, 0.05, 0.45, 0.04, 'dungeon-rune', 0, 2.24, 0.71),
    ),
  ]);
}

function hoodedStatue(ctx) {
  const colors = paletteFor();
  return model(1.7, 1.55, 2.74, [
    part(ctx, 'hooded sentinel statue',
      pedestal(ctx, colors, 1.48, 1.34),
      at(ctx.wedge(1.10, 0.78, 1.76, colors.dark), 0, 0.52, 0),
      at(ctx.wedge(0.86, 0.62, 1.44, colors.main), 0, 0.76, 0.06),
      at(ctx.cylinder(0.36, 0.44, 0.48, colors.light, 8), 0, 2.04, 0.10),
      box(ctx, 0.48, 0.34, 0.38, 'graphite-dark', 0, 2.10, 0.30),
      at(turn(ctx.wedge(0.82, 0.62, 0.66, colors.dark), Math.PI, 0, 0), 0, 2.18, -0.02),
      rod(ctx, 0.07, 1.72, colors.dark, 0.44, 0.66, 0.22, 0, 0, 0),
      at(turn(ctx.wedge(0.24, 0.18, 0.38, colors.light), 0, 0, Math.PI), 0.44, 2.35, 0.22),
      box(ctx, 0.30, 0.12, 0.14, colors.light, 0, 1.46, 0.48),
    ),
  ]);
}

function buildStatue(spec, ctx) {
  const options = spec.options;
  if (options.subject === 'horse') return horseStatue(ctx, options);
  if (options.subject === 'knight') return knightStatue(ctx, options);
  if (options.subject === 'gargoyle') return gargoyleStatue(ctx);
  if (options.subject === 'serpent') return serpentStatue(ctx);
  return hoodedStatue(ctx);
}

function flameCluster(ctx, x = 0, y = 0, z = 0, scale = 1, embersOnly = false) {
  const hot = ctx.screenMat('dungeon-flame-hot');
  const flame = ctx.screenMat('dungeon-flame');
  const pieces = [
    at(ctx.cylinder(0.08 * scale, 0.10 * scale, 0.08 * scale, ctx.screenMat('dungeon-ember'), 7), -0.13 * scale, 0, 0),
    at(ctx.cylinder(0.07 * scale, 0.09 * scale, 0.07 * scale, ctx.screenMat('dungeon-ember'), 7), 0.13 * scale, 0, 0.04 * scale),
  ];
  if (!embersOnly) {
    pieces.push(
      at(turn(ctx.wedge(0.34 * scale, 0.28 * scale, 0.72 * scale, flame), 0, 0.34, 0), 0, 0.05 * scale, 0),
      at(turn(ctx.wedge(0.23 * scale, 0.20 * scale, 0.92 * scale, hot), 0, -0.42, 0), 0.06 * scale, 0.08 * scale, 0.02 * scale),
      at(turn(ctx.wedge(0.18 * scale, 0.18 * scale, 0.55 * scale, hot), 0, 0.70, 0), -0.12 * scale, 0.10 * scale, -0.03 * scale),
    );
  }
  return at(part(ctx, embersOnly ? 'glowing embers' : 'layered flame', pieces), x, y, z);
}

function chainLinks(ctx, count, x, y, z, spacing = 0.25, material = 'dungeon-iron') {
  const links = [];
  for (let index = 0; index < count; index += 1) {
    const link = part(ctx, 'chain link',
      box(ctx, 0.22, 0.045, 0.045, material, 0, 0, 0),
      box(ctx, 0.22, 0.045, 0.045, material, 0, 0.22, 0),
      box(ctx, 0.045, 0.045, 0.22, material, -0.088, 0.02, 0),
      box(ctx, 0.045, 0.045, 0.22, material, 0.088, 0.02, 0));
    if (index % 2 === 1) turn(link, 0, HALF_PI, 0);
    links.push(at(link, x, y - index * spacing, z));
  }
  return part(ctx, 'linked chain', links);
}

function buildBrazier(ctx, options) {
  const metal = options.rust ? 'dungeon-rust' : 'dungeon-iron';
  const colors = paletteFor(options.style);
  const pieces = [];
  if (options.hanging) {
    pieces.push(
      chainLinks(ctx, 8, -0.40, 3.12, 0, 0.25, 'dungeon-iron-dark'),
      chainLinks(ctx, 8, 0.40, 3.12, 0, 0.25, 'dungeon-iron-dark'),
      box(ctx, 1.28, 0.12, 0.12, 'dungeon-iron-dark', 0, 3.10, 0),
      at(ctx.cylinder(0.68, 0.48, 0.25, metal, 10), 0, 0.95, 0),
      at(ctx.cylinder(0.76, 0.76, 0.10, 'dungeon-iron-light', 10), 0, 1.14, 0),
      flameCluster(ctx, 0, 1.22, 0, 0.92),
    );
    return model(1.7, 1.5, 3.42, [part(ctx, 'hanging brazier', pieces)]);
  }

  const bowlY = options.tall ? 1.32 : options.stone ? 0.58 : 0.82;
  if (options.stone) {
    pieces.push(
      box(ctx, 0.78, 0.78, 0.22, colors.dark),
      at(ctx.cylinder(0.36, 0.46, 0.50, colors.main, 8), 0, 0.22, 0),
      at(ctx.cylinder(0.66, 0.42, 0.25, colors.light, 10), 0, bowlY, 0),
    );
  } else {
    pieces.push(
      at(ctx.cylinder(0.34, 0.42, 0.15, metal, 8), 0, 0, 0),
      rod(ctx, 0.09, bowlY - 0.10, metal, 0, 0.13, 0, 0, 0, 0, 8),
      rod(ctx, 0.055, bowlY * 0.90, metal, -0.28, 0.10, -0.20, -0.22, 0, -0.12),
      rod(ctx, 0.055, bowlY * 0.90, metal, 0.28, 0.10, -0.20, -0.22, 0, 0.12),
      rod(ctx, 0.055, bowlY * 0.90, metal, 0, 0.10, 0.30, 0.24, 0, 0),
      at(ctx.cylinder(0.68, 0.46, 0.25, metal, 10), 0, bowlY, 0),
      at(ctx.cylinder(0.76, 0.76, 0.10, 'dungeon-iron-light', 10), 0, bowlY + 0.18, 0),
    );
  }
  pieces.push(flameCluster(ctx, 0, bowlY + 0.28, 0, options.tall ? 1.05 : 0.86));
  return model(1.55, 1.45, bowlY + 1.25, [
    part(ctx, options.stone ? 'stone brazier' : 'iron brazier', pieces),
  ]);
}

function buildFire(spec, ctx) {
  const options = spec.options;
  if (options.form === 'brazier') return buildBrazier(ctx, options);

  if (options.form === 'pit') {
    const colors = paletteFor(options.style);
    const ring = [];
    for (let index = 0; index < 10; index += 1) {
      const angle = index * Math.PI / 5;
      ring.push(at(
        turn(ctx.tileBox(0.48, 0.32, 0.24, index % 3 ? colors.main : colors.light), 0, -angle, 0),
        Math.cos(angle) * 0.72,
        0,
        Math.sin(angle) * 0.72,
      ));
    }
    ring.push(
      box(ctx, 1.05, 1.05, 0.08, 'graphite-dark', 0, 0.03, 0),
      turn(box(ctx, 1.16, 0.12, 0.12, 'wood-dark', 0, 0.18, 0), 0, QUARTER_PI, 0),
      turn(box(ctx, 1.16, 0.12, 0.12, 'wood', 0, 0.19, 0), 0, -QUARTER_PI, 0),
      flameCluster(ctx, 0, 0.28, 0, options.embers ? 0.70 : 0.92, options.embers),
    );
    return model(2.0, 2.0, options.embers ? 0.55 : 1.34, [
      part(ctx, 'ringed fire pit', ring),
    ]);
  }

  if (options.form === 'floor-torch') {
    return model(1.05, 1.05, 2.56, [
      part(ctx, 'standing floor torch',
        at(ctx.cylinder(0.26, 0.34, 0.15, 'dungeon-iron-dark', 8), 0, 0, 0),
        rod(ctx, 0.075, 1.54, 'dungeon-iron', 0, 0.14, 0, 0, 0, 0, 8),
        at(ctx.cylinder(0.29, 0.18, 0.20, 'dungeon-iron-light', 8), 0, 1.68, 0),
        flameCluster(ctx, 0, 1.84, 0, 0.70),
      ),
    ]);
  }

  const torchXs = options.double ? [-0.46, 0.46] : [0];
  const pieces = [
    box(ctx, options.double ? 1.35 : 0.70, 0.28, 1.42, 'dungeon-stone-dark', 0, 0, -0.12),
    box(ctx, options.double ? 1.20 : 0.55, 0.08, 1.28, 'dungeon-stone', 0, 0.08, 0.07),
  ];
  for (const x of torchXs) {
    pieces.push(
      rod(ctx, 0.065, 0.62, 'dungeon-iron', x, 0.58, 0.16, HALF_PI, 0, 0, 8),
      box(ctx, 0.34, 0.10, 0.09, 'dungeon-iron-light', x, 0.54, 0.38),
      at(ctx.cylinder(0.22, 0.14, 0.18, 'dungeon-iron', 8), x, 0.57, 0.70),
      flameCluster(ctx, x, 0.70, 0.70, 0.64),
    );
  }
  return model(options.double ? 1.65 : 0.95, 1.56, 1.48, [
    part(ctx, options.double ? 'double wall torch' : 'wall torch', pieces),
  ]);
}

function crateShape(ctx, options = {}) {
  const size = options.size === 'small' ? 0.82 : options.size === 'large' ? 1.48 : 1.12;
  const depth = size * 0.86;
  const height = size * 0.84;
  const pieces = [
    box(ctx, size, depth, height, 'wood'),
    box(ctx, size + 0.05, 0.10, 0.10, 'wood-dark', 0, 0.08, depth / 2 + 0.03),
    box(ctx, size + 0.05, 0.10, 0.10, 'wood-dark', 0, height - 0.16, depth / 2 + 0.03),
    box(ctx, 0.10, 0.10, height, 'wood-dark', -size / 2 + 0.06, 0, depth / 2 + 0.03),
    box(ctx, 0.10, 0.10, height, 'wood-dark', size / 2 - 0.06, 0, depth / 2 + 0.03),
    at(turn(ctx.strip(0.09, 0.10, height * 0.82, 'wood-light'), 0, 0, -0.72), 0, 0.08, depth / 2 + 0.08),
    at(turn(ctx.strip(0.09, 0.10, height * 0.82, 'wood-light'), 0, 0, 0.72), 0, 0.08, depth / 2 + 0.08),
  ];
  if (options.reinforced) {
    pieces.push(
      box(ctx, size + 0.10, depth + 0.08, 0.10, 'dungeon-iron', 0, height * 0.28, 0),
      box(ctx, size + 0.10, depth + 0.08, 0.10, 'dungeon-iron', 0, height * 0.70, 0),
      box(ctx, 0.13, 0.10, 0.24, 'dungeon-iron-light', 0, height * 0.42, depth / 2 + 0.09),
    );
  }
  if (options.open) {
    pieces.push(
      at(turn(ctx.tileBox(size * 0.96, 0.12, depth * 0.88, 'wood-light'), -1.20, 0, 0), 0, height * 0.92, -depth * 0.38),
      box(ctx, size * 0.76, depth * 0.66, 0.10, 'graphite-dark', 0, height + 0.02, 0),
    );
  }
  return { root: part(ctx, 'wooden crate', pieces), size, depth, height: options.open ? height + depth * 0.78 : height };
}

function barrelShape(ctx, reinforced = false) {
  const pieces = [
    ctx.cylinder(0.46, 0.41, 1.14, 'wood', 10),
    at(ctx.cylinder(0.49, 0.49, 0.09, reinforced ? 'dungeon-iron-light' : 'dungeon-iron', 10), 0, 0.10, 0),
    at(ctx.cylinder(0.50, 0.50, 0.09, reinforced ? 'dungeon-iron-light' : 'dungeon-iron', 10), 0, 0.52, 0),
    at(ctx.cylinder(0.49, 0.49, 0.09, reinforced ? 'dungeon-iron-light' : 'dungeon-iron', 10), 0, 0.98, 0),
    box(ctx, 0.09, 0.05, 0.88, 'wood-light', 0, 0.14, 0.44),
    at(ctx.cylinder(0.34, 0.34, 0.06, 'wood-dark', 10), 0, 1.10, 0),
  ];
  return part(ctx, reinforced ? 'iron-banded barrel' : 'wooden barrel', pieces);
}

function chestShape(ctx, options = {}) {
  const body = options.iron ? 'dungeon-iron-dark' : 'wood';
  const trim = options.iron ? 'dungeon-iron-light' : 'dungeon-iron';
  const pieces = [
    box(ctx, 1.56, 0.86, 0.58, body),
    box(ctx, 1.64, 0.94, 0.12, trim, 0, 0.52, 0),
    box(ctx, 0.12, 0.92, 0.65, trim, -0.58, 0, 0),
    box(ctx, 0.12, 0.92, 0.65, trim, 0.58, 0, 0),
    box(ctx, 0.24, 0.10, 0.30, 'brass', 0, 0.28, 0.49),
  ];
  if (options.open) {
    pieces.push(
      at(turn(ctx.tileBox(1.56, 0.14, 0.72, body), -1.18, 0, 0), 0, 0.58, -0.40),
      box(ctx, 1.22, 0.62, 0.08, 'graphite-dark', 0, 0.60, 0),
      at(ctx.cylinder(0.09, 0.12, 0.07, 'brass', 8), -0.28, 0.67, 0.08),
      at(ctx.cylinder(0.09, 0.12, 0.07, 'brass', 8), 0.02, 0.67, -0.10),
      at(ctx.cylinder(0.09, 0.12, 0.07, 'brass', 8), 0.32, 0.67, 0.12),
    );
  } else {
    pieces.push(
      box(ctx, 1.48, 0.78, 0.24, body, 0, 0.64, 0),
      at(turn(ctx.wedge(0.74, 0.78, 0.30, body), 0, 0, HALF_PI), -0.36, 0.86, 0),
      at(turn(ctx.wedge(0.74, 0.78, 0.30, body), 0, Math.PI, -HALF_PI), 0.36, 0.86, 0),
      box(ctx, 1.60, 0.08, 0.09, trim, 0, 0.84, 0.43),
    );
  }
  if (options.treasure) {
    pieces.push(
      at(ctx.cylinder(0.10, 0.10, 0.05, 'brass', 8), -0.34, 1.00, 0.12),
      at(ctx.cylinder(0.10, 0.10, 0.05, 'brass', 8), 0, 1.02, 0.18),
      at(ctx.cylinder(0.10, 0.10, 0.05, 'brass', 8), 0.34, 1.00, 0.08),
      at(turn(ctx.wedge(0.18, 0.18, 0.28, 'dungeon-rune'), 0, 0.30, 0), 0.08, 0.98, -0.04),
    );
  }
  return part(ctx, 'dungeon chest', pieces);
}

function buildStorage(spec, ctx) {
  const options = spec.options;
  if (options.form === 'crate') {
    const crate = crateShape(ctx, options);
    const footprintDepth = options.open ? crate.depth + 0.95 : crate.depth + 0.18;
    return model(crate.size + 0.18, footprintDepth, crate.height + 0.08, [crate.root]);
  }
  if (options.form === 'crate-stack') {
    const lower = crateShape(ctx, { size: 'large', reinforced: true });
    const upper = crateShape(ctx, { size: 'small' });
    turn(upper.root, 0, 0.18, 0);
    return model(2.2, 1.45, 1.92, [
      part(ctx, 'stacked crates',
        at(lower.root, -0.28, 0, 0),
        at(upper.root, 0.54, 1.22, -0.08),
        turn(box(ctx, 0.72, 0.58, 0.62, 'wood', 0.52, 0, 0.32), 0, -0.14, 0)),
    ]);
  }
  if (options.form === 'barrel') {
    return model(1.18, 1.18, 1.24, [barrelShape(ctx, options.reinforced)]);
  }
  if (options.form === 'barrel-stack') {
    const top = barrelShape(ctx, true);
    turn(top, 0, 0, HALF_PI);
    return model(2.35, 1.55, 1.85, [
      part(ctx, 'stacked barrels',
        at(barrelShape(ctx), -0.55, 0, 0),
        at(barrelShape(ctx), 0.55, 0, 0),
        at(top, 0, 1.10, 0)),
    ]);
  }
  return model(1.86, options.open ? 1.76 : 1.18, options.open || options.treasure ? 1.42 : 1.20, [
    chestShape(ctx, options),
  ]);
}

function bannerShape(ctx, options) {
  const isLong = options.length === 'long' || options.torn || options.split || options.rune;
  const clothHeight = isLong ? 2.18 : 1.42;
  const width = options.split ? 1.48 : 1.28;
  const pieces = [
    box(ctx, width + 0.46, 0.10, 0.10, 'wood-dark', 0, clothHeight + 0.35, 0),
    at(ctx.cylinder(0.09, 0.12, 0.15, 'brass', 8), -width / 2 - 0.18, clothHeight + 0.31, 0),
    at(ctx.cylinder(0.09, 0.12, 0.15, 'brass', 8), width / 2 + 0.18, clothHeight + 0.31, 0),
    box(ctx, 0.08, 0.08, 0.28, 'dungeon-iron', -width / 2 - 0.08, clothHeight + 0.06, -0.05),
    box(ctx, 0.08, 0.08, 0.28, 'dungeon-iron', width / 2 + 0.08, clothHeight + 0.06, -0.05),
  ];

  if (options.split) {
    pieces.push(
      box(ctx, width * 0.44, 0.07, clothHeight - 0.24, 'dungeon-banner', -width * 0.27, 0.30, 0.05),
      box(ctx, width * 0.44, 0.07, clothHeight - 0.45, 'dungeon-banner-dark', width * 0.27, 0.50, 0.05),
      at(turn(ctx.wedge(width * 0.44, 0.07, 0.45, 'dungeon-banner-dark'), Math.PI, 0, 0), -width * 0.27, 0.02, 0.05),
      at(turn(ctx.wedge(width * 0.44, 0.07, 0.45, 'dungeon-banner'), Math.PI, 0, 0), width * 0.27, 0.18, 0.05),
    );
  } else if (options.torn) {
    pieces.push(
      box(ctx, width, 0.07, clothHeight - 0.50, 'dungeon-banner', 0, 0.52, 0.05),
      at(turn(ctx.wedge(width * 0.42, 0.07, 0.56, 'dungeon-banner-dark'), Math.PI, 0, 0), -width * 0.29, 0.05, 0.05),
      at(turn(ctx.wedge(width * 0.30, 0.07, 0.37, 'dungeon-banner'), Math.PI, 0, 0), width * 0.34, 0.26, 0.05),
    );
  } else {
    pieces.push(
      box(ctx, width, 0.07, clothHeight - 0.30, 'dungeon-banner', 0, 0.32, 0.05),
      at(turn(ctx.wedge(width / 2, 0.07, 0.38, 'dungeon-banner-dark'), Math.PI, 0, 0), -width / 4, 0.02, 0.05),
      at(turn(ctx.wedge(width / 2, 0.07, 0.38, 'dungeon-banner'), Math.PI, 0, 0), width / 4, 0.02, 0.05),
      box(ctx, 0.10, 0.02, clothHeight - 0.52, 'dungeon-banner-light', -width * 0.34, 0.44, 0.095),
    );
  }

  if (options.rune) {
    const rune = ctx.screenMat('dungeon-rune');
    pieces.push(
      box(ctx, 0.10, 0.025, 0.84, rune, 0, 0.85, 0.10),
      box(ctx, 0.58, 0.025, 0.10, rune, 0, 1.18, 0.10),
      at(turn(ctx.strip(0.08, 0.025, 0.46, rune), 0, 0, 0.72), 0.16, 0.88, 0.10),
      at(turn(ctx.strip(0.08, 0.025, 0.46, rune), 0, 0, -0.72), -0.16, 0.88, 0.10),
    );
  }
  return { pieces, width: width + 0.58, height: clothHeight + 0.52 };
}

function webSegment(ctx, x1, y1, x2, y2, line) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(-dx, dy);
  return at(turn(ctx.strip(line, 0.035, length, 'dungeon-web'), 0, 0, angle), x1, y1, 0);
}

function webShape(ctx, options) {
  const size = options.size === 'small' ? 1.15 : options.wall ? 2.25 : 1.90;
  const line = options.size === 'small' ? 0.025 : 0.035;
  const left = -size / 2;
  const right = size / 2;
  const pieces = [
    box(ctx, line, 0.035, size, 'dungeon-web', -size / 2, 0, 0),
    box(ctx, size, 0.035, line, 'dungeon-web', 0, size - line, 0),
    webSegment(ctx, left, 0, right, size, line),
    webSegment(ctx, left, 0, 0, size, line),
    webSegment(ctx, left, size * 0.48, right, size, line),
    webSegment(ctx, left, size * 0.32, -size * 0.18, size * 0.68, line),
    webSegment(ctx, -size * 0.18, size * 0.68, size * 0.18, size * 0.84, line),
    webSegment(ctx, left, size * 0.62, size * 0.22, size * 0.82, line),
    at(ctx.cylinder(0.05, 0.07, 0.07, 'dungeon-web', 6), -size * 0.22, size * 0.58, 0.02),
  ];
  if (options.wall) {
    pieces.unshift(
      box(ctx, size + 0.26, 0.18, 0.12, 'dungeon-stone-dark', 0, size + 0.06, -0.12),
      box(ctx, 0.18, 0.18, size + 0.16, 'dungeon-stone-dark', -size / 2 - 0.10, 0, -0.12),
    );
  }
  return { pieces, size };
}

function buildDecor(spec, ctx) {
  const options = spec.options;
  if (options.form === 'banner') {
    const banner = bannerShape(ctx, options);
    return model(banner.width, 0.72, banner.height + 0.54, [
      at(part(ctx, 'hanging banner', banner.pieces), 0, 0.54, 0),
    ]);
  }
  if (options.form === 'web') {
    const web = webShape(ctx, options);
    return model(web.size + 0.40, 0.62, web.size + 0.28, [
      part(ctx, 'cobweb', web.pieces),
    ]);
  }
  const pieces = [chainLinks(ctx, 10, options.double ? -0.28 : 0, 2.60, 0, 0.24, 'dungeon-iron')];
  if (options.double) {
    pieces.push(
      chainLinks(ctx, 10, 0.28, 2.60, 0, 0.24, 'dungeon-rust'),
      box(ctx, 0.86, 0.14, 0.14, 'dungeon-iron-dark', 0, 2.62, 0),
    );
  } else {
    pieces.push(at(ctx.cylinder(0.17, 0.21, 0.10, 'dungeon-iron-dark', 8), 0, 2.58, 0));
  }
  return model(options.double ? 1.12 : 0.62, 0.62, 2.88, [
    part(ctx, options.double ? 'paired hanging chains' : 'hanging chain', pieces),
  ]);
}

function tiledFloor(ctx, options) {
  const colors = paletteFor(options.style);
  if (options.broken) {
    return model(3.3, 3.3, 0.34, [
      at(part(ctx, 'broken floor tile',
        turn(box(ctx, 1.40, 1.28, 0.16, colors.main, -0.78, 0, -0.72), 0, 0.06, 0.03),
        turn(box(ctx, 1.22, 1.42, 0.18, colors.light, 0.76, 0, -0.62), 0, -0.08, -0.03),
        turn(box(ctx, 1.16, 1.18, 0.15, colors.dark, -0.66, 0, 0.74), 0, -0.12, 0.02),
        at(turn(ctx.wedge(1.22, 1.10, 0.18, colors.main), 0, 0.18, 0), 0.77, 0, 0.77),
        turn(box(ctx, 0.38, 0.52, 0.12, colors.light, 0.08, 0, 0.12), 0.12, 0.42, 0.16),
        at(turn(ctx.wedge(0.28, 0.44, 0.14, colors.dark), 0, -0.30, 0), -0.04, 0.01, -0.14),
      ), 0, 0.08, 0),
    ]);
  }

  const pieces = [
    box(ctx, 3.12, 3.12, 0.08, colors.mortar),
    box(ctx, 1.48, 1.48, 0.14, colors.main, -0.77, 0.08, -0.77),
    box(ctx, 1.48, 1.48, 0.14, colors.light, 0.77, 0.08, -0.77),
    box(ctx, 1.48, 1.48, 0.14, colors.dark, -0.77, 0.08, 0.77),
    box(ctx, 1.48, 1.48, 0.14, colors.main, 0.77, 0.08, 0.77),
  ];
  if (options.cracked) {
    pieces.push(
      at(turn(ctx.strip(0.045, 0.72, 0.025, colors.dark), 0, 0.50, 0), -0.42, 0.225, -0.58),
      at(turn(ctx.strip(0.045, 0.86, 0.025, colors.dark), 0, -0.70, 0), 0.66, 0.225, 0.52),
      at(turn(ctx.strip(0.04, 0.62, 0.025, colors.dark), 0, 0.18, 0), 0.24, 0.225, -0.94),
    );
  }
  if (options.mossy) {
    pieces.push(
      box(ctx, 0.90, 0.22, 0.035, 'dungeon-moss', -0.85, 0.225, 0.06),
      box(ctx, 0.32, 0.72, 0.035, 'dungeon-moss', 0.18, 0.225, -1.05),
      at(ctx.cylinder(0.22, 0.30, 0.025, 'dungeon-moss', 8), 1.05, 0.225, 0.84),
    );
  }
  if (options.rune) {
    const rune = ctx.screenMat('dungeon-rune');
    pieces.push(
      box(ctx, 0.09, 1.62, 0.035, rune, 0, 0.225, 0),
      box(ctx, 1.62, 0.09, 0.035, rune, 0, 0.225, 0),
      at(turn(ctx.strip(0.08, 1.30, 0.035, rune), 0, QUARTER_PI, 0), 0, 0.225, 0),
      at(ctx.cylinder(0.22, 0.28, 0.04, rune, 8), 0, 0.225, 0),
    );
  }
  if (options.blood) {
    pieces.push(
      at(ctx.cylinder(0.58, 0.72, 0.035, 'dungeon-blood', 9), 0.32, 0.225, -0.18),
      at(ctx.cylinder(0.25, 0.34, 0.035, 'dungeon-blood', 8), -0.52, 0.225, 0.44),
      box(ctx, 0.14, 1.04, 0.035, 'dungeon-blood', 0.72, 0.225, 0.54),
    );
  }
  return model(3.3, 3.3, 0.32, [part(ctx, 'modular floor tile', pieces)]);
}

function stairsShape(ctx, options) {
  const colors = paletteFor(options.style);
  const count = options.count;
  const depth = 3.35;
  const stepDepth = depth / count;
  const pieces = [];
  for (let index = 0; index < count; index += 1) {
    if (options.broken && index === count - 2) {
      pieces.push(
        turn(box(ctx, 1.10, stepDepth * 0.88, (index + 1) * 0.25, colors.dark, -0.76, 0.03, -depth / 2 + (index + 0.5) * stepDepth), 0, 0.12, -0.04),
        at(turn(ctx.wedge(0.82, stepDepth * 0.80, (index + 1) * 0.22, colors.main), 0, -0.20, 0), 0.70, 0, -depth / 2 + (index + 0.5) * stepDepth),
      );
      continue;
    }
    const material = index % 3 === 0 ? colors.light : index % 3 === 1 ? colors.main : colors.dark;
    pieces.push(box(
      ctx,
      2.86,
      stepDepth + 0.025,
      (index + 1) * 0.25,
      material,
      0,
      0,
      -depth / 2 + (index + 0.5) * stepDepth,
    ));
  }
  pieces.push(
    box(ctx, 0.22, depth + 0.10, count * 0.25 + 0.12, colors.dark, -1.54, 0, 0),
    box(ctx, 0.22, depth + 0.10, count * 0.25 + 0.12, colors.dark, 1.54, 0, 0),
  );
  return model(3.4, 3.55, count * 0.25 + 0.20, [part(ctx, 'stone stair flight', pieces)]);
}

function bridgeShape(ctx, options) {
  const length = options.length;
  const count = Math.round(length / 0.42);
  const pieces = [];
  for (let index = 0; index < count; index += 1) {
    if (options.broken && (index === 3 || index === count - 3)) continue;
    const x = -length / 2 + length * (index + 0.5) / count;
    const plank = box(ctx, length / count - 0.025, 1.62, 0.15, index % 3 === 0 ? 'wood-light' : 'wood', x, 0.34, 0);
    if (options.broken && index === count - 4) turn(plank, 0, 0.10, 0.16);
    pieces.push(plank);
  }
  pieces.push(
    box(ctx, length, 0.10, 0.14, 'wood-dark', 0, 0.20, -0.54),
    box(ctx, length, 0.10, 0.14, 'wood-dark', 0, 0.20, 0.54),
  );
  for (const x of [-length / 2 + 0.25, 0, length / 2 - 0.25]) {
    if (options.broken && x === 0) continue;
    pieces.push(
      box(ctx, 0.12, 0.12, 0.82, 'wood-dark', x, 0.36, -0.76),
      box(ctx, 0.12, 0.12, 0.82, 'wood-dark', x, 0.36, 0.76),
    );
  }
  if (!options.broken) {
    pieces.push(
      box(ctx, length, 0.09, 0.10, 'wood-light', 0, 1.02, -0.76),
      box(ctx, length, 0.09, 0.10, 'wood-light', 0, 1.02, 0.76),
    );
  } else {
    pieces.push(
      box(ctx, length * 0.38, 0.09, 0.10, 'wood-light', -length * 0.30, 1.02, -0.76),
      turn(box(ctx, 0.55, 0.09, 0.10, 'wood-light', length * 0.34, 0.82, -0.76), 0, 0, -0.62),
    );
  }
  return model(Math.min(4.5, length + 0.10), 2.05, 1.22, [
    part(ctx, options.broken ? 'broken timber bridge' : 'timber bridge', pieces),
  ]);
}

function platformShape(ctx) {
  const pieces = [];
  for (let index = 0; index < 9; index += 1) {
    pieces.push(box(
      ctx,
      0.38,
      3.00,
      0.16,
      index % 3 === 0 ? 'wood-light' : 'wood',
      -1.52 + index * 0.38,
      0.56,
      0,
    ));
  }
  pieces.push(
    box(ctx, 3.58, 0.16, 0.18, 'wood-dark', 0, 0.38, -1.18),
    box(ctx, 3.58, 0.16, 0.18, 'wood-dark', 0, 0.38, 1.18),
    box(ctx, 0.16, 3.00, 0.18, 'wood-dark', -1.42, 0.38, 0),
    box(ctx, 0.16, 3.00, 0.18, 'wood-dark', 1.42, 0.38, 0),
  );
  for (const x of [-1.42, 1.42]) {
    for (const z of [-1.18, 1.18]) {
      pieces.push(box(ctx, 0.24, 0.24, 0.58, 'wood-dark', x, 0, z));
    }
  }
  pieces.push(
    box(ctx, 3.58, 0.10, 0.10, 'wood-light', 0, 1.34, -1.45),
    box(ctx, 0.10, 2.00, 0.10, 'wood-light', -1.72, 1.34, -0.45),
    box(ctx, 0.12, 0.12, 0.72, 'wood-dark', -1.72, 0.62, -1.45),
    box(ctx, 0.12, 0.12, 0.72, 'wood-dark', 1.72, 0.62, -1.45),
    box(ctx, 0.12, 0.12, 0.72, 'wood-dark', -1.72, 0.62, 0.55),
  );
  return model(3.9, 3.4, 1.55, [part(ctx, 'raised wooden platform', pieces)]);
}

function buildFloor(spec, ctx) {
  const options = spec.options;
  if (options.form === 'tile') return tiledFloor(ctx, options);
  if (options.form === 'stairs') return stairsShape(ctx, options);
  if (options.form === 'bridge') return bridgeShape(ctx, options);
  return platformShape(ctx);
}

function sarcophagusShape(ctx, options) {
  const colors = paletteFor(options.style);
  const pieces = [
    box(ctx, 1.62, 2.62, 0.18, colors.dark),
    box(ctx, 1.45, 2.44, 0.62, colors.main, 0, 0.18, 0),
    box(ctx, 1.54, 2.54, 0.12, colors.light, 0, 0.76, 0),
  ];
  if (options.open) {
    pieces.push(
      at(turn(ctx.tileBox(1.48, 2.48, 0.22, colors.light), 0, 0, -1.08), 1.10, 0.70, -0.10),
      box(ctx, 1.12, 2.05, 0.09, 'graphite-dark', 0, 0.88, 0),
      skullShape(ctx, 'dungeon-bone', 0, 0.90, 0.70, 0.78),
      box(ctx, 0.42, 1.10, 0.16, 'dungeon-bone-dark', 0, 0.90, -0.32),
    );
  } else if (options.broken) {
    pieces.push(
      at(turn(ctx.wedge(0.72, 1.20, 0.24, colors.light), 0, -0.18, 0), -0.38, 0.86, -0.45),
      turn(box(ctx, 0.68, 1.08, 0.22, colors.dark, 0.46, 0.84, 0.55), 0.14, 0.22, -0.16),
      turn(box(ctx, 0.42, 0.58, 0.16, colors.main, 0.98, 0.08, -0.86), -0.12, 0.34, 0.18),
    );
  } else {
    pieces.push(
      at(turn(ctx.wedge(0.75, 2.38, 0.28, colors.light), 0, 0, HALF_PI), -0.36, 0.88, 0),
      at(turn(ctx.wedge(0.75, 2.38, 0.28, colors.main), 0, Math.PI, -HALF_PI), 0.36, 0.88, 0),
      box(ctx, 0.42, 1.20, 0.08, colors.dark, 0, 1.06, 0),
      at(ctx.cylinder(0.24, 0.28, 0.12, colors.dark, 8), 0, 1.06, 0.78),
    );
  }
  if (options.rune) {
    const rune = ctx.screenMat('dungeon-rune');
    pieces.push(
      box(ctx, 0.10, 1.30, 0.035, rune, 0, 1.18, -0.10),
      box(ctx, 0.62, 0.10, 0.035, rune, 0, 1.18, 0.28),
      at(turn(ctx.strip(0.08, 0.64, 0.035, rune), 0, QUARTER_PI, 0), 0, 1.18, 0),
    );
  }
  return model(options.open ? 3.35 : options.broken ? 2.25 : 1.90, 2.92, options.open ? 2.48 : 1.36, [
    part(ctx, 'carved sarcophagus', pieces),
  ]);
}

function altarShape(ctx, options) {
  const colors = paletteFor(options.style);
  const pieces = [
    box(ctx, 1.72, 1.18, 0.18, colors.dark),
    at(ctx.wedge(1.28, 0.92, 0.78, colors.main), 0, 0.18, 0),
    box(ctx, 1.92, 1.35, 0.22, colors.light, 0, 0.94, 0),
    box(ctx, 1.62, 1.08, 0.10, colors.main, 0, 1.16, 0),
    box(ctx, 0.30, 0.18, 0.38, colors.dark, 0, 0.50, 0.48),
  ];
  if (options.blood) {
    pieces.push(
      at(ctx.cylinder(0.44, 0.54, 0.035, 'dungeon-blood', 9), 0.20, 1.27, -0.06),
      box(ctx, 0.12, 0.46, 0.22, 'dungeon-blood', 0.54, 1.14, 0.42),
      skullShape(ctx, 'dungeon-bone', -0.32, 1.26, 0.10, 0.72),
    );
  }
  if (options.rune) {
    const rune = ctx.screenMat('dungeon-rune');
    pieces.push(
      box(ctx, 0.09, 0.025, 0.55, rune, 0, 0.46, 0.555),
      box(ctx, 0.56, 0.025, 0.08, rune, 0, 0.68, 0.555),
      at(ctx.cylinder(0.24, 0.28, 0.035, rune, 8), 0, 1.27, 0),
    );
  }
  return model(2.22, 1.72, 1.58, [part(ctx, 'ritual altar', pieces)]);
}

function ritualCircle(ctx) {
  const pieces = [
    box(ctx, 3.18, 3.18, 0.08, 'dungeon-stone-dark'),
    box(ctx, 2.92, 2.92, 0.09, 'dungeon-stone', 0, 0.08, 0),
  ];
  const rune = ctx.screenMat('dungeon-rune');
  for (let index = 0; index < 16; index += 1) {
    const angle = index * Math.PI / 8;
    pieces.push(at(
      turn(ctx.tileBox(0.34, 0.12, 0.035, index % 2 ? rune : 'dungeon-sandstone-light'), 0, -angle, 0),
      Math.cos(angle) * 1.18,
      0.18,
      Math.sin(angle) * 1.18,
    ));
  }
  for (let index = 0; index < 5; index += 1) {
    pieces.push(at(
      turn(ctx.strip(0.075, 1.84, 0.035, rune), 0, index * Math.PI * 0.4 + 0.31, 0),
      0,
      0.18,
      0,
    ));
  }
  pieces.push(
    at(ctx.cylinder(0.23, 0.30, 0.04, ctx.screenMat('dungeon-flame-hot'), 8), 0, 0.18, 0),
    at(ctx.cylinder(0.08, 0.11, 0.12, 'dungeon-bone', 7), 0, 0.22, 0),
  );
  return model(3.45, 3.45, 0.40, [part(ctx, 'glowing ritual circle', pieces)]);
}

function buildRitual(spec, ctx) {
  const options = spec.options;
  if (options.form === 'sarcophagus') return sarcophagusShape(ctx, options);
  if (options.form === 'altar') return altarShape(ctx, options);
  return ritualCircle(ctx);
}

function cageShape(ctx, options) {
  const isTall = options.size === 'tall';
  const width = isTall ? 1.72 : 1.42;
  const depth = isTall ? 1.62 : 1.34;
  const cageHeight = isTall ? 2.42 : 1.62;
  const baseY = options.hanging ? 0.58 : 0;
  const metal = options.broken ? 'dungeon-rust' : 'dungeon-iron';
  const pieces = [
    box(ctx, width, depth, 0.14, 'dungeon-iron-dark', 0, baseY, 0),
    box(ctx, width, 0.13, 0.13, metal, 0, baseY + cageHeight, -depth / 2),
    box(ctx, width, 0.13, 0.13, metal, 0, baseY + cageHeight, depth / 2),
    box(ctx, 0.13, depth, 0.13, metal, -width / 2, baseY + cageHeight, 0),
    box(ctx, 0.13, depth, 0.13, metal, width / 2, baseY + cageHeight, 0),
  ];
  const frontCount = isTall ? 6 : 5;
  for (let index = 0; index < frontCount; index += 1) {
    if (options.broken && index === frontCount - 2) continue;
    const x = -width * 0.42 + width * 0.84 * index / (frontCount - 1);
    const front = box(ctx, 0.065, 0.065, cageHeight, metal, x, baseY + 0.10, depth / 2);
    if (options.broken && index === 1) turn(front, 0, 0, -0.18);
    pieces.push(
      front,
      box(ctx, 0.065, 0.065, cageHeight, metal, x, baseY + 0.10, -depth / 2),
    );
  }
  for (let index = 1; index < 4; index += 1) {
    const z = -depth / 2 + depth * index / 4;
    pieces.push(
      box(ctx, 0.065, 0.065, cageHeight, metal, -width / 2, baseY + 0.10, z),
      box(ctx, 0.065, 0.065, cageHeight, metal, width / 2, baseY + 0.10, z),
    );
  }
  pieces.push(
    box(ctx, width + 0.08, 0.10, 0.10, 'dungeon-iron-light', 0, baseY + cageHeight * 0.48, depth / 2 + 0.02),
    box(ctx, width + 0.08, 0.10, 0.10, 'dungeon-iron-light', 0, baseY + cageHeight * 0.48, -depth / 2 - 0.02),
  );
  if (options.hanging) {
    pieces.push(
      chainLinks(ctx, 8, -0.48, 3.44, -0.42, 0.26, 'dungeon-iron-dark'),
      chainLinks(ctx, 8, 0.48, 3.44, -0.42, 0.26, 'dungeon-iron-dark'),
      chainLinks(ctx, 8, -0.48, 3.44, 0.42, 0.26, 'dungeon-iron-dark'),
      chainLinks(ctx, 8, 0.48, 3.44, 0.42, 0.26, 'dungeon-iron-dark'),
      box(ctx, 1.42, 0.12, 0.12, 'dungeon-iron-dark', 0, 3.42, 0),
    );
  }
  if (options.broken) {
    pieces.push(
      turn(box(ctx, 0.72, 0.10, 0.09, 'dungeon-rust', 0.34, 0.12, depth / 2 + 0.12), 0, 0, -0.35),
      turn(box(ctx, 0.46, 0.10, 0.09, 'dungeon-rust', -0.48, 0.02, depth / 2 + 0.08), 0, 0.30, 0.18),
    );
  }
  return {
    pieces,
    width: width + 0.30,
    depth: depth + 0.30,
    height: options.hanging ? 3.68 : cageHeight + 0.28,
  };
}

function jailBars(ctx, options) {
  const width = options.corner ? 3.20 : 3.65;
  const height = 2.52;
  const panel = [];
  const makePanel = (panelWidth) => {
    const pieces = [
      box(ctx, panelWidth, 0.14, 0.18, 'dungeon-iron-dark'),
      box(ctx, panelWidth, 0.14, 0.18, 'dungeon-iron-dark', 0, height - 0.18, 0),
      box(ctx, panelWidth, 0.12, 0.10, 'dungeon-iron-light', 0, height * 0.47, 0),
    ];
    for (let index = 0; index < 9; index += 1) {
      const x = -panelWidth * 0.44 + panelWidth * 0.88 * index / 8;
      pieces.push(box(ctx, 0.075, 0.075, height - 0.20, 'dungeon-iron', x, 0.10, 0));
    }
    return part(ctx, 'barred panel', pieces);
  };
  if (options.corner) {
    panel.push(
      at(makePanel(width), 0, 0, -1.32),
      at(turn(makePanel(2.76), 0, HALF_PI, 0), -1.52, 0, 0),
    );
  } else if (options.door) {
    panel.push(
      box(ctx, 3.70, 0.18, 0.20, 'dungeon-stone-dark'),
      box(ctx, 3.70, 0.18, 0.20, 'dungeon-stone-dark', 0, 2.52, 0),
      box(ctx, 0.22, 0.40, 2.72, 'dungeon-stone', -1.74, 0, 0),
      box(ctx, 0.22, 0.40, 2.72, 'dungeon-stone', 1.74, 0, 0),
      at(turn(makePanel(2.38), 0, 0.42, 0), -0.44, 0.18, 0.26),
      box(ctx, 0.18, 0.18, 0.28, 'brass', 0.70, 1.14, 0.22),
    );
  } else {
    panel.push(makePanel(width));
  }
  return model(options.corner ? 3.55 : 3.92, options.corner ? 3.22 : options.door ? 1.28 : 0.72, 2.82, [
    part(ctx, options.door ? 'hinged jail door' : 'jail bars', panel),
  ]);
}

function manacleWall(ctx) {
  return model(2.15, 0.95, 2.25, [
    part(ctx, 'wall manacles',
      box(ctx, 1.82, 0.40, 2.02, 'dungeon-stone-dark', 0, 0, -0.14),
      box(ctx, 1.65, 0.14, 1.86, 'dungeon-stone', 0, 0.08, 0.11),
      box(ctx, 1.90, 0.42, 0.16, 'dungeon-stone-light', 0, 1.92, -0.14),
      chainLinks(ctx, 5, -0.44, 1.62, 0.24, 0.22, 'dungeon-rust'),
      chainLinks(ctx, 5, 0.44, 1.62, 0.24, 0.22, 'dungeon-rust'),
      part(ctx, 'left cuff',
        box(ctx, 0.38, 0.08, 0.07, 'dungeon-iron-light', -0.44, 0.48, 0.24),
        box(ctx, 0.38, 0.08, 0.07, 'dungeon-iron-light', -0.44, 0.78, 0.24),
        box(ctx, 0.07, 0.08, 0.30, 'dungeon-iron-light', -0.60, 0.50, 0.24),
        box(ctx, 0.07, 0.08, 0.30, 'dungeon-iron-light', -0.28, 0.50, 0.24)),
      part(ctx, 'right cuff',
        box(ctx, 0.38, 0.08, 0.07, 'dungeon-iron-light', 0.44, 0.48, 0.24),
        box(ctx, 0.38, 0.08, 0.07, 'dungeon-iron-light', 0.44, 0.78, 0.24),
        box(ctx, 0.07, 0.08, 0.30, 'dungeon-iron-light', 0.28, 0.50, 0.24),
        box(ctx, 0.07, 0.08, 0.30, 'dungeon-iron-light', 0.60, 0.50, 0.24)),
    ),
  ]);
}

function buildPrison(spec, ctx) {
  const options = spec.options;
  if (options.form === 'cage') {
    const cage = cageShape(ctx, options);
    return model(cage.width, cage.depth, cage.height, [
      part(ctx, 'iron cage', cage.pieces),
    ]);
  }
  if (options.form === 'bars') return jailBars(ctx, options);
  return manacleWall(ctx);
}

function rubbleShape(ctx, options) {
  const colors = paletteFor(options.style);
  const large = options.size === 'large';
  const count = large ? 15 : 8;
  const spread = large ? 1.55 : 0.92;
  const pieces = [];
  for (let index = 0; index < count; index += 1) {
    const x = (((index * 37) % 17) / 16 - 0.5) * spread * 2;
    const z = (((index * 53) % 19) / 18 - 0.5) * spread * 1.55;
    const width = 0.24 + (index % 4) * 0.09;
    const depth = 0.22 + ((index * 3) % 4) * 0.08;
    const height = 0.16 + ((index * 5) % 4) * 0.09;
    const material = index % 5 === 0 ? colors.light : index % 3 === 0 ? colors.dark : colors.main;
    if (index % 3 === 0) {
      pieces.push(at(
        turn(ctx.wedge(width, depth, height, material), 0, index * 0.31, 0),
        x,
        0,
        z,
      ));
    } else {
      pieces.push(turn(box(ctx, width, depth, height, material, x, 0.12, z), 0.08 * (index % 2), index * 0.27, 0.06 * ((index % 3) - 1)));
    }
  }
  if (large) {
    pieces.push(
      turn(box(ctx, 0.82, 0.58, 0.42, colors.dark, -0.66, 0.14, 0.18), 0.12, 0.28, 0.16),
      at(turn(ctx.wedge(0.78, 0.64, 0.58, colors.main), 0, -0.42, 0), 0.72, 0, -0.36),
    );
  }
  return model(large ? 3.65 : 2.25, large ? 2.85 : 1.85, large ? 0.82 : 0.56, [
    part(ctx, 'deterministic masonry rubble', pieces),
  ]);
}

function boneShape(ctx, length, x, y, z, yaw = 0, material = 'dungeon-bone') {
  const bone = part(ctx, 'long bone',
    rod(ctx, 0.075, length, material, 0, 0, 0, 0, 0, -HALF_PI, 7),
    at(ctx.cylinder(0.11, 0.14, 0.12, material, 7), length * 0.48, -0.07, 0),
    at(ctx.cylinder(0.11, 0.14, 0.12, material, 7), -length * 0.48, -0.07, 0));
  turn(bone, 0, yaw, 0);
  return at(bone, x, y, z);
}

function buildRemains(spec, ctx) {
  const options = spec.options;
  if (options.form === 'rubble') return rubbleShape(ctx, options);

  if (options.form === 'skull') {
    const pieces = [skullShape(ctx, 'dungeon-bone', 0, 0.05, 0, options.pile ? 1.05 : 1.18)];
    if (options.pile) {
      pieces.push(
        skullShape(ctx, 'dungeon-bone-dark', -0.34, 0.02, -0.10, 0.88),
        skullShape(ctx, 'dungeon-bone', 0.34, 0.02, -0.12, 0.82),
        boneShape(ctx, 0.82, -0.08, 0.03, 0.28, 0.42),
        boneShape(ctx, 0.72, 0.18, 0.03, -0.34, -0.62, 'dungeon-bone-dark'),
      );
    }
    return model(options.pile ? 1.65 : 0.82, options.pile ? 1.35 : 0.78, options.pile ? 0.82 : 0.66, [
      at(part(ctx, options.pile ? 'skull pile' : 'single skull', pieces), 0, options.pile ? 0.05 : 0, 0),
    ]);
  }

  if (options.form === 'bones') {
    const pieces = [
      boneShape(ctx, 1.12, -0.48, 0.10, -0.18, 0.38),
      boneShape(ctx, 0.92, 0.38, 0.09, 0.14, -0.82, 'dungeon-bone-dark'),
      boneShape(ctx, 0.78, -0.12, 0.08, 0.48, 1.22),
    ];
    if (options.pile) {
      pieces.push(
        skullShape(ctx, 'dungeon-bone', 0.12, 0.22, -0.08, 0.92),
        boneShape(ctx, 1.02, 0.46, 0.18, -0.38, 0.18),
        boneShape(ctx, 0.84, -0.42, 0.20, 0.22, -0.24, 'dungeon-bone-dark'),
        skullShape(ctx, 'dungeon-bone-dark', -0.32, 0.04, -0.20, 0.70),
      );
    }
    return model(options.pile ? 2.80 : 2.35, options.pile ? 2.00 : 1.85, options.pile ? 0.86 : 0.42, [
      part(ctx, options.pile ? 'bone pile' : 'scattered bones', pieces),
    ]);
  }

  if (options.form === 'skeleton') {
    return model(3.30, 2.05, 0.62, [
      part(ctx, 'partial skeleton',
        skullShape(ctx, 'dungeon-bone', -0.94, 0.08, 0, 0.92),
        boneShape(ctx, 1.08, -0.18, 0.12, 0, 0),
        boneShape(ctx, 0.82, 0.52, 0.10, -0.36, 0.68),
        boneShape(ctx, 0.82, 0.52, 0.10, 0.36, -0.68),
        boneShape(ctx, 0.92, 1.02, 0.09, -0.28, 0.24),
        boneShape(ctx, 0.92, 1.02, 0.09, 0.28, -0.24),
        ...[-0.40, -0.18, 0.04, 0.26].map((x) => (
          at(turn(ctx.strip(0.055, 0.88 - Math.abs(x) * 0.32, 0.055, 'dungeon-bone-dark'), 0, QUARTER_PI, 0), x, 0.10, 0)
        )),
        box(ctx, 0.52, 0.42, 0.14, 'dungeon-bone', 0.35, 0.10, 0),
      ),
    ]);
  }

  const colors = paletteFor();
  return model(2.15, 3.15, 0.62, [
    part(ctx, 'carved tomb slab',
      box(ctx, 1.76, 2.82, 0.22, colors.dark),
      box(ctx, 1.58, 2.62, 0.18, colors.main, 0, 0.22, 0),
      box(ctx, 0.18, 1.58, 0.08, colors.light, 0, 0.40, -0.12),
      box(ctx, 0.86, 0.18, 0.08, colors.light, 0, 0.40, 0.32),
      skullShape(ctx, 'dungeon-bone-dark', 0, 0.41, -0.76, 0.72),
      at(turn(ctx.strip(0.045, 0.88, 0.035, colors.dark), 0, 0.54, 0), 0.42, 0.41, 0.82),
    ),
  ]);
}

function spike(ctx, x, y, z, length = 0.72, wall = false, material = 'dungeon-iron') {
  const value = ctx.cylinder(0, 0.10, length, material, 7);
  if (wall) turn(value, HALF_PI, 0, 0);
  return at(value, x, y, z);
}

function trapdoorShape(ctx, options) {
  const pieces = [
    box(ctx, 2.42, 2.42, 0.10, 'dungeon-stone-dark'),
    box(ctx, 2.02, 2.02, 0.04, 'graphite-dark', 0, 0.10, 0),
    box(ctx, 2.28, 0.16, 0.14, 'dungeon-iron', 0, 0.12, -1.04),
    box(ctx, 2.28, 0.16, 0.14, 'dungeon-iron', 0, 0.12, 1.04),
    box(ctx, 0.16, 2.10, 0.14, 'dungeon-iron', -1.04, 0.12, 0),
    box(ctx, 0.16, 2.10, 0.14, 'dungeon-iron', 1.04, 0.12, 0),
  ];
  if (options.open) {
    const lid = part(ctx, 'raised trapdoor lid',
      box(ctx, 1.96, 0.14, 1.96, 'wood'),
      box(ctx, 2.02, 0.08, 0.12, 'dungeon-iron-light', 0, 0.38, 0.08),
      box(ctx, 2.02, 0.08, 0.12, 'dungeon-iron-light', 0, 1.36, 0.08),
      box(ctx, 0.16, 0.08, 1.76, 'wood-dark', -0.68, 0.12, 0.08),
      box(ctx, 0.16, 0.08, 1.76, 'wood-dark', 0.68, 0.12, 0.08));
    pieces.push(at(lid, 0, 0.20, -1.05));
  } else {
    pieces.push(
      box(ctx, 1.96, 1.96, 0.14, 'wood', 0, 0.14, 0),
      box(ctx, 2.02, 0.14, 0.12, 'dungeon-iron-light', 0, 0.28, -0.56),
      box(ctx, 2.02, 0.14, 0.12, 'dungeon-iron-light', 0, 0.28, 0.56),
      at(ctx.cylinder(0.16, 0.20, 0.06, 'brass', 8), 0.58, 0.28, 0),
    );
  }
  return model(2.65, 2.65, options.open ? 2.28 : 0.56, [
    part(ctx, options.open ? 'open trapdoor' : 'closed trapdoor', pieces),
  ]);
}

function grateShape(ctx) {
  const pieces = [
    box(ctx, 2.50, 2.50, 0.10, 'dungeon-stone-dark'),
    box(ctx, 2.10, 2.10, 0.04, 'graphite-dark', 0, 0.10, 0),
    box(ctx, 2.28, 0.16, 0.14, 'dungeon-iron-light', 0, 0.14, -1.04),
    box(ctx, 2.28, 0.16, 0.14, 'dungeon-iron-light', 0, 0.14, 1.04),
    box(ctx, 0.16, 2.10, 0.14, 'dungeon-iron-light', -1.04, 0.14, 0),
    box(ctx, 0.16, 2.10, 0.14, 'dungeon-iron-light', 1.04, 0.14, 0),
  ];
  for (let index = 0; index < 8; index += 1) {
    pieces.push(box(ctx, 0.075, 2.02, 0.09, 'dungeon-iron', -0.84 + index * 0.24, 0.18, 0));
  }
  for (let index = 0; index < 4; index += 1) {
    pieces.push(box(ctx, 2.02, 0.075, 0.09, 'dungeon-iron', 0, 0.18, -0.72 + index * 0.48));
  }
  return model(2.75, 2.75, 0.46, [part(ctx, 'iron floor grate', pieces)]);
}

function buildTrap(spec, ctx) {
  const options = spec.options;
  if (options.form === 'trapdoor') return trapdoorShape(ctx, options);
  if (options.form === 'grate') return grateShape(ctx);

  if (options.form === 'spikes') {
    const pieces = [];
    if (options.wall) {
      pieces.push(
        box(ctx, 2.52, 0.34, 2.30, 'dungeon-stone-dark', 0, 0, -0.18),
        box(ctx, 2.32, 0.12, 2.12, 'dungeon-stone', 0, 0.08, 0.05),
      );
      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 5; column += 1) {
          pieces.push(spike(ctx, -0.88 + column * 0.44, 0.38 + row * 0.48, 0.08, 0.70, true));
        }
      }
      return model(2.78, 1.22, 2.50, [part(ctx, 'wall spike trap', pieces)]);
    }
    pieces.push(
      box(ctx, 2.48, 2.48, 0.12, 'dungeon-iron-dark'),
      box(ctx, 2.26, 2.26, 0.08, 'graphite-dark', 0, 0.12, 0),
    );
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        pieces.push(spike(ctx, -0.78 + column * 0.52, 0.20, -0.78 + row * 0.52, 0.82));
      }
    }
    return model(2.72, 2.72, 1.18, [part(ctx, 'floor spike trap', pieces)]);
  }

  if (options.form === 'pressure') {
    return model(2.65, 2.65, 0.42, [
      part(ctx, 'pressure plate',
        box(ctx, 2.42, 2.42, 0.10, 'dungeon-stone-dark'),
        box(ctx, 1.92, 1.92, 0.14, 'dungeon-stone-light', 0, 0.10, 0),
        box(ctx, 1.66, 1.66, 0.06, 'dungeon-stone', 0, 0.24, 0),
        box(ctx, 0.08, 1.10, 0.025, 'dungeon-rune', 0, 0.30, 0),
        box(ctx, 1.10, 0.08, 0.025, 'dungeon-rune', 0, 0.30, 0),
        at(ctx.cylinder(0.18, 0.24, 0.035, 'dungeon-rune', 8), 0, 0.30, 0),
      ),
    ]);
  }

  if (options.form === 'dart') {
    const pieces = [
      box(ctx, 2.62, 0.38, 2.28, 'dungeon-stone-dark', 0, 0, -0.18),
      box(ctx, 2.42, 0.12, 2.10, 'dungeon-stone', 0, 0.08, 0.05),
    ];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        pieces.push(
          at(ctx.cylinder(0.09, 0.11, 0.06, 'graphite-dark', 8), -0.88 + column * 0.44, 0.42 + row * 0.60, 0.13),
        );
      }
    }
    pieces.push(
      spike(ctx, -0.44, 1.02, 0.14, 0.68, true, 'dungeon-rust'),
      spike(ctx, 0.44, 1.62, 0.14, 0.68, true, 'dungeon-rust'),
    );
    return model(2.88, 1.40, 2.48, [part(ctx, 'dart trap wall', pieces)]);
  }

  if (options.form === 'blade') {
    return model(2.50, 1.58, 2.62, [
      part(ctx, 'swinging blade trap',
        box(ctx, 2.24, 1.28, 0.16, 'dungeon-stone-dark'),
        box(ctx, 0.28, 0.28, 2.22, 'dungeon-iron-dark', -0.88, 0.14, 0),
        box(ctx, 0.28, 0.28, 2.22, 'dungeon-iron-dark', 0.88, 0.14, 0),
        box(ctx, 2.04, 0.28, 0.22, 'dungeon-iron-dark', 0, 2.28, 0),
        rod(ctx, 0.08, 1.28, 'dungeon-iron', 0, 1.04, 0, 0, 0, 0.62, 8),
        at(turn(ctx.wedge(1.18, 0.16, 0.92, 'dungeon-iron-light'), 0, 0, Math.PI), 0.72, 0.95, 0),
        at(ctx.cylinder(0.22, 0.26, 0.18, 'brass', 8), 0, 2.18, 0),
        box(ctx, 1.10, 0.08, 0.06, 'dungeon-blood', 0.70, 0.50, 0.10),
      ),
    ]);
  }

  return model(2.42, 2.42, 1.88, [
    part(ctx, 'flame jet trap',
      box(ctx, 2.18, 2.18, 0.10, 'dungeon-stone-dark'),
      box(ctx, 1.82, 1.82, 0.08, 'dungeon-iron-dark', 0, 0.10, 0),
      ...[-0.58, 0, 0.58].flatMap((x) => [-0.58, 0, 0.58].map((z) => (
        at(ctx.cylinder(0.12, 0.16, 0.08, 'dungeon-iron-light', 8), x, 0.18, z)
      ))),
      flameCluster(ctx, 0, 0.28, 0, 1.26),
      flameCluster(ctx, -0.48, 0.28, 0.26, 0.72),
      flameCluster(ctx, 0.48, 0.28, -0.26, 0.72),
    ),
  ]);
}

const SHAPE_BUILDERS = Object.freeze({
  wall: buildWall,
  gateway: buildGateway,
  column: buildColumn,
  statue: buildStatue,
  fire: buildFire,
  storage: buildStorage,
  decor: buildDecor,
  floor: buildFloor,
  ritual: buildRitual,
  prison: buildPrison,
  remains: buildRemains,
  trap: buildTrap,
});

const SPEC_BY_KIND = new Map(CATALOG.map((spec) => [spec.kind, spec]));

export const DUNGEON_KINDS = Object.freeze(CATALOG.map((spec) => spec.kind));

export const DUNGEON_SKUS = Object.freeze(Object.fromEntries(
  DUNGEON_KINDS.map((kind, index) => ['sku-' + (1700 + index), kind]),
));

export function buildDungeon(entry, ctx) {
  const kind = entry?.kind || DUNGEON_SKUS[entry?.sku_id || entry?.sku];
  const spec = SPEC_BY_KIND.get(kind)
    || (!kind && entry?.family === 'dungeon'
      ? SPEC_BY_KIND.get('column-round-stone')
      : undefined);
  if (!spec) return null;
  const value = SHAPE_BUILDERS[spec.shape](spec, ctx);
  return finish(ctx, spec, value);
}

export function init(reg) {
  reg.registerMesh('dungeon', buildDungeon);
}
