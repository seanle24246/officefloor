/* WebGL edit-mode selection outline and projected placement action pane. */

import * as THREE from './vendor/three.module.js';
import { project as cameraProject } from './office.webgl.camera.js';
import { pointerToTile } from './office.webgl.edit.move.leaf.js';
import { familyForSku } from './office.webgl.families.js';
import { isSharedGeometry } from './office.webgl.primitives.js';
import { buildMesh, getRuntime } from './office.webgl.scene.js';

export const SELECTION_PANE_ID = 'office-webgl-edit-actions';
export const PLACEMENT_PANE_ID = 'office-webgl-edit-placement';
export const PLACEMENT_BLOCKER_LABEL_ID = 'office-webgl-edit-placement-blocker-label';
export const SELECTION_STYLE_ID = 'office-webgl-edit-selection-style';

const RED = 0xff3b30;
const RED_CSS = '#ff3b30';
const GREEN = 0x56d68b;
const GREEN_CSS = '#56d68b';
const AMBER = 0xffc478;
const FLOOR_LIFT = 0.008;
const OUTLINE_PX = 2;
const TILE_EDGE_PX = Math.hypot(32, 16);
const PANE_MARGIN = 8;
const PANE_GAP = 12;
const PANE_FALLBACK = Object.freeze({ width: 184, height: 88 });
const INITIAL_TILE_LIMIT = 96;
const MIN_CORNER = 'min-corner';
const BLOCKER_KINDS = Object.freeze(new Set(['agent', 'door', 'route', 'wall', 'item']));
const STYLESHEET = new URL('./office.webgl.edit.selection.css', import.meta.url).href;
let previewNonce = 0;

function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function spatialApi(capability) {
  const api = globalThis.OfficeSpatial;
  if (api?.ANCHOR_SEMANTICS !== MIN_CORNER || typeof api?.[capability] !== 'function') {
    throw new Error(`WebGL edit placement requires OfficeSpatial.${capability}()`);
  }
  return api;
}

function activeEditorSnapshot(editor) {
  let snapshot = null;
  try { snapshot = editor?.snapshot?.() || null; }
  catch { return null; }
  return ['editing-clean', 'editing-dirty', 'failed'].includes(String(snapshot?.state || ''))
    ? snapshot : null;
}

function selectedPayload(snapshot) {
  const value = snapshot?.selection;
  if (typeof value === 'string') return Object.freeze({
    kind: 'item', id: value, key: `item:${value}`, placement_id: value,
    movable: true, removable: true,
  });
  if (!value || typeof value !== 'object') return null;
  if (!value.kind && typeof value.placement_id === 'string' && value.placement_id) {
    return Object.freeze({
      ...value,
      kind: 'item',
      id: value.placement_id,
      key: `item:${value.placement_id}`,
      movable: true,
      removable: value.authored !== true,
    });
  }
  return value;
}

function selectedObject(content, selection) {
  let match = null;
  content?.traverse?.((object) => {
    if (match) return;
    const data = object?.userData;
    if (selection?.kind === 'agent' && data?.agentLane === selection.id) match = object;
    else if (selection?.kind === 'animal'
        && data?.decorativeAnimalId === selection.id) match = object;
    else if (selection?.kind === 'item' && selection.placement_id
        && (data?.placement_id === selection.placement_id
          || data?.stable_furnishing_id === selection.placement_id)) match = object;
    else if (selection?.kind === 'item' && selection.placement_id
        && Array.isArray(data?.editableInstances)) {
      const instance = data.editableInstances.find((row) =>
        row?.stable_furnishing_id === selection.placement_id);
      if (instance) match = {
        position: {
          x: instance.x, y: 0, z: instance.y,
          set(x, y, z) { this.x = x; this.y = y; this.z = z; },
        },
        userData: { footprint: instance.footprint },
      };
    }
  });
  return match;
}

function catalogItem(root, skuId, injected) {
  if (typeof injected === 'function') return injected(skuId);
  return root.OfficeCustomizationCatalog?.bySku?.(skuId) || null;
}

function roomIdAt(rooms, tile) {
  if (!Array.isArray(rooms)) return null;
  const matches = rooms.filter((room) => room.x <= tile.x && tile.x < room.x + room.w
    && room.y <= tile.y && tile.y < room.y + room.h);
  return matches.length === 1 ? matches[0].id : null;
}

function draftPlacementId(root, injected) {
  if (typeof injected === 'function') return String(injected());
  let uuid = null;
  try { uuid = root.crypto?.randomUUID?.() || null; } catch { /* use bounded fallback */ }
  previewNonce += 1;
  return uuid
    ? `plc_${uuid.replaceAll('-', '')}`
    : `plc_preview_${Date.now().toString(36)}_${previewNonce.toString(36)}`;
}

export function candidateTiles(origin, world, limit = INITIAL_TILE_LIMIT) {
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return Object.freeze([]);
  const width = Math.max(1, Math.floor(Number(world?.w) || 1));
  const depth = Math.max(1, Math.floor(Number(world?.h) || 1));
  const maximum = Math.max(1, Math.floor(Number(limit) || INITIAL_TILE_LIMIT));
  const start = {
    x: Math.max(0, Math.min(width - 1, Math.floor(origin.x))),
    y: Math.max(0, Math.min(depth - 1, Math.floor(origin.y))),
  };
  const rows = [];
  for (let y = 0; y < depth; y += 1) {
    for (let x = 0; x < width; x += 1) {
      rows.push({ x, y, distance: Math.abs(x - start.x) + Math.abs(y - start.y) });
    }
  }
  rows.sort((left, right) => left.distance - right.distance
    || left.y - right.y || left.x - right.x);
  return Object.freeze(rows.slice(0, maximum)
    .map(({ x, y }) => Object.freeze({ x, y })));
}

export function placementSource(options = {}) {
  const root = options.root || globalThis;
  const coordinator = options.coordinator || root.OFFICE?.state?.customization;
  const editor = options.editor || coordinator?.editorController;
  const editorSnapshot = activeEditorSnapshot(editor);
  if (editorSnapshot?.tool !== 'place') return null;
  let coordinatorSnapshot = null;
  try { coordinatorSnapshot = coordinator?.snapshot?.() || null; }
  catch { return null; }
  const skuId = coordinatorSnapshot?.selected_sku;
  if (typeof skuId !== 'string' || !skuId) return null;
  const item = catalogItem(root, skuId, options.catalogItem);
  if (!item) return null;
  const rotation = Number(coordinatorSnapshot?.edit_mode?.rot) || 0;
  const footprint = rotatedFootprint({ rotation }, item);
  if (!footprint) return null;
  return Object.freeze({
    skuId,
    item,
    rotation,
    footprint,
    editor,
    editorSnapshot,
    coordinator,
    placementController: coordinator?.placementController,
    placementRevision: coordinatorSnapshot?.placement?.local_revision ?? null,
    name: String(item.name || skuId),
  });
}

