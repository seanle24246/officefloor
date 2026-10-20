// CITY-EDIT-03 — the pure state machine behind placing furniture in a city office (no DOM, no THREE, no fetch).
//
// The glue (office.city.editor.js) turns pointer events into cells and calls this core; the core decides what fits
// (office.city.zones.js canPlace on the city grid), keeps the working placement list, and builds the exact
// customization request the server validates again (server/city_zones.py). Placement rows use the standard shape:
// { placement_id, sku_id, room_id: 'city', anchor: { x: i, y: j }, rotation }.

import { canPlace, footprintCells } from './office.city.zones.js';

export const ROTATIONS = Object.freeze([0, 90, 180, 270]);

// options:
//   grid      — placementGrid(...) of the city (cols, rows, open, ...)
//   catalog   — array of catalog items ({ sku_id, grid: { footprint: { w, d } } })
//   entitled  — array or Set of owned sku_ids (only owned SKUs can be selected)
//   design    — the saved city design or null: { design_id, name, architecture_id, revision, placements: [...] }
//   newId     — () => string, returns a fresh 'plc_...' id for each new placement (injected so tests are deterministic)
// Returns an editor object with the methods below. All returned rows/lists are fresh copies (callers cannot mutate
// the editor's state through them).
export function createCityEditor({ grid, catalog, entitled, design = null, newId }) {
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const bySku = new Map(catalog.map((item) => [item.sku_id, item]));
  const entitledSet = entitled instanceof Set ? entitled : new Set(entitled);
  let savedDesign = design ? copy(design) : null;
  let baseline = savedDesign ? copy(savedDesign.placements) : [];
  let list = copy(baseline);
  let selection = null;

  const occupiedSet = () => {
    const occupied = new Set();
    for (const p of list) {
      const fp = bySku.get(p.sku_id)?.grid?.footprint;
      if (!fp) continue; // a SKU that left the catalog draws nothing and blocks nothing
      for (const [ci, cj] of footprintCells(p.anchor.x, p.anchor.y, fp.w, fp.d, p.rotation)) {
        occupied.add(`${ci},${cj}`);
      }
    }
    return occupied;
  };

  const probe = (i, j) => {
    if (!selection) return { ok: false, reason: 'no_selection', cells: [] };
    const fp = bySku.get(selection.sku_id).grid.footprint;
    const result = canPlace(grid, occupiedSet(), i, j, fp.w, fp.d, selection.rotation);
    return { ...result, cells: footprintCells(i, j, fp.w, fp.d, selection.rotation) };
  };

  return {
    selected() {
      return selection ? copy(selection) : null;
    },
    select(skuId) {
      if (skuId === null) { selection = null; return { ok: true }; }
      if (!bySku.has(skuId)) return { ok: false, reason: 'unknown_sku' };
      if (!entitledSet.has(skuId)) return { ok: false, reason: 'not_entitled' };
      selection = { sku_id: skuId, rotation: 0 };
      return { ok: true };
    },
    rotate() {
      if (!selection) return null;
      selection.rotation = ROTATIONS[(ROTATIONS.indexOf(selection.rotation) + 1) % ROTATIONS.length];
      return selection.rotation;
    },
    hover(i, j) {
      return probe(i, j);
    },
    place(i, j) {
      const result = probe(i, j);
      if (!result.ok) return { ok: false, reason: result.reason };
      const placement = {
        placement_id: newId(),
        sku_id: selection.sku_id,
        room_id: 'city',
        anchor: { x: i, y: j },
        rotation: selection.rotation,
      };
      list.push(placement);
      return { ok: true, placement: copy(placement) };
    },
    removeAt(i, j) {
      for (let n = 0; n < list.length; n += 1) {
        const p = list[n];
        const fp = bySku.get(p.sku_id)?.grid?.footprint;
        if (!fp) continue;
        if (footprintCells(p.anchor.x, p.anchor.y, fp.w, fp.d, p.rotation).some(([ci, cj]) => ci === i && cj === j)) {
          list.splice(n, 1);
          return p.placement_id;
        }
      }
      return null;
    },
    placements() {
      return copy(list);
    },
    dirty() {
      return JSON.stringify(list) !== JSON.stringify(baseline);
    },
    request(architectureId, { revision, catalogDigest, designId, name }) {
      if (savedDesign === null) {
        return {
          resource: 'designs', action: 'create', expected_revision: revision,
          catalog_digest: catalogDigest, design_id: designId, name, architecture_id: architectureId,
          placements: copy(list),
        };
      }
      return {
        resource: 'designs', action: 'replace', expected_revision: revision,
        catalog_digest: catalogDigest, design_id: savedDesign.design_id, placements: copy(list),
      };
    },
    saved(newDesign) {
      savedDesign = copy(newDesign);
      baseline = copy(savedDesign.placements);
    },
  };
}

// The editor object's methods (implement them inside createCityEditor's returned object):
//
// selected()                -> { sku_id, rotation } or null
// select(skuId)             -> { ok: true } | { ok: false, reason: 'unknown_sku' | 'not_entitled' }.
//                              Selecting sets rotation to 0. select(null) clears the selection and returns { ok: true }.
// rotate()                  -> the new rotation: next value in ROTATIONS after the current one (270 wraps to 0);
//                              with nothing selected returns null and changes nothing.
// hover(i, j)               -> with nothing selected: { ok: false, reason: 'no_selection', cells: [] }; otherwise
//                              the canPlace(grid, occupied, i, j, w, d, rotation) result plus
//                              cells: footprintCells(i, j, w, d, rotation), where occupied is the Set of 'i,j' strings
//                              covered by the current placements. (canPlace already returns cells when ok; always
//                              include `cells` in the result.)
// place(i, j)               -> same checks as hover; on ok appends { placement_id: newId(), sku_id, room_id: 'city',
//                              anchor: { x: i, y: j }, rotation } and returns { ok: true, placement: <copy> };
//                              otherwise { ok: false, reason }. The selection stays (place several in a row).
// removeAt(i, j)            -> removes the placement whose footprint covers cell (i, j); returns its placement_id,
//                              or null when the cell is empty.
// placements()              -> copy of the working list, in insertion order.
// dirty()                   -> true iff the working list differs from the saved design's placements (compare
//                              JSON.stringify of both lists; a null design counts as an empty list).
// request(architectureId, { revision, catalogDigest, designId, name }) ->
//     the POST body to save the working list:
//     - no saved design: { resource: 'designs', action: 'create', expected_revision: revision,
//                          catalog_digest: catalogDigest, design_id: designId, name, architecture_id: architectureId,
//                          placements: <copy> }
//     - saved design:    { resource: 'designs', action: 'replace', expected_revision: revision,
//                          catalog_digest: catalogDigest, design_id: <saved design_id>, placements: <copy> }
//       (replace has no name/architecture_id fields: the server keeps them.)
// saved(design)             -> adopt a design returned by the server as the new saved baseline (dirty() becomes
//                              false when the working list equals it). Returns undefined.
