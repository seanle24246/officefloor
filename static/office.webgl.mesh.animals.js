/* office.webgl.mesh.animals.js — decorative WebGL animal meshes. */

const HALF_PI = Math.PI / 2;
const QUARTER_PI = Math.PI / 4;

function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function rot(object, x = 0, y = 0, z = 0) {
  object.rotation.set(x, y, z);
  return object;
}

function finish(ctx, kind, width, depth, parts) {
  const geometry = ctx.group(parts);
  geometry.name = `animal-parts:${kind}`;
  geometry.position.y = 0.012;
  const shadow = ctx.contactShadow(width * 0.85, depth * 0.85);
  shadow.name = `animal-shadow:${kind}`;
  const root = ctx.group(shadow, geometry);
  root.name = `animal:${kind}`;
  root.userData.species = kind;
  root.userData.footprint = Object.freeze({ w: width, d: depth });
  return root;
}

// ---- dog (medium brown, floppy ears, curled tail) ----
function buildDog(ctx) {
  const bodyColor = 'terracotta';
  const bellyColor = 'terracotta-light';
  const darkColor = 'terracotta-dark';
  const noseColor = 'charcoal';

  const parts = [
    // body
    at(ctx.tileBox(0.38, 0.58, 0.32, bodyColor), 0, 0.24, 0),
    // belly highlight
    at(ctx.tileBox(0.30, 0.46, 0.12, bellyColor), 0, 0.18, 0.02),
    // head
    at(ctx.tileBox(0.28, 0.24, 0.26, bodyColor), 0, 0.52, 0.26),
    // snout
    at(ctx.tileBox(0.18, 0.10, 0.14, bellyColor), 0, 0.45, 0.41),
    // nose
    at(ctx.tileBox(0.10, 0.06, 0.07, noseColor), 0, 0.44, 0.50),
    // left ear (floppy)
    at(rot(ctx.wedge(0.08, 0.12, 0.16, darkColor), 0, 0, -0.4), -0.10, 0.58, 0.28),
    // right ear (floppy)
    at(rot(ctx.wedge(0.08, 0.12, 0.16, darkColor), 0, 0, 0.4), 0.10, 0.58, 0.28),
    // left front leg
    at(ctx.cylinder(0.06, 0.07, 0.24, bellyColor, 6), -0.10, 0.01, 0.12),
    // right front leg
    at(ctx.cylinder(0.06, 0.07, 0.24, bellyColor, 6), 0.10, 0.01, 0.12),
    // left back leg
    at(ctx.cylinder(0.07, 0.08, 0.24, bodyColor, 6), -0.10, 0.01, -0.16),
    // right back leg
    at(ctx.cylinder(0.07, 0.08, 0.24, bodyColor, 6), 0.10, 0.01, -0.16),
    // tail (curled up)
    at(ctx.cylinder(0.04, 0.05, 0.20, darkColor, 6), 0, 0.30, -0.34),
    at(rot(ctx.cylinder(0.04, 0.04, 0.14, darkColor, 6), HALF_PI * 0.7, 0, 0), 0, 0.46, -0.36),
    // eyes (tiny dark dots)
    at(ctx.tileBox(0.04, 0.025, 0.04, noseColor), -0.07, 0.55, 0.38),
    at(ctx.tileBox(0.04, 0.025, 0.04, noseColor), 0.07, 0.55, 0.38),
  ];

  return finish(ctx, 'dog', 0.5, 0.65, parts);
}

// ---- cat (orange tabby, pointy ears, long curved tail) ----
function buildCat(ctx) {
  const bodyColor = 'terracotta';
  const bellyColor = 'terracotta-light';
  const stripeColor = 'terracotta-dark';
  const eyeColor = 'foliage-olive';

  const parts = [
    // body
    at(ctx.tileBox(0.30, 0.48, 0.26, bodyColor), 0, 0.20, 0),
    // belly
    at(ctx.tileBox(0.22, 0.36, 0.10, bellyColor), 0, 0.15, 0.02),
    // head
    at(ctx.tileBox(0.24, 0.20, 0.22, bodyColor), 0, 0.44, 0.22),
    // chin
    at(ctx.tileBox(0.14, 0.08, 0.08, bellyColor), 0, 0.37, 0.34),
    // left ear (pointy)
    at(rot(ctx.wedge(0.06, 0.08, 0.18, bodyColor), 0, 0, -0.25), -0.10, 0.50, 0.22),
    // left inner ear
    at(rot(ctx.wedge(0.04, 0.05, 0.12, bellyColor), 0, 0, -0.25), -0.09, 0.50, 0.22),
    // right ear (pointy)
    at(rot(ctx.wedge(0.06, 0.08, 0.18, bodyColor), 0, 0, 0.25), 0.10, 0.50, 0.22),
    // right inner ear
    at(rot(ctx.wedge(0.04, 0.05, 0.12, bellyColor), 0, 0, 0.25), 0.09, 0.50, 0.22),
    // stripes on head
    at(ctx.strip(0.08, 0.015, 0.15, stripeColor), 0, 0.55, 0.31),
    at(ctx.strip(0.04, 0.015, 0.08, stripeColor), -0.06, 0.55, 0.31),
    at(ctx.strip(0.04, 0.015, 0.08, stripeColor), 0.06, 0.55, 0.31),
    // eyes
    at(ctx.tileBox(0.05, 0.03, 0.05, eyeColor), -0.06, 0.48, 0.32),
    at(ctx.tileBox(0.05, 0.03, 0.05, eyeColor), 0.06, 0.48, 0.32),
    // left front leg
    at(ctx.cylinder(0.05, 0.06, 0.20, bodyColor, 6), -0.08, 0.01, 0.10),
    // right front leg
    at(ctx.cylinder(0.05, 0.06, 0.20, bodyColor, 6), 0.08, 0.01, 0.10),
    // left back leg
    at(ctx.cylinder(0.055, 0.065, 0.20, bodyColor, 6), -0.08, 0.01, -0.14),
    // right back leg
    at(ctx.cylinder(0.055, 0.065, 0.20, bodyColor, 6), 0.08, 0.01, -0.14),
    // tail (curved up)
    at(ctx.cylinder(0.035, 0.05, 0.22, bodyColor, 6), 0, 0.28, -0.28),
    at(rot(ctx.cylinder(0.035, 0.035, 0.16, bodyColor, 6), HALF_PI * 0.8, 0, 0), 0, 0.44, -0.32),
    // tail stripes
    at(ctx.strip(0.035, 0.01, 0.09, stripeColor), 0, 0.34, -0.30),
  ];

  return finish(ctx, 'cat', 0.45, 0.55, parts);
}

