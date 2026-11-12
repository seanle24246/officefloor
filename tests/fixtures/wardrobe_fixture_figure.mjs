/* wardrobe_fixture_figure.mjs — TEST FIXTURE ONLY (WARDROBE-CLOSEUP-01), never shipped.
 *
 * A stand-in for WARDROBE-RENDER-01's buildAgentFigure(look, ctx, {tier}) so the close-up layer can be built and
 * checked before the real floor builder lands. It follows WARDROBE-SEAM-SPECS §4 names exactly: today's
 * office.webgl.mesh.agent.js body (`agent-part:<name>`), worn items as `wear:<slot>:<item id>` groups parented to the
 * body part they follow (sleeves under the arms), hair as `hair:<style>` on the head, skin parts with
 * userData.skin, every group with userData.wardrobe. Items are plain boxes per slot; nothing here is the real look.
 * Like the real builder it returns the bare figure: the face anchors and contact shadow come from stageFigure().
 * The QA probe serves this file at /office.webgl.wardrobe.js only when static/office.webgl.wardrobe.js is absent.
 */
const SHORT_SLEEVES = new Set(['polo', 'tee', 'v-neck', 'short-sleeve-button']);
const SLEEVELESS = new Set(['shell-top', 'sweater-vest', 'suit-vest', 'fleece-vest', 'puffer-vest', 'sheath-dress']);
const SHORTS = new Set(['chino-shorts', 'cargo-shorts', 'denim-shorts']);
const SKIRTS = new Set(['pencil-skirt', 'a-line-skirt', 'pleated-skirt', 'culottes', 'sheath-dress', 'wrap-dress',
  'shirt-dress', 'skirt-suit']);
const CAPS = new Set(['baseball-cap', 'trucker-cap', 'classic-cap', 'sun-visor']);

