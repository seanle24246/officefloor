(() => {
  let shown = false;
  globalThis.OfficeWebGLRequired = {
    get active() { return shown; },
    show(reason) {
      if (shown) return;
      shown = true;
      const host = document.body || document.documentElement;
      if (!host) return;
      const welcome = document.getElementById('welcome');
      if (welcome) welcome.style.display = 'none';
      const panel = document.createElement('div');
      panel.id = 'office-webgl-required';
      panel.setAttribute('role', 'alert');
      panel.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:2147483647',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center',
        'gap:12px', 'padding:32px', 'text-align:center',
        'background:#11151c', 'color:#e8edf5',
        'font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif',
      ].join(';');
      const title = document.createElement('h1');
      title.textContent = 'This office needs WebGL';
      title.style.cssText = 'margin:0;font-size:24px;font-weight:600';
      const body = document.createElement('p');
      body.textContent = 'The floor renders in 3D and has no 2D fallback. '
        + 'Enable hardware acceleration or open this file in a browser that supports WebGL.';
      body.style.cssText = 'margin:0;max-width:44ch;opacity:.85';
      const detail = document.createElement('p');
      detail.textContent = String(reason || 'WebGL unavailable');
      detail.style.cssText = 'margin:0;font-size:13px;opacity:.55';
      panel.append(title, body, detail);
      host.appendChild(panel);
    },
  };
})();