// ---- capybara (chunky, wide body, square head, tiny ears, no tail) ----
function buildCapybara(ctx) {
  const bodyColor = 'wood';
  const bellyColor = 'wood-dark';
  const faceColor = 'honey-wood';
  const eyeColor = 'charcoal';

  const parts = [
    // body (wide and chunky)
    at(ctx.tileBox(0.52, 0.72, 0.40, bodyColor), 0, 0.24, 0),
    // belly
    at(ctx.tileBox(0.44, 0.60, 0.14, bellyColor), 0, 0.16, 0.02),
    // head (large, square-ish)
    at(ctx.tileBox(0.38, 0.32, 0.34, bodyColor), 0, 0.52, 0.34),
    // snout
    at(ctx.tileBox(0.24, 0.18, 0.16, faceColor), 0, 0.42, 0.54),
    // nostrils
    at(ctx.tileBox(0.03, 0.025, 0.025, bellyColor), -0.05, 0.44, 0.63),
    at(ctx.tileBox(0.03, 0.025, 0.025, bellyColor), 0.05, 0.44, 0.63),
    // left ear (tiny)
    at(ctx.cylinder(0.03, 0.04, 0.06, bellyColor, 6), -0.14, 0.64, 0.30),
    // right ear (tiny)
    at(ctx.cylinder(0.03, 0.04, 0.06, bellyColor, 6), 0.14, 0.64, 0.30),
    // eyes
    at(ctx.tileBox(0.045, 0.025, 0.045, eyeColor), -0.10, 0.55, 0.50),
    at(ctx.tileBox(0.045, 0.025, 0.045, eyeColor), 0.10, 0.55, 0.50),
    // front left leg (stubby)
    at(ctx.cylinder(0.07, 0.08, 0.16, bodyColor, 6), -0.14, 0.01, 0.18),
    // front right leg
    at(ctx.cylinder(0.07, 0.08, 0.16, bodyColor, 6), 0.14, 0.01, 0.18),
    // back left leg
    at(ctx.cylinder(0.075, 0.085, 0.16, bodyColor, 6), -0.14, 0.01, -0.18),
    // back right leg
    at(ctx.cylinder(0.075, 0.085, 0.16, bodyColor, 6), 0.14, 0.01, -0.18),
    // back hump
    at(ctx.tileBox(0.30, 0.30, 0.08, faceColor), 0, 0.46, -0.15),
  ];

  return finish(ctx, 'capybara', 0.65, 0.85, parts);
}

// ---- duck (round body, neck, head, beak, wings) ----
function buildDuck(ctx) {
  const bodyColor = 'cream';
  const billColor = 'terracotta';
  const wingColor = 'cream';
  const eyeColor = 'charcoal';

  const parts = [
    // body (rounded: use chunky box)
    at(ctx.tileBox(0.34, 0.46, 0.30, bodyColor), 0, 0.18, 0),
    // body top highlight
    at(ctx.tileBox(0.26, 0.36, 0.10, 'paper'), 0, 0.30, 0),
    // neck
    at(ctx.cylinder(0.08, 0.09, 0.22, bodyColor, 8), 0, 0.38, 0.18),
    // head
    at(ctx.tileBox(0.18, 0.15, 0.20, bodyColor), 0, 0.54, 0.24),
    // crown (slightly darker)
    at(ctx.tileBox(0.12, 0.08, 0.10, 'cream'), 0, 0.63, 0.24),
    // bill
    at(rot(ctx.wedge(0.10, 0.08, 0.16, billColor), 0, 0, 0), 0, 0.50, 0.36),
    // eyes
    at(ctx.tileBox(0.035, 0.025, 0.035, eyeColor), -0.04, 0.57, 0.33),
    at(ctx.tileBox(0.035, 0.025, 0.035, eyeColor), 0.04, 0.57, 0.33),
    // left wing
    at(rot(ctx.wedge(0.08, 0.24, 0.20, wingColor), 0, 0, -0.2), -0.20, 0.22, -0.02),
    // right wing
    at(rot(ctx.wedge(0.08, 0.24, 0.20, wingColor), 0, 0, 0.2), 0.20, 0.22, -0.02),
    // left foot
    at(ctx.wedge(0.10, 0.06, 0.04, billColor), -0.06, 0.02, 0.06),
    // right foot
    at(ctx.wedge(0.10, 0.06, 0.04, billColor), 0.06, 0.02, 0.06),
    // tail feathers (up)
    at(rot(ctx.wedge(0.06, 0.06, 0.14, 'cream'), -QUARTER_PI, 0, 0), 0, 0.26, -0.24),
  ];

  return finish(ctx, 'duck', 0.45, 0.6, parts);
}

