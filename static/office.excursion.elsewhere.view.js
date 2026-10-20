/* Example scene "elsewhere": a deliberately plain room. Its only job is to prove scenes plug in —
   one script tag and one registerScene call; no CSS file, no runtime change, never scheduled. */
(function (root) {
  'use strict';
  function create({ THREE: T, renderer }) {
    const doc = root.document;
    let overlay = null, scene = null, camera = null, actions = {};
    function panel(id, css) {
      overlay?.remove();
      overlay = doc.createElement('section');
      overlay.id = id;
      overlay.style.cssText = `position:fixed;z-index:110;color:#f5f1e8;font-family:inherit;${css}`;
      doc.body.appendChild(overlay);
      return overlay;
    }
    function text(tag, value, parent, css = '') {
      const el = doc.createElement(tag);
      el.textContent = value; el.style.cssText = css;
      parent.appendChild(el);
      return el;
    }
    function box(w, h, d, x, y, z, color) {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshStandardMaterial({ color, roughness: .9 }));
      m.position.set(x, y, z); scene.add(m); return m;
    }
    function loading() {
      const p = panel('excursion-elsewhere-loading', 'inset:70px 0 0;display:grid;place-items:center;background:#1b1f27;');
      text('p', 'Stepping out…', p, 'font-size:18px;color:#c9d2dc;');
    }
    function build(agents) {
      scene = new T.Scene(); scene.background = new T.Color('#1b1f27');
      camera = new T.PerspectiveCamera(36, 1, .1, 100); camera.position.set(16, 14, 21); camera.lookAt(0, 0.8, -0.5);
      scene.add(new T.HemisphereLight('#e6ecf4', '#3a3f48', 2.2));
      const sun = new T.DirectionalLight('#ffffff', 2); sun.position.set(5, 10, 6); scene.add(sun);
      box(14, .3, 10, 0, -.15, 0, '#8d8577');      // floor
      box(14, 5, .3, 0, 2.5, -5, '#cfc8bb');       // back wall
      box(.3, 5, 10, -7, 2.5, 0, '#bdb6a8');       // side wall
      box(1.4, 2.6, .1, 3, 1.3, -4.8, '#5d6b7a');  // door
      const n = agents.length, cols = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(n * 2))));
      agents.forEach((_, i) => {
        const x = ((i % cols) - (cols - 1) / 2) * 1.3, z = Math.floor(i / cols) * 1.3 - 1;
        box(.5, .9, .3, x, .75, z, '#7aa6c2');
        box(.42, .42, .38, x, 1.45, z, '#c9a98a');
      });
      const p = panel('excursion-elsewhere-venue', 'inset:70px 0 0 58px;padding:20px 24px;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none;');
      const head = doc.createElement('div'); p.appendChild(head);
      text('div', '🎭 FICTION · ELSEWHERE', head, 'font-size:11px;letter-spacing:.18em;color:#8ddfd8;');
      text('h2', 'Elsewhere', head, 'font-size:32px;font-weight:500;margin:8px 0;');
      text('p', `${n} away from the floor`, head, 'margin:0;font-size:12px;color:#aebccc;');
      const back = text('button', 'Head back', p, 'pointer-events:auto;font:inherit;cursor:pointer;color:inherit;border:1px solid #536478;border-radius:7px;padding:11px 20px;background:#242d40;');
      back.type = 'button'; back.onclick = () => actions.back?.();
    }
    // A still room: nothing animates, so reduced motion needs no special case.
    function cutaway({ agents }) {
      if (!scene) build(agents);
      const canvas = renderer.domElement;
      camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight); camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    }
    function dispose() {
      overlay?.remove(); overlay = null;
      scene?.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      scene = null; camera = null;
    }
    return { loading, cutaway, dispose, setActions: (value) => { actions = value; } };
  }
  root.OfficeExcursion?.registerScene({
    id: 'elsewhere', title: 'Elsewhere', label: 'Elsewhere', capacity: 12, durationMs: 30000, buildView: create,
  });
})(globalThis);
