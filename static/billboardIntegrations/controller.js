/* billboardIntegrations/controller.js — configurable WebGL company sign. */

import * as THREE from '../vendor/three.module.js';
import { createBillboardItemOptions } from './item-options.js';

export const BILLBOARD_DEFAULT_TEXT = 'YOUR OFFICE INC.';
export const BILLBOARD_STORAGE_KEY = 'office-billboard-text';
export const BILLBOARD_LAYER_NAME = 'office-webgl-company-billboard';

const MAX_TEXT_LENGTH = 48;
const TEXTURE_WIDTH = 1536;
const TEXTURE_HEIGHT = 384;
const BOARD_HEIGHT = 3.25;
const BOARD_DEPTH = 0.28;
const BOARD_Y = 4.75;
// Follow the executive wing's north wall instead of turning toward the camera.
const BOARD_YAW = 0;

function rootObject(options = {}) {
  return options.root || globalThis;
}

export function billboardDefaultText(root = globalThis) {
  const configured = root?.__OFFICE_BILLBOARD_DEFAULT__;
  const text = typeof configured === 'string'
    ? configured.replace(/\s+/g, ' ').trim() : '';
  return (text || BILLBOARD_DEFAULT_TEXT).slice(0, MAX_TEXT_LENGTH);
}

export function normalizeBillboardText(value, root = globalThis) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (text || billboardDefaultText(root)).slice(0, MAX_TEXT_LENGTH);
}

export function configuredText(root = globalThis) {
  try {
    const query = new root.URLSearchParams(String(root.location?.search || '')).get('billboard');
    if (query && query.trim()) return normalizeBillboardText(query, root);
  } catch { /* local configuration remains available */ }
  try {
    const stored = root.localStorage?.getItem(BILLBOARD_STORAGE_KEY);
    if (stored && stored.trim()) return normalizeBillboardText(stored, root);
  } catch { /* the demo default remains available without storage */ }
  return billboardDefaultText(root);
}