// ---- rabbit (cream coat, long upright ears, puffball tail) ----
function buildRabbit(ctx) {
  const bodyColor = 'cream';
  const bellyColor = 'paper';
  const innerEarColor = 'terracotta-light';
  const eyeColor = 'charcoal';
  const noseColor = 'terracotta-dark';

  const parts = [
    // body
    at(ctx.tileBox(0.32, 0.44, 0.26, bodyColor), 0, 0.20, -0.02),
    // belly
    at(ctx.tileBox(0.24, 0.32, 0.10, bellyColor), 0, 0.15, 0.02),
    // left haunch
    at(ctx.tileBox(0.08, 0.18, 0.16, bodyColor), -0.15, 0.16, -0.12),
    // right haunch
    at(ctx.tileBox(0.08, 0.18, 0.16, bodyColor), 0.15, 0.16, -0.12),
    // head
    at(ctx.tileBox(0.26, 0.22, 0.22, bodyColor), 0, 0.44, 0.20),
    // muzzle
    at(ctx.tileBox(0.14, 0.08, 0.08, bellyColor), 0, 0.37, 0.30),
    // left ear (long, upright)
    at(rot(ctx.tileBox(0.07, 0.05, 0.28, bodyColor), 0, 0, 0.08), -0.08, 0.62, 0.18),
    // left inner ear
    at(rot(ctx.strip(0.04, 0.015, 0.20, innerEarColor), 0, 0, 0.08), -0.08, 0.62, 0.21),
    // right ear (long, upright)
    at(rot(ctx.tileBox(0.07, 0.05, 0.28, bodyColor), 0, 0, -0.08), 0.08, 0.62, 0.18),
    // right inner ear
    at(rot(ctx.strip(0.04, 0.015, 0.20, innerEarColor), 0, 0, -0.08), 0.08, 0.62, 0.21),
    // eyes
    at(ctx.tileBox(0.05, 0.03, 0.05, eyeColor), -0.07, 0.48, 0.30),
    at(ctx.tileBox(0.05, 0.03, 0.05, eyeColor), 0.07, 0.48, 0.30),
    // nose
    at(ctx.tileBox(0.05, 0.03, 0.04, noseColor), 0, 0.42, 0.32),
    // left front leg
    at(ctx.cylinder(0.045, 0.055, 0.18, bodyColor, 6), -0.09, 0.01, 0.12),
    // right front leg
    at(ctx.cylinder(0.045, 0.055, 0.18, bodyColor, 6), 0.09, 0.01, 0.12),
    // left back leg
    at(ctx.cylinder(0.06, 0.07, 0.18, bodyColor, 6), -0.10, 0.01, -0.14),
    // right back leg
    at(ctx.cylinder(0.06, 0.07, 0.18, bodyColor, 6), 0.10, 0.01, -0.14),
    // tail (puffball)
    at(ctx.tileBox(0.10, 0.10, 0.10, bellyColor), 0, 0.22, -0.27),
  ];

  return finish(ctx, 'rabbit', 0.45, 0.60, parts);
}

