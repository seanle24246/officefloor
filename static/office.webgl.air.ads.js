/* office.webgl.air.ads.js — detailed ambient ad aircraft for the live floor. */

import * as THREE from './vendor/three.module.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { palette, vertexColorMaterial } from './office.webgl.palette.js';

const LAYER_NAME = 'office-webgl-air-ads';
const TAU = Math.PI * 2;
const BANNER_COLUMNS = 12;
export const BANNER_DROP = 0.66;
export const BANNER_SAG = 0.18;
export const BANNER_HALF_HEIGHT = 0.58;
export const BIPLANE_BOB_AMPLITUDE = 0.10;
export const AIR_AD_CLEARANCE = 0.50;
const ATLAS_WIDTH = 512;
const ATLAS_HEIGHT = 256;
const AD_REGION_HEIGHT = ATLAS_HEIGHT / 2;
// Preserve the retired duty-cycle crossing lengths: 48000 * 0.86 and 22000 * 0.82.
export const BLIMP_CROSSING_MS = 41280;
export const PLANE_CROSSING_MS = 18040;
const AIR_AD_INTERVAL_MS = 600000;
const AIR_AD_JITTER_MS = 60000;
const AIR_AD_FIRST_MIN_MS = 30000;
const AIR_AD_FIRST_MAX_MS = 90000;
const DEFAULT_AIR_AD_SCHEDULE_SEED = 0x0ff1ce;
const BLIMP_ALTITUDE_OFFSET = 0.35;
const BLIMP_BOB_AMPLITUDE = 0.16;
const WALL_H_PX = 62;
const DEFAULT_HEIGHT_UNIT_PX = 32;
const DYNAMIC_CEILING_ROOTS = new Set([
  LAYER_NAME,
  'office-webgl-agents',
  'office-webgl-ufo',
  'office-webgl-vignettes',
  'office-webgl-bouts',
]);

export const AIR_AD_COPY = Object.freeze({
  blimp: Object.freeze({
    eyebrow: 'THE OFFICE',
    headline: 'AGENTS AT WORK',
    subline: 'LIVE FLOOR / CLEAR SIGNALS',
  }),
  biplane: Object.freeze({
    eyebrow: 'THE OFFICE AIR',
    headline: 'SHIP IT TOGETHER',
    subline: 'REAL WORK / ZERO STATIC',
  }),
});

// Deterministic 5x7 face: crisp at the office's 2:1 pixel-art scale and DOM-free.
const PIXEL_FONT = Object.freeze({
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
});

