/* office.webgl.mesh.desks.js — metadata-faithful blocky desk meshes. */

const HALF_PI = Math.PI / 2;
const MIN_CORNER = 'min-corner';

const PART_COUNTS = Object.freeze({
  '0100': 21,
  '0101': 18,
  '0106': 15,
});

function place(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function rotate(object, x = 0, y = 0, z = 0) {
  object.rotation.set(x, y, z);
  return object;
}

function named(ctx, name, ...objects) {
  const part = ctx.group(...objects);
  part.name = `desks-part:${name}`;
  return part;
}

function box(ctx, w, d, h, materialName, x, y, z) {
  return place(ctx.tileBox(w, d, h, materialName), x, y, z);
}

function strip(ctx, w, d, h, materialName, x, y, z) {
  return place(ctx.strip(w, d, h, materialName), x, y, z);
}

function post(ctx, rTop, rBottom, h, materialName, x, y, z, sides = 4) {
  return place(ctx.cylinder(rTop, rBottom, h, materialName, sides), x, y, z);
}

function finish(ctx, sku, width, depth, parts) {
  const expected = PART_COUNTS[sku];
  if (parts.length !== expected) {
    throw new Error(`sku-${sku} desk part count ${parts.length} does not match ${expected}`);
  }

  const geometry = ctx.group(parts);
  geometry.name = `desks-parts:sku-${sku}`;
  geometry.userData.partCount = parts.length;
  geometry.userData.partCountSource = 'founder-voxel-metadata';

  const shadow = ctx.contactShadow(width * 0.94, depth * 0.92);
  shadow.name = `desks-shadow:sku-${sku}`;

  const root = ctx.group(shadow, geometry);
  root.name = `desks:sku-${sku}`;
  return root;
}

function drawerFaces(ctx, x, z, materialName) {
  return ctx.group(
    strip(ctx, 0.39, 0.028, 0.14, materialName, x, 0.13, z),
    strip(ctx, 0.39, 0.028, 0.14, materialName, x, 0.33, z),
    strip(ctx, 0.39, 0.028, 0.14, materialName, x, 0.53, z),
  );
}

function drawerHandles(ctx, x, z) {
  return ctx.group(
    strip(ctx, 0.18, 0.025, 0.025, 'charcoal-mid', x, 0.225, z),
    strip(ctx, 0.18, 0.025, 0.025, 'charcoal-mid', x, 0.425, z),
    strip(ctx, 0.18, 0.025, 0.025, 'charcoal-mid', x, 0.625, z),
  );
}

function executivePlantFoliage(ctx) {
  const foliage = ctx.greeble(0.36, 0.32, 6, 'foliage', 0.16);
  foliage.children.forEach((leaf, index) => {
    leaf.position.y = [0.02, 0.09, 0, 0.11, 0.05, 0.13][index];
    leaf.scale.set(index % 2 ? 0.9 : 1.1, index % 3 ? 1.1 : 1.25, 1);
  });
  return place(foliage, 0.70, 1.02, -0.49);
}

function buildExecutiveDesk(ctx) {
  const chairBack = ctx.group(
    box(ctx, 0.46, 0.10, 0.25, 'charcoal', 0.05, 0.60, 0.74),
    box(ctx, 0.42, 0.10, 0.22, 'charcoal-mid', 0.05, 0.85, 0.74),
  );

  const chairArms = ctx.group(
    post(ctx, 0.025, 0.03, 0.22, 'iron', -0.27, 0.47, 0.57),
    post(ctx, 0.025, 0.03, 0.22, 'iron', 0.37, 0.47, 0.57),
    box(ctx, 0.11, 0.30, 0.06, 'iron', -0.27, 0.68, 0.57),
    box(ctx, 0.11, 0.30, 0.06, 'iron', 0.37, 0.68, 0.57),
  );

  const parts = [
    named(ctx, 'main desktop',
      box(ctx, 1.90, 0.62, 0.12, 'oak', 0, 0.72, 0.08)),
    named(ctx, 'return desktop',
      box(ctx, 0.58, 1.08, 0.12, 'honey-wood', 0.65, 0.72, -0.25)),
    named(ctx, 'left drawer pedestal',
      box(ctx, 0.48, 0.52, 0.72, 'wood-light', -0.80, 0, 0.08)),
    named(ctx, 'left drawer fronts',
      drawerFaces(ctx, -0.80, 0.355, 'honey-wood')),
    named(ctx, 'left drawer handles',
      drawerHandles(ctx, -0.80, 0.385)),
    named(ctx, 'right drawer pedestal',
      box(ctx, 0.44, 0.50, 0.72, 'charcoal', 0.65, 0, -0.34)),
    named(ctx, 'right drawer fronts',
      drawerFaces(ctx, 0.65, -0.075, 'oak')),
    named(ctx, 'right drawer handles',
      drawerHandles(ctx, 0.65, -0.045)),
    named(ctx, 'front modesty panel',
      box(ctx, 1.24, 0.07, 0.47, 'charcoal', -0.16, 0.22, -0.16)),
    named(ctx, 'right end support',
      box(ctx, 0.14, 0.50, 0.72, 'charcoal-mid', 0.90, 0, 0.15)),
    named(ctx, 'desktop monitor frame',
      box(ctx, 0.62, 0.09, 0.32, 'iron', -0.34, 1.00, 0.01)),
    named(ctx, 'desktop monitor screen',
      strip(ctx, 0.53, 0.022, 0.24, 'iron-light', -0.34, 1.04, 0.066)),
    named(ctx, 'monitor neck',
      post(ctx, 0.035, 0.045, 0.16, 'iron', -0.34, 0.84, 0.01, 6)),
    named(ctx, 'monitor foot',
      box(ctx, 0.30, 0.20, 0.04, 'iron', -0.34, 0.84, 0.01)),
    named(ctx, 'chair back', chairBack),
    named(ctx, 'chair headrest',
      box(ctx, 0.34, 0.11, 0.17, 'iron', 0.05, 1.07, 0.74)),
    named(ctx, 'chair seat',
      box(ctx, 0.56, 0.40, 0.12, 'charcoal', 0.05, 0.43, 0.57)),
    named(ctx, 'chair armrests', chairArms),
    named(ctx, 'plant pot',
      box(ctx, 0.24, 0.24, 0.18, 'cream', 0.70, 0.84, -0.49)),
    named(ctx, 'plant soil',
      strip(ctx, 0.20, 0.20, 0.025, 'wood', 0.70, 1.02, -0.49)),
    named(ctx, 'plant foliage', executivePlantFoliage(ctx)),
  ];

  return finish(ctx, '0100', 2.0, 2.0, parts);
}

function liftingColumn(ctx, x) {
  return ctx.group(
    post(ctx, 0.065, 0.075, 0.58, 'iron', x, 0.08, 0, 4),
    post(ctx, 0.045, 0.055, 0.34, 'charcoal-mid', x, 0.66, 0, 4),
  );
}

function stabilizingFoot(ctx, x) {
  return ctx.group(
    box(ctx, 0.16, 0.66, 0.08, 'iron', x, 0, 0),
    box(ctx, 0.34, 0.15, 0.08, 'iron', x, 0, 0),
  );
}

function footEndCaps(ctx, x) {
  return ctx.group(
    box(ctx, 0.20, 0.10, 0.09, 'iron-light', x, 0, -0.30),
    box(ctx, 0.20, 0.10, 0.09, 'iron-light', x, 0, 0.30),
  );
}

function standingDeskButtons(ctx) {
  const buttons = ctx.greeble(0.16, 0.05, 3, ctx.screenMat('sage-light'), 0.035);
  rotate(buttons, -HALF_PI, 0, 0);
  return place(buttons, 0.58, 1.00, 0.386);
}

function standingPlantFoliage(ctx) {
  const foliage = ctx.greeble(0.30, 0.26, 5, 'foliage', 0.12);
  foliage.children.forEach((leaf, index) => {
    leaf.position.y = [0, 0.015, 0.03, 0.01, 0.02][index];
  });
  return place(foliage, -0.58, 1.20, -0.03);
}

function buildStandingDesk(ctx) {
  const parts = [
    named(ctx, 'desktop',
      box(ctx, 1.72, 0.70, 0.12, 'honey-wood', 0, 0.98, 0)),
    named(ctx, 'left lifting column', liftingColumn(ctx, -0.66)),
    named(ctx, 'right lifting column', liftingColumn(ctx, 0.66)),
    named(ctx, 'left upper bracket',
      box(ctx, 0.34, 0.52, 0.08, 'iron-light', -0.66, 0.91, 0)),
    named(ctx, 'right upper bracket',
      box(ctx, 0.34, 0.52, 0.08, 'iron-light', 0.66, 0.91, 0)),
    named(ctx, 'left floor foot', stabilizingFoot(ctx, -0.66)),
    named(ctx, 'right floor foot', stabilizingFoot(ctx, 0.66)),
    named(ctx, 'left foot end caps', footEndCaps(ctx, -0.66)),
    named(ctx, 'right foot end caps', footEndCaps(ctx, 0.66)),
    named(ctx, 'height-control housing',
      box(ctx, 0.28, 0.06, 0.10, 'charcoal', 0.58, 0.91, 0.35)),
    named(ctx, 'height-control buttons', standingDeskButtons(ctx)),
    named(ctx, 'desktop monitor frame',
      box(ctx, 0.62, 0.09, 0.32, 'graphite-dark', 0.10, 1.26, -0.14)),
    named(ctx, 'desktop monitor screen',
      strip(ctx, 0.53, 0.022, 0.24, ctx.screenMat('blue'), 0.10, 1.30, -0.086)),
    named(ctx, 'monitor neck',
      post(ctx, 0.035, 0.045, 0.16, 'graphite-mid', 0.10, 1.10, -0.14, 6)),
    named(ctx, 'monitor foot',
      box(ctx, 0.30, 0.20, 0.04, 'graphite-dark', 0.10, 1.10, -0.14)),
    named(ctx, 'plant pot',
      box(ctx, 0.22, 0.22, 0.11, 'cream', -0.58, 1.10, -0.03)),
    named(ctx, 'plant soil',
      strip(ctx, 0.18, 0.18, 0.025, 'wood', -0.58, 1.21, -0.03)),
    named(ctx, 'plant foliage', standingPlantFoliage(ctx)),
  ];

  return finish(ctx, '0101', 1.8, 0.8, parts);
}

function receptionWorktop(ctx) {
  return ctx.group(
    box(ctx, 1.42, 0.58, 0.10, 'wood-light', -0.12, 0.78, -0.13),
    box(ctx, 0.42, 0.78, 0.10, 'wood-light', 0.58, 0.78, -0.03),
  );
}

function receptionFrontPanels(ctx, materialName, y, height) {
  return ctx.group(
    strip(ctx, 0.50, 0.035, height, materialName, -0.55, y, 0.48),
    strip(ctx, 0.50, 0.035, height, materialName, 0, y, 0.48),
    strip(ctx, 0.50, 0.035, height, materialName, 0.55, y, 0.48),
  );
}

function buildReceptionDesk(ctx) {
  const parts = [
    named(ctx, 'raised front counter',
      box(ctx, 1.72, 0.28, 0.12, 'honey-wood', 0, 1.08, 0.34)),
    named(ctx, 'raised side counter',
      box(ctx, 0.28, 0.82, 0.12, 'honey-wood', 0.72, 1.08, 0)),
    named(ctx, 'inner worktop', receptionWorktop(ctx)),
    named(ctx, 'upper front fascia',
      strip(ctx, 1.62, 0.07, 0.26, 'iron-light', 0, 0.82, 0.425)),
    named(ctx, 'middle front panels',
      receptionFrontPanels(ctx, 'iron', 0.43, 0.36)),
    named(ctx, 'lower front panels',
      receptionFrontPanels(ctx, 'charcoal-mid', 0.16, 0.23)),
    named(ctx, 'left side panel',
      box(ctx, 0.08, 0.82, 0.92, 'iron', -0.82, 0.16, 0)),
    named(ctx, 'right side panel',
      box(ctx, 0.08, 0.82, 0.92, 'iron', 0.82, 0.16, 0)),
    named(ctx, 'wood plinth',
      box(ctx, 1.70, 0.10, 0.08, 'honey-wood', 0, 0.08, 0.42)),
    named(ctx, 'dark floor base',
      box(ctx, 1.72, 0.84, 0.08, 'charcoal', 0, 0, 0)),
    named(ctx, 'monitor frame',
      box(ctx, 0.48, 0.08, 0.27, 'graphite-dark', -0.25, 0.91, -0.16)),
    named(ctx, 'monitor screen',
      strip(ctx, 0.40, 0.022, 0.19, 'metal-dark', -0.25, 0.95, -0.211)),
    named(ctx, 'monitor neck',
      post(ctx, 0.03, 0.04, 0.13, 'charcoal', -0.25, 0.88, -0.16, 6)),
    named(ctx, 'monitor base',
      box(ctx, 0.27, 0.18, 0.035, 'charcoal', -0.25, 0.88, -0.16)),
    named(ctx, 'desk accessory',
      box(ctx, 0.18, 0.16, 0.17, 'sage', 0.34, 0.88, -0.15)),
  ];

  return finish(ctx, '0106', 1.8, 1.0, parts);
}

function skuCode(value) {
  const code = String(value ?? '').replace(/^sku-/, '');
  return /^\d+$/.test(code) ? code.padStart(4, '0') : code;
}

function entryMatrix(entry, ctx) {
  if (!Number.isFinite(entry?.x)) throw new TypeError('entry.x must be finite');
  if (!Number.isFinite(entry?.y)) throw new TypeError('entry.y must be finite');
  const rotation = entry.rot === undefined ? 0 : entry.rot;
  if (!Number.isFinite(rotation)) throw new TypeError('entry.rot must be finite');
  let position = entry;
  if (entry.anchorSemantics === MIN_CORNER) {
    const spatial = globalThis.OfficeSpatial;
    if (spatial?.ANCHOR_SEMANTICS !== MIN_CORNER
        || typeof spatial?.entryCenter !== 'function') {
      throw new Error(`min-corner desk entry requires OfficeSpatial.entryCenter(): ${entry.sku || '<unknown>'}`);
    }
    position = spatial.entryCenter(entry);
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
      throw new TypeError('desk entry center must be finite');
    }
  }
  return new ctx.THREE.Matrix4().compose(
    new ctx.THREE.Vector3(position.x, 0, position.y),
    new ctx.THREE.Quaternion().setFromEuler(new ctx.THREE.Euler(
      0, ctx.THREE.MathUtils.degToRad(rotation), 0,
    )),
    new ctx.THREE.Vector3(1, 1, 1),
  );
}