// ---- pigeon (charcoal body, iridescent neck, folded wings) ----
function buildPigeon(ctx) {
  const bodyColor = 'charcoal';
  const bellyColor = 'paper';
  const neckColor = 'foliage-olive';
  const wingBarColor = 'paper';
  const accentColor = 'terracotta-dark';
  const eyeColor = 'terracotta';

  const parts = [
    // body
    at(ctx.tileBox(0.26, 0.40, 0.24, bodyColor), 0, 0.22, -0.02),
    // belly
    at(ctx.tileBox(0.20, 0.28, 0.10, bellyColor), 0, 0.16, 0.02),
    // neck
    at(ctx.tileBox(0.14, 0.12, 0.16, neckColor), 0, 0.34, 0.12),
    // head
    at(ctx.tileBox(0.18, 0.16, 0.16, bodyColor), 0, 0.46, 0.14),
    // eyes
    at(ctx.tileBox(0.04, 0.03, 0.04, eyeColor), -0.055, 0.48, 0.21),
    at(ctx.tileBox(0.04, 0.03, 0.04, eyeColor), 0.055, 0.48, 0.21),
    // beak
    at(ctx.tileBox(0.05, 0.07, 0.05, accentColor), 0, 0.44, 0.25),
    // left wing (folded)
    at(rot(ctx.tileBox(0.06, 0.30, 0.14, bodyColor), 0, 0.10, 0), -0.15, 0.26, -0.04),
    // left wing bar
    at(rot(ctx.strip(0.015, 0.20, 0.04, wingBarColor), 0, 0.10, 0), -0.185, 0.28, -0.05),
    // right wing (folded)
    at(rot(ctx.tileBox(0.06, 0.30, 0.14, bodyColor), 0, -0.10, 0), 0.15, 0.26, -0.04),
    // right wing bar
    at(rot(ctx.strip(0.015, 0.20, 0.04, wingBarColor), 0, -0.10, 0), 0.185, 0.28, -0.05),
    // tail feathers (sloped)
    at(rot(ctx.tileBox(0.18, 0.12, 0.06, bodyColor), -0.15, 0, 0), 0, 0.26, -0.23),
    // left leg
    at(ctx.cylinder(0.025, 0.03, 0.12, accentColor, 6), -0.07, 0.01, 0.06),
    // right leg
    at(ctx.cylinder(0.025, 0.03, 0.12, accentColor, 6), 0.07, 0.01, 0.06),
    // left foot
    at(ctx.tileBox(0.08, 0.10, 0.03, accentColor), -0.07, 0.025, 0.09),
    // right foot
    at(ctx.tileBox(0.08, 0.10, 0.03, accentColor), 0.07, 0.025, 0.09),
  ];

  return finish(ctx, 'pigeon', 0.45, 0.55, parts);
}

// ---- builder switch ----
function build(entry, ctx) {
  // `dog` is the family preview/default when a caller has not selected a
  // species yet; authored floor placements always pass their explicit kind.
  switch (entry?.kind || entry?.species || 'dog') {
    case 'dog': return buildDog(ctx);
    case 'cat': return buildCat(ctx);
    case 'capybara': return buildCapybara(ctx);
    case 'duck': return buildDuck(ctx);
    case 'rabbit': return buildRabbit(ctx);
    case 'pigeon': return buildPigeon(ctx);
    default: return null;
  }
}

// ---- deterministic placement ----
const ANIMAL_ROSTER = Object.freeze([
  Object.freeze({ id: 'dog-lounge-mid', kind: 'dog', room: 'lounge', u: 0.86, v: 0.43 }),
  Object.freeze({ id: 'dog-lounge-south', kind: 'dog', room: 'lounge', u: 0.86, v: 0.77 }),
  Object.freeze({ id: 'cat-bullpen-northwest', kind: 'cat', room: 'bullpen', u: 0.04, v: 0.08 }),
  Object.freeze({ id: 'cat-bullpen-southeast', kind: 'cat', room: 'bullpen', u: 0.96, v: 0.91 }),
  Object.freeze({ id: 'capybara-lounge-plant', kind: 'capybara', room: 'lounge', u: 0.83, v: 0.18 }),
  Object.freeze({ id: 'duck-lounge-southwest', kind: 'duck', room: 'lounge', u: 0.14, v: 0.89 }),
  Object.freeze({ id: 'rabbit-bullpen-southwest', kind: 'rabbit', room: 'bullpen', u: 0.08, v: 0.82 }),
  Object.freeze({ id: 'pigeon-lounge-northwest', kind: 'pigeon', room: 'lounge', u: 0.16, v: 0.20 }),
]);