export function buildAgentFigure(look, ctx, { tier = 'floor' } = {}) {
  const THREE = ctx.THREE;
  const materials = new Map();
  const mat = (hex) => {
    if (!materials.has(hex)) materials.set(hex, new THREE.MeshLambertMaterial({ color: hex, flatShading: true }));
    return materials.get(hex);
  };
  const box = (w, d, h, hex, x = 0, y = 0, z = 0) => {
    const group = ctx.tileBox(w, d, h, 'paper');
    group.children[0].material = mat(hex);
    group.position.set(x, y, z);
    return group;
  };
  const named = (name, object, userData = {}) => { object.name = name; Object.assign(object.userData, userData); return object; };
  const wear = (slot, item, ...children) => named(`wear:${slot}:${item.id}`, ctx.group(...children),
    { wardrobe: { slot, id: item.id, color: item.color } });

  const model = look.model;
  const bear = model === 'bear';
  const skin = look.skin;
  const fur = skin;
  const part = (name, object, skinPart = false) => named(`agent-part:${name}`, object, skinPart ? { skin: true } : {});
  const torso = part('torso', box(0.84, 0.44, 0.70, bear ? fur : '#d8d4cc', 0, 0, 0)); torso.position.set(0, 0.43, 0);
  const arms = [-1, 1].map((sign) => { const arm = part(sign < 0 ? 'left-arm' : 'right-arm', box(0.19, 0.29, 0.44, bear ? fur : skin), true); arm.position.set(sign * 0.515, 0.65, 0); return arm; });
  const hands = [-1, 1].map((sign) => { const hand = part(sign < 0 ? 'left-hand' : 'right-hand', box(bear ? 0.23 : 0.19, bear ? 0.30 : 0.26, bear ? 0.14 : 0.115, skin), true); hand.position.set(sign * 0.515, 0.535, 0.01); return hand; });
  const legs = [-1, 1].map((sign) => { const leg = part(sign < 0 ? 'left-leg' : 'right-leg', box(0.27, 0.30, 0.34, bear ? fur : skin), true); leg.position.set(sign * 0.18, 0.09, 0); return leg; });
  const shoes = [-1, 1].map((sign) => { const shoe = part(sign < 0 ? 'left-shoe' : 'right-shoe', box(bear ? 0.31 : 0.27, bear ? 0.37 : 0.34, bear ? 0.12 : 0.09, bear ? '#4a3020' : '#2a2522')); shoe.position.set(sign * 0.18, 0, 0.02); return shoe; });
  const head = part('head', box(0.57, 0.46, 0.53, skin), true); head.position.set(0, 1.13, 0);
  const extras = [];
  if (bear) {
    extras.push(part('left-ear', box(0.19, 0.20, 0.20, fur, -0.20, 1.57, -0.015)), part('right-ear', box(0.19, 0.20, 0.20, fur, 0.20, 1.57, -0.015)),
      part('snout', box(0.32, 0.12, 0.16, '#b0763c', 0, 1.28, 0.25)));
  }
  // hair on the head (head-local)
  const hair = look.hair || { style: 'bald', color: '#000000' };
  if (!bear && hair.style !== 'bald') {
    const pieces = [box(0.59, 0.49, 0.18, hair.color, 0, 0.43, -0.005), box(0.59, 0.065, 0.27, hair.color, 0, 0.13, -0.22)];
    if (/bun|ponytail/.test(hair.style)) pieces.push(box(0.25, 0.25, 0.20, hair.color, 0, 0.565, -0.10));
    if (/long|bob|braids|locs|mullet/.test(hair.style)) pieces.push(box(0.6, 0.08, 0.5, hair.color, 0, -0.2, -0.22));
    head.add(named(`hair:${hair.style}`, ctx.group(...pieces), { wardrobe: { slot: 'hair', id: hair.style, color: hair.color } }));
  }

  for (const [slot, item] of Object.entries(look.wear || {})) {
    const c = item.color;
    const longSleeves = !SHORT_SLEEVES.has(item.id) && !SLEEVELESS.has(item.id);
    const sleeve = (out) => longSleeves ? box(0.21 + out, 0.31 + out, 0.44, c, 0, -0.005, 0) : box(0.21 + out, 0.31 + out, 0.2, c, 0, 0.24, 0);
    if (slot === 'top' || slot === 'outer' || slot === 'full') {
      const out = slot === 'outer' ? 0.05 : slot === 'full' ? 0.04 : 0.02;
      torso.add(wear(slot, item, box(0.84 + out, 0.44 + out, 0.70 - (slot === 'outer' ? 0.04 : 0), c, 0, slot === 'outer' ? 0.04 : -0.005, 0)));
      if (!SLEEVELESS.has(item.id)) arms.forEach((arm) => arm.add(wear(slot, item, sleeve(out))));
    }
    if (slot === 'bottom' || slot === 'full') {
      legs.forEach((leg) => leg.add(wear(slot, item, SKIRTS.has(item.id) ? box(0.35, 0.38, 0.28, c, 0, 0.06, 0)
        : SHORTS.has(item.id) ? box(0.29, 0.32, 0.2, c, 0, 0.14, 0) : box(0.29, 0.32, 0.35, c, 0, -0.005, 0))));
    }
    if (slot === 'feet') shoes.forEach((shoe) => shoe.add(wear(slot, item, box(0.29, 0.36, item.id.includes('boots') ? 0.18 : 0.1, c, 0, -0.002, 0))));
    if (slot === 'head') {
      head.add(wear(slot, item, CAPS.has(item.id)
        ? ctx.group(box(0.6, 0.5, 0.16, c, 0, 0.46, -0.01), box(0.5, 0.2, 0.03, c, 0, 0.46, 0.3))
        : ctx.group(box(0.56, 0.48, 0.18, c, 0, 0.5, 0), box(0.76, 0.66, 0.03, c, 0, 0.47, 0))));
    }
    if (slot === 'eyes') head.add(wear(slot, item, box(0.5, 0.03, 0.1, c, 0, 0.255, 0.245)));
    if (slot === 'ears') head.add(wear(slot, item, ctx.group(box(0.62, 0.08, 0.05, c, 0, 0.55, 0), box(0.05, 0.14, 0.16, c, -0.3, 0.26, 0), box(0.05, 0.14, 0.16, c, 0.3, 0.26, 0))));
    if (slot === 'neck') torso.add(wear(slot, item, box(item.id.includes('tie') ? 0.08 : 0.4, 0.03, item.id.includes('tie') ? 0.42 : 0.08, c, 0, 0.27, 0.235)));
    if (slot === 'badge') torso.add(wear(slot, item, box(0.12, 0.02, 0.08, c, 0.22, 0.48, 0.245)));
    if (slot === 'back') torso.add(wear(slot, item, box(0.6, 0.16, 0.5, c, 0, 0.12, -0.3)));
    if (slot === 'waist') torso.add(wear(slot, item, box(0.9, 0.5, 0.07, c, 0, 0, 0)));
    if (slot === 'hand') hands[1].add(wear(slot, item, box(0.14, 0.14, 0.22, c, 0, -0.12, 0.12)));
    if (slot === 'wrist') hands[0].add(wear(slot, item, box(0.21, 0.28, 0.04, c, 0, 0.1, 0)));
  }

  const figure = ctx.group(...shoes, ...legs, torso, ...arms, ...hands, head, ...extras);
  figure.name = 'agent-figure:fixture';
  figure.userData.mainAgentModel = model;
  figure.userData.tier = tier;
  return figure;   // like the real builder: no face anchors, no contact shadow (the agent mesh adds them)
}
