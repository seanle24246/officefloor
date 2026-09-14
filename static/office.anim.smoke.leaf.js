/* office.anim.smoke.leaf.js — pure C-arc gesture planner for the registered cigarette prop. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OfficeAnimSmokeLeaf = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEG = Math.PI / 180;
  var SMOKE_VARIANTS = Object.freeze(['c-arc']);
  var KEYFRAME_TIMES = Object.freeze([0, 0.1, 0.3, 0.6, 0.7, 1]);

  function frame(shoulderPitch, shoulderYaw, elbowFlex, wristPitch, handAtMouth) {
    return Object.freeze({
      shoulderPitch: shoulderPitch * DEG,
      shoulderYaw: shoulderYaw * DEG,
      elbowFlex: elbowFlex * DEG,
      wristPitch: wristPitch * DEG,
      handAtMouth: handAtMouth
    });
  }

  var GESTURES = Object.freeze({
    'c-arc': Object.freeze([
      frame(-90, 0, 0, 0, 0),
      frame(-90, 0, 0, 0, 0),
      frame(-60, -10, 125, -20, 1),
      frame(-60, -10, 125, -20, 1),
      frame(-60, -10, 125, -20, 1),
      frame(-90, 0, 0, 0, 0)
    ])
  });

  var CIG_POSE = Object.freeze({
    alongForearm: 0.11,
    emberOffset: 0.22,
    roll: 0
  });

  // Geometry, mounting, glow, and smoke instances belong to the registered
  // office.webgl.cigprop.js lifecycle. The leaf remains deliberately pure so
  // beer and cigarettes can share this C-arc without duplicate rig motion.

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  function wrapUnit(value) {
    if (!Number.isFinite(value)) return 0;
    var wrapped = value % 1;
    return wrapped < 0 ? wrapped + 1 : wrapped;
  }

  function easeInOut(value) {
    var t = clamp01(value);
    return t * t * (3 - 2 * t);
  }

  function interpolate(start, end, amount) {
    return start + (end - start) * amount;
  }

  function requireVariant(variant) {
    if (!Object.prototype.hasOwnProperty.call(GESTURES, variant)) {
      throw new TypeError('unknown smoke variant: ' + String(variant));
    }
    return variant;
  }

  function smokeVariantFor(seed) {
    return 'c-arc';
  }

  function smokeGesture(variant, u) {
    requireVariant(variant);
    var frames = GESTURES[variant];
    var phase = wrapUnit(u);
    var segment = 0;
    while (segment < KEYFRAME_TIMES.length - 2
        && phase > KEYFRAME_TIMES[segment + 1]) {
      segment += 1;
    }
    var start = KEYFRAME_TIMES[segment];
    var end = KEYFRAME_TIMES[segment + 1];
    var eased = easeInOut((phase - start) / (end - start));
    var left = frames[segment];
    var right = frames[segment + 1];
    return Object.freeze({
      shoulderPitch: interpolate(left.shoulderPitch, right.shoulderPitch, eased),
      shoulderYaw: interpolate(left.shoulderYaw, right.shoulderYaw, eased),
      elbowFlex: interpolate(left.elbowFlex, right.elbowFlex, eased),
      wristPitch: interpolate(left.wristPitch, right.wristPitch, eased),
      handAtMouth: clamp01(interpolate(left.handAtMouth, right.handAtMouth, eased))
    });
  }

  function cigPose(pose) {
    return CIG_POSE;
  }

  function wispFrames(smokeAnim, variant) {
    requireVariant(variant);
    var puff = clamp01(smokeAnim && smokeAnim.puff);
    var exhale = clamp01(smokeAnim && smokeAnim.exhale);
    var active = puff > 0 || exhale > 0;
    return Object.freeze({
      active: active,
      rise: exhale,
      fade: 1 - exhale,
      cubes: 4
    });
  }

  return Object.freeze({
    SMOKE_VARIANTS: SMOKE_VARIANTS,
    smokeVariantFor: smokeVariantFor,
    smokeGesture: smokeGesture,
    cigPose: cigPose,
    wispFrames: wispFrames
  });
}));