function fnv1a(text) {
  let hash = 2166136261;
  const source = String(text);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function namedRoom(sceneSpec, wanted) {
  const rooms = sceneSpec?.rooms || [];
  // Authored animal habitat wins over legacy room anchors. Stable IDs and
  // explicit user edit offsets remain intact; there are no random escapees.
  const habitat = rooms.find((room) => room?.animal_zone === true);
  if (habitat) return habitat;
  if (wanted === 'bullpen') {
    return rooms.find((room) => room?.id === 'bullpen')
      || rooms.find((room) => /bullpen/i.test(String(room?.label || '')));
  }
  return rooms.find((room) => room?.id === 'bench')
    || rooms.find((room) => /lounge/i.test(String(room?.label || '')));
}

function fallbackRoom(sceneSpec) {
  const room = (sceneSpec?.rooms || []).find((entry) => (
    [entry?.x, entry?.y, entry?.w, entry?.h].every(Number.isFinite)
  ));
  if (room) return room;
  const world = sceneSpec?.world || {};
  return {
    x: 0,
    y: 0,
    w: Math.max(4, Number(world.w) || 4),
    h: Math.max(4, Number(world.buildingH ?? world.h) || 4),
  };
}

// Room-relative anchors keep the same eight creatures in quiet edge positions on
// both the default and tall office layouts. The seeded nudge and facing are
// intentionally tiny: stable across reloads, but not arranged like a grid.
function animalPosition(record, sceneSpec, seed) {
  const room = namedRoom(sceneSpec, record.room) || fallbackRoom(sceneSpec);
  const hash = fnv1a(`${seed}:${record.id}:${room.x}:${room.y}:${room.w}:${room.h}`);
  const margin = 0.55;
  const usableWidth = Math.max(0, room.w - margin * 2);
  const usableDepth = Math.max(0, room.h - margin * 2);
  const jitterX = ((hash % 101) / 100 - 0.5) * 0.20;
  const jitterY = (((hash >>> 8) % 101) / 100 - 0.5) * 0.20;
  const facing = ((hash >>> 16) % 360) * Math.PI / 180;
  return {
    x: room.x + margin + usableWidth * record.u + jitterX,
    y: room.y + margin + usableDepth * record.v + jitterY,
    rot: facing,
  };
}

// ---- placement + tick state ----
const placedAnimals = new WeakMap();
const contextByContent = new WeakMap();
const wanderStateByContent = new WeakMap();

const ANIMAL_PLACEMENT_SEED = 'office-animal-placement-v1';
const BOB_FREQ_HZ = 0.55;
const BOB_AMP = 0.012;
const WALK_BOB_AMP = 0.016;
const MIN_TARGET_DISTANCE = 1.2;
const AGENT_CLEARANCE = 0.45;
const ANIMAL_CLEARANCE = 0.15;
const MAX_BLOCKED_S = 0.75;

const WANDER_PROFILE = Object.freeze({
  dog: Object.freeze({ speed: 0.72, range: 4.5, cadence: 1.55 }),
  cat: Object.freeze({ speed: 0.58, range: 3.6, cadence: 1.40 }),
  duck: Object.freeze({ speed: 0.46, range: 3.0, cadence: 1.25 }),
  capybara: Object.freeze({ speed: 0.38, range: 2.6, cadence: 1.15 }),
  rabbit: Object.freeze({ speed: 0.62, range: 3.4, cadence: 1.50 }),
  pigeon: Object.freeze({ speed: 0.50, range: 3.0, cadence: 1.35 }),
});

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function animalRadius(animal) {
  const footprint = animal?.userData?.footprint || {};
  return Math.max(Number(footprint.w) || 0.6, Number(footprint.d) || 0.6) / 2;
}

function movementContext(sceneSpec) {
  const office = globalThis.OFFICE;
  const navigationApi = office?.por?.nav;
  const spatialApi = globalThis.OfficeSpatial;
  let spatialSnapshot = sceneSpec?.spatial || null;
  if (spatialApi) {
    try {
      if (spatialApi.publicationStatus?.() === 'invalid' || !spatialSnapshot) {
        return { sceneSpec, spatialSnapshot, navigation: Object.freeze({ mode: 'failed' }) };
      }
      spatialSnapshot = spatialApi.validate(spatialSnapshot);
      const layout = office?.state?.world?.layout
        || spatialApi.layoutFor?.(spatialSnapshot);
      if (typeof navigationApi?.buildNav !== 'function'
          || typeof navigationApi?.route !== 'function' || !layout) {
        return { sceneSpec, spatialSnapshot, navigation: Object.freeze({ mode: 'failed' }) };
      }
      return {
        sceneSpec,
        spatialSnapshot,
        navigation: Object.freeze({
          mode: 'ready', api: navigationApi,
          grid: navigationApi.buildNav(layout, spatialSnapshot),
        }),
      };
    } catch {
      return { sceneSpec, spatialSnapshot, navigation: Object.freeze({ mode: 'failed' }) };
    }
  }
  try {
    const required = globalThis.__OFFICE_SPATIAL_REQUIRED__ === true
      || [...(globalThis.document?.scripts || [])].some((script) =>
      /(?:^|\/)office\.spatial\.js(?:[?#]|$)/.test(String(script?.src || '')));
    if (required) {
      return { sceneSpec, spatialSnapshot, navigation: Object.freeze({ mode: 'failed' }) };
    }
  } catch (_) { /* isolated non-browser compatibility */ }
  const blockingRects = (spatialSnapshot?.furnitureRects || []).flatMap((rect) => (
    [rect?.x, rect?.y, rect?.w, rect?.d].every(Number.isFinite)
      ? [Object.freeze({ x: rect.x, z: rect.y, w: rect.w, d: rect.d })] : []
  ));
  return {
    sceneSpec,
    spatialSnapshot,
    navigation: Object.freeze({
      mode: 'fallback',
      blockingRects: Object.freeze(blockingRects),
    }),
  };
}

function isBlockedTile(tileKey, grid) {
  return grid?.blockedTiles?.has(tileKey) === true;
}

function liveAgentPositions(sceneSpec) {
  const positions = [];
  const actors = globalThis.OFFICE?.state?.actors;
  if (typeof actors?.values === 'function') {
    for (const actor of actors.values()) {
      if (Number.isFinite(actor?.x) && Number.isFinite(actor?.y)) {
        positions.push({ x: actor.x, z: actor.y });
      }
    }
  }
  if (positions.length) return positions;
  for (const agent of sceneSpec?.agents || []) {
    if (Number.isFinite(agent?.x) && Number.isFinite(agent?.y)) {
      positions.push({ x: agent.x, z: agent.y });
    }
  }
  return positions;
}

function positionClearsOccupants(animal, x, z, animals, sceneSpec) {
  const radius = animalRadius(animal);
  for (const agent of liveAgentPositions(sceneSpec)) {
    if (Math.hypot(x - agent.x, z - agent.z) < radius + AGENT_CLEARANCE) return false;
  }
  for (const other of animals) {
    if (other === animal || other?.isObject3D !== true) continue;
    if (Math.hypot(x - other.position.x, z - other.position.z)
        < radius + animalRadius(other) + ANIMAL_CLEARANCE) return false;
  }
  return true;
}

function pointInsideExpandedRect(x, z, rect, padding) {
  return x >= rect.x - padding && x <= rect.x + rect.w + padding
    && z >= rect.z - padding && z <= rect.z + rect.d + padding;
}

function segmentIntersectsExpandedRect(ax, az, bx, bz, rect, padding) {
  const minX = rect.x - padding;
  const maxX = rect.x + rect.w + padding;
  const minZ = rect.z - padding;
  const maxZ = rect.z + rect.d + padding;
  const dx = bx - ax;
  const dz = bz - az;
  let tMin = 0;
  let tMax = 1;
  for (const [origin, delta, low, high] of [
    [ax, dx, minX, maxX],
    [az, dz, minZ, maxZ],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < low || origin > high) return false;
      continue;
    }
    const near = (low - origin) / delta;
    const far = (high - origin) / delta;
    tMin = Math.max(tMin, Math.min(near, far));
    tMax = Math.min(tMax, Math.max(near, far));
    if (tMin > tMax) return false;
  }
  return true;
}

function fallbackRouteIsClear(animal, target, navigation) {
  const padding = animalRadius(animal);
  for (const rect of navigation.blockingRects) {
    if (pointInsideExpandedRect(target.x, target.z, rect, padding)) return false;
    if (segmentIntersectsExpandedRect(
      animal.position.x,
      animal.position.z,
      target.x,
      target.z,
      rect,
      padding,
    )) return false;
  }
  return true;
}

function insideWanderRoom(point, room) {
  return point.x >= room.minX && point.x <= room.maxX
    && point.z >= room.minZ && point.z <= room.maxZ;
}

function beginPause(wander, minimum = 0.8, range = 1.7) {
  wander.pauseS = minimum + wander.random() * range;
  wander.route = [];
  wander.routeIndex = 0;
  wander.blockedS = 0;
}

function planWander(animal, animals, context) {
  const wander = animal.userData.wander;
  const navigation = context.navigation;
  if (navigation.mode === 'failed') return false;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const angle = wander.random() * Math.PI * 2;
    const distance = MIN_TARGET_DISTANCE
      + wander.random() * (wander.range - MIN_TARGET_DISTANCE);
    const target = {
      x: Math.min(wander.room.maxX, Math.max(
        wander.room.minX,
        animal.position.x + Math.cos(angle) * distance,
      )),
      z: Math.min(wander.room.maxZ, Math.max(
        wander.room.minZ,
        animal.position.z + Math.sin(angle) * distance,
      )),
    };
    if (Math.hypot(target.x - animal.position.x, target.z - animal.position.z)
        < MIN_TARGET_DISTANCE) continue;
    if (!positionClearsOccupants(animal, target.x, target.z, animals, context.sceneSpec)) continue;

    let route;
    if (navigation.mode === 'ready') {
      const tileKey = `${Math.floor(target.x)},${Math.floor(target.z)}`;
      if (isBlockedTile(tileKey, navigation.grid)) continue;
      let rawRoute;
      try {
        rawRoute = navigation.api.route(
          animal.position.x,
          animal.position.z,
          target.x,
          target.z,
          navigation.grid,
        );
      } catch {
        return false;
      }
      if (!Array.isArray(rawRoute) || !rawRoute.length) continue;
      route = rawRoute.map((point) => ({ x: point?.x, z: point?.y }));
      if (route.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.z)
          || !insideWanderRoom(point, wander.room))) continue;
    } else {
      if (!fallbackRouteIsClear(animal, target, navigation)) continue;
      route = [target];
    }

    wander.route = route;
    wander.routeIndex = 0;
    wander.blockedS = 0;
    return true;
  }
  return false;
}