export function rotatedFootprint(placement, item, object = null) {
  const canonical = item?.grid?.footprint;
  const width = finitePositive(canonical?.w);
  const depth = finitePositive(canonical?.d);
  const rotation = Number(placement?.rotation) || 0;
  if (width && depth) {
    const placed = spatialApi('rotatedFootprint').rotatedFootprint({ w: width, d: depth }, rotation);
    const placedWidth = finitePositive(placed?.w);
    const placedDepth = finitePositive(placed?.d);
    return placedWidth && placedDepth
      ? Object.freeze({ w: placedWidth, d: placedDepth }) : null;
  }
  // Effective authored furnishing geometry is already projected at its live
  // rotation. Rotating it again swaps every non-square outline a second time.
  // Wall-mounted authored props have a valid zero-depth footprint. Keep
  // their canonical geometry so the action pane can remove/restore them.
  const effectiveWidth = placement?.geometry?.footprint?.w;
  const effectiveDepth = placement?.geometry?.footprint?.d;
  if (Number.isFinite(effectiveWidth) && Number.isFinite(effectiveDepth)
      && effectiveWidth >= 0 && effectiveDepth >= 0
      && effectiveWidth + effectiveDepth > 0) {
    return Object.freeze({ w: effectiveWidth, d: effectiveDepth });
  }
  const objectWidth = finitePositive(object?.userData?.footprint?.w);
  const objectDepth = finitePositive(object?.userData?.footprint?.d);
  return objectWidth && objectDepth
    ? Object.freeze({ w: objectWidth, d: objectDepth }) : null;
}

function canonicalPlacement(coordinator, placementId) {
  const placed = coordinator?.placementController?.snapshot?.()?.design?.placements
    ?.find((row) => row.placement_id === placementId);
  return placed || coordinator?.authoredFurnishing?.(placementId) || null;
}

export function selectionView(options = {}) {
  const root = options.root || globalThis;
  const runtime = options.runtime || getRuntime();
  const coordinator = options.coordinator || root.OFFICE?.state?.customization;
  const editor = options.editor || coordinator?.editorController;
  const editorSnapshot = activeEditorSnapshot(editor);
  const selection = selectedPayload(editorSnapshot);
  const selectionId = selection?.id || selection?.placement_id || null;
  if (!runtime || !selectionId) return null;

  const objectResolver = options.objectForSelection
    || (typeof options.objectForPlacement === 'function'
      ? (content, value) => options.objectForPlacement(content, value.placement_id || value.id)
      : selectedObject);
  const object = objectResolver(runtime.content, selection)
    || objectResolver(runtime.scene, selection);
  if (!object) return null;

  if (selection.kind === 'agent' || selection.kind === 'animal') {
    const footprint = rotatedFootprint({}, null, object) || Object.freeze({ w: 1, d: 1 });
    if (!Number.isFinite(object.position?.x) || !Number.isFinite(object.position?.z)) return null;
    return Object.freeze({
      placementId: selectionId,
      selection,
      selectionKind: selection.kind,
      selectionKey: selection.key || `${selection.kind}:${selectionId}`,
      placement: null,
      editor,
      editorSnapshot,
      object,
      footprint,
      center: Object.freeze({ x: object.position.x, y: object.position.z }),
      authored: false,
      movable: selection.movable === true,
      removable: selection.removable === true,
      removalReason: selection.removal_reason || null,
      rotatable: false,
      name: selection.kind === 'agent'
        ? String(selection.name || selection.lane || selectionId)
        : String(selection.name || selection.species || selectionId),
    });
  }

  const placementId = selection.placement_id || selectionId;
  const itemOptions = object?.userData?.officeItemOptions;
  if (selection.kind === 'item' && typeof itemOptions?.mount === 'function') {
    const footprint = rotatedFootprint({}, null, object) || Object.freeze({ w: 1, d: 1 });
    if (!Number.isFinite(object.position?.x) || !Number.isFinite(object.position?.z)) return null;
    return Object.freeze({
      placementId,
      selection,
      selectionKind: 'item',
      selectionKey: selection.key || `item:${placementId}`,
      placement: null,
      editor,
      editorSnapshot,
      object,
      footprint,
      center: Object.freeze({ x: object.position.x, y: object.position.z }),
      authored: true,
      movable: false,
      removable: false,
      rotatable: false,
      hideKeys: true,
      hideRemove: true,
      itemOptions,
      name: String(itemOptions.name || placementId),
    });
  }
  const placement = canonicalPlacement(coordinator, placementId);
  if (!placement) return null;

  const item = catalogItem(root, placement.sku_id, options.catalogItem);
  const footprint = rotatedFootprint(placement, item, object);
  if (!footprint) return null;

  const canonicalCenter = spatialApi('centerFromAnchor')
    .centerFromAnchor(placement.anchor, footprint);
  const objectFootprint = object?.userData?.footprint;
  const objectMatches = finitePositive(objectFootprint?.w) === footprint.w
    && finitePositive(objectFootprint?.d) === footprint.d;
  const authored = placement.authored === true;
  const center = authored && Number.isFinite(object?.position?.x)
    && Number.isFinite(object?.position?.z)
    ? { x: object.position.x, y: object.position.z }
    : editorSnapshot.tool === 'move' && objectMatches
    && Number.isFinite(object?.position?.x) && Number.isFinite(object?.position?.z)
    ? { x: object.position.x, y: object.position.z }
    : canonicalCenter;

  const family = item ? familyForSku(item)
    : typeof object?.userData?.vehicle === 'string' ? 'cars' : null;
  const editLocked = family === 'cars' || object?.userData?.officeEditMovable === false;
  return Object.freeze({
    placementId,
    selection,
    selectionKind: 'item',
    selectionKey: selection.key || `item:${placementId}`,
    placement,
    editor,
    editorSnapshot,
    object,
    footprint,
    center: Object.freeze(center),
    authored,
    movable: editLocked ? false : selection.movable !== false,
    removable: authored ? placement.removable === true : selection.removable !== false,
    removalReason: placement.removal_reason || selection.removal_reason || null,
    rotatable: !editLocked,
    name: String(editorSnapshot.selection?.name || item?.name || placement.name || placement.sku_id),
  });
}

function quad(vertices, x0, z0, x1, z1) {
  vertices.push(
    x0, 0, z0, x1, 0, z0, x1, 0, z1,
    x0, 0, z0, x1, 0, z1, x0, 0, z1,
  );
}

export function ringVertices(width, depth, thickness) {
  const w = finitePositive(width);
  const d = finitePositive(depth);
  const line = finitePositive(thickness);
  if (!w || !d || !line) throw new TypeError('selection ring dimensions must be positive');
  const outerX = w / 2 + line / 2;
  const outerZ = d / 2 + line / 2;
  const innerX = Math.max(0, w / 2 - line / 2);
  const innerZ = Math.max(0, d / 2 - line / 2);
  const vertices = [];
  quad(vertices, -outerX, -outerZ, outerX, -innerZ);
  quad(vertices, -outerX, innerZ, outerX, outerZ);
  quad(vertices, -outerX, -innerZ, -innerX, innerZ);
  quad(vertices, innerX, -innerZ, outerX, innerZ);
  return new Float32Array(vertices);
}

