/* office.sku.pack.foragents.wear.js — wearable geometry for the paid "For the agents" store items
 * (PKT:of-wardrobe-render-01). Matches office.sku.pack.* so the public wheel excludes it with the other commercial
 * packs (MANIFEST.in, pyproject exclude-package-data, qa/tools/wheel_content_probe.py). Loaded on demand by
 * office.webgl.wardrobe.js only when agent_wardrobe is on and a look wears a paid item; owning one is the server's
 * business (POST /api/looks/action answers not_owned), this file only draws.
 *
 * Same conventions as office.webgl.wardrobe.js: B(w, h, d, x, yBottom, z, tone), tones m/d/D/l/L or '@palette'.
 * Frames: head (0.57 x 0.53 x 0.46, eyes y 0.29-0.36 at z 0.24), torso (0.84 x 0.70 x 0.44, front z 0.22),
 * right-hand (0.19 x 0.115 x 0.26; held things sit in front, +z), left-arm (wrist at y 0).
 */
import { B, C, Z, hat, simple } from './office.webgl.wardrobe.js';

const rim = (plan, x, w, h, y, z, tone = 'm', thick = 0.02) => plan.add('head',
  B(w, thick, 0.02, x, y + h - thick, z, tone), B(w, thick, 0.02, x, y, z, tone),
  B(thick, h, 0.02, x - w / 2 + thick / 2, y, z, tone), B(thick, h, 0.02, x + w / 2 - thick / 2, y, z, tone));
const temples = (plan, y = 0.33, tone = 'm') => plan.add('head', B(0.02, 0.02, 0.26, -0.29, y, 0.12, tone),
  B(0.02, 0.02, 0.26, 0.29, y, 0.12, tone));