function partLabel(object, root) {
  let current = object.parent;
  while (current && current !== root) {
    if (current.name.startsWith('desks-part:')) {
      return current.name.slice('desks-part:'.length);
    }
    current = current.parent;
  }
  return 'unnamed';
}

function templateParts(template) {
  template.updateMatrixWorld(true);
  const labels = new Map();
  const parts = [];
  template.traverse((object) => {
    if (object.isMesh !== true) return;
    const label = partLabel(object, template);
    const ordinal = labels.get(label) || 0;
    labels.set(label, ordinal + 1);
    parts.push(Object.freeze({
      label,
      ordinal,
      geometry: object.geometry,
      material: object.material,
      matrix: object.matrixWorld.clone(),
      castShadow: object.castShadow,
      receiveShadow: object.receiveShadow,
      renderOrder: object.renderOrder,
      visible: object.visible,
      frustumCulled: object.frustumCulled,
    }));
  });
  return parts;
}

export function buildInstances(entries, ctx) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new TypeError('desk instances require at least two entries');
  }
  const sku = skuCode(entries[0]?.sku);
  if (entries.some((entry) => skuCode(entry?.sku) !== sku)) {
    throw new TypeError('desk instances must share one sku');
  }
  if (entries.some((entry) => typeof entry?.placement_id === 'string' && entry.placement_id)) {
    throw new TypeError('placement_id desks cannot be instanced');
  }

  const template = build({ sku }, ctx);
  if (!template) return null;
  const transforms = entries.map((entry) => entryMatrix(entry, ctx));
  const editableInstances = Object.freeze(entries.map((entry) => {
    const id = typeof entry?.stable_furnishing_id === 'string'
      ? entry.stable_furnishing_id : null;
    if (!id) return null;
    const center = entry.anchorSemantics === MIN_CORNER
      ? globalThis.OfficeSpatial.entryCenter(entry) : { x: entry.x, y: entry.y };
    const footprint = globalThis.OfficeSpatial?.rotatedFootprint?.(
      entry.footprint || { w: 1, d: 1 }, entry.rot || 0,
    ) || entry.footprint || { w: 1, d: 1 };
    return Object.freeze({
      stable_furnishing_id: id,
      room_id: entry.room_id,
      x: center.x,
      y: center.y,
      footprint: Object.freeze({ w: footprint.w, d: footprint.d }),
    });
  }));
  const root = ctx.group();
  root.name = `desks-instances:sku-${sku}`;
  root.userData.instanceCount = entries.length;
  root.userData.partCount = PART_COUNTS[sku];

  for (const part of templateParts(template)) {
    const mesh = new ctx.THREE.InstancedMesh(part.geometry, part.material, entries.length);
    mesh.name = `desks-instance:sku-${sku}:${part.label}:${part.ordinal}`;
    mesh.castShadow = part.castShadow;
    mesh.receiveShadow = part.receiveShadow;
    mesh.renderOrder = part.renderOrder;
    mesh.visible = part.visible;
    mesh.frustumCulled = part.frustumCulled;
    mesh.userData.editableInstances = editableInstances;
    transforms.forEach((transform, index) => {
      mesh.setMatrixAt(index, new ctx.THREE.Matrix4().multiplyMatrices(transform, part.matrix));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  return root;
}

function build(entry, ctx) {
  switch (skuCode(entry?.sku)) {
    case '0100': return buildExecutiveDesk(ctx);
    case '0101': return buildStandingDesk(ctx);
    case '0106': return buildReceptionDesk(ctx);
    default: return null;
  }
}

export function init(reg) {
  reg.registerMesh('desks', build);
}