export function projectedFootprint(view, projectPoint = cameraProject) {
  const halfW = view.footprint.w / 2;
  const halfD = view.footprint.d / 2;
  return [
    projectPoint(view.center.x - halfW, view.center.y - halfD, FLOOR_LIFT),
    projectPoint(view.center.x + halfW, view.center.y - halfD, FLOOR_LIFT),
    projectPoint(view.center.x + halfW, view.center.y + halfD, FLOOR_LIFT),
    projectPoint(view.center.x - halfW, view.center.y + halfD, FLOOR_LIFT),
  ];
}

export function placementGhostEntry(source, tile, family) {
  if (!source?.item || !Number.isFinite(tile?.x) || !Number.isFinite(tile?.y)) {
    throw new TypeError('placement ghost requires an item and finite min-corner anchor');
  }
  return Object.freeze({
    sku: source.skuId,
    family,
    anchorSemantics: spatialApi('entryCenter').ANCHOR_SEMANTICS,
    x: tile.x,
    y: tile.y,
    rot: source.rotation,
    footprint: source.item.grid?.footprint,
    heightUnits: source.item.height_units,
  });
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function panePosition(points, viewport, paneSize, margin = PANE_MARGIN, gap = PANE_GAP) {
  const usable = points.filter((point) => Number.isFinite(point?.sx) && Number.isFinite(point?.sy));
  if (usable.length !== 4) return null;
  const minX = Math.min(...usable.map((point) => point.sx));
  const maxX = Math.max(...usable.map((point) => point.sx));
  const minY = Math.min(...usable.map((point) => point.sy));
  const maxY = Math.max(...usable.map((point) => point.sy));
  const width = finitePositive(paneSize?.width) || PANE_FALLBACK.width;
  const height = finitePositive(paneSize?.height) || PANE_FALLBACK.height;
  const viewportWidth = finitePositive(viewport?.width) || width + margin * 2;
  const viewportHeight = finitePositive(viewport?.height) || height + margin * 2;

  let x = maxX + gap;
  let y = (minY + maxY - height) / 2;
  if (x + width > viewportWidth - margin) x = minX - gap - width;
  if (x < margin) {
    x = (minX + maxX - width) / 2;
    y = minY - gap - height;
    if (y < margin) y = maxY + gap;
  }
  return Object.freeze({
    x: clamp(x, margin, Math.max(margin, viewportWidth - width - margin)),
    y: clamp(y, margin, Math.max(margin, viewportHeight - height - margin)),
  });
}

export function placementBlocker(result) {
  if (result?.ok !== false) return null;
  if (BLOCKER_KINDS.has(result.blocker)) return result.blocker;
  if (result.reason === 'structural') return 'wall';
  if (result.reason === 'door') return 'door';
  if (result.reason === 'corridor') return 'route';
  if (result.reason === 'occupied') return 'item';
  return null;
}

export function placementStatusText(result) {
  if (result?.ok === true) return 'Legal placement';
  if (result?.readiness) return `Asset ${result.readiness}`;
  if (typeof result?.disconnectMessage === 'string' && result.disconnectMessage) {
    return `Cannot place: ${result.disconnectMessage}`;
  }
  const blocker = placementBlocker(result);
  if (blocker) return `Cannot place: occupied by ${blocker}`;
  return `Cannot place: ${String(result?.reason || 'unavailable').replaceAll('_', ' ')}`;
}

export function placementBlockerView(result) {
  const label = placementBlocker(result);
  const source = result?.blockerFootprint || {};
  const anchor = source.anchor || result?.tile;
  const footprint = source.footprint || { w: 1, d: 1 };
  if (!label || !Number.isFinite(anchor?.x) || !Number.isFinite(anchor?.y)
      || !finitePositive(footprint?.w) || !finitePositive(footprint?.d)) return null;
  return Object.freeze({
    label,
    anchor: Object.freeze({ x: anchor.x, y: anchor.y }),
    footprint: Object.freeze({ w: footprint.w, d: footprint.d }),
    center: Object.freeze({
      x: anchor.x + footprint.w / 2,
      y: anchor.y + footprint.d / 2,
    }),
  });
}

function append(parent, ...nodes) {
  if (typeof parent.append === 'function') parent.append(...nodes);
  else for (const node of nodes) parent.appendChild(node);
}

function remove(node) {
  if (typeof node?.remove === 'function') node.remove();
  else node?.parentNode?.removeChild?.(node);
}

function makeElement(document, tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function button(document, className, text) {
  const node = makeElement(document, 'button', className, text);
  node.type = 'button';
  return node;
}

function paneSize(node) {
  const bounds = node.getBoundingClientRect?.();
  return {
    width: finitePositive(bounds?.width) || finitePositive(node.offsetWidth) || PANE_FALLBACK.width,
    height: finitePositive(bounds?.height) || finitePositive(node.offsetHeight) || PANE_FALLBACK.height,
  };
}

function viewportSize(root, runtime, injected) {
  if (typeof injected === 'function') return injected();
  if (injected) return injected;
  const bounds = runtime?.canvas?.getBoundingClientRect?.();
  return {
    width: finitePositive(root.innerWidth) || finitePositive(bounds?.right) || finitePositive(bounds?.width),
    height: finitePositive(root.innerHeight) || finitePositive(bounds?.bottom) || finitePositive(bounds?.height),
  };
}

function pointerTile(clientX, clientY, runtime, projectTile = pointerToTile) {
  const bounds = runtime?.canvas?.getBoundingClientRect?.();
  if (![clientX, clientY, bounds?.left, bounds?.top, bounds?.width, bounds?.height]
    .every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return null;
  return projectTile(Object.freeze({
    x: ((clientX - bounds.left) / bounds.width) * 2 - 1,
    y: 1 - ((clientY - bounds.top) / bounds.height) * 2,
  }), runtime.camera, 0);
}

function visibleFloorTile(runtime, panel, projectTile, injected) {
  if (typeof injected === 'function') return injected(runtime);
  if (injected && Number.isFinite(injected.x) && Number.isFinite(injected.y)) return injected;
  const canvasBounds = runtime?.canvas?.getBoundingClientRect?.();
  if (!canvasBounds) return null;
  const panelBounds = panel?.getBoundingClientRect?.();
  const floorLeft = Number.isFinite(panelBounds?.right)
    ? Math.max(canvasBounds.left, Math.min(canvasBounds.right, panelBounds.right + PANE_GAP))
    : canvasBounds.left;
  return pointerTile(
    floorLeft + Math.max(0, canvasBounds.right - floorLeft) / 2,
    canvasBounds.top + canvasBounds.height / 2,
    runtime,
    projectTile,
  );
}

function cloneGhostMaterials(object) {
  object?.traverse?.((node) => {
    if (!node.material) return;
    const source = Array.isArray(node.material) ? node.material : [node.material];
    const cloned = source.map((material) => {
      const value = material.clone();
      value.transparent = true;
      value.opacity = Math.min(0.52, Number.isFinite(value.opacity) ? value.opacity * 0.52 : 0.52);
      value.depthWrite = false;
      value.needsUpdate = true;
      return value;
    });
    node.material = Array.isArray(node.material) ? cloned : cloned[0];
    node.renderOrder = 9998;
  });
  return object;
}

function disposeObject(object) {
  object?.parent?.remove?.(object);
  object?.traverse?.((node) => {
    if (!isSharedGeometry(node.geometry)) node.geometry?.dispose?.();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      material?.dispose?.();
    }
  });
}

function typingTarget(target) {
  const tag = String(target?.tagName || '').toLowerCase();
  return target?.isContentEditable || ['input', 'textarea', 'select'].includes(tag);
}

export function createSelectionSurface(options = {}) {
  const root = options.root || globalThis;
  const document = options.document || root.document;
  const requestFrame = options.requestAnimationFrame || root.requestAnimationFrame?.bind(root);
  const cancelFrame = options.cancelAnimationFrame || root.cancelAnimationFrame?.bind(root);
  const projectPoint = options.project || cameraProject;
  const THREE_API = options.THREE || THREE;
  if (!document?.createElement || !document.body) {
    throw new Error('WebGL edit selection requires a document body');
  }

  let runtime = options.runtime || getRuntime();
  if (!runtime?.scene) throw new Error('WebGL edit selection requires an active scene');

  const geometry = new THREE_API.BufferGeometry();
  const material = new THREE_API.MeshBasicMaterial({
    color: RED,
    transparent: true,
    opacity: 0.96,
    depthTest: true,
    depthWrite: false,
    side: THREE_API.DoubleSide,
  });
  const outline = new THREE_API.Mesh(geometry, material);
  outline.name = 'office-webgl-edit-selection-outline';
  outline.renderOrder = 10000;
  outline.visible = false;
  runtime.scene.add(outline);

  const placementGeometry = new THREE_API.BufferGeometry();
  const placementMaterial = new THREE_API.MeshBasicMaterial({
    color: GREEN,
    transparent: true,
    opacity: 0.98,
    depthTest: true,
    depthWrite: false,
    side: THREE_API.DoubleSide,
  });
  const placementOutline = new THREE_API.Mesh(placementGeometry, placementMaterial);
  placementOutline.name = 'office-webgl-edit-placement-outline';
  placementOutline.renderOrder = 10001;
  placementOutline.visible = false;
  runtime.scene.add(placementOutline);

  const blockerGeometry = new THREE_API.BufferGeometry();
  const blockerMaterial = new THREE_API.MeshBasicMaterial({
    color: RED,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    side: THREE_API.DoubleSide,
  });
  const blockerOutline = new THREE_API.Mesh(blockerGeometry, blockerMaterial);
  blockerOutline.name = 'office-webgl-edit-placement-blocker';
  blockerOutline.renderOrder = 10002;
  blockerOutline.visible = false;
  runtime.scene.add(blockerOutline);

  let style = document.getElementById?.(SELECTION_STYLE_ID) || null;
  if (!style) {
    style = makeElement(document, 'link', '');
    style.id = SELECTION_STYLE_ID;
    style.rel = 'stylesheet';
    style.href = options.stylesheetHref || STYLESHEET;
    append(document.head || document.documentElement || document.body, style);
  }

  const pane = makeElement(document, 'section', 'office-webgl-edit-actions');
  pane.id = SELECTION_PANE_ID;
  pane.hidden = true;
  pane.setAttribute('role', 'toolbar');
  pane.setAttribute('aria-label', 'Selected object actions');
  const title = makeElement(document, 'strong', 'office-webgl-edit-actions-title');
  const keysRow = makeElement(document, 'div', 'office-webgl-edit-actions-keys');
  let rotateBinding = null;
  let moveBinding = null;
  let escapeBinding = null;
  let escapeLabelNode = null;
  for (const [name, keys, label] of [
    ['rotate', ['R'], 'Rotate'],
    ['move', ['↑', '↓', '←', '→'], 'Move'],
    ['escape', ['Esc'], 'Deselect'],
  ]) {
    const binding = makeElement(document, 'span', 'office-webgl-edit-actions-key');
    const keyGroup = makeElement(document, 'span', 'office-webgl-edit-keycaps');
    for (const key of keys) append(keyGroup, makeElement(document, 'kbd', '', key));
    const labelNode = makeElement(document, 'span', '', label);
    append(binding, keyGroup, labelNode);
    append(keysRow, binding);
    if (name === 'rotate') rotateBinding = binding;
    else if (name === 'move') moveBinding = binding;
    else {
      escapeBinding = binding;
      escapeLabelNode = labelNode;
    }
  }
  const primary = makeElement(document, 'div', 'office-webgl-edit-actions-primary');
  const store = button(document, 'office-webgl-edit-action office-webgl-edit-remove', 'Remove');
  const optionsButton = button(document, 'office-webgl-edit-action', 'Options');
  optionsButton.setAttribute('aria-expanded', 'false');
  const secondary = makeElement(document, 'div', 'office-webgl-edit-actions-options');
  secondary.id = 'office-webgl-edit-options-menu';
  secondary.hidden = true;
  optionsButton.setAttribute('aria-controls', secondary.id);
  const rotation = makeElement(document, 'span', 'office-webgl-edit-actions-rotation');
  const rotate = button(document, 'office-webgl-edit-action', 'Rotate 90°');
  const customOptions = makeElement(document, 'div', 'office-webgl-edit-actions-custom-options');
  customOptions.hidden = true;
  append(primary, store, optionsButton);
  append(secondary, rotation, rotate, customOptions);
  append(pane, title, keysRow, primary, secondary);
  append(document.body, pane);

  const placementPane = makeElement(document, 'section', 'office-webgl-edit-placement');
  placementPane.id = PLACEMENT_PANE_ID;
  placementPane.hidden = true;
  placementPane.setAttribute('role', 'group');
  placementPane.setAttribute('aria-label', 'Placement controls');
  const placementTitle = makeElement(document, 'strong', 'office-webgl-edit-placement-title');
  const placementKeys = makeElement(document, 'div', 'office-webgl-edit-placement-keys');
  for (const [keys, label] of [
    [['R'], 'Rotate'], [['↑', '↓', '←', '→'], 'Move'],
    [['Enter'], 'Place'], [['Esc'], 'Cancel'],
  ]) {
    const binding = makeElement(document, 'span', 'office-webgl-edit-placement-key');
    const keyGroup = makeElement(document, 'span', 'office-webgl-edit-keycaps');
    for (const key of keys) append(keyGroup, makeElement(document, 'kbd', '', key));
    const labelNode = makeElement(document, 'span', '', label);
    append(binding, keyGroup, labelNode);
    append(placementKeys, binding);
  }
  const placementStatus = makeElement(document, 'span', 'office-webgl-edit-placement-status');
  placementStatus.setAttribute('role', 'status');
  placementStatus.setAttribute('aria-live', 'polite');
  const placementActions = makeElement(document, 'div', 'office-webgl-edit-placement-actions');
  const placementConfirm = button(
    document,
    'office-webgl-edit-placement-confirm',
    'Place ⏎',
  );
  placementConfirm.setAttribute('aria-label', 'Place item');
  append(placementActions, placementConfirm);
  append(placementPane, placementTitle, placementKeys, placementStatus, placementActions);
  append(document.body, placementPane);
  const placementBlockerLabel = makeElement(
    document,
    'span',
    'office-webgl-edit-placement-blocker-label',
  );
  placementBlockerLabel.id = PLACEMENT_BLOCKER_LABEL_ID;
  placementBlockerLabel.hidden = true;
  append(document.body, placementBlockerLabel);

  let currentView = null;
  let currentPlacementId = null;
  let geometryKey = null;
  let placementGeometryKey = null;
  let blockerGeometryKey = null;
  let optionsOpen = false;
  let mountedItemOptions = null;
  let unmountItemOptions = null;
  let draft = null;
  let ghost = null;
  let pointerSession = null;
  let frame = null;
  let running = false;
  let nudgeFlight = Promise.resolve();
  let selectionUndoAnchor = null;
  let selectionUndoDirty = false;

  function setOptionsOpen(open) {
    optionsOpen = Boolean(open);
    secondary.hidden = !optionsOpen;
    optionsButton.setAttribute('aria-expanded', String(optionsOpen));
  }

  function clearItemOptions() {
    try { unmountItemOptions?.(); }
    catch (error) { root.console?.error?.('office item options cleanup failed', error); }
    unmountItemOptions = null;
    mountedItemOptions = null;
    customOptions.replaceChildren?.();
    customOptions.hidden = true;
  }

  function mountItemOptions(view) {
    const integration = view?.itemOptions || null;
    if (mountedItemOptions === integration) return;
    clearItemOptions();
    if (!integration) return;
    mountedItemOptions = integration;
    customOptions.hidden = false;
    try {
      const cleanup = integration.mount({ document, host: customOptions, view });
      if (typeof cleanup === 'function') unmountItemOptions = cleanup;
    } catch (error) {
      root.console?.error?.('office item options mount failed', error);
      customOptions.textContent = 'Options unavailable';
    }
  }

  function selectedAction(callback) {
    const view = currentView;
    if (!view?.placementId || typeof callback !== 'function') return false;
    return callback(view.editor, view.placementId) === true;
  }

  function refreshAfterSelectedAction(callback, label) {
    const changed = selectedAction(callback);
    if (!changed) return false;
    try { refreshWebGL(); }
    catch (error) { root.console?.error?.(`office WebGL ${label} refresh failed`, error); }
    return true;
  }

  store.addEventListener('click', () => { void removeCurrentSelection(); });
  optionsButton.addEventListener('click', () => setOptionsOpen(!optionsOpen));
  rotate.addEventListener('click', () => refreshAfterSelectedAction((editor, placementId) => (
    editor.placementIntent?.('rotate', { placement_id: placementId })
  ), 'rotate'));
  placementConfirm.addEventListener('click', () => commitDraft());
  pane.addEventListener('pointerdown', (event) => event.stopPropagation?.());
  placementPane.addEventListener('pointerdown', (event) => event.stopPropagation?.());

  function removeGhost() {
    if (!ghost) return;
    (options.disposeGhost || disposeObject)(ghost);
    ghost = null;
  }

  function hidePlacement(clear = true) {
    placementOutline.visible = false;
    blockerOutline.visible = false;
    placementBlockerLabel.hidden = true;
    placementPane.hidden = true;
    pointerSession = null;
    removeGhost();
    if (clear) draft = null;
  }

  function previewFor(source, tile, placementId) {
    const roomId = typeof options.roomIdForTile === 'function'
      ? options.roomIdForTile(tile, runtime)
      : roomIdAt(runtime?.sceneSpec?.rooms, tile);
    if (!roomId) return Object.freeze({
      roomId: null,
      result: Object.freeze({ ok: false, reason: 'cross_room' }),
    });
    try {
      const result = source.placementController?.preview?.({
        placement_id: placementId,
        sku_id: source.skuId,
        room_id: roomId,
        anchor: tile,
        rotation: source.rotation,
      });
      return Object.freeze({
        roomId,
        result: result || Object.freeze({ ok: false, reason: 'stale_revision' }),
      });
    } catch (error) {
      return Object.freeze({
        roomId,
        result: Object.freeze({ ok: false, reason: String(error?.message || error) }),
      });
    }
  }

  function buildDraftGhost(value) {
    removeGhost();
    const build = options.buildGhost || buildMesh;
    const family = typeof options.familyForItem === 'function'
      ? options.familyForItem(value.source.item) : familyForSku(value.source.item);
    let object = null;
    try {
      object = build(placementGhostEntry(value.source, value.tile, family));
    } catch (error) {
      root.console?.error?.('office WebGL placement ghost failed', error);
      return null;
    }
    if (!object) return null;
    ghost = cloneGhostMaterials(object);
    ghost.name = 'office-webgl-edit-placement-ghost';
    ghost.userData.officeEditGhost = true;
    runtime.scene.add(ghost);
    return ghost;
  }

  function draftValue(source, tile, placementId, checked) {
    const center = spatialApi('centerFromAnchor')
      .centerFromAnchor(tile, source.item.grid?.footprint, source.rotation);
    return {
      source,
      tile: Object.freeze({ x: tile.x, y: tile.y }),
      placementId,
      roomId: checked.roomId,
      result: checked.result,
      footprint: source.footprint,
      center: Object.freeze(center),
    };
  }

  function setDraft(source, tile, placementId = draft?.placementId, checked = null) {
    const id = placementId || draftPlacementId(root, options.makePlacementId);
    const validation = checked || previewFor(source, tile, id);
    draft = draftValue(source, tile, id, validation);
    buildDraftGhost(draft);
    return draft;
  }

  function startDraft(source) {
    const placementId = draftPlacementId(root, options.makePlacementId);
    const world = runtime?.sceneSpec?.world || {};
    const initial = visibleFloorTile(
      runtime,
      document.getElementById?.('officeEditOwnedItems'),
      options.pointerToTile || pointerToTile,
      options.initialTile,
    ) || { x: Math.floor((world.w || 1) / 2), y: Math.floor((world.h || 1) / 2) };
    const candidates = candidateTiles(initial, world, options.initialTileLimit);
    let fallback = null;
    for (const tile of candidates.length ? candidates : [initial]) {
      const checked = previewFor(source, tile, placementId);
      fallback ||= { tile, checked };
      if (checked.result?.ok === true) return setDraft(source, tile, placementId, checked);
      if (checked.result?.readiness) break;
    }
    return setDraft(source, fallback?.tile || initial, placementId, fallback?.checked);
  }

  function updateDraftGeometry(value) {
    let zoom = 1;
    try { zoom = Number(options.zoom?.() ?? root.OFFICE?.camera?.cam?.zoom ?? 1); }
    catch { zoom = 1; }
    zoom = finitePositive(zoom) || 1;
    const thickness = Math.min(0.14, Math.max(0.025, OUTLINE_PX / (TILE_EDGE_PX * zoom)));
    const key = `${value.footprint.w}:${value.footprint.d}:${thickness.toFixed(5)}`;
    if (key !== placementGeometryKey) {
      placementGeometry.setAttribute('position', new THREE_API.BufferAttribute(
        ringVertices(value.footprint.w, value.footprint.d, thickness), 3,
      ));
      placementGeometry.computeBoundingSphere?.();
      placementGeometryKey = key;
    }
  }

  function renderBlocker(result) {
    const blocker = placementBlockerView(result);
    if (!blocker) {
      blockerOutline.visible = false;
      placementBlockerLabel.hidden = true;
      return null;
    }
    let zoom = 1;
    try { zoom = Number(options.zoom?.() ?? root.OFFICE?.camera?.cam?.zoom ?? 1); }
    catch { zoom = 1; }
    zoom = finitePositive(zoom) || 1;
    const thickness = Math.min(0.16, Math.max(0.035, OUTLINE_PX / (TILE_EDGE_PX * zoom)));
    const key = `${blocker.footprint.w}:${blocker.footprint.d}:${thickness.toFixed(5)}`;
    if (key !== blockerGeometryKey) {
      blockerGeometry.setAttribute('position', new THREE_API.BufferAttribute(
        ringVertices(blocker.footprint.w, blocker.footprint.d, thickness), 3,
      ));
      blockerGeometry.computeBoundingSphere?.();
      blockerGeometryKey = key;
    }
    blockerOutline.position.set(blocker.center.x, FLOOR_LIFT + 0.004, blocker.center.y);
    blockerOutline.visible = true;
    placementBlockerLabel.textContent = blocker.label;
    placementBlockerLabel.setAttribute('aria-label', `Placement blocked by ${blocker.label}`);
    const point = projectPoint(blocker.center.x, blocker.center.y, FLOOR_LIFT + 0.004);
    if (Number.isFinite(point?.sx) && Number.isFinite(point?.sy)) {
      placementBlockerLabel.style.transform = `translate3d(${point.sx}px, ${point.sy}px, 0) `
        + 'translate(-50%, calc(-100% - 7px))';
      placementBlockerLabel.hidden = false;
    } else {
      placementBlockerLabel.hidden = true;
    }
    return blocker;
  }

  function renderDraft(source) {
    if (!draft || draft.source.skuId !== source.skuId) startDraft(source);
    else if (draft.source.rotation !== source.rotation
        || draft.source.placementRevision !== source.placementRevision) {
      setDraft(source, draft.tile, draft.placementId);
    } else {
      draft.source = source;
    }
    if (!draft) return null;
    updateDraftGeometry(draft);
    placementMaterial.color.setHex(draft.result?.ok === true
      ? GREEN : draft.result?.readiness ? AMBER : RED);
    placementOutline.position.set(draft.center.x, FLOOR_LIFT + 0.002, draft.center.y);
    placementOutline.visible = true;
    renderBlocker(draft.result);
    placementTitle.textContent = `Place ${source.name}`;
    placementStatus.textContent = placementStatusText(draft.result);
    placementKeys.hidden = source.editorSnapshot?.placementHints === false;
    placementConfirm.disabled = draft.result?.ok !== true;
    placementPane.dataset.valid = String(draft.result?.ok === true);
    placementPane.hidden = false;
    const position = panePosition(
      projectedFootprint(draft, projectPoint),
      viewportSize(root, runtime, options.viewport),
      paneSize(placementPane),
    );
    if (position) placementPane.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    return draft;
  }

  function setDraftTile(tile) {
    if (!draft || !tile || !Number.isFinite(tile.x) || !Number.isFinite(tile.y)) return false;
    const next = { x: Math.floor(tile.x), y: Math.floor(tile.y) };
    if (next.x === draft.tile.x && next.y === draft.tile.y) return true;
    setDraft(draft.source, next, draft.placementId);
    renderDraft(draft.source);
    return true;
  }

  function refreshWebGL() {
    if (typeof options.refreshWorld === 'function') return options.refreshWorld();
    const webgl = root.OFFICE?.webgl;
    if (typeof webgl?.refreshEditProjection === 'function') return webgl.refreshEditProjection();
    const world = root.OFFICE?.state?.world;
    return world ? webgl?.setWorld?.(world) : null;
  }

  function anchorForSelection(view) {
    const anchor = view?.placement?.anchor;
    const position = view?.object?.position;
    if (view?.selectionKind !== 'item'
        || !Number.isFinite(anchor?.x) || !Number.isFinite(anchor?.y)
        || ![position?.x, position?.y, position?.z].every(Number.isFinite)) return null;
    const identity = view.authored
      ? { authored_id: view.placementId }
      : { placement_id: view.placementId };
    return Object.freeze({
      ...identity,
      selectionKey: view.selectionKey,
      authored: view.authored,
      anchor_x: anchor.x,
      anchor_y: anchor.y,
      room_id: view.placement.room_id || null,
      x: position.x,
      y: position.y,
      z: position.z,
      rotation: Number(view.placement.rotation) || 0,
    });
  }

  function selectionDiffersFromAnchor(view, anchor) {
    if (!view || !anchor || view.selectionKey !== anchor.selectionKey) return false;
    const position = view.object?.position;
    return view.placement?.anchor?.x !== anchor.anchor_x
      || view.placement?.anchor?.y !== anchor.anchor_y
      || (Number(view.placement?.rotation) || 0) !== anchor.rotation
      || position?.x !== anchor.x || position?.y !== anchor.y || position?.z !== anchor.z;
  }

  function syncSelectionUndo(view) {
    if (view?.selectionKind !== 'item' || !view.placement) {
      selectionUndoAnchor = null;
      selectionUndoDirty = false;
      return;
    }
    if (!selectionUndoAnchor || selectionUndoAnchor.selectionKey !== view.selectionKey) {
      selectionUndoAnchor = anchorForSelection(view);
    }
    selectionUndoDirty = selectionDiffersFromAnchor(view, selectionUndoAnchor);
  }

  function deselect(view) {
    view?.editor?.setTool?.('select');
    view?.editor?.setSelection?.(null);
    selectionUndoAnchor = null;
    selectionUndoDirty = false;
    renderFrame();
    return true;
  }

  async function undoSelectionOrDeselect() {
    runtime = options.runtime || getRuntime();
    const view = selectionView({ ...options, root, runtime });
    if (!view) return false;
    syncSelectionUndo(view);
    const anchor = selectionUndoAnchor;
    if (!selectionUndoDirty || !anchor) return deselect(view);

    const targetAnchor = Object.freeze({ x: anchor.anchor_x, y: anchor.anchor_y });
    const roomId = anchor.room_id || roomIdAt(runtime?.sceneSpec?.rooms, targetAnchor);
    if (!roomId) return false;
    let moved = false;
    if (view.authored) {
      const coordinator = options.coordinator || root.OFFICE?.state?.customization;
      moved = coordinator?.moveAuthoredFurnishing?.(
        anchor.authored_id,
        targetAnchor,
        roomId,
        anchor.rotation,
      ) === true;
      if (moved) view.editor.markDirty?.('authored-move');
    } else {
      const intent = Object.freeze({
        kind: 'move',
        placement_id: anchor.placement_id,
        room_id: roomId,
        anchor: targetAnchor,
        rotation: anchor.rotation,
      });
      moved = view.editor.placementIntent?.('move', intent) === true;
    }
    if (!moved) return false;
    view.object?.position?.set?.(anchor.x, anchor.y, anchor.z);
    renderFrame();
    if (await view.editor.save?.() !== true) return false;
    try { refreshWebGL(); }
    catch (error) { root.console?.error?.('office WebGL selection undo refresh failed', error); }
    return deselect(view);
  }

  async function removeCurrentSelection() {
    runtime = options.runtime || getRuntime();
    const view = selectionView({ ...options, root, runtime });
    if (!view?.removable) return false;
    const intent = view.selectionKind === 'animal'
      ? {
          kind: 'entity-remove',
          entity_kind: 'animal',
          entity_id: view.selection.id,
        }
      : view.authored
        ? { kind: 'authored-remove', placement_id: view.placementId }
        : { kind: 'store', placement_id: view.placementId };
    if (view.editor.placementIntent?.(intent.kind, intent) !== true) return false;
    view.editor.setSelection?.(null);
    try { refreshWebGL(); }
    catch (error) { root.console?.error?.('office WebGL remove refresh failed', error); }
    renderFrame();
    return await view.editor.save?.() === true;
  }

  function commitDraft() {
    const value = draft;
    if (!value) return false;
    const checked = previewFor(value.source, value.tile, value.placementId);
    draft = draftValue(value.source, value.tile, value.placementId, checked);
    if (checked.result?.ok !== true) {
      renderDraft(value.source);
      return false;
    }
    const detail = {
      pointer_id: 'keyboard-placement',
      placement_id: value.placementId,
      point: { x: value.center.x, y: value.center.y },
      tile: value.tile,
    };
    value.source.editor.pointerIntent?.('down', detail);
    value.source.editor.pointerIntent?.('up', detail);
    const committed = value.source.placementController?.snapshot?.()?.design?.placements
      ?.some((row) => row.placement_id === value.placementId) === true;
    if (!committed) {
      renderDraft(value.source);
      return false;
    }
    try { refreshWebGL(); }
    catch (error) { root.console?.error?.('office WebGL placement refresh failed', error); }
    hidePlacement(true);
    return true;
  }

  function claim(event) {
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }

  function eventTile(event) {
    return pointerTile(
      event.clientX,
      event.clientY,
      runtime,
      options.pointerToTile || pointerToTile,
    );
  }

  function pointerMove(event) {
    if (!draft || event.isPrimary === false) return;
    const tile = eventTile(event);
    if (tile) setDraftTile(tile);
    claim(event);
  }

  function pointerDown(event) {
    if (!draft || event.button !== 0 || event.isPrimary === false) return;
    pointerSession = event.pointerId;
    const tile = eventTile(event);
    if (tile) setDraftTile(tile);
    try { runtime.canvas.setPointerCapture?.(event.pointerId); } catch { /* optional */ }
    claim(event);
  }

  function pointerUp(event) {
    if (pointerSession === null || event.pointerId !== pointerSession) return;
    pointerSession = null;
    const tile = eventTile(event);
    if (tile) setDraftTile(tile);
    if (runtime.canvas.hasPointerCapture?.(event.pointerId)) {
      try { runtime.canvas.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
    }
    claim(event);
    commitDraft();
  }

  function pointerCancel(event) {
    if (pointerSession === null || event.pointerId !== pointerSession) return;
    pointerSession = null;
    claim(event);
  }

  async function performNudge(delta) {
    runtime = options.runtime || getRuntime();
    const view = selectionView({ ...options, root, runtime });
    if (!view?.movable) return false;
    syncSelectionUndo(view);

    const object = view.object;
    const origin = object?.position ? Object.freeze({
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
    }) : null;
    if (!origin || ![origin.x, origin.y, origin.z].every(Number.isFinite)) return false;

    if (view.selectionKind === 'agent' || view.selectionKind === 'animal') {
      const target = Object.freeze({ x: origin.x + delta.x, y: origin.z + delta.y });
      const world = runtime?.sceneSpec?.world || {};
      const worldDepth = Number(world.buildingH ?? world.h);
      if (!Number.isFinite(world.w) || !Number.isFinite(worldDepth)
          || target.x < 0 || target.y < 0 || target.x >= world.w || target.y >= worldDepth) {
        return false;
      }
      const moved = view.editor.placementIntent?.('entity-move', {
        entity_kind: view.selectionKind,
        entity_id: view.selection.id,
        delta,
        target,
      }) === true;
      if (!moved) return false;
      renderFrame();
      const saved = await view.editor.save?.();
      if (saved !== true) return false;
      try { refreshWebGL(); }
      catch (error) { root.console?.error?.('office WebGL entity move refresh failed', error); }
      renderFrame();
      return true;
    }

    const anchor = view.placement?.anchor;
    if (!Number.isFinite(anchor?.x) || !Number.isFinite(anchor?.y)) return false;
    const nextAnchor = Object.freeze({
      x: Math.floor(anchor.x) + delta.x,
      y: Math.floor(anchor.y) + delta.y,
    });
    const roomId = roomIdAt(runtime?.sceneSpec?.rooms, nextAnchor);
    if (!roomId) return false;

    const moveObject = () => {
      if (!object?.position?.set || !origin) return;
      object.position.set(origin.x + delta.x, origin.y, origin.z + delta.y);
    };

    if (view.authored) {
      const coordinator = options.coordinator || root.OFFICE?.state?.customization;
      const moved = coordinator?.moveAuthoredFurnishing?.(
        view.placementId,
        nextAnchor,
        roomId,
      ) === true;
      if (!moved) return false;
      moveObject();
      view.editor.markDirty?.('authored-move');
      renderFrame();
      const saved = await view.editor.save?.();
      if (saved !== true) return false;
      try { refreshWebGL(); }
      catch (error) { root.console?.error?.('office WebGL authored move refresh failed', error); }
      renderFrame();
      return true;
    }

    const intent = Object.freeze({
      kind: 'move',
      placement_id: view.placementId,
      room_id: roomId,
      anchor: nextAnchor,
      rotation: view.placement.rotation,
    });
    if (view.editor.placementIntent?.('move', intent) !== true) return false;
    moveObject();
    const saved = await view.editor.save?.();
    if (saved !== true) {
      if (origin) object.position.set(origin.x, origin.y, origin.z);
      renderFrame();
      return false;
    }
    try { refreshWebGL(); }
    catch (error) { root.console?.error?.('office WebGL keyboard move refresh failed', error); }
    renderFrame();
    return true;
  }

  function keydown(event) {
    if (typingTarget(event.target)) return;
    const delta = {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
    }[event.key];
    if (delta) {
      if (!draft && !currentView?.movable) return;
      claim(event);
      if (draft) setDraftTile({ x: draft.tile.x + delta.x, y: draft.tile.y + delta.y });
      else nudgeFlight = nudgeFlight
        .catch(() => false)
        .then(() => performNudge(delta))
        .catch((error) => {
          root.console?.error?.('office WebGL keyboard move failed', error);
          return false;
        });
      return;
    }
    if (event.key === 'r' || event.key === 'R') {
      if (!draft && !currentView?.rotatable) return;
      claim(event);
      if (draft) {
        draft.source.editor?.placementIntent?.('rotate', { placement_id: null });
        renderFrame();
      } else if (currentView?.rotatable) {
        refreshAfterSelectedAction((editor, placementId) => (
          editor.placementIntent?.('rotate', { placement_id: placementId })
        ), 'keyboard rotate');
      }
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && currentView) {
      claim(event);
      nudgeFlight = nudgeFlight
        .catch(() => false)
        .then(() => removeCurrentSelection())
        .catch((error) => {
          root.console?.error?.('office WebGL remove failed', error);
          return false;
        });
      return;
    }
    if (event.key === 'Escape') {
      if (draft) {
        claim(event);
        const editor = draft.source?.editor;
        hidePlacement(true);
        try { editor?.placementIntent?.('cancel'); }
        catch (error) { root.console?.error?.('office WebGL placement cancel failed', error); }
        renderFrame();
      } else if (currentView) {
        claim(event);
        nudgeFlight = nudgeFlight
          .catch(() => false)
          .then(() => undoSelectionOrDeselect())
          .catch((error) => {
            root.console?.error?.('office WebGL selection undo failed', error);
            return false;
          });
      }
      return;
    }
    if (draft && event.key === 'Enter') {
      claim(event);
      commitDraft();
    }
  }

  runtime.canvas?.addEventListener?.('pointermove', pointerMove, true);
  runtime.canvas?.addEventListener?.('pointerdown', pointerDown, true);
  runtime.canvas?.addEventListener?.('pointerup', pointerUp, true);
  runtime.canvas?.addEventListener?.('pointercancel', pointerCancel, true);
  document.addEventListener?.('keydown', keydown, true);

  function hide() {
    currentView = null;
    currentPlacementId = null;
    selectionUndoAnchor = null;
    selectionUndoDirty = false;
    outline.visible = false;
    pane.hidden = true;
    setOptionsOpen(false);
    clearItemOptions();
  }

  function updateGeometry(view) {
    let zoom = 1;
    try { zoom = Number(options.zoom?.() ?? root.OFFICE?.camera?.cam?.zoom ?? 1); }
    catch { zoom = 1; }
    zoom = finitePositive(zoom) || 1;
    const thickness = Math.min(0.12, Math.max(0.02, OUTLINE_PX / (TILE_EDGE_PX * zoom)));
    const key = `${view.footprint.w}:${view.footprint.d}:${thickness.toFixed(5)}`;
    if (key === geometryKey) return;
    geometry.setAttribute('position', new THREE_API.BufferAttribute(
      // A flat wall prop still needs a visible stroke; never inflate its
      // canonical collision footprint just to draw the selection outline.
      ringVertices(Math.max(view.footprint.w, thickness),
        Math.max(view.footprint.d, thickness), thickness), 3,
    ));
    geometry.computeBoundingSphere?.();
    geometryKey = key;
  }

  function renderFrame() {
    runtime = options.runtime || getRuntime();
    if (!runtime?.scene || outline.parent !== runtime.scene) {
      outline.parent?.remove?.(outline);
      runtime?.scene?.add?.(outline);
    }
    if (!runtime?.scene || placementOutline.parent !== runtime.scene) {
      placementOutline.parent?.remove?.(placementOutline);
      runtime?.scene?.add?.(placementOutline);
      if (draft) buildDraftGhost(draft);
    }
    if (!runtime?.scene || blockerOutline.parent !== runtime.scene) {
      blockerOutline.parent?.remove?.(blockerOutline);
      runtime?.scene?.add?.(blockerOutline);
    }
    const source = placementSource({ ...options, root });
    if (source) {
      hide();
      return renderDraft(source);
    }
    if (draft || ghost || !placementPane.hidden || placementOutline.visible) hidePlacement(true);
    const view = selectionView({ ...options, root, runtime });
    if (!view) {
      hide();
      return null;
    }
    if (currentPlacementId !== view.placementId) setOptionsOpen(false);
    syncSelectionUndo(view);
    currentView = view;
    currentPlacementId = view.placementId;
    updateGeometry(view);
    outline.position.set(view.center.x, FLOOR_LIFT, view.center.y);
    outline.visible = true;

    title.textContent = view.name;
    keysRow.hidden = view.hideKeys === true;
    rotateBinding.hidden = !view.rotatable;
    moveBinding.hidden = !view.movable;
    escapeBinding.hidden = false;
    escapeLabelNode.textContent = selectionUndoDirty ? 'Undo' : 'Deselect';
    rotation.textContent = view.rotatable ? `Rotation ${view.placement.rotation}°` : '';
    rotation.hidden = !view.rotatable;
    rotate.hidden = !view.rotatable;
    rotate.disabled = !view.rotatable;
    mountItemOptions(view);
    optionsButton.hidden = !view.rotatable && !view.itemOptions;
    store.hidden = view.hideRemove === true;
    store.disabled = !view.removable;
    store.title = view.removable ? '' : (view.removalReason || (view.selectionKind === 'agent'
      ? 'Agents remain on the office roster' : 'This item cannot be removed'));
    pane.dataset.placementId = view.placementId;
    pane.dataset.selectionKind = view.selectionKind;
    pane.hidden = false;
    const position = panePosition(
      projectedFootprint(view, projectPoint),
      viewportSize(root, runtime, options.viewport),
      paneSize(pane),
    );
    if (position) pane.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    return view;
  }

  function tick() {
    if (!running) return;
    renderFrame();
    frame = requestFrame(tick);
  }

  function start() {
    if (running) return api;
    if (typeof requestFrame !== 'function') {
      throw new Error('WebGL edit selection requires requestAnimationFrame');
    }
    running = true;
    renderFrame();
    frame = requestFrame(tick);
    return api;
  }

  function stop() {
    running = false;
    if (frame !== null) cancelFrame?.(frame);
    frame = null;
    hide();
    hidePlacement(true);
    runtime?.canvas?.removeEventListener?.('pointermove', pointerMove, true);
    runtime?.canvas?.removeEventListener?.('pointerdown', pointerDown, true);
    runtime?.canvas?.removeEventListener?.('pointerup', pointerUp, true);
    runtime?.canvas?.removeEventListener?.('pointercancel', pointerCancel, true);
    document.removeEventListener?.('keydown', keydown, true);
    outline.parent?.remove?.(outline);
    placementOutline.parent?.remove?.(placementOutline);
    blockerOutline.parent?.remove?.(blockerOutline);
    geometry.dispose?.();
    material.dispose?.();
    placementGeometry.dispose?.();
    placementMaterial.dispose?.();
    blockerGeometry.dispose?.();
    blockerMaterial.dispose?.();
    remove(pane);
    remove(placementPane);
    remove(placementBlockerLabel);
    remove(style);
    return api;
  }

  const api = Object.freeze({
    start,
    stop,
    renderFrame,
    get active() { return running; },
    get element() { return pane; },
    get outline() { return outline; },
    get placementElement() { return placementPane; },
    get placementOutline() { return placementOutline; },
    get blockerOutline() { return blockerOutline; },
    get blockerLabel() { return placementBlockerLabel; },
    get ghost() { return ghost; },
    get draft() { return draft; },
    idle: () => nudgeFlight,
  });
  return api;
}

let singleton = null;

export function start(options = {}) {
  singleton ||= createSelectionSurface(options);
  return singleton.start();
}

export function stop() {
  singleton?.stop?.();
  singleton = null;
}

export function renderFrame() {
  return singleton?.renderFrame() || null;
}

export { GREEN_CSS, RED_CSS };
