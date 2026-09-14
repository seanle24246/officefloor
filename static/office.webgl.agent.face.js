/* office.webgl.agent.face.js — state-derived face plans for the default agent figure.
 * Pure data: the mesh builder turns these parts into palette boxes. Expression is a
 * function of collector-published agent state ONLY (truth law: the face never asserts
 * what the collector doesn't know). Sizes are pinned to the readability floor:
 * vertical px on screen = height-units * 32 (PPU) * zoom, so MIN_MOUTH_H 0.05 is a
 * ~1.4px dark line at the 0.9 default zoom and ~2.6px zoomed in at 1.6.
 * Part sizes are [w, h, d] — wide, tall, deep (the mesh builder maps to tileBox(w, d, h)).
 * Positions sit on the +z face of the original peeing-agent box head (base y 1.39). */

export const FACE_MATERIAL = 'charcoal-dark';
export const MIN_EYE = 0.045;
export const MIN_MOUTH_H = 0.05;
export const MIN_MOUTH_W = 0.16;

export const FACE_EXPRESSIONS = Object.freeze({
  working: 'smile',
  delivering: 'smile',
  reading: 'smile',
  asking: 'smile',
  bench: 'smile',
  blocked: 'flat',
  absent: 'flat',
  unknown: 'flat',
  dead: 'frown',
  frozen: 'frown',
});

export function expressionFor(state) {
  return FACE_EXPRESSIONS[String(state ?? '').trim().toLowerCase()] || 'flat';
}

function part(id, size, position) {
  return Object.freeze({ id, size: Object.freeze(size), position: Object.freeze(position), material: FACE_MATERIAL });
}

const EYES = Object.freeze([
  part('left-eye', [0.045, 0.05, 0.035], [-0.07, 1.535, 0.13]),
  part('right-eye', [0.045, 0.05, 0.035], [0.07, 1.535, 0.13]),
]);

const MOUTHS = Object.freeze({
  smile: Object.freeze([
    part('mouth', [0.08, 0.05, 0.035], [0, 1.425, 0.13]),
    part('mouth-left', [0.04, 0.05, 0.035], [-0.06, 1.455, 0.13]),
    part('mouth-right', [0.04, 0.05, 0.035], [0.06, 1.455, 0.13]),
  ]),
  frown: Object.freeze([
    part('mouth', [0.08, 0.05, 0.035], [0, 1.455, 0.13]),
    part('mouth-left', [0.04, 0.05, 0.035], [-0.06, 1.425, 0.13]),
    part('mouth-right', [0.04, 0.05, 0.035], [0.06, 1.425, 0.13]),
  ]),
  flat: Object.freeze([
    part('mouth', [0.16, 0.05, 0.035], [0, 1.44, 0.13]),
  ]),
});

export function facePlanFor(state) {
  const expression = expressionFor(state);
  return Object.freeze({
    expression,
    parts: Object.freeze([...EYES, ...MOUTHS[expression]]),
  });
}


// Oscar and June share a wider box head. Keep legacy costume faces untouched.
export function mainFacePlanFor(state) {
  const expression = expressionFor(state);
  const eyes = [
    part('left-eye', [0.067, 0.067, 0.012], [-0.13, 1.4235, 0.237]),
    part('right-eye', [0.067, 0.067, 0.012], [0.13, 1.4235, 0.237]),
  ];
  const mouth = expression === 'flat'
    ? [part('mouth', [0.30, 0.05, 0.012], [0, 1.30, 0.237])]
    : [0, -1, 1, -2, 2].map((step, index) => {
      const level = [0, 0.024, 0.057][Math.abs(step)];
      const y = expression === 'smile' ? 1.274 + level : 1.331 - level;
      return part(['mouth', 'mouth-left', 'mouth-right', 'mouth-left-corner',
        'mouth-right-corner'][index], [0.062, 0.05, 0.012], [step * 0.06, y, 0.237]);
    });
  return Object.freeze({ expression, parts: Object.freeze([...eyes, ...mouth]) });
}