function splitHeadline(text) {
  if (text.length <= 24 || !text.includes(' ')) return [text];
  const words = text.split(' ');
  let best = 1;
  let bestDelta = Infinity;
  for (let index = 1; index < words.length; index += 1) {
    const left = words.slice(0, index).join(' ');
    const right = words.slice(index).join(' ');
    const delta = Math.abs(left.length - right.length);
    if (delta < bestDelta) {
      best = index;
      bestDelta = delta;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

function fittedFont(context, text, maximum, minimum, maxWidth) {
  let size = maximum;
  while (size > minimum) {
    context.font = `900 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    if (context.measureText(text).width <= maxWidth) break;
    size -= 4;
  }
  return size;
}

function paintFace(canvas, text) {
  const context = canvas.getContext?.('2d');
  if (!context) throw new Error('company billboard requires a 2D texture canvas');
  context.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

  const background = context.createLinearGradient(0, 0, 0, TEXTURE_HEIGHT);
  background.addColorStop(0, '#f8f3e8');
  background.addColorStop(1, '#d9d2c2');
  context.fillStyle = background;
  context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

  context.fillStyle = '#14233a';
  context.fillRect(0, 0, TEXTURE_WIDTH, 24);
  context.fillRect(0, TEXTURE_HEIGHT - 24, TEXTURE_WIDTH, 24);
  context.fillRect(0, 0, 24, TEXTURE_HEIGHT);
  context.fillRect(TEXTURE_WIDTH - 24, 0, 24, TEXTURE_HEIGHT);
  context.strokeStyle = '#b79346';
  context.lineWidth = 8;
  context.strokeRect(40, 40, TEXTURE_WIDTH - 80, TEXTURE_HEIGHT - 80);

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#b79346';
  context.font = '700 26px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  context.fillText('THE OFFICE  •  EST. 2026', TEXTURE_WIDTH / 2, 72);

  const lines = splitHeadline(normalizeBillboardText(text).toUpperCase());
  context.fillStyle = '#173c67';
  context.shadowColor = 'rgba(20, 35, 58, 0.20)';
  context.shadowOffsetY = 5;
  context.shadowBlur = 0;
  if (lines.length === 1) {
    const size = fittedFont(context, lines[0], 150, 72, TEXTURE_WIDTH - 150);
    context.font = `900 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    context.fillText(lines[0], TEXTURE_WIDTH / 2, 207);
  } else {
    const size = Math.min(...lines.map((line) => (
      fittedFont(context, line, 102, 62, TEXTURE_WIDTH - 150)
    )));
    context.font = `900 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    context.fillText(lines[0], TEXTURE_WIDTH / 2, 166);
    context.fillText(lines[1], TEXTURE_WIDTH / 2, 265);
  }
  context.shadowColor = 'transparent';

  context.fillStyle = '#596779';
  context.font = '700 24px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  context.fillText('LIVE FLOOR  /  YOUR COMPANY, YOUR SIGN', TEXTURE_WIDTH / 2, 332);
  return canvas;
}

function textureCanvas(root) {
  const canvas = root.document?.createElement?.('canvas');
  if (!canvas) throw new Error('company billboard requires document.createElement');
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  return canvas;
}

export function billboardPlacement(sceneSpec) {
  const rooms = Array.isArray(sceneSpec?.rooms)
    ? sceneSpec.rooms.filter((room) => room?.outdoor !== true) : [];
  const executive = rooms.filter((room) => ['ceo', 'csuite'].includes(room?.id));
  const anchors = executive.length ? executive : rooms;
  if (!anchors.length) return Object.freeze({ x: 11.5, z: 0.45, width: 13.5 });
  const minX = Math.min(...anchors.map((room) => Number(room.x) || 0));
  const maxX = Math.max(...anchors.map((room) => (Number(room.x) || 0) + (Number(room.w) || 0)));
  const minZ = Math.min(...anchors.map((room) => Number(room.y) || 0));
  const span = Math.max(8, maxX - minX);
  return Object.freeze({
    x: minX + span / 2,
    z: minZ - 0.48,
    width: Math.min(14.5, Math.max(10.5, span * 0.65)),
  });
}

function makeAssembly(Three, texture) {
  const layer = new Three.Group();
  layer.name = BILLBOARD_LAYER_NAME;
  layer.rotation.y = BOARD_YAW;

  const faceMaterial = new Three.MeshBasicMaterial({
    map: texture,
    side: Three.DoubleSide,
    toneMapped: false,
  });
  faceMaterial.userData.officeBillboardOwned = true;
  const frameMaterial = new Three.MeshStandardMaterial({
    color: '#14233a', roughness: 0.72, metalness: 0.14,
  });
  frameMaterial.userData.officeBillboardOwned = true;
  const brassMaterial = new Three.MeshStandardMaterial({
    color: '#b79346', roughness: 0.58, metalness: 0.42,
  });
  brassMaterial.userData.officeBillboardOwned = true;

  const backing = new Three.Mesh(
    new Three.BoxGeometry(1, BOARD_HEIGHT + 0.42, BOARD_DEPTH),
    frameMaterial,
  );
  backing.name = 'company-billboard:backing';
  backing.position.y = BOARD_Y;
  const face = new Three.Mesh(new Three.PlaneGeometry(1, BOARD_HEIGHT), faceMaterial);
  face.name = 'company-billboard:face';
  face.position.set(0, BOARD_Y, BOARD_DEPTH / 2 + 0.011);

  const topCap = new Three.Mesh(new Three.BoxGeometry(1, 0.12, 0.48), brassMaterial);
  topCap.name = 'company-billboard:top-cap';
  topCap.position.set(0, BOARD_Y + BOARD_HEIGHT / 2 + 0.20, 0);
  const lowerCap = topCap.clone();
  lowerCap.name = 'company-billboard:lower-cap';
  lowerCap.position.y = BOARD_Y - BOARD_HEIGHT / 2 - 0.20;

  const postGeometry = new Three.BoxGeometry(0.22, BOARD_Y - BOARD_HEIGHT / 2, 0.22);
  const postY = (BOARD_Y - BOARD_HEIGHT / 2) / 2;
  const posts = [-1, 1].map((side) => {
    const post = new Three.Mesh(postGeometry, frameMaterial);
    post.name = `company-billboard:post:${side < 0 ? 'left' : 'right'}`;
    post.position.set(side * 0.41, postY, 0);
    return post;
  });
  const footGeometry = new Three.CylinderGeometry(0.28, 0.34, 0.12, 8);
  const feet = [-1, 1].map((side) => {
    const foot = new Three.Mesh(footGeometry, brassMaterial);
    foot.name = `company-billboard:foot:${side < 0 ? 'left' : 'right'}`;
    foot.position.set(side * 0.41, 0.06, 0);
    return foot;
  });

  layer.add(backing, face, topCap, lowerCap, ...posts, ...feet);
  layer.userData.billboardParts = { backing, face, topCap, lowerCap, posts, feet };
  return layer;
}

function scaleAssembly(layer, width) {
  const parts = layer.userData.billboardParts;
  parts.backing.scale.x = width + 0.50;
  parts.face.scale.x = width;
  parts.topCap.scale.x = width + 0.72;
  parts.lowerCap.scale.x = width + 0.72;
  for (const post of parts.posts) post.position.x *= width;
  for (const foot of parts.feet) foot.position.x *= width;
}

function disposeAssembly(layer) {
  const geometries = new Set();
  const materials = new Set();
  layer?.traverse?.((node) => {
    if (node.geometry) geometries.add(node.geometry);
    if (node.material) materials.add(node.material);
  });
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
}

export function createBillboardController(options = {}) {
  const Three = options.THREE || THREE;
  const root = rootObject(options);
  const scene = options.scene;
  if (!scene?.add) throw new TypeError('company billboard requires a THREE.Scene');
  const canvas = textureCanvas(root);
  let text = configuredText(root);
  paintFace(canvas, text);
  const texture = new Three.CanvasTexture(canvas);
  texture.name = 'office-company-billboard-texture';
  texture.colorSpace = Three.SRGBColorSpace;
  texture.minFilter = Three.LinearMipmapLinearFilter;
  texture.magFilter = Three.LinearFilter;
  texture.anisotropy = 4;
  const layer = makeAssembly(Three, texture);
  let sceneSpec = null;
  let disposed = false;
  scene.add(layer);

  function setText(value) {
    if (disposed) return text;
    text = normalizeBillboardText(value);
    paintFace(canvas, text);
    texture.needsUpdate = true;
    try { root.localStorage?.setItem(BILLBOARD_STORAGE_KEY, text); } catch { /* ephemeral */ }
    try { root.OFFICE?.webgl?.renderFrame?.(); } catch { /* next scheduled frame will paint */ }
    return text;
  }

  function setSceneSpec(value) {
    if (disposed) return api;
    sceneSpec = value?.world ? value : null;
    layer.visible = Boolean(sceneSpec);
    if (!sceneSpec) return api;
    const placement = billboardPlacement(sceneSpec);
    layer.position.set(placement.x, 0, placement.z);
    layer.userData.footprint = Object.freeze({ w: placement.width, d: 0.6 });
    if (!layer.userData.billboardScaled) {
      scaleAssembly(layer, placement.width);
      layer.userData.billboardScaled = true;
      layer.userData.billboardWidth = placement.width;
    }
    return api;
  }

  function dispose() {
    if (disposed) return null;
    disposed = true;
    layer.parent?.remove?.(layer);
    disposeAssembly(layer);
    texture.dispose?.();
    if (root.OfficeBillboard === api) root.OfficeBillboard = null;
    sceneSpec = null;
    return null;
  }

  const api = Object.freeze({
    setText,
    setSceneSpec,
    dispose,
    get text() { return text; },
    inspect: () => Object.freeze({
      active: !disposed && Boolean(sceneSpec),
      mounted: layer.parent === scene,
      text,
      layerName: layer.name,
      width: layer.userData.billboardWidth || null,
    }),
  });
  layer.userData.officeEditPickRoot = true;
  layer.userData.placement_id = 'office-company-billboard';
  layer.userData.officeEditMovable = false;
  layer.userData.officeEditRemovable = false;
  layer.userData.footprint = Object.freeze({
    w: layer.userData.billboardWidth || billboardPlacement(null).width,
    d: 0.6,
  });
  layer.userData.officeItemOptions = createBillboardItemOptions({
    controller: api,
    root,
    defaultText: billboardDefaultText(root),
    maxLength: MAX_TEXT_LENGTH,
  });
  root.OfficeBillboard = api;
  return api;
}

export default createBillboardController;