function positiveOr(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function ownedGeometry(geometry) {
  geometry.userData.officeAirAdsOwned = true;
  return geometry;
}

function hexRgb(value) {
  const color = String(value || '#000000').replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
}

function fillPixels(data, x, y, width, height, color) {
  const [red, green, blue] = hexRgb(color);
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(ATLAS_WIDTH, Math.ceil(x + width));
  const y1 = Math.min(ATLAS_HEIGHT, Math.ceil(y + height));
  for (let row = y0; row < y1; row += 1) {
    for (let column = x0; column < x1; column += 1) {
      const offset = (row * ATLAS_WIDTH + column) * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = 255;
    }
  }
}

function textWidth(text, scale) {
  return Math.max(0, String(text).length * 6 - 1) * scale;
}

function drawPixelText(data, text, centerX, y, scale, color) {
  const value = String(text).toUpperCase();
  let cursor = Math.round(centerX - textWidth(value, scale) / 2);
  for (const character of value) {
    const glyph = PIXEL_FONT[character] || PIXEL_FONT[' '];
    glyph.forEach((row, rowIndex) => {
      for (let column = 0; column < row.length; column += 1) {
        if (row[column] === '1') {
          fillPixels(data, cursor + column * scale, y + rowIndex * scale, scale, scale, color);
        }
      }
    });
    cursor += 6 * scale;
  }
}

function paintAdRegion(data, regionY, copy, accent) {
  fillPixels(data, 0, regionY, ATLAS_WIDTH, AD_REGION_HEIGHT, palette['graphite-dark']);
  fillPixels(data, 0, regionY, ATLAS_WIDTH, 13, accent);
  fillPixels(data, 0, regionY + AD_REGION_HEIGHT - 9, ATLAS_WIDTH, 9, accent);
  fillPixels(data, 5, regionY + 5, ATLAS_WIDTH - 10, 3, palette.brass);
  fillPixels(data, 5, regionY + AD_REGION_HEIGHT - 8, ATLAS_WIDTH - 10, 3, palette.brass);
  drawPixelText(data, copy.eyebrow, ATLAS_WIDTH / 2, regionY + 18, 2, palette.brass);
  drawPixelText(data, copy.headline, ATLAS_WIDTH / 2, regionY + 43, 5, palette.cream);
  drawPixelText(data, copy.subline, ATLAS_WIDTH / 2, regionY + 91, 2, palette.paper);
}

export function createAdAtlas(options = {}) {
  const Three = options.THREE || THREE;
  const data = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  paintAdRegion(data, 0, AIR_AD_COPY.biplane, palette.blue);
  paintAdRegion(data, AD_REGION_HEIGHT, AIR_AD_COPY.blimp, palette.terracotta);
  const texture = new Three.DataTexture(
    data, ATLAS_WIDTH, ATLAS_HEIGHT, Three.RGBAFormat, Three.UnsignedByteType,
  );
  texture.name = 'office-air-ad-atlas';
  texture.colorSpace = Three.SRGBColorSpace;
  texture.minFilter = Three.NearestFilter;
  texture.magFilter = Three.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = true;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  texture.userData.officeAirAdsOwned = true;
  texture.userData.copy = AIR_AD_COPY;
  return texture;
}

function adMaterial(atlas, options = {}) {
  const Three = options.THREE || THREE;
  const material = new Three.MeshBasicMaterial({
    map: atlas,
    side: Three.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  material.userData.officeAirAdsOwned = true;
  material.userData.officeAirAdPresentation = 'flat-readable-label';
  return material;
}

function transformedGeometry(geometry, colorValue, transform, Three = THREE) {
  const matrix = new Three.Matrix4().compose(
    new Three.Vector3(...(transform?.position || [0, 0, 0])),
    new Three.Quaternion().setFromEuler(new Three.Euler(...(transform?.rotation || [0, 0, 0]))),
    new Three.Vector3(...(transform?.scale || [1, 1, 1])),
  );
  geometry.applyMatrix4(matrix);
  geometry.deleteAttribute('uv');
  const color = new Three.Color(colorValue);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let index = 0; index < geometry.attributes.position.count; index += 1) {
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new Three.BufferAttribute(colors, 3));
  return geometry;
}

function batchedGeometry(name, parts, options = {}) {
  const Three = options.THREE || THREE;
  const merge = options.mergeGeometries || mergeGeometries;
  const geometries = parts.map(({ geometry, color, transform }) => (
    transformedGeometry(geometry, color, transform, Three)
  ));
  const merged = merge(geometries, false);
  for (const geometry of geometries) geometry.dispose?.();
  if (!merged) throw new Error(`air ad batch could not merge ${name}`);
  merged.name = `${name}-geometry`;
  ownedGeometry(merged);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function batchedMesh(name, parts, options = {}) {
  const Three = options.THREE || THREE;
  const mesh = new Three.Mesh(batchedGeometry(name, parts, options), vertexColorMaterial);
  mesh.name = name;
  return mesh;
}

function polygonPrism(points, thickness, plane = 'xy', Three = THREE) {
  const half = thickness / 2;
  const coordinates = [];
  const point3 = (point, side) => (
    plane === 'xz' ? [point[0], side * half, point[1]] : [point[0], point[1], side * half]
  );
  for (const side of [1, -1]) for (const point of points) coordinates.push(...point3(point, side));
  const count = points.length;
  const indices = [];
  for (let index = 1; index < count - 1; index += 1) {
    if (plane === 'xz') {
      indices.push(0, index + 1, index, count, count + index, count + index + 1);
    } else {
      indices.push(0, index, index + 1, count, count + index + 1, count + index);
    }
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(index, next, count + next, index, count + next, count + index);
  }
  const geometry = new Three.BufferGeometry();
  geometry.setAttribute('position', new Three.Float32BufferAttribute(coordinates, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function wingPrism(span, chord, thickness, Three = THREE) {
  return polygonPrism([
    [-chord * 0.54, -span * 0.46],
    [chord * 0.32, -span * 0.50],
    [chord * 0.52, -span * 0.42],
    [chord * 0.52, span * 0.42],
    [chord * 0.32, span * 0.50],
    [-chord * 0.54, span * 0.46],
  ], thickness, 'xz', Three);
}

function flatAdGeometry(width, height, atlasRow, Three = THREE) {
  const geometry = ownedGeometry(new Three.PlaneGeometry(width, height, 1, 1));
  const uv = geometry.attributes.uv;
  const vMin = atlasRow === 'blimp' ? 0.5 : 0;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setY(index, vMin + uv.getY(index) * 0.5);
  }
  uv.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function propellerParts(Three = THREE) {
  return [
    { geometry: new Three.BoxGeometry(0.07, 1.20, 0.11), color: palette['wood-dark'] },
    { geometry: new Three.BoxGeometry(0.07, 0.11, 1.20), color: palette['wood-dark'] },
    { geometry: new Three.SphereGeometry(0.13, 8, 5), color: palette.brass },
  ];
}

function buildBlimp(atlas, options = {}) {
  const Three = options.THREE || THREE;
  const parts = [
    {
      geometry: new Three.SphereGeometry(1, 18, 10), color: palette['sage-light'],
      transform: { scale: [3.55, 0.86, 0.96] },
    },
    ...[-2.65, -1.95, -1.25, -0.55, 0.2, 0.95, 1.65, 2.35].map((x) => {
      const radius = Math.sqrt(Math.max(0.12, 1 - (x * x) / (3.55 * 3.55)));
      return {
        geometry: new Three.TorusGeometry(0.91 * radius, 0.018, 4, 18),
        color: palette['sage-dark'],
        transform: { position: [x, 0, 0], rotation: [0, Math.PI / 2, 0] },
      };
    }),
    {
      geometry: polygonPrism([
        [-3.55, 0.12], [-2.15, 0.55], [-1.95, 1.55], [-3.10, 1.08],
      ], 0.13, 'xy', Three),
      color: palette['sage-dark'],
    },
    {
      geometry: polygonPrism([
        [-3.55, -0.12], [-3.10, -1.08], [-1.95, -1.55], [-2.15, -0.55],
      ], 0.13, 'xy', Three),
      color: palette['sage-dark'],
    },
    {
      geometry: polygonPrism([
        [-3.55, 0.12], [-2.15, 0.55], [-1.95, 1.45], [-3.10, 1.02],
      ], 0.12, 'xz', Three),
      color: palette.sage,
    },
    {
      geometry: polygonPrism([
        [-3.55, -0.12], [-3.10, -1.02], [-1.95, -1.45], [-2.15, -0.55],
      ], 0.12, 'xz', Three),
      color: palette.sage,
    },
    {
      geometry: new Three.CapsuleGeometry(0.29, 1.55, 4, 10), color: palette['wood-dark'],
      transform: { position: [0.5, -1.22, 0], rotation: [0, 0, -Math.PI / 2] },
    },
    ...[-0.15, 0.25, 0.65, 1.05, 1.45].flatMap((x) => [1, -1].map((side) => ({
      geometry: new Three.BoxGeometry(0.22, 0.18, 0.025), color: palette.glass,
      transform: { position: [x, -1.20, side * 0.295] },
    }))),
    ...[-0.35, 0.35, 1.05].map((x) => ({
      geometry: new Three.BoxGeometry(0.07, 0.64, 0.07), color: palette.metal,
      transform: { position: [x, -0.76, 0] },
    })),
    ...[1, -1].map((side) => ({
      geometry: new Three.CylinderGeometry(0.16, 0.22, 0.64, 8), color: palette['metal-dark'],
      transform: { position: [0.42, -0.34, side * 1.16], rotation: [0, 0, -Math.PI / 2] },
    })),
    {
      geometry: new Three.CylinderGeometry(0.14, 0.20, 0.58, 8), color: palette['metal-dark'],
      transform: { position: [-2.34, -0.56, 0], rotation: [0, 0, -Math.PI / 2] },
    },
    {
      geometry: new Three.CylinderGeometry(0.04, 0.16, 0.42, 8), color: palette.brass,
      transform: { position: [3.66, 0, 0], rotation: [0, 0, -Math.PI / 2] },
    },
    ...[
      { position: [-2.20, 1.42, 0], color: palette.red },
      { position: [-2.20, -1.42, 0], color: palette.amber },
      { position: [-2.20, 0, 1.34], color: palette.green },
      { position: [-2.20, 0, -1.34], color: palette.red },
    ].map(({ position, color }) => ({
      geometry: new Three.SphereGeometry(0.07, 7, 4), color,
      transform: { position },
    })),
  ];

  const body = batchedMesh('air-ad-part:blimp-airframe', parts, { ...options, THREE: Three });
  const panel = new Three.Mesh(
    flatAdGeometry(4.65, 1.18, 'blimp', Three),
    adMaterial(atlas, { ...options, THREE: Three }),
  );
  panel.name = 'air-ad-part:blimp-ad-billboard';
  panel.userData.officeAirAdSurface = 'camera-facing-2d';
  panel.userData.officeAirAdPresentation = 'flat-readable-label';
  panel.frustumCulled = false;
  panel.renderOrder = 10000;

  const propellerGeometry = batchedGeometry(
    'air-ad-part:blimp-propellers', propellerParts(Three), { ...options, THREE: Three },
  );
  const propellers = new Three.InstancedMesh(propellerGeometry, vertexColorMaterial, 3);
  propellers.name = 'air-ad-part:blimp-propellers';
  propellers.instanceMatrix.setUsage(Three.DynamicDrawUsage);
  propellers.frustumCulled = false;

  const blimp = new Three.Group();
  blimp.name = 'air-ad:blimp';
  blimp.userData.officeAirAdKind = 'blimp';
  blimp.userData.frontAxis = '+X';
  blimp.add(body, propellers);
  return { blimp, blimpPanel: panel, blimpPropellers: propellers };
}

function biplaneRigging(Three = THREE) {
  const positions = [];
  const line = (a, b) => positions.push(...a, ...b);
  for (const side of [-1, 1]) {
    const inner = side * 0.72;
    const outer = side * 1.38;
    line([-0.28, -0.02, inner], [0.42, 0.86, inner]);
    line([0.42, -0.02, inner], [-0.28, 0.86, inner]);
    line([-0.28, -0.02, outer], [0.42, 0.86, outer]);
    line([0.42, -0.02, outer], [-0.28, 0.86, outer]);
    line([0.06, -0.58, side * 0.55], [0.34, -0.08, side * 0.18]);
  }
  const geometry = ownedGeometry(new Three.BufferGeometry());
  geometry.setAttribute('position', new Three.Float32BufferAttribute(positions, 3));
  const material = new Three.LineBasicMaterial({ color: palette['graphite-dark'] });
  material.userData.officeAirAdsOwned = true;
  const rigging = new Three.LineSegments(geometry, material);
  rigging.name = 'air-ad-part:biplane-rigging';
  return rigging;
}

function buildBiplane(options = {}) {
  const Three = options.THREE || THREE;
  const parts = [
    {
      geometry: new Three.CylinderGeometry(0.20, 0.37, 2.60, 10), color: palette.terracotta,
      transform: { position: [-0.08, 0.18, 0], rotation: [0, 0, -Math.PI / 2] },
    },
    {
      geometry: new Three.CylinderGeometry(0.31, 0.31, 0.52, 12), color: palette['metal-dark'],
      transform: { position: [1.48, 0.18, 0], rotation: [0, 0, -Math.PI / 2] },
    },
    {
      geometry: new Three.TorusGeometry(0.32, 0.055, 5, 12), color: palette.brass,
      transform: { position: [1.73, 0.18, 0], rotation: [0, Math.PI / 2, 0] },
    },
    ...Array.from({ length: 8 }, (_, index) => {
      const angle = index / 8 * TAU;
      return {
        geometry: new Three.CylinderGeometry(0.055, 0.055, 0.31, 6), color: palette.graphite,
        transform: {
          position: [1.58, 0.18 + Math.cos(angle) * 0.30, Math.sin(angle) * 0.30],
          rotation: [angle, 0, 0],
        },
      };
    }),
    {
      geometry: wingPrism(3.85, 1.15, 0.12, Three), color: palette.cream,
      transform: { position: [-0.03, -0.04, 0] },
    },
    {
      geometry: wingPrism(4.15, 1.18, 0.13, Three), color: palette.cream,
      transform: { position: [0.20, 0.88, 0] },
    },
    ...[-1.72, 1.72].flatMap((z) => [-0.18, 0.48].map((x) => ({
      geometry: new Three.BoxGeometry(0.075, 0.90, 0.075), color: palette['wood-dark'],
      transform: { position: [x, 0.42, z], rotation: [0, 0, x < 0 ? -0.08 : 0.08] },
    }))),
    ...[-1.82, 1.82].map((z) => ({
      geometry: new Three.BoxGeometry(0.30, 0.05, 0.22), color: palette.terracotta,
      transform: { position: [0.23, 0.96, z] },
    })),
    {
      geometry: wingPrism(1.62, 0.72, 0.10, Three), color: palette.cream,
      transform: { position: [-1.76, 0.21, 0] },
    },
    {
      geometry: polygonPrism([
        [-2.12, 0.18], [-1.50, 0.30], [-1.70, 1.04], [-2.16, 0.86],
      ], 0.11, 'xy', Three),
      color: palette.blue,
    },
    {
      geometry: new Three.TorusGeometry(0.31, 0.07, 6, 12), color: palette['graphite-dark'],
      transform: { position: [0.06, -0.66, 0.61] },
    },
    {
      geometry: new Three.TorusGeometry(0.31, 0.07, 6, 12), color: palette['graphite-dark'],
      transform: { position: [0.06, -0.66, -0.61] },
    },
    {
      geometry: new Three.CylinderGeometry(0.12, 0.12, 1.22, 8), color: palette.metal,
      transform: { position: [0.06, -0.66, 0], rotation: [Math.PI / 2, 0, 0] },
    },
    ...[-1, 1].map((side) => ({
      geometry: new Three.BoxGeometry(0.09, 0.72, 0.09), color: palette.metal,
      transform: { position: [0.13, -0.34, side * 0.36], rotation: [0, 0, side * 0.27] },
    })),
    {
      geometry: new Three.TorusGeometry(0.27, 0.045, 5, 10), color: palette['wood-dark'],
      transform: { position: [-0.42, 0.54, 0], rotation: [Math.PI / 2, 0, 0] },
    },
    {
      geometry: new Three.SphereGeometry(0.20, 9, 6), color: palette['warm-neutral'],
      transform: { position: [-0.42, 0.70, 0] },
    },
    ...[-0.08, 0.08].map((z) => ({
      geometry: new Three.SphereGeometry(0.055, 7, 4), color: palette.glass,
      transform: { position: [-0.27, 0.75, z] },
    })),
    ...[-0.17, 0, 0.17].map((z) => ({
      geometry: new Three.BoxGeometry(0.32, 0.055, 0.055), color: palette['metal-dark'],
      transform: { position: [1.26, 0.39, z] },
    })),
  ];

  const body = batchedMesh('air-ad-part:biplane-airframe', parts, { ...options, THREE: Three });
  const propeller = batchedMesh(
    'air-ad-part:biplane-propeller', propellerParts(Three), { ...options, THREE: Three },
  );
  propeller.position.set(1.98, 0.18, 0);
  const rigging = biplaneRigging(Three);
  const biplane = new Three.Group();
  biplane.name = 'air-ad:biplane';
  biplane.userData.officeAirAdKind = 'biplane';
  biplane.userData.frontAxis = '+X';
  biplane.add(body, propeller, rigging);
  return { biplane, propeller };
}

function bannerGeometry(Three = THREE) {
  const positions = new Float32Array(BANNER_COLUMNS * 2 * 3);
  const uvs = new Float32Array(BANNER_COLUMNS * 2 * 2);
  const indices = [];
  for (let column = 0; column < BANNER_COLUMNS; column += 1) {
    const u = column / (BANNER_COLUMNS - 1);
    uvs.set([u, 0.5, u, 0], column * 4);
    if (column < BANNER_COLUMNS - 1) {
      const top = column * 2;
      indices.push(top, top + 1, top + 2, top + 2, top + 1, top + 3);
    }
  }
  const geometry = ownedGeometry(new Three.BufferGeometry());
  geometry.setAttribute('position', new Three.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Three.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildBanner(atlas, options = {}) {
  const Three = options.THREE || THREE;
  const banner = new Three.Mesh(bannerGeometry(Three), adMaterial(atlas, { ...options, THREE: Three }));
  banner.name = 'air-ad:biplane-banner';
  banner.userData.officeAirAdSurface = 'camera-facing-2d';
  banner.userData.officeAirAdPresentation = 'flat-readable-label';
  banner.frustumCulled = false;
  banner.renderOrder = 10000;

  const cableGeometry = ownedGeometry(new Three.BufferGeometry());
  cableGeometry.setAttribute('position', new Three.BufferAttribute(new Float32Array(18), 3));
  const cableMaterial = new Three.LineBasicMaterial({ color: palette.brass });
  cableMaterial.userData.officeAirAdsOwned = true;
  const cable = new Three.Line(cableGeometry, cableMaterial);
  cable.name = 'air-ad:biplane-tow-line';
  cable.frustumCulled = false;
  return { banner, cable };
}

export function flightFrame(sceneSpec) {
  const world = sceneSpec?.world || {};
  const width = positiveOr(world.w, 36);
  const worldDepth = positiveOr(world.h, 36);
  const depth = Math.min(worldDepth, positiveOr(world.buildingH, worldDepth));
  return Object.freeze({ width, depth, centerX: width / 2, centerZ: depth / 2 });
}

export function sceneCeiling(options = {}) {
  const Three = options.THREE || THREE;
  const scene = options.scene;
  let ceiling = -Infinity;

  function measure(object) {
    if (!object?.isObject3D || object.visible === false || DYNAMIC_CEILING_ROOTS.has(object.name)) return;
    const bounds = new Three.Box3().setFromObject(object, true);
    if (!bounds.isEmpty() && Number.isFinite(bounds.max.y)) ceiling = Math.max(ceiling, bounds.max.y);
  }

  for (const object of scene?.children || []) {
    if (object.name === 'office-webgl-content') {
      if (object.visible === false) continue;
      for (const child of object.children || []) measure(child);
    } else {
      measure(object);
    }
  }

  if (Number.isFinite(ceiling)) return ceiling;
  return WALL_H_PX / positiveOr(options.heightUnitPx, DEFAULT_HEIGHT_UNIT_PX);
}

export function sampleCrossing(progress, frame, route = 'biplane', options = {}) {
  const margin = route === 'blimp' ? 10 : 12;
  const start = route === 'blimp'
    ? { x: frame.width + margin, z: -margin }
    : { x: -margin, z: frame.depth + margin };
  const end = route === 'blimp'
    ? { x: -margin, z: frame.depth + margin }
    : { x: frame.width + margin, z: -margin };
  const t = Math.max(-0.25, Math.min(1.25, progress));
  const baseDx = end.x - start.x;
  const baseDz = end.z - start.z;
  const length = Math.hypot(baseDx, baseDz) || 1;
  const normalX = -baseDz / length;
  const normalZ = baseDx / length;
  const curve = (route === 'blimp' ? 1.4 : -0.85) * Math.sin(t * Math.PI);
  const curveRate = (route === 'blimp' ? 1.4 : -0.85) * Math.PI * Math.cos(t * Math.PI);
  const x = start.x + baseDx * t + normalX * curve;
  const z = start.z + baseDz * t + normalZ * curve;
  const dx = baseDx + normalX * curveRate;
  const dz = baseDz + normalZ * curveRate;
  const tangentLength = Math.hypot(dx, dz) || 1;
  const ceiling = Number.isFinite(options.ceilingY) ? options.ceilingY : sceneCeiling(options);
  const bannerEnvelope = BANNER_DROP + BANNER_SAG + BANNER_HALF_HEIGHT
    + BIPLANE_BOB_AMPLITUDE + AIR_AD_CLEARANCE;
  const biplaneAltitude = Math.max(6.0, ceiling + bannerEnvelope);
  const altitude = biplaneAltitude + (route === 'blimp' ? BLIMP_ALTITUDE_OFFSET : 0);
  const motion = options.reducedMotion ? 0 : 1;
  const y = altitude + Math.sin(t * TAU * (route === 'blimp' ? 1 : 2))
    * (route === 'blimp' ? BLIMP_BOB_AMPLITUDE : BIPLANE_BOB_AMPLITUDE) * motion;
  return Object.freeze({
    x, y, z,
    tangentX: dx / tangentLength,
    tangentZ: dz / tangentLength,
    yaw: Math.atan2(-dz, dx),
  });
}

function seededUnit(seed, index) {
  let value = (Number.isFinite(seed) ? Math.trunc(seed) : DEFAULT_AIR_AD_SCHEDULE_SEED) >>> 0;
  value = (value + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  value ^= value >>> 15;
  return (value >>> 0) / 0x100000000;
}

function airAdRoute(index) {
  return index % 2 === 0 ? 'blimp' : 'biplane';
}

function airAdDuration(route) {
  return route === 'blimp' ? BLIMP_CROSSING_MS : PLANE_CROSSING_MS;
}

export function airAdCrossingAt(now = 0, seed = DEFAULT_AIR_AD_SCHEDULE_SEED) {
  const elapsed = Math.max(0, Number(now) || 0);
  let index = 0;
  let start = AIR_AD_FIRST_MIN_MS + Math.round(
    seededUnit(seed, index) * (AIR_AD_FIRST_MAX_MS - AIR_AD_FIRST_MIN_MS),
  );
  while (start <= elapsed) {
    const route = airAdRoute(index);
    const duration = airAdDuration(route);
    if (elapsed < start + duration) {
      return Object.freeze({
        index, start, route, visible: true, progress: (elapsed - start) / duration,
      });
    }
    index += 1;
    start += AIR_AD_INTERVAL_MS + Math.round((seededUnit(seed, index) * 2 - 1) * AIR_AD_JITTER_MS);
  }
  return Object.freeze({
    index, start, route: airAdRoute(index), visible: false, progress: 0,
  });
}

function idleCrossingProgress(now, route) {
  const duration = airAdDuration(route);
  return ((Math.max(0, Number(now) || 0) % duration) + duration) % duration / duration;
}

function updateBlimpPropellers(asset, spin, Three = THREE) {
  const positions = [
    [0.78, -0.34, 1.31],
    [0.78, -0.34, -1.31],
    [-2.02, -0.56, 0],
  ];
  const matrix = new Three.Matrix4();
  const scale = new Three.Vector3(0.72, 0.72, 0.72);
  positions.forEach((position, index) => {
    const quaternion = new Three.Quaternion().setFromEuler(new Three.Euler(
      spin * (index === 1 ? -1 : 1), 0, 0,
    ));
    matrix.compose(new Three.Vector3(...position), quaternion, scale);
    asset.blimpPropellers.setMatrixAt(index, matrix);
  });
  asset.blimpPropellers.instanceMatrix.needsUpdate = true;
}

function createScreenFrame(Three = THREE) {
  return {
    quaternion: new Three.Quaternion(),
    right: new Three.Vector3(1, 0, 0),
    up: new Three.Vector3(0, 1, 0),
    forward: new Three.Vector3(0, 0, 1),
  };
}

function updateScreenFrame(frame, camera) {
  frame.quaternion.identity();
  if (camera?.getWorldQuaternion) {
    camera.updateMatrixWorld?.(true);
    camera.getWorldQuaternion(frame.quaternion);
  }
  frame.right.set(1, 0, 0).applyQuaternion(frame.quaternion).normalize();
  frame.up.set(0, 1, 0).applyQuaternion(frame.quaternion).normalize();
  frame.forward.set(0, 0, 1).applyQuaternion(frame.quaternion).normalize();
  return frame;
}

function updateBanner(asset, progress, frame, now, options, view) {
  const anchor = sampleCrossing(progress - 0.082, frame, 'biplane', options);
  const plane = sampleCrossing(progress, frame, 'biplane', options);
  const movingScreenRight = plane.tangentX * view.right.x + plane.tangentZ * view.right.z >= 0;
  const centerX = anchor.x + view.forward.x * 0.10;
  const centerY = anchor.y - BANNER_DROP + view.forward.y * 0.10;
  const centerZ = anchor.z + view.forward.z * 0.10;
  const positions = asset.banner.geometry.attributes.position.array;
  let leadingX = centerX;
  let leadingY = centerY;
  let leadingZ = centerZ;
  for (let column = 0; column < BANNER_COLUMNS; column += 1) {
    const ratio = column / (BANNER_COLUMNS - 1);
    const horizontal = (ratio - 0.5) * 5.20;
    const flutter = options.reducedMotion
      ? 0
      : Math.sin(now * 0.0065 + column * 0.78) * 0.045 * ratio;
    const sag = Math.sin(ratio * Math.PI) * BANNER_SAG;
    const height = BANNER_HALF_HEIGHT * 2 - ratio * 0.07;
    const columnX = centerX + view.right.x * horizontal - view.up.x * sag
      + view.forward.x * flutter;
    const columnY = centerY + view.right.y * horizontal - view.up.y * sag
      + view.forward.y * flutter;
    const columnZ = centerZ + view.right.z * horizontal - view.up.z * sag
      + view.forward.z * flutter;
    const offset = column * 6;
    const halfHeight = height / 2;
    positions[offset] = columnX + view.up.x * halfHeight;
    positions[offset + 1] = columnY + view.up.y * halfHeight;
    positions[offset + 2] = columnZ + view.up.z * halfHeight;
    positions[offset + 3] = columnX - view.up.x * halfHeight;
    positions[offset + 4] = columnY - view.up.y * halfHeight;
    positions[offset + 5] = columnZ - view.up.z * halfHeight;
    if ((movingScreenRight && column === BANNER_COLUMNS - 1)
      || (!movingScreenRight && column === 0)) {
      leadingX = columnX;
      leadingY = columnY;
      leadingZ = columnZ;
    }
  }
  asset.banner.geometry.attributes.position.needsUpdate = true;

  const start = {
    x: plane.x - plane.tangentX * 2.20,
    y: plane.y - 0.04,
    z: plane.z - plane.tangentZ * 2.20,
  };
  const cable = asset.cable.geometry.attributes.position.array;
  for (let point = 0; point < 6; point += 1) {
    const ratio = point / 5;
    const inverse = 1 - ratio;
    cable.set([
      start.x * inverse + leadingX * ratio,
      start.y * inverse + leadingY * ratio - Math.sin(ratio * Math.PI) * BANNER_SAG,
      start.z * inverse + leadingZ * ratio,
    ], point * 3);
  }
  asset.cable.geometry.attributes.position.needsUpdate = true;
}

export function updateAirAds(asset, sceneSpec, now = 0, options = {}) {
  if (!asset?.layer) throw new TypeError('air ad asset is required');
  const Three = options.THREE || THREE;
  const crossingOptions = Number.isFinite(options.ceilingY)
    ? options : { ...options, ceilingY: sceneCeiling(options) };
  const frame = flightFrame(sceneSpec);
  const crossing = airAdCrossingAt(now, options.airAdSeed);
  const blimpVisible = crossing.visible && crossing.route === 'blimp';
  const planeVisible = crossing.visible && crossing.route === 'biplane';
  const blimpProgress = blimpVisible ? crossing.progress : idleCrossingProgress(now, 'blimp');
  const planeProgress = planeVisible ? crossing.progress : idleCrossingProgress(now, 'biplane');
  const blimp = sampleCrossing(blimpProgress, frame, 'blimp', crossingOptions);
  const plane = sampleCrossing(planeProgress, frame, 'biplane', crossingOptions);
  const motion = options.reducedMotion ? 0 : 1;
  const view = updateScreenFrame(asset.billboardFrame, options.camera);

  asset.blimp.visible = blimpVisible;
  asset.blimpPanel.visible = blimpVisible;
  asset.blimp.position.set(blimp.x, blimp.y, blimp.z);
  asset.blimp.rotation.set(
    Math.sin(blimpProgress * TAU) * 0.018 * motion,
    blimp.yaw,
    Math.sin(blimpProgress * TAU * 2) * 0.025 * motion,
    'YXZ',
  );
  asset.blimpPanel.position.set(
    blimp.x + view.forward.x * 1.06 - view.up.x * 0.04,
    blimp.y + view.forward.y * 1.06 - view.up.y * 0.04,
    blimp.z + view.forward.z * 1.06 - view.up.z * 0.04,
  );
  asset.blimpPanel.quaternion.copy(view.quaternion);
  updateBlimpPropellers(asset, now * 0.008 * motion, Three);

  asset.biplane.visible = planeVisible;
  asset.banner.visible = planeVisible;
  asset.cable.visible = planeVisible;
  asset.biplane.position.set(plane.x, plane.y, plane.z);
  asset.biplane.rotation.set(
    Math.sin(planeProgress * TAU * 2) * 0.045 * motion,
    plane.yaw,
    -Math.sin(planeProgress * Math.PI) * 0.08 * motion,
    'YXZ',
  );
  asset.propeller.rotation.x = now * 0.026 * motion;
  updateBanner(asset, planeProgress, frame, now, crossingOptions, view);
  asset.layer.visible = true;
  return asset;
}

export function buildAirAds(options = {}) {
  const Three = options.THREE || THREE;
  const atlas = options.atlas || createAdAtlas({ ...options, THREE: Three });
  const layer = new Three.Group();
  layer.name = LAYER_NAME;
  layer.userData.officeAirAds = Object.freeze({
    schemaVersion: 1,
    aircraft: 2,
    advertisements: 2,
    drawCalls: 8,
    textures: 1,
  });
  const { blimp, blimpPanel, blimpPropellers } = buildBlimp(
    atlas, { ...options, THREE: Three },
  );
  const { biplane, propeller } = buildBiplane({ ...options, THREE: Three });
  const { banner, cable } = buildBanner(atlas, { ...options, THREE: Three });
  const billboardFrame = createScreenFrame(Three);
  layer.add(blimp, blimpPanel, biplane, banner, cable);
  layer.visible = false;
  return {
    layer, atlas, blimp, blimpPanel, blimpPropellers, biplane, propeller, banner, cable,
    billboardFrame,
  };
}

export function disposeAirAds(asset) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  asset?.layer?.traverse?.((node) => {
    if (node.geometry?.userData?.officeAirAdsOwned === true) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material?.userData?.officeAirAdsOwned !== true) continue;
      materials.add(material);
      if (material.map?.userData?.officeAirAdsOwned === true) textures.add(material.map);
    }
  });
  if (asset?.atlas?.userData?.officeAirAdsOwned === true) textures.add(asset.atlas);
  for (const texture of textures) texture.dispose?.();
  for (const material of materials) material.dispose?.();
  for (const geometry of geometries) geometry.dispose?.();
}

export function createAirAdsController(options = {}) {
  const Three = options.THREE || THREE;
  const scene = options.scene;
  if (!scene?.add) throw new TypeError('air ad controller requires a THREE.Scene');
  const asset = (options.build || buildAirAds)({ ...options, THREE: Three });
  if (!asset?.layer?.isObject3D) throw new TypeError('air ad builder must return a THREE layer');
  scene.add(asset.layer);
  let sceneSpec = null;
  let ceilingY = sceneCeiling({ ...options, THREE: Three, scene });
  let disposed = false;

  function setSceneSpec(value) {
    sceneSpec = value?.world ? value : null;
    if (sceneSpec) ceilingY = sceneCeiling({ ...options, THREE: Three, scene });
    asset.layer.visible = Boolean(sceneSpec);
    return api;
  }

  function tick(frame = {}) {
    if (disposed || !sceneSpec) return null;
    updateAirAds(asset, sceneSpec, Number(frame.now) || 0, {
      THREE: Three,
      camera: frame.camera || options.camera,
      ceilingY,
      reducedMotion: frame.reducedMotion === true,
    });
    return asset;
  }

  function dispose() {
    if (disposed) return null;
    disposed = true;
    asset.layer.parent?.remove?.(asset.layer);
    disposeAirAds(asset);
    sceneSpec = null;
    return null;
  }

  const api = Object.freeze({
    setSceneSpec,
    tick,
    dispose,
    get active() { return !disposed && Boolean(sceneSpec); },
    inspect: () => Object.freeze({
      active: !disposed && Boolean(sceneSpec),
      mounted: asset.layer.parent === scene,
      aircraft: disposed ? 0 : 2,
      advertisements: disposed ? 0 : 2,
      drawCalls: disposed ? 0 : 8,
      textures: disposed ? 0 : 1,
    }),
  });
  return api;
}