function stepWander(animal, animals, context, dt) {
  const wander = animal.userData.wander;
  if (!wander) return false;
  if (wander.pauseS > 0) {
    wander.pauseS = Math.max(0, wander.pauseS - dt);
    return false;
  }

  if (!wander.route.length || wander.routeIndex >= wander.route.length) {
    if (!planWander(animal, animals, context)) {
      beginPause(wander, 0.3, 0.4);
      return false;
    }
  }

  const waypoint = wander.route[wander.routeIndex];
  const dx = waypoint.x - animal.position.x;
  const dz = waypoint.z - animal.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 1e-8) {
    wander.routeIndex += 1;
    if (wander.routeIndex >= wander.route.length) beginPause(wander);
    return false;
  }

  const travel = Math.min(distance, wander.speed * dt);
  const nextX = animal.position.x + dx / distance * travel;
  const nextZ = animal.position.z + dz / distance * travel;
  if (!insideWanderRoom({ x: nextX, z: nextZ }, wander.room)
      || !positionClearsOccupants(animal, nextX, nextZ, animals, context.sceneSpec)) {
    wander.blockedS += dt;
    if (wander.blockedS >= MAX_BLOCKED_S) beginPause(wander, 0.3, 0.4);
    return false;
  }

  const movedX = nextX - animal.position.x;
  const movedZ = nextZ - animal.position.z;
  animal.position.set(nextX, 0, nextZ);
  animal.rotation.y = Math.atan2(movedX, movedZ);
  wander.blockedS = 0;
  if (travel >= distance - 1e-8) {
    wander.routeIndex += 1;
    if (wander.routeIndex >= wander.route.length) beginPause(wander);
  }
  return true;
}