export const PAID_RECIPES = Object.freeze({
  // head
  'classic-cap': hat((plan) => plan.add('head', B(0.62, 0.17, 0.52, 0, 0.47, -0.01), B(0.46, 0.035, 0.22, 0, 0.475, 0.33, 'm', { rx: 0.12 }),
    B(0.16, 0.08, 0.02, 0, 0.53, 0.25, 'L'), B(0.08, 0.03, 0.08, 0, 0.64, -0.01, 'd'), B(0.63, 0.03, 0.53, 0, 0.47, -0.01, 'd'))),
  'wide-brim-hat': hat((plan) => plan.add('head', B(1.02, 0.03, 0.92, 0, 0.48, 0, 'm', { rx: 0.04 }), B(0.56, 0.16, 0.48, 0, 0.50, 0, 'm', { taper: [0.9, 0.9] }),
    B(0.575, 0.05, 0.495, 0, 0.505, 0, 'D'))),
  'knit-beanie': hat((plan) => plan.add('head', B(0.62, 0.20, 0.52, 0, 0.47, -0.01, 'm', { taper: [0.85, 0.85] }), B(0.64, 0.07, 0.54, 0, 0.44, -0.01, 'd'),
    B(0.14, 0.12, 0.14, 0, 0.66, -0.01, 'l'), ...[-0.2, -0.1, 0, 0.1, 0.2].map((x) => B(0.02, 0.16, 0.012, x, 0.51, 0.255, 'd')))),
  'sun-visor': hat((plan) => plan.add('head', B(0.60, 0.07, 0.49, 0, 0.42, 0), B(0.50, 0.03, 0.24, 0, 0.44, 0.33, 'm', { rx: 0.1 }),
    B(0.12, 0.05, 0.02, 0, 0.43, 0.25, 'l')), false),
  'rain-hood': hat((plan) => plan.add('head', B(0.68, 0.10, 0.58, 0, 0.53, -0.02), B(0.07, 0.56, 0.56, -0.32, 0.0, -0.03),
    B(0.07, 0.56, 0.56, 0.32, 0.0, -0.03), B(0.68, 0.62, 0.07, 0, -0.02, -0.28), B(0.64, 0.05, 0.05, 0, 0.50, 0.27, 'd'),
    B(0.02, 0.10, 0.02, -0.12, -0.05, 0.25, '@paper'), B(0.02, 0.10, 0.02, 0.12, -0.05, 0.25, '@paper'))),

  // eyes
  'round-glasses': simple((plan) => {
    for (const x of [-0.13, 0.13]) {
      plan.add('head', C(0.14, 0.012, x, 0.355, 0.252, 'm'), C(0.14, 0.012, x, 0.268, 0.252, 'm'),
        B(0.02, 0.08, 0.02, x - 0.068, 0.275, 0.252), B(0.02, 0.08, 0.02, x + 0.068, 0.275, 0.252));
    }
    plan.add('head', B(0.08, 0.02, 0.02, 0, 0.33, 0.252));
    temples(plan);
  }),
  'square-glasses': simple((plan) => {
    rim(plan, -0.13, 0.16, 0.12, 0.265, 0.252, 'm', 0.03);
    rim(plan, 0.13, 0.16, 0.12, 0.265, 0.252, 'm', 0.03);
    plan.add('head', B(0.10, 0.03, 0.02, 0, 0.335, 0.252));
    temples(plan, 0.34);
  }),
  'safety-glasses': simple((plan) => {
    plan.add('head', B(0.50, 0.04, 0.03, 0, 0.36, 0.255), B(0.48, 0.016, 0.02, 0, 0.26, 0.255, 'l'),
      B(0.02, 0.12, 0.10, -0.27, 0.26, 0.20), B(0.02, 0.12, 0.10, 0.27, 0.26, 0.20), B(0.06, 0.06, 0.02, 0, 0.30, 0.257, 'd'));
    temples(plan, 0.35);
  }),
  'aviator-shades': simple((plan) => {
    for (const x of [-0.13, 0.13]) {
      plan.add('head', B(0.15, 0.09, 0.014, x, 0.275, 0.25, '@charcoal-dark', { taper: [1, 1], taperBottom: [0.75, 1] }),
        B(0.16, 0.015, 0.02, x, 0.36, 0.252));
    }
    plan.add('head', B(0.10, 0.015, 0.02, 0, 0.345, 0.252), B(0.06, 0.012, 0.02, 0, 0.365, 0.252));
    temples(plan, 0.35);
  }),

  // badges, neck
  'name-badge': simple((plan, info) => plan.add('torso', B(0.14, 0.09, 0.012, -0.22, 0.44, info.neckZ - 0.004, '@paper'),
    B(0.14, 0.025, 0.014, -0.22, 0.505, info.neckZ - 0.002, 'm'), B(0.09, 0.012, 0.014, -0.22, 0.46, info.neckZ - 0.002, '@charcoal'))),
  'visitor-badge': simple((plan, info) => plan.add('torso', B(0.12, 0.15, 0.012, -0.22, 0.38, info.neckZ - 0.004),
    B(0.10, 0.04, 0.014, -0.22, 0.45, info.neckZ - 0.002, '@paper'), B(0.03, 0.04, 0.02, -0.22, 0.52, info.neckZ, '@metal'))),
  lanyard: simple((plan, info) => plan.add('torso', B(0.03, 0.36, 0.014, -0.10, 0.34, info.neckZ - 0.004, 'm', { rz: 0.32 }),
    B(0.03, 0.36, 0.014, 0.10, 0.34, info.neckZ - 0.004, 'm', { rz: -0.32 }), B(0.60, 0.035, 0.50, 0, 0.68, 0),
    B(0.12, 0.15, 0.012, 0, 0.20, info.neckZ, '@paper'), B(0.12, 0.04, 0.014, 0, 0.31, info.neckZ + 0.002, 'd'))),
  scarf: simple((plan, info) => plan.add('torso', B(0.62, 0.11, 0.52, 0, 0.64, 0), B(0.11, 0.32, 0.04, -0.08, 0.31, info.neckZ),
    B(0.11, 0.26, 0.04, 0.06, 0.36, info.neckZ + 0.012), B(0.115, 0.03, 0.045, -0.08, 0.37, info.neckZ, 'd'),
    B(0.115, 0.03, 0.045, -0.08, 0.45, info.neckZ, 'd'), B(0.115, 0.03, 0.045, 0.06, 0.42, info.neckZ + 0.012, 'd'))),
  'bow-tie': simple((plan, info) => plan.add('torso', B(0.10, 0.08, 0.025, -0.06, 0.60, info.neckZ, 'm', { taper: [1, 1], taperBottom: [1, 1] }),
    B(0.10, 0.08, 0.025, 0.06, 0.60, info.neckZ), B(0.04, 0.05, 0.03, 0, 0.615, info.neckZ + 0.004, 'd'))),
  necktie: simple((plan, info) => plan.add('torso', B(0.08, 0.06, 0.035, 0, 0.60, info.neckZ, 'd'),
    B(0.09, 0.34, 0.018, 0, 0.24, info.neckZ - 0.006, 'm', { taper: [0.7, 1] }), B(0.06, 0.05, 0.018, 0, 0.20, info.neckZ - 0.006, 'm', { rz: 0.785 }),
    B(0.09, 0.02, 0.02, 0, 0.42, info.neckZ - 0.004, 'l'), B(0.09, 0.02, 0.02, 0, 0.32, info.neckZ - 0.004, 'l'))),

  // ears
  headset: simple((plan) => plan.add('head', B(0.60, 0.04, 0.07, 0, 0.60, 0), B(0.04, 0.30, 0.06, -0.30, 0.30, 0), B(0.04, 0.30, 0.06, 0.30, 0.30, 0),
    B(0.06, 0.13, 0.14, -0.31, 0.20, 0), B(0.06, 0.13, 0.14, 0.31, 0.20, 0, 'd'), B(0.025, 0.025, 0.22, -0.30, 0.20, 0.15, '@charcoal'),
    B(0.04, 0.04, 0.04, -0.27, 0.19, 0.26, '@charcoal-dark'))),
  'ear-defenders': simple((plan) => plan.add('head', B(0.66, 0.05, 0.09, 0, 0.62, 0), B(0.05, 0.32, 0.08, -0.33, 0.32, 0), B(0.05, 0.32, 0.08, 0.33, 0.32, 0),
    B(0.11, 0.20, 0.19, -0.34, 0.16, 0), B(0.11, 0.20, 0.19, 0.34, 0.16, 0), B(0.03, 0.16, 0.15, -0.395, 0.18, 0, 'd'), B(0.03, 0.16, 0.15, 0.395, 0.18, 0, 'd'))),

  // hand (right hand)
  'coffee-mug': simple((plan) => plan.add('right-hand', C(0.16, 0.15, 0, -0.02, 0.18), C(0.135, 0.012, 0, 0.125, 0.18, '@wood-dark'),
    B(0.035, 0.09, 0.07, 0.09, 0.01, 0.18))),
  'travel-tumbler': simple((plan) => plan.add('right-hand', C(0.10, 0.20, 0, -0.05, 0.17, 'm', { top: 0.12 }), C(0.125, 0.04, 0, 0.15, 0.17, 'd'),
    C(0.105, 0.04, 0, 0.0, 0.17, 'l'))),
  'water-bottle': simple((plan) => plan.add('right-hand', C(0.10, 0.22, 0, -0.06, 0.17), C(0.06, 0.05, 0, 0.16, 0.17, 'd'),
    C(0.105, 0.07, 0, 0.0, 0.17, 'L'))),
  briefcase: simple((plan) => plan.add('right-hand', B(0.11, 0.26, 0.40, 0, -0.34, 0), B(0.02, 0.05, 0.12, 0, -0.08, 0, 'D'),
    B(0.095, 0.02, 0.345, 0, -0.14, 0, 'd'), B(0.10, 0.03, 0.04, 0, -0.12, 0.08, '@brass'), B(0.10, 0.03, 0.04, 0, -0.12, -0.08, '@brass'))),
  clipboard: simple((plan) => plan.add('right-hand', B(0.02, 0.30, 0.22, 0.10, -0.18, 0.04), B(0.012, 0.25, 0.19, 0.112, -0.17, 0.04, '@paper'),
    B(0.03, 0.03, 0.08, 0.11, 0.10, 0.04, '@metal'))),
  notebook: simple((plan) => plan.add('right-hand', B(0.05, 0.22, 0.16, 0.10, -0.15, 0.04), B(0.052, 0.22, 0.02, 0.10, -0.15, -0.04, 'D'),
    B(0.04, 0.21, 0.012, 0.10, -0.145, 0.121, '@paper'), B(0.054, 0.025, 0.162, 0.10, -0.06, 0.04, 'l'))),
  tablet: simple((plan) => plan.add('right-hand', B(0.025, 0.24, 0.17, 0.10, -0.16, 0.05), B(0.012, 0.21, 0.145, 0.114, -0.145, 0.05, '@charcoal-dark'))),
  umbrella: simple((plan) => plan.add('right-hand', C(0.10, 0.34, 0, -0.44, 0.06, 'm', { top: 0.035 }), B(0.02, 0.20, 0.02, 0, -0.10, 0.06, '@charcoal'),
    B(0.03, 0.05, 0.03, 0, -0.52, 0.06, '@charcoal'), B(0.03, 0.03, 0.08, 0, 0.09, 0.03, 'D'), C(0.105, 0.03, 0, -0.30, 0.06, 'd'))),

  // back, wrist, waist
  'messenger-bag': simple((plan) => plan.add('torso', B(0.06, 0.95, 0.016, 0, -0.04, Z.neck, 'd', { rz: 0.72 }), B(0.06, 0.70, 0.016, 0.05, 0.0, -0.25, 'd', { rz: -0.72 }),
    B(0.12, 0.26, 0.34, -0.50, -0.12, 0), B(0.125, 0.12, 0.345, -0.50, 0.03, 0, 'd'), B(0.02, 0.04, 0.06, -0.565, 0.02, 0, '@brass'))),
  backpack: simple((plan) => plan.add('torso', B(0.56, 0.48, 0.18, 0, 0.12, -0.31), B(0.42, 0.20, 0.06, 0, 0.16, -0.42, 'd'),
    B(0.58, 0.08, 0.19, 0, 0.55, -0.31, 'd'), B(0.12, 0.05, 0.04, 0, 0.61, -0.30, 'D'),
    B(0.07, 0.44, 0.02, -0.22, 0.24, Z.neck - 0.004, 'd'), B(0.07, 0.44, 0.02, 0.22, 0.24, Z.neck - 0.004, 'd'),
    B(0.07, 0.04, 0.49, -0.22, 0.66, -0.03, 'd'), B(0.07, 0.04, 0.49, 0.22, 0.66, -0.03, 'd'))),
  wristwatch: simple((plan) => plan.add('left-arm', B(0.205, 0.045, 0.305, 0, 0.03, 0), B(0.02, 0.07, 0.08, -0.105, 0.017, 0.02, '@brass'),
    B(0.012, 0.05, 0.06, -0.116, 0.027, 0.02, '@paper'))),
  'tool-belt': simple((plan) => plan.add('torso', B(0.88, 0.08, 0.48, 0, 0.0, 0), B(0.08, 0.07, 0.02, 0, 0.005, 0.245, '@metal'),
    B(0.16, 0.18, 0.10, -0.30, -0.12, 0.22, 'd'), B(0.16, 0.16, 0.10, 0.30, -0.10, 0.22, 'd'),
    B(0.04, 0.16, 0.04, 0.34, -0.02, 0.27, '@metal'), B(0.10, 0.04, 0.04, 0.34, 0.14, 0.27, '@charcoal'),
    B(0.03, 0.12, 0.03, -0.27, 0.0, 0.26, '@amber'))),
});
