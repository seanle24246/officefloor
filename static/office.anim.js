(function installAnim(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeAnim = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  function isoDir4(dx, dy) {
    if (dx === 0 && dy === 0) return null;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx > 0 ? 'SE' : 'NW';
    } else {
      return dy > 0 ? 'SW' : 'NE';
    }
  }
  function facingBody(dir) {
    if (dir === 'SE') return { flipX: false, back: false };
    if (dir === 'SW') return { flipX: true, back: false };
    if (dir === 'NE') return { flipX: false, back: true };
    if (dir === 'NW') return { flipX: true, back: true };
    return { flipX: false, back: false };
  }
  function walkGait(phase, dir) {
    var p = phase - Math.floor(phase);
    var a = 2 * Math.PI * p;
    var bob = Math.abs(Math.sin(a)) * 3;
    var legSwing = Math.sin(a) * 6;
    var armSwing = -Math.sin(a) * 4;
    var footLift = Math.max(0, Math.sin(a)) * 2;
    return { bob: bob, legSwing: legSwing, armSwing: armSwing, footLift: footLift };
  }
  function smokeAnim(t, seed) {
    var P = 6;
    var offset = seed || 0;
    var raw = (t + offset) % P;
    if (raw < 0) raw += P;
    var u = raw / P;
    var handRaise, emberGlow, puff, exhale;
    if (u < 0.3) {
      handRaise = u / 0.3;
    } else if (u < 0.7) {
      handRaise = 1;
    } else {
      handRaise = Math.max(0, 1 - (u - 0.7) / 0.3);
    }
    if (u >= 0.3 && u < 0.5) {
      emberGlow = Math.sin((u - 0.3) / 0.2 * Math.PI);
    } else {
      emberGlow = 0.15;
    }
    if (u >= 0.5 && u < 0.6) {
      puff = Math.sin((u - 0.5) / 0.1 * Math.PI);
    } else {
      puff = 0;
    }
    if (u >= 0.6 && u < 0.9) {
      exhale = (u - 0.6) / 0.3;
    } else {
      exhale = 0;
    }
    if (handRaise < 0) handRaise = 0;
    if (handRaise > 1) handRaise = 1;
    if (emberGlow < 0) emberGlow = 0;
    if (emberGlow > 1) emberGlow = 1;
    if (puff < 0) puff = 0;
    if (puff > 1) puff = 1;
    if (exhale < 0) exhale = 0;
    if (exhale > 1) exhale = 1;
    return { handRaise: handRaise, emberGlow: emberGlow, puff: puff, exhale: exhale };
  }
  function isoDir8(dx, dy) {
      if (dx === 0 && dy === 0) return null;
      const ang = Math.atan2(dx + dy, dx - dy);
      const index = Math.round(ang / (Math.PI / 4));
      const normalized = ((index % 8) + 8) % 8;
      return ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'][normalized];
  }

  function runGait(phase, dir) {
      const p = phase - Math.floor(phase);
      const a = 2 * Math.PI * p;
      return {
          bob: Math.abs(Math.sin(a)) * 5,
          legSwing: Math.sin(a) * 11,
          armSwing: -Math.sin(a) * 8,
          footLift: Math.max(0, Math.sin(a)) * 4
      };
  }

  function beerAnim(t, seed) {
      const P = 5;
      const u = (((t + (seed || 0)) % P) + P) % P / P;
      const handRaise = u < 0.3 ? (u / 0.3) : (u < 0.6 ? 1 : Math.max(0, 1 - (u - 0.6) / 0.4));
      const sip = (u >= 0.3 && u < 0.6) ? Math.sin((u - 0.3) / 0.3 * Math.PI) : 0;
      const lower = u >= 0.6 ? ((u - 0.6) / 0.4) : 0;
      return {
          handRaise: Math.min(1, Math.max(0, handRaise)),
          sip: Math.min(1, Math.max(0, sip)),
          lower: Math.min(1, Math.max(0, lower))
      };
  }

  function eatAnim(t, seed) {
      const P = 4;
      const u = (((t + (seed || 0)) % P) + P) % P / P;
      const handRaise = u < 0.25 ? (u / 0.25) : (u < 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) / 0.45));
      const chew = (u >= 0.25 && u < 0.55) ? (0.5 + 0.5 * Math.sin((u - 0.25) / 0.30 * Math.PI * 6)) : 0;
      const lower = u >= 0.55 ? ((u - 0.55) / 0.45) : 0;
      return {
          handRaise: Math.min(1, Math.max(0, handRaise)),
          chew: Math.min(1, Math.max(0, chew)),
          lower: Math.min(1, Math.max(0, lower))
      };
  }

  function peeAnim(t, seed) {
      var P = 7;
      var raw = (t + (seed || 0)) % P;
      if (raw < 0) raw += P;
      var u = raw / P;
      var settle = u < 0.12 ? u / 0.12 : u < 0.9 ? 1 : Math.max(0, 1 - (u - 0.9) / 0.1);
      var stream = u < 0.14 ? 0 : u < 0.2 ? (u - 0.14) / 0.06 : u < 0.78 ? 1
          : u < 0.88 ? Math.max(0, 1 - (u - 0.78) / 0.1) : 0;
      var puddle = u < 0.16 ? 0 : Math.min(1, (u - 0.16) / 0.62);
      var shake = 0;
      if (u >= 0.78 && u < 0.92) {
          var w = (u - 0.78) / 0.14;
          shake = Math.sin(w * Math.PI) * Math.sin(w * Math.PI * 6);
      }
      var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
      return {
          settle: clamp01(settle),
          stream: clamp01(stream),
          puddle: clamp01(puddle),
          shake: Math.max(-1, Math.min(1, shake))
      };
  }

  function gaitSpeed(name) {
      if (name === 'slow') return { cadence: 0.6, translate: 0.6 };
      if (name === 'walk') return { cadence: 1.0, translate: 1.0 };
      if (name === 'run') return { cadence: 1.8, translate: 2.2 };
      return { cadence: 1.0, translate: 1.0 };
  }

  return { isoDir4: isoDir4, walkGait: walkGait, smokeAnim: smokeAnim, facingBody: facingBody, isoDir8: isoDir8, runGait: runGait, beerAnim: beerAnim, eatAnim: eatAnim, peeAnim: peeAnim, gaitSpeed: gaitSpeed };
}));