function advanceBob(animal, dt, moving) {
  const wander = animal.userData.wander;
  const frequency = moving ? wander?.cadence || 1.25 : BOB_FREQ_HZ;
  animal.userData.bobPhase = (animal.userData.bobPhase || 0)
    + frequency * dt * Math.PI * 2;
  while (animal.userData.bobPhase > Math.PI * 2) animal.userData.bobPhase -= Math.PI * 2;
  while (animal.userData.bobPhase < 0) animal.userData.bobPhase += Math.PI * 2;
  animal.userData.wanderMoving = moving;
}

function stateStoreFor(content) {
  let store = wanderStateByContent.get(content);
  if (store) return store;
  store = new Map();
  wanderStateByContent.set(content, store);
  return store;
}

function clearWanderRoute(state) {
  if (!state) return;
  state.route = [];
  state.routeIndex = 0;
  state.blockedS = 0;
  state.pauseS = 0;
}

function contextAuthorityCurrent(context) {
  const spatialApi = globalThis.OfficeSpatial;
  if (!spatialApi) return true;
  const status = spatialApi.publicationStatus?.();
  if (status === 'invalid') return false;
  if (status === 'published') {
    try { return spatialApi.current?.() === context?.spatialSnapshot; }
    catch { return false; }
  }
  return context?.spatialSnapshot != null;
}

function wanderRoomFor(object, record, sceneSpec, offset = { x: 0, y: 0 }) {
  const room = namedRoom(sceneSpec, record.room) || fallbackRoom(sceneSpec);
  const margin = Math.max(0.55, animalRadius(object) + 0.15);
  return Object.freeze({
    minX: room.x + margin + offset.x,
    maxX: room.x + room.w - margin + offset.x,
    minZ: room.y + margin + offset.y,
    maxZ: room.y + room.h - margin + offset.y,
  });
}

function sameWanderRoom(left, right) {
  return left && right
    && left.minX === right.minX && left.maxX === right.maxX
    && left.minZ === right.minZ && left.maxZ === right.maxZ;
}

function freshWanderState(record, position, room, index) {
  const profile = WANDER_PROFILE[record.kind] || WANDER_PROFILE.cat;
  const random = seededRandom(fnv1a(`${ANIMAL_PLACEMENT_SEED}:${record.id}:wander`));
  return {
    random,
    speed: profile.speed,
    range: profile.range,
    cadence: profile.cadence,
    pauseS: 0.15 + random() * 1.05,
    route: [],
    routeIndex: 0,
    blockedS: 0,
    room,
    x: position.x,
    z: position.y,
    rotationY: position.rot,
    bobPhase: index * Math.PI * 2 / ANIMAL_ROSTER.length,
    moving: false,
    offsetX: Number(position.offsetX) || 0,
    offsetY: Number(position.offsetY) || 0,
  };
}

function alignWanderOffset(state, offset) {
  if (!state || typeof state !== 'object') return;
  const oldX = Number.isSafeInteger(state.offsetX) ? state.offsetX : 0;
  const oldY = Number.isSafeInteger(state.offsetY) ? state.offsetY : 0;
  const dx = offset.x - oldX;
  const dy = offset.y - oldY;
  if (dx || dy) {
    if (Number.isFinite(state.x)) state.x += dx;
    if (Number.isFinite(state.z)) state.z += dy;
    if (state.room && typeof state.room === 'object') {
      state.room = Object.freeze({
        minX: state.room.minX + dx,
        maxX: state.room.maxX + dx,
        minZ: state.room.minZ + dy,
        maxZ: state.room.maxZ + dy,
      });
    }
    if (Array.isArray(state.route)) {
      state.route = state.route.map((point) => ({ x: point.x + dx, z: point.z + dy }));
    }
  }
  state.offsetX = offset.x;
  state.offsetY = offset.y;
}

function restorableWanderState(state, room) {
  return typeof state?.random === 'function'
    && sameWanderRoom(state.room, room)
    && Number.isFinite(state.x) && Number.isFinite(state.z)
    && Number.isFinite(state.rotationY) && Number.isFinite(state.bobPhase)
    && insideWanderRoom({ x: state.x, z: state.z }, room);
}

function applyBobPose(object) {
  const moving = object.userData.wanderMoving === true;
  const amplitude = moving ? WALK_BOB_AMP : (object.userData.bobAmp || BOB_AMP);
  const phase = Number(object.userData.bobPhase) || 0;
  const body = object.getObjectByName(`animal-parts:${object.userData.species}`);
  if (!body) return;
  body.position.y = amplitude + Math.sin(phase) * amplitude;
  body.rotation.z = Math.sin(phase * 0.7) * (moving ? 0.03 : 0.02);
}

function restoreWanderState(object, state) {
  object.position.set(state.x, 0, state.z);
  object.rotation.y = state.rotationY;
  object.userData.wander = state;
  object.userData.bobPhase = state.bobPhase;
  object.userData.wanderMoving = state.moving === true;
  applyBobPose(object);
}

