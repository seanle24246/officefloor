/* office.por.registry.js — SPRITE METADATA REGISTRY + anchors + rotation (POR3
 * G0 skeleton). Layer 3 of the Procedural Customizable Office Renderer
 * (docs/render/PROC-OFFICE-RENDER-PLAN.md). Every placeable sprite carries its
 * metadata here — asset paths per orientation, tile footprint, GROUND-CONTACT
 * anchor, collision, placement rules, interaction points — so dimensions and
 * offsets never scatter through rendering code. TWO LAWS baked in:
 *   ASSET-EXISTENCE — every listed orientation must map to an authored asset
 *   (the PLC1 painter-existence scar, generalized): no asset, no orientation.
 *   NO RUNTIME ROTATION — rotation switches to another AUTHORED sprite and
 *   rotates the footprint + interaction offsets; raster rotation is banned.
 * Three leaves fill this file:
 *   POR3-01 validateSpriteDef — the registry structure gate
 *   POR3-02 anchorDraw        — draw position = ground point minus anchor
 *   POR3-03 rotateFootprint   — footprint + interaction points per orientation
 */
OFFICE.module('por.registry', [], () => {
'use strict';

const finite = Number.isFinite;
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function deepFreeze(v) {
  if (Array.isArray(v)) { if (!Object.isFrozen(v)) { Object.freeze(v); v.forEach(deepFreeze); } return v; }
  if (isRecord(v) && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); }
  return v;
}

// The four authored isometric orientations, in clockwise rotation order.
const ORIENTATIONS = Object.freeze(['ne', 'se', 'sw', 'nw']);
function rotateFacing(facing, steps) {
  const i = ORIENTATIONS.indexOf(facing);
  if (i < 0) return null;
  return ORIENTATIONS[(i + steps + 4) % 4];
}

const API = { SCHEMA: 1, ORIENTATIONS, rotateFacing };

  /**
   * validateSpriteDef(def) — registry structure gate.
   * Returns {ok:false, code} on first failure (checked in order) or
   * {ok:true, value: deepFreeze(def)} on success.
   */
  function validateSpriteDef(def) {
    // 1. def a plain object
    if (!isRecord(def)) return Object.freeze({ ok: false, code: 'def.object' });
    // 2. id a non-empty string
    if (typeof def.id !== 'string' || def.id.length === 0) return Object.freeze({ ok: false, code: 'def.id' });
    // 3. footprint {width,height} positive safe integers
    const fp = def.footprint;
    if (!isRecord(fp) || !Number.isSafeInteger(fp.width) || fp.width < 1 ||
        !Number.isSafeInteger(fp.height) || fp.height < 1) return Object.freeze({ ok: false, code: 'def.footprint' });
    // 4. anchor {x,y} FINITE numbers
    const anc = def.anchor;
    if (!isRecord(anc) || !finite(anc.x) || !finite(anc.y)) return Object.freeze({ ok: false, code: 'def.anchor' });
    // 5. orientations a non-empty duplicate-free subset of ORIENTATIONS
    const ori = def.orientations;
    if (!Array.isArray(ori) || ori.length === 0) return Object.freeze({ ok: false, code: 'def.orientations' });
    for (let i = 0; i < ori.length; i++) {
      if (ORIENTATIONS.indexOf(ori[i]) === -1) return Object.freeze({ ok: false, code: 'def.orientations' });
      // duplicate check
      if (ori.indexOf(ori[i]) !== i) return Object.freeze({ ok: false, code: 'def.orientations' });
    }
    // 6. assets a plain object mapping EVERY listed orientation to a non-empty string path
    const assets = def.assets;
    if (!isRecord(assets)) return Object.freeze({ ok: false, code: 'def.assets' });
    for (let i = 0; i < ori.length; i++) {
      const path = assets[ori[i]];
      if (typeof path !== 'string' || path.length === 0) return Object.freeze({ ok: false, code: 'def.asset_missing' });
    }
    // 7. blocksMovement boolean
    if (typeof def.blocksMovement !== 'boolean') return Object.freeze({ ok: false, code: 'def.blocks' });
    // 8. category non-empty string
    if (typeof def.category !== 'string' || def.category.length === 0) return Object.freeze({ ok: false, code: 'def.category' });
    // 9. placement, if present, a plain object
    if ('placement' in def && !isRecord(def.placement)) return Object.freeze({ ok: false, code: 'def.placement' });
    // 10. interactionPoints, if present, an array of valid interaction objects
    if ('interactionPoints' in def) {
      const pts = def.interactionPoints;
      if (!Array.isArray(pts)) return Object.freeze({ ok: false, code: 'def.interaction' });
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!isRecord(p)) return Object.freeze({ ok: false, code: 'def.interaction' });
        if (!Number.isSafeInteger(p.offsetX) || !Number.isSafeInteger(p.offsetY)) return Object.freeze({ ok: false, code: 'def.interaction' });
        if (ORIENTATIONS.indexOf(p.facing) === -1) return Object.freeze({ ok: false, code: 'def.interaction' });
        if (typeof p.action !== 'string' || p.action.length === 0) return Object.freeze({ ok: false, code: 'def.interaction' });
      }
    }
    // All checks passed
    return Object.freeze({ ok: true, value: deepFreeze(def) });
  }

  API.validateSpriteDef = validateSpriteDef;

  /**
   * anchorDraw(groundX, groundY, def) — draw position from ground contact point.
   * Returns Object.freeze({drawX, drawY}) = ground point minus anchor offset.
   * Returns null when groundX/groundY are not finite OR def.anchor is
   * missing/non-finite — a sprite without a ground anchor is NEVER drawn by
   * top-left alignment (the banned failure: returning the ground point unmodified).
   */
  function anchorDraw(groundX, groundY, def) {
    if (!finite(groundX) || !finite(groundY)) return null;
    if (!isRecord(def)) return null;
    const anc = def.anchor;
    if (!isRecord(anc) || !finite(anc.x) || !finite(anc.y)) return null;
    return Object.freeze({ drawX: groundX - anc.x, drawY: groundY - anc.y });
  }

  API.anchorDraw = anchorDraw;

  /**
     * rotateFootprint(def, orientation) — rotate footprint, interaction points,
     * and facing for a target orientation. Returns null unless orientation is
     * one of ne/se/sw/nw AND def.orientations includes it AND
     * def.assets[orientation] is a non-empty string (NO RUNTIME ROTATION —
     * unauthored orientations are never synthesized).
     *
     * With w=def.footprint.width, h=def.footprint.height and 'se' as the
     * authored base:
     *   'se' -> footprint {w, h}, points as authored, facing +0 steps
     *   'sw' -> {width:h, height:w}, (offsetX,offsetY)->(offsetY, w-1-offsetX), facing +1
     *   'nw' -> {w, h}, points (w-1-offsetX, h-1-offsetY), facing +2
     *   'ne' -> {width:h, height:w}, points (h-1-offsetY, offsetX), facing +3
     *
     * Facing rotates through ['ne','se','sw','nw'] cyclically via rotateFacing.
     * Returns deepFreeze({footprint, interactionPoints, asset: def.assets[orientation]}).
     */
    function rotateFootprint(def, orientation) {
      if (ORIENTATIONS.indexOf(orientation) === -1) return null;
      if (!isRecord(def)) return null;
      const ori = def.orientations;
      if (!Array.isArray(ori) || ori.indexOf(orientation) === -1) return null;
      const assets = def.assets;
      if (!isRecord(assets) || typeof assets[orientation] !== 'string' || assets[orientation].length === 0) return null;

      const w = def.footprint.width;
      const h = def.footprint.height;
      const baseIdx = ori.indexOf('se');
      const targetIdx = ORIENTATIONS.indexOf(orientation);
      let steps;
      if (baseIdx === -1 || targetIdx === -1) {
        // Fallback: compute steps from orientation index in ORIENTATIONS
        steps = (targetIdx - ORIENTATIONS.indexOf('se') + 4) % 4;
      } else {
        steps = (targetIdx - baseIdx + 4) % 4;
      }

      let footprint, interactionPoints;
      const pts = def.interactionPoints;

      if (steps === 0) {
        // 'se' — as authored
        footprint = { width: w, height: h };
        interactionPoints = pts ? pts.map(p => ({
          offsetX: p.offsetX,
          offsetY: p.offsetY,
          facing: p.facing,
          action: p.action
        })) : [];
      } else if (steps === 1) {
        // 'sw' — swap dims, (ox, oy)->(oy, w-1-ox)
        footprint = { width: h, height: w };
        interactionPoints = pts ? pts.map(p => ({
          offsetX: p.offsetY,
          offsetY: w - 1 - p.offsetX,
          facing: rotateFacing(p.facing, 1),
          action: p.action
        })) : [];
      } else if (steps === 2) {
        // 'nw' — same dims, (ox, oy)->(w-1-ox, h-1-oy)
        footprint = { width: w, height: h };
        interactionPoints = pts ? pts.map(p => ({
          offsetX: w - 1 - p.offsetX,
          offsetY: h - 1 - p.offsetY,
          facing: rotateFacing(p.facing, 2),
          action: p.action
        })) : [];
      } else if (steps === 3) {
        // 'ne' — swap dims, (ox, oy)->(h-1-oy, ox)
        footprint = { width: h, height: w };
        interactionPoints = pts ? pts.map(p => ({
          offsetX: h - 1 - p.offsetY,
          offsetY: p.offsetX,
          facing: rotateFacing(p.facing, 3),
          action: p.action
        })) : [];
      }

      return deepFreeze({
        footprint,
        interactionPoints: interactionPoints || [],
        asset: assets[orientation]
      });
    }

    API.rotateFootprint = rotateFootprint;

    // ==== POR3 leaves (added above this line) ====

return Object.freeze(API);
});
