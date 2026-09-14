/* office.fx.webgl.js — opt-in, additive raw-WebGL dust atmosphere. */
(function installFx(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeFx = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const OVERLAY_ID = 'fxstage';
  const PARTICLES = 1536;
  let active = null;

  function shouldEnable() {
    const search = root.location?.search || '';
    try { return new URLSearchParams(search).get('fx') === 'webgl'; } catch { return /(?:^|[?&])fx=webgl(?:&|$)/.test(search); }
  }

  function shader(gl, type, source) {
    const compiled = gl.createShader(type);
    gl.shaderSource(compiled, source);
    gl.compileShader(compiled);
    if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) throw new Error('FX shader compilation failed');
    return compiled;
  }

  function program(gl) {
    const vertex = shader(gl, gl.VERTEX_SHADER, `
      attribute vec2 aDust; uniform float uTime;
      void main() {
        vec2 drift = vec2(sin(uTime * .00007 + aDust.y * 19.) * .025,
                          cos(uTime * .00005 + aDust.x * 23.) * .018);
        gl_Position = vec4(aDust + drift, 0., 1.);
        gl_PointSize = 1.5 + fract(aDust.x * 83. + aDust.y * 47.) * 2.5;
      }`);
    const fragment = shader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      void main() {
        float d = length(gl_PointCoord - .5);
        float alpha = smoothstep(.5, .0, d) * .115;
        gl_FragColor = vec4(1., .76, .43, alpha);
      }`);
    const linked = gl.createProgram();
    gl.attachShader(linked, vertex);
    gl.attachShader(linked, fragment);
    gl.linkProgram(linked);
    if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) throw new Error('FX program link failed');
    return linked;
  }

  function dust() {
    const points = new Float32Array(PARTICLES * 2);
    for (let index = 0; index < PARTICLES; index += 1) {
      const seed = Math.sin(index * 91.17) * 43758.5453;
      const other = Math.sin(index * 37.71) * 24634.6345;
      points[index * 2] = (seed - Math.floor(seed)) * 2 - 1;
      points[index * 2 + 1] = (other - Math.floor(other)) * 2 - 1;
    }
    return points;
  }

  function teardown() {
    if (!active) return null;
    const { canvas, gl, frame, onVisibility } = active;
    if (frame !== null) root.cancelAnimationFrame?.(frame);
    root.document?.removeEventListener?.('visibilitychange', onVisibility);
    gl.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    canvas.remove?.();
    active = null;
    return null;
  }

  function mount(options = {}) {
    const doc = root.document;
    if (!doc?.body || root.__OFFICE_SNAPSHOT__ || (!shouldEnable() && options.force !== true)) return null;
    if (active) return active.canvas;
    const existing = doc.getElementById?.(OVERLAY_ID);
    if (existing) return existing;

    const canvas = doc.createElement('canvas');
    canvas.id = OVERLAY_ID;
    // These duplicate the one-line stylesheet handoff so the opt-in remains
    // harmlessly functional while the shared CSS file is serialized elsewhere.
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1',
      background: 'radial-gradient(ellipse at center, rgba(255,178,72,.045), rgba(8,12,28,.16))',
    });
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false })
      || canvas.getContext('experimental-webgl', { alpha: true, antialias: false });
    if (!gl) return null;
    try {
      const linked = program(gl);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, dust(), gl.STATIC_DRAW);
      gl.useProgram(linked);
      const position = gl.getAttribLocation(linked, 'aDust');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const time = gl.getUniformLocation(linked, 'uTime');
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      const resize = () => {
        const ratio = Math.min(2, Math.max(1, Number(root.devicePixelRatio) || 1));
        const width = Math.max(1, Math.floor((root.innerWidth || 1) * ratio));
        const height = Math.max(1, Math.floor((root.innerHeight || 1) * ratio));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; gl.viewport(0, 0, width, height); }
      };
      const handle = { canvas, gl, frame: null, onVisibility: null };
      const draw = (now) => {
        if (!active || doc.hidden) return;
        resize();
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(time, now || 0);
        gl.drawArrays(gl.POINTS, 0, PARTICLES);
        handle.frame = root.requestAnimationFrame?.(draw) ?? null;
      };
      handle.onVisibility = () => {
        if (doc.hidden && handle.frame !== null) { root.cancelAnimationFrame?.(handle.frame); handle.frame = null; }
        else if (!doc.hidden && handle.frame === null) handle.frame = root.requestAnimationFrame?.(draw) ?? null;
      };
      active = handle;
      doc.body.append(canvas);
      doc.addEventListener?.('visibilitychange', handle.onVisibility);
      resize();
      handle.frame = root.requestAnimationFrame?.(draw) ?? null;
      return canvas;
    } catch {
      canvas.remove?.();
      return null;
    }
  }

  return Object.freeze({ mount, teardown, shouldEnable });
}));