function persistWanderState(animal) {
  const state = animal.userData.wander;
  if (!state) return;
  state.x = animal.position.x;
  state.z = animal.position.z;
  state.rotationY = animal.rotation.y;
  state.bobPhase = animal.userData.bobPhase;
  state.moving = animal.userData.wanderMoving === true;
}

function animalsIn(content) {
  const tracked = placedAnimals.get(content);
  if (Array.isArray(tracked) && tracked.every((animal) => animal?.parent === content)) return tracked;
  const found = (content?.children || []).filter((node) => (
    typeof node?.userData?.decorativeAnimalId === 'string'
  ));
  placedAnimals.set(content, found);
  return found;
}

function overrideFor(sceneSpec, id) {
  const value = sceneSpec?.animal_overrides?.[id];
  const valid = value?.kind === 'animal' && value?.id === id;
  const offset = valid ? value.offset || {} : {};
  return Object.freeze({
    removed: valid && value.removed === true,
    offset: Object.freeze({
      x: Number.isSafeInteger(offset.x) ? offset.x : 0,
      y: Number.isSafeInteger(offset.y) ? offset.y : 0,
    }),
  });
}

function matchesRoster(current, desired, sceneSpec) {
  if (current.length !== desired.length) return false;
  return desired.every((record, index) => {
    const animal = current[index];
    const override = overrideFor(sceneSpec, record.id);
    const room = animal?.isObject3D === true
      ? wanderRoomFor(animal, record, sceneSpec, override.offset) : null;
    return animal?.parent
      && animal.userData?.decorativeAnimalId === record.id
      && animal.userData?.entityOffset?.x === override.offset.x
      && animal.userData?.entityOffset?.y === override.offset.y
      && sameWanderRoom(animal.userData?.wander?.room, room);
  });
}

export function refreshAnimalMovement(content, sceneSpec) {
  if (!content || content.isObject3D !== true) return;
  const priorContext = contextByContent.get(content);
  const nextContext = movementContext(sceneSpec);
  const authorityChanged = priorContext
    && (priorContext.spatialSnapshot !== nextContext.spatialSnapshot
      || priorContext.navigation?.mode !== nextContext.navigation?.mode);
  contextByContent.set(content, nextContext);
  if (authorityChanged) {
    for (const state of stateStoreFor(content).values()) {
      clearWanderRoute(state);
    }
  }
  return nextContext;
}

export function placeAnimals(content, ctx, sceneSpec) {
  if (!content || content.isObject3D !== true) return;
  refreshAnimalMovement(content, sceneSpec);
  const current = animalsIn(content);
  const desired = ANIMAL_ROSTER.filter((record) => !overrideFor(sceneSpec, record.id).removed);
  if (matchesRoster(current, desired, sceneSpec)) return current;

  for (const animal of current) content.remove?.(animal);

  const stateStore = stateStoreFor(content);
  const animals = [];
  for (let index = 0; index < desired.length; index += 1) {
    const record = desired[index];
    const override = overrideFor(sceneSpec, record.id);
    const base = animalPosition(record, sceneSpec, ANIMAL_PLACEMENT_SEED);
    const pos = {
      x: base.x + override.offset.x,
      y: base.y + override.offset.y,
      rot: base.rot,
      offsetX: override.offset.x,
      offsetY: override.offset.y,
    };

    const entry = { kind: record.kind, x: pos.x, y: pos.y, rot: 0 };
    const object = build(entry, ctx);

    if (!object) continue;

    object.userData.bobAmp = BOB_AMP;
    object.userData.decorativeAnimalId = record.id;
    object.userData.entityOffset = override.offset;
    object.userData.nonBlocking = true;
    const room = wanderRoomFor(object, record, sceneSpec, override.offset);
    let state = stateStore.get(record.id);
    alignWanderOffset(state, override.offset);
    if (!restorableWanderState(state, room)) {
      state = freshWanderState(record, pos, room, index);
      stateStore.set(record.id, state);
    }
    restoreWanderState(object, state);

    content.add(object);
    animals.push(object);
  }

  placedAnimals.set(content, animals);
  return animals;
}

export function tickAnimals(content, dt) {
  if (!Number.isFinite(dt) || !(dt > 0)) return;
  const animals = animalsIn(content);
  if (!animals.length) return;
  const context = contextByContent.get(content);
  if (!context) return;
  if (!contextAuthorityCurrent(context)) {
    for (const animal of animals) clearWanderRoute(animal?.userData?.wander);
    return;
  }

  const simulatedS = Math.min(dt, 2);
  const stepCount = Math.min(40, Math.max(1, Math.ceil(simulatedS / 0.05)));
  const stepS = simulatedS / stepCount;
  for (let step = 0; step < stepCount; step += 1) {
    for (const animal of animals) {
      if (!animal || animal.isObject3D !== true) continue;
      const moving = stepWander(animal, animals, context, stepS);
      advanceBob(animal, stepS, moving);
    }
  }

  for (const animal of animals) {
    if (!animal || animal.isObject3D !== true) continue;
    persistWanderState(animal);
    applyBobPose(animal);
  }
}

// ---- registry initializer ----
export function init(reg) {
  reg.registerMesh('animals', build);
}
