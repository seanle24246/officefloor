/* office.webgl.mesh.agent.customize.js — optional rolled-appearance mesh layer.
 *
 * Mount seam (owned by the agent-mesh maintainer):
 *   import { mountAgentAppearanceMesh } from './office.webgl.mesh.agent.customize.js';
 *   const customizeAgentMesh = mountAgentAppearanceMesh();
 *   // Once, immediately after a 3D agent root is built:
 *   customizeAgentMesh(root, entry, context);
 *
 * This is an ESM leaf loaded by the WebGL mesh, not an index.html script; it
 * deliberately does not register OFFICE.module after OFFICE.seal().
 */

export const AGENT_APPEARANCE_FLAG = 'agent_appearance';

const PARTS = Object.freeze({
  skin: Object.freeze(['left-hand', 'right-hand', 'neck', 'head', 'nose']),
  hair: Object.freeze(['hair-cap', 'hair-back', 'hair-bun']),
  shirt: Object.freeze(['torso', 'left-arm', 'right-arm']),
  trousers: Object.freeze(['left-leg', 'right-leg', 'left-shoe', 'right-shoe']),
  accent: Object.freeze(['lane-badge']),
});
const PALETTE_KEYS = Object.freeze(Object.keys(PARTS));
const CUSTOMIZATION_NAME = 'agent-appearance:customization';
const HEX_COLOR = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
const MAX_ACCESSORIES = 4;

function rootObject() {
  return typeof globalThis === 'undefined' ? window : globalThis;
}

function flagEnabled(flags) {
  return flags?.enabled?.(AGENT_APPEARANCE_FLAG) === true;
}

function appearanceFor(entry) {
  const api = rootObject().OFFICE?.appearance;
  if (typeof api?.appearanceFor !== 'function') return null;
  try {
    return api.appearanceFor(entry);
  } catch {
    // Appearance is cosmetic. A malformed optional trait must preserve the
    // existing mesh instead of breaking the whole WebGL floor.
    return null;
  }
}

function validAppearance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!value.palette || typeof value.palette !== 'object' || Array.isArray(value.palette)) return false;
  return PALETTE_KEYS.every((key) => HEX_COLOR.test(value.palette[key] || ''));
}

function named(root, name) {
  return root?.getObjectByName?.(`agent-part:${name}`)
    || root?.getObjectByName?.(`avatar-part:${name}`)
    || null;
}

function figureFor(root) {
  let figure = null;
  root?.traverse?.((node) => {
    if (!figure && /^(agent|avatar)-figure:/.test(node.name || '')) figure = node;
  });
  return figure || root;
}

function removeCustomization(root) {
  const prior = root?.getObjectByName?.(CUSTOMIZATION_NAME);
  if (!prior) return;
  prior.parent?.remove?.(prior);
  const owned = prior.userData?.appearanceMaterials;
  for (const material of owned instanceof Set ? owned : []) material?.dispose?.();
}

function replaceMaterial(part, material) {
  part?.traverse?.((node) => {
    if (node?.isMesh === true) node.material = material;
  });
}

function meshMaterial(ctx, color, owned) {
  const material = new ctx.THREE.MeshLambertMaterial({ color, flatShading: true });
  owned.add(material);
  return material;
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function supportedAccessories(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Set();
  for (const item of value) {
    const key = typeof item === 'string' ? item.trim().slice(0, 48) : '';
    if (key) unique.add(key);
    if (unique.size === MAX_ACCESSORIES) break;
  }
  return [...unique];
}

function addOutfit(root, appearance, ctx, accent) {
  const outfit = typeof appearance.outfit === 'string' ? appearance.outfit.trim() : '';
  if (!outfit) return;
  const hash = stableHash(outfit);
  const layer = ctx.group();
  layer.name = 'agent-appearance:outfit';
  const band = ctx.tileBox(0.37, 0.035, 0.07, accent);
  band.position.set(0, 0.98, 0.125);
  layer.add(band);
  // Rolled outfit selects one bounded silhouette detail; no state or user
  // input changes geometry beyond this immutable appearance result.
  if ((hash & 1) === 0) {
    const lapel = ctx.tileBox(0.07, 0.04, 0.20, accent);
    lapel.position.set(-0.10, 1.10, 0.125);
    lapel.rotation.z = -0.22;
    layer.add(lapel);
  } else {
    const collar = ctx.tileBox(0.23, 0.04, 0.06, accent);
    collar.position.set(0, 1.29, 0.115);
    layer.add(collar);
  }
  root.add(layer);
}

function addAccessories(root, appearance, ctx, accent) {
  for (const [index, accessory] of supportedAccessories(appearance.accessories).entries()) {
    const hash = stableHash(accessory);
    const ornament = ctx.tileBox(0.055, 0.045, 0.055, accent);
    ornament.name = `agent-appearance:accessory:${accessory}`;
    const x = ((hash % 5) - 2) * 0.055;
    const y = 1.43 + (index % 2) * 0.085;
    const z = (hash & 1) === 0 ? 0.145 : -0.155;
    ornament.position.set(x, y, z);
    root.add(ornament);
  }
}

/**
 * Apply one immutable `OFFICE.appearance.appearanceFor(agent)` result to an
 * already-built 3D root. False flag, missing core, and invalid output are
 * strict no-ops, preserving flag-off identity.
 */
export function customizeAgentMesh(root, entry, ctx, { featureFlags } = {}) {
  const flags = featureFlags || rootObject().OfficeFeatureFlags;
  if (!flagEnabled(flags)) return root;
  if (!root?.isObject3D || !ctx?.THREE || typeof ctx.tileBox !== 'function') return root;

  const appearance = entry?.previewAppearance || appearanceFor(entry);
  if (!validAppearance(appearance)) return root;

  removeCustomization(root);
  const owned = new Set();
  const materials = Object.fromEntries(PALETTE_KEYS.map((key) => [
    key,
    meshMaterial(ctx, appearance.palette[key], owned),
  ]));
  for (const key of PALETTE_KEYS) {
    for (const part of PARTS[key]) replaceMaterial(named(root, part), materials[key]);
  }

  const customization = ctx.group();
  customization.name = CUSTOMIZATION_NAME;
  customization.userData.appearanceMaterials = owned;
  figureFor(root).add(customization);
  addOutfit(customization, appearance, ctx, materials.accent);
  addAccessories(customization, appearance, ctx, materials.accent);
  root.userData.appearanceFingerprint = JSON.stringify(appearance);
  return root;
}

/** Mount once at the Mac-owned mesh build seam; returned hook takes root, entry, ctx. */
export function mountAgentAppearanceMesh({ featureFlags } = {}) {
  return (root, entry, ctx) => customizeAgentMesh(root, entry, ctx, { featureFlags });
}

// Mesh-file contract for the registry's static lint. The active agent family
// remains owned by office.webgl.mesh.agent.js; this dormant family is available
// only to a future scene spec and never replaces that builder.
export function init(reg) {
  reg.registerMesh('agent-customization', () => null);
}
