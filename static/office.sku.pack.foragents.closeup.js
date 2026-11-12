/* office.sku.pack.foragents.closeup.js — close-up ("++") detail for the paid "For the agents" store items
 * (PKT:of-wardrobe-closeup-01). Matches office.sku.pack.* so the public wheel excludes it with the other commercial
 * packs (MANIFEST.in, pyproject exclude-package-data, qa/tools/wheel_content_probe.py), like their floor geometry in
 * office.sku.pack.foragents.wear.js. Fetched on demand by office.webgl.wardrobe.closeup.js only when agent_wardrobe
 * is on and a close-up shows a paid item; this file only draws (owning an item is the server's business).
 *
 * paidCloseupRules(kit) returns { <item id>: { <anchor kind>: (F, sign) => pieces } } in the close-up's own frame
 * vocabulary (F.front / F.back / F.side / F.band / F.line / F.piece / F.buttons / F.ribs, F.outer for a hat's brim).
 */
export function paidCloseupRules(kit) {
  const { DARK, DEEP, LIGHT, BASE, INK, CREAM, SILVER, BRASS, CLUMP, glasses, tie } = kit;
  const badge = (stripe = '#2f62b8') => (F) => [F.front(0, 0.85, F.b.w, F.b.h * 0.25, { color: stripe, tint: 0, t: 0.006 }),
    ...[0.5, 0.3].map((v) => F.front(-0.1, v, F.b.w * 0.6, 0.008, { color: '#5b6470', tint: 0, t: 0.008 })),
    F.front(0, 1.04, 0.03, 0.025, { color: SILVER, tint: 0, t: 0.014 })];
  return Object.freeze({
    'classic-cap': { head: (F) => [F.piece([0.04, 0.025, 0.04], [F.b.cx, F.b.y1 + 0.012, F.z(-0.1)], { color: DARK }),
    F.piece([F.b.w * 0.92, 0.012, 0.02], [F.b.cx, F.y(0.12), F.b.z1 - 0.008], { color: LIGHT })] },
    'wide-brim-hat': { head: (F) => [F.band(0.3, 0.05, { color: DEEP, out: 0.004 }), F.outer.band(0.02, 0.01, { color: LIGHT, out: 0.004 })] },
    'knit-beanie': { head: (F) => [F.band(0, 0.08, { color: DARK }), ...F.ribs(0, 0.08, 9),
    F.piece([0.08, 0.06, 0.08], [F.b.cx, F.b.y1 + 0.02, F.b.cz], { color: LIGHT, geo: CLUMP })] },
    'sun-visor': { head: (F) => [F.outer.band(0, 0.012, { color: LIGHT, out: 0.004 })] },
    'round-glasses': { head: glasses() },
    'square-glasses': { head: glasses() },
    'safety-glasses': { head: glasses({ shields: true }) },
    'aviator-shades': { head: glasses({ bridge: BRASS, glare: '#bcd4e6' }) },
    'name-badge': { any: badge() },
    'visitor-badge': { any: badge('#c7432f') },
    lanyard: { any: (F) => [F.front(0, 0.12, 0.05, 0.02, { color: SILVER, tint: 0, t: 0.016 }),
    F.front(0, 0.05, F.b.w * 0.5, 0.012, { color: INK, tint: 0, t: 0.014 })] },
    headset: { head: (F) => [F.front(0.85, 0.15, 0.03, 0.03, { color: INK, tint: 0, t: 0.02 }),
    F.piece([0.12, 0.016, 0.016], [F.x(0.7), F.y(0.18), F.b.z1 - 0.01], { color: DARK, rot: [0, 0, -0.3] })] },
    'ear-defenders': { head: (F) => [...[-1, 1].map((sign) => F.side(sign, 0, 0.35, F.b.d * 0.6, F.b.h * 0.3, { color: DARK, t: 0.012 })),
    F.piece([F.b.w * 0.5, 0.02, 0.04], [F.b.cx, F.b.y1 + 0.006, F.b.cz], { color: LIGHT })] },
    'coffee-mug': { any: (F) => [F.band(0.85, 0.03, { color: LIGHT, out: 0.004 }),
    F.side(1, 0, 0.5, 0.03, F.b.h * 0.5, { color: BASE, t: 0.04 })] },
    'travel-tumbler': { any: (F) => [F.band(0.82, 0.06, { color: '#2a2522', tint: 0, out: 0.006 }), F.band(0.3, 0.02, { color: DARK, out: 0.003 })] },
    'water-bottle': { any: (F) => [F.band(0.9, 0.08, { color: SILVER, tint: 0, out: 0.003 }), F.band(0.4, 0.2, { color: LIGHT, out: 0.003 })] },
    briefcase: { any: (F) => [F.piece([F.b.w * 0.4, 0.04, 0.03], [F.b.cx, F.b.y1 + 0.02, F.b.cz], { color: DEEP }),
    ...[-0.5, 0.5].map((u) => F.front(u, 0.85, 0.04, 0.04, { color: BRASS, tint: 0, t: 0.012 })),
    F.band(0.8, 0.012, { color: DARK, out: 0.004 })] },
    'messenger-bag': { any: (F) => [F.back(0, 0.6, F.b.w * 0.9, F.b.h * 0.3, { color: DARK, t: 0.012 }),
    F.back(0, 0.48, 0.05, 0.05, { color: BRASS, tint: 0, t: 0.016, lift: 0.006 })] },
    backpack: { any: (F) => [F.back(0, 0.35, F.b.w * 0.7, F.b.h * 0.3, { color: DARK, t: 0.03 }),
    F.back(0, 0.52, F.b.w * 0.6, 0.012, { color: SILVER, tint: 0, t: 0.01, lift: 0.03 }),
    F.back(0.3, 0.52, 0.03, 0.04, { color: SILVER, tint: 0, t: 0.012, lift: 0.032 })] },
    clipboard: { any: (F) => [F.front(0, 0.95, F.b.w * 0.4, 0.05, { color: SILVER, tint: 0, t: 0.02 }),
    F.front(0, 0.5, F.b.w * 0.8, F.b.h * 0.7, { color: '#f4f1ea', tint: 0, t: 0.006 }),
    ...[0.65, 0.5, 0.35].map((v) => F.front(-0.1, v, F.b.w * 0.5, 0.01, { color: '#9aa3ad', tint: 0, t: 0.008 }))] },
    notebook: { any: (F) => [F.side(-1, 0, 0.5, F.b.d, F.b.h, { color: DEEP, t: 0.01 }),
    F.front(0.6, 0.5, 0.012, F.b.h, { color: INK, tint: 0, t: 0.008 })] },
    tablet: { any: (F) => [F.front(0, 0.5, F.b.w * 0.8, F.b.h * 0.8, { color: '#5fb6e8', tint: 0, glow: 0.8, t: 0.006 })] },
    umbrella: { any: (F) => [F.band(0.95, 0.04, { color: DARK, out: 0.004 }), F.band(0.0, 0.03, { color: '#2a2522', tint: 0, out: 0.004 })] },
    'rain-hood': { head: (F) => [F.band(0.05, 0.03, { color: DARK }), ...[-0.3, 0.3].map((u) => F.front(u, -0.05, 0.014, 0.12, { color: CREAM, tint: 0, t: 0.012 }))] },
    scarf: { any: (F) => [...[0.2, 0.5].map((v) => F.band(v, 0.03, { color: LIGHT, out: 0.004 })),
    ...Array.from({ length: 5 }, (_, index) => F.front(-0.6 + index * 0.3, -0.02, 0.018, 0.05, { color: DARK, t: 0.01 }))] },
    'bow-tie': { any: (F) => [F.front(0, 0.5, 0.05, 0.05, { color: DARK, t: 0.016 }),
    ...[-1, 1].map((sign) => F.front(sign * 0.55, 0.5, 0.012, F.b.h * 0.6, { color: DARK, t: 0.008 }))] },
    necktie: { any: tie(0.07) },
    wristwatch: { any: (F) => [F.front(0, 0.5, 0.05, 0.05, { color: '#cfe8ff', tint: 0, glow: 0.6, t: 0.014 }),
    F.front(0, 0.5, 0.008, 0.03, { color: INK, tint: 0, t: 0.018 })] },
    'tool-belt': { any: (F) => [F.front(0, 0.5, 0.07, 0.06, { color: BRASS, tint: 0, t: 0.016 }),
    ...[-0.6, 0.6].map((u) => F.front(u, -0.2, 0.012, 0.18, { color: SILVER, tint: 0, t: 0.016, lift: 0.01 }))] },
  });
}
