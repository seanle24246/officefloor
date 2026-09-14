#!/usr/bin/env python3
"""live_capture.py — record the office floor to mp4 while driving it with REAL
mouse input (CDP Input.dispatchMouseEvent), so demo videos show an actual cursor
gliding across the floor, hovering agents, clicking them open, and dragging in
edit mode — instead of a passive frame grab or JS-injected state.

Unlike ceo/ops/floor_video.py (ambient capture), this issues genuine mouse
move/press/release events through Chrome DevTools Protocol, injects a visible
cursor sprite that tracks the pointer, and captures frames continuously so the
motion and the UI's real hover/click/drag responses are recorded.

Usage:
    live_capture.py <url> <out.mp4> [--scene scene.json] [--fps 12] [--headful]

Scene file (JSON): a list of steps, each one of:
    {"move":  "<css selector>" | [x, y]}        glide the cursor there
    {"hover": "<css selector>" | [x, y], "hold": 1.0}   glide + linger (fires :hover)
    {"click": "<css selector>" | [x, y]}        glide, press, release
    {"lane":  "<lane-id>"}                       glide to that agent on the floor + click
    {"drag":  ["<from>", "<to>"]}                press at from, glide to to, release
    {"wait":  <seconds>}                         hold still, keep filming
    {"js":    "<expr>"}                          escape hatch (Runtime.evaluate)
A selector resolves to the element's on-screen centre. [x, y] are CSS pixels.
With no --scene, a built-in demo tour runs (hover+open an agent inspector via the
People panel, then open Edit Office).

Self-contained: only Python stdlib + a system `chromium`/`chrome` and `ffmpeg`.
"""
import sys, os, json, subprocess, base64, struct, time, socket, urllib.request, tempfile, shutil, hashlib

PORT = 9412  # distinct from floor_video.py's 9411 so both can run
WINDOW = (1600, 900)

import glob as _glob

def _find(names, extra_globs=()):
    # 1) env override, 2) PATH, 3) known non-PATH locations (playwright, ~/.local)
    for n in names:
        if os.environ.get(n.upper().replace("-", "_") + "_BIN"):
            return os.environ[n.upper().replace("-", "_") + "_BIN"]
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    for pat in extra_globs:
        hits = sorted(_glob.glob(os.path.expanduser(pat)))
        if hits:
            return hits[-1]
    return names[0]

CHROME = os.environ.get("CHROME_BIN") or _find(
    ["chromium", "chromium-browser", "google-chrome", "chrome"],
    ["~/.cache/ms-playwright/chromium-*/chrome-linux/chrome",
     "~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome"])
FFMPEG = os.environ.get("FFMPEG_BIN") or _find(
    ["ffmpeg"], ["~/.local/bin/ffmpeg", "/usr/local/bin/ffmpeg"])

# ---- minimal CDP-over-websocket client (no third-party deps) ----------------
def connect(ws_url):
    host_port = ws_url.split("/devtools/")[0].replace("ws://", "")
    host, port = host_port.split(":")
    s = socket.create_connection((host, int(port)), timeout=30)
    key = base64.b64encode(os.urandom(16)).decode()
    path = "/devtools/" + ws_url.split("/devtools/")[1]
    s.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
               "Upgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        buf += s.recv(1)
    return s

_mid = [0]
def _send(s, method, params=None):
    _mid[0] += 1
    payload = json.dumps({"id": _mid[0], "method": method, "params": params or {}}).encode()
    header = bytearray([0x81])
    n = len(payload)
    mask = os.urandom(4)
    if n < 126:
        header.append(0x80 | n)
    elif n < 65536:
        header.append(0x80 | 126); header += struct.pack(">H", n)
    else:
        header.append(0x80 | 127); header += struct.pack(">Q", n)
    header += mask
    s.sendall(bytes(header) + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
    return _mid[0]

def _recvn(s, n):
    b = b""
    while len(b) < n:
        chunk = s.recv(n - len(b))
        if not chunk:
            break
        b += chunk
    return b

def _read(s):
    b0, b1 = _recvn(s, 2)
    ln = b1 & 0x7F
    if ln == 126:
        ln = struct.unpack(">H", _recvn(s, 2))[0]
    elif ln == 127:
        ln = struct.unpack(">Q", _recvn(s, 8))[0]
    return _recvn(s, ln)

def call(s, method, params=None, want=True):
    mid = _send(s, method, params)
    if not want:
        return {}
    for _ in range(2000):
        try:
            msg = json.loads(_read(s))
        except Exception:
            continue
        if msg.get("id") == mid:
            return msg.get("result", {})
    return {}

def ev(s, expr):
    r = call(s, "Runtime.evaluate", {"expression": expr, "returnByValue": True})
    return r.get("result", {}).get("value")

# ---- visible cursor + coordinate helpers ------------------------------------
CURSOR_JS = r"""
(() => {
  let c = document.getElementById('__livecursor');
  if (!c) {
    c = document.createElement('div');
    c.id = '__livecursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;'
      + 'pointer-events:none;transition:none;will-change:transform;'
      + 'background:no-repeat center/contain;'
      + "background-image:url('data:image/svg+xml;utf8,"
      + "<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2222%22 height=%2222%22 viewBox=%220 0 22 22%22>"
      + "<path d=%22M2 2 L2 17 L6.5 13 L9.5 20 L12.5 18.5 L9.5 11.5 L15.5 11.5 Z%22 "
      + "fill=%22white%22 stroke=%22black%22 stroke-width=%221.5%22 stroke-linejoin=%22round%22/></svg>');";
    document.body.appendChild(c);
    const ring = document.createElement('div');
    ring.id = '__livecursor_ring';
    ring.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;'
      + 'z-index:2147483646;pointer-events:none;border:2px solid rgba(120,200,255,0.9);'
      + 'border-radius:50%;opacity:0;transform:scale(0.3);transition:opacity .18s,transform .18s;';
    document.body.appendChild(ring);
  }
  window.__setCursor = (x, y) => { c.style.transform = `translate(${x}px,${y}px)`; const r=document.getElementById('__livecursor_ring'); if(r){r.style.left=x+'px';r.style.top=y+'px';} };
  window.__pulseCursor = () => { const r=document.getElementById('__livecursor_ring'); if(!r)return; r.style.opacity='1'; r.style.transform='scale(1)'; setTimeout(()=>{r.style.opacity='0';r.style.transform='scale(0.3)';},220); };
  return 'cursor-ready';
})()
"""

def center_of(s, selector):
    expr = ("(() => { const el = document.querySelector(%s);"
            " if (!el) return null; const r = el.getBoundingClientRect();"
            " if (r.width===0 && r.height===0) return null;"
            " return [r.left + r.width/2, r.top + r.height/2]; })()") % json.dumps(selector)
    return ev(s, expr)

def center_of_text(s, text, near=None):
    """Centre of the smallest visible element whose trimmed text matches `text`
    (case-insensitive substring). Optional `near`=[x,y] disambiguates to the
    closest match — handy for per-row links like 'VIEW' in a list."""
    expr = ("(() => { const T = %s.toLowerCase(); const near = %s;"
            " const els = [...document.querySelectorAll('a,button,[role=button],span,div,li,.row')]"
            "   .filter(e => (e.textContent||'').trim().toLowerCase().includes(T)"
            "     && e.getClientRects().length"
            "     && !e.querySelector('*:not(svg):not(path)') === false ? true : (e.textContent||'').trim().toLowerCase().includes(T));"
            " const vis = els.filter(e => { const r=e.getBoundingClientRect(); return r.width>0&&r.height>0&&r.top>=0&&r.left>=0; });"
            " if (!vis.length) return null;"
            " const score = e => { const r=e.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2;"
            "   const area=r.width*r.height; const d = near ? Math.hypot(cx-near[0],cy-near[1]) : 0; return area/1e4 + d/1e3; };"
            " vis.sort((a,b)=>score(a)-score(b)); const r=vis[0].getBoundingClientRect();"
            " return [r.left+r.width/2, r.top+r.height/2]; })()") % (json.dumps(text), json.dumps(near))
    return ev(s, expr)

def lane_screen_pos(s, lane):
    """Best-effort: project an agent lane to a floor screen position.
    Tries the app's own projector, then a labelled DOM node, then null."""
    expr = ("(() => { try {"
            " const L = %s;"
            " const cam = window.OFFICE && OFFICE.camera;"
            " if (cam && typeof cam.laneScreenXY === 'function') { const p = cam.laneScreenXY(L); if (p) return [p.x, p.y]; }"
            " const n = [...document.querySelectorAll('[data-lane],[data-agent]')].find(e => (e.getAttribute('data-lane')||e.getAttribute('data-agent'))===L);"
            " if (n) { const r = n.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; }"
            " return null;"
            " } catch(e){ return null; } })()") % json.dumps(lane)
    return ev(s, expr)

# ---- input primitives -------------------------------------------------------
class Cap:
    def __init__(self, s, tmp):
        self.s = s; self.tmp = tmp; self.n = 0; self.x = WINDOW[0] * 0.62; self.y = WINDOW[1] * 0.5
    def frame(self):
        r = call(self.s, "Page.captureScreenshot", {"format": "jpeg", "quality": 74})
        if "data" in r:
            open(f"{self.tmp}/f{self.n:05d}.jpg", "wb").write(base64.b64decode(r["data"])); self.n += 1
    def _mouse(self, typ, x, y, button="none", buttons=0):
        call(self.s, "Input.dispatchMouseEvent",
             {"type": typ, "x": x, "y": y, "button": button, "buttons": buttons,
              "clickCount": 1 if typ in ("mousePressed", "mouseReleased") else 0}, want=False)
        ev(self.s, f"window.__setCursor && window.__setCursor({x:.1f},{y:.1f})")
    def glide(self, tx, ty, steps=18, buttons=0, btn="none"):
        x0, y0 = self.x, self.y
        for i in range(1, steps + 1):
            t = i / steps
            e = t * t * (3 - 2 * t)  # smoothstep
            x = x0 + (tx - x0) * e; y = y0 + (ty - y0) * e
            self._mouse("mouseMoved", x, y, button=btn, buttons=buttons)
            self.frame()
        self.x, self.y = tx, ty
    def click(self):
        ev(self.s, "window.__pulseCursor && window.__pulseCursor()")
        self._mouse("mousePressed", self.x, self.y, button="left", buttons=1); self.frame()
        self._mouse("mouseReleased", self.x, self.y, button="left", buttons=0); self.frame()
    def drag(self, tx, ty):
        self._mouse("mousePressed", self.x, self.y, button="left", buttons=1); self.frame()
        self.glide(tx, ty, steps=22, buttons=1, btn="left")
        self._mouse("mouseReleased", self.x, self.y, button="left", buttons=0); self.frame()
    def wait(self, secs):
        t_end = time.time() + secs
        while time.time() < t_end:
            self.frame(); time.sleep(0.05)

def resolve(s, target, near=None):
    if isinstance(target, (list, tuple)) and len(target) == 2:
        return float(target[0]), float(target[1])
    if isinstance(target, str) and target.startswith("text="):
        p = center_of_text(s, target[5:], near=near)
    else:
        p = center_of(s, target)
    return (float(p[0]), float(p[1])) if p else None

# Built-in demo tour: glide over the roster, open an agent's inspector via its
# "VIEW" link, linger, then move up and open Edit Office. Every target is
# text-based so it survives class renames.
DEFAULT_SCENE = [
    {"wait": 2.0},
    {"hover": "text=VIEW", "hold": 0.7},
    {"click": "text=VIEW"},
    {"wait": 3.0},
    {"click": "text=Edit Office"},
    {"wait": 3.0},
]

def run_scene(cap, s, scene):
    for step in scene:
        if "wait" in step:
            cap.wait(float(step["wait"]))
        elif "move" in step:
            p = resolve(s, step["move"])
            if p: cap.glide(*p)
        elif "hover" in step:
            p = resolve(s, step["hover"])
            if p:
                cap.glide(*p); cap.wait(float(step.get("hold", 0.8)))
        elif "click" in step:
            p = resolve(s, step["click"])
            if p:
                cap.glide(*p); cap.click()
        elif "lane" in step:
            p = lane_screen_pos(s, step["lane"])
            if p:
                cap.glide(*p); cap.wait(0.4); cap.click()
        elif "drag" in step:
            a = resolve(s, step["drag"][0]); b = resolve(s, step["drag"][1])
            if a and b:
                cap.glide(*a); cap.drag(*b)
        elif "js" in step:
            ev(s, step["js"]); cap.wait(0.3)

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(2)
    url, out = sys.argv[1], sys.argv[2]
    scene_path = sys.argv[sys.argv.index("--scene") + 1] if "--scene" in sys.argv else None
    fps = int(sys.argv[sys.argv.index("--fps") + 1]) if "--fps" in sys.argv else 12
    headful = "--headful" in sys.argv
    scene = json.load(open(scene_path)) if scene_path else DEFAULT_SCENE

    tmp = tempfile.mkdtemp(prefix="livecap_")
    mode = [] if headful else ["--headless=new"]
    proc = subprocess.Popen([CHROME, *mode, "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
        "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--force-device-scale-factor=1",
        f"--window-size={WINDOW[0]},{WINDOW[1]}", f"--remote-debugging-port={PORT}", url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws = None
        for _ in range(60):
            try:
                t = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=2))
                p = [x for x in t if x.get("type") == "page" and x.get("webSocketDebuggerUrl")]
                if p: ws = p[0]["webSocketDebuggerUrl"]; break
            except Exception:
                pass
            time.sleep(0.5)
        if not ws:
            print("could not reach CDP"); sys.exit(1)
        s = connect(ws)
        call(s, "Page.enable"); call(s, "Runtime.enable"); call(s, "DOM.enable")
        time.sleep(11)  # let the floor boot + first render settle
        # dismiss any first-run modal
        ev(s, r"""(()=>{const bs=[...document.querySelectorAll('button')];
          for(const re of [/accept\s*&?\s*enter/i,/got it/i,/^\s*accept/i,/dismiss/i,/continue/i]){
            const b=bs.find(x=>re.test((x.textContent||'').trim())); if(b){b.click();}} return 'ok';})()""")
        time.sleep(1.5)
        ev(s, CURSOR_JS)
        cap = Cap(s, tmp)
        ev(s, f"window.__setCursor && window.__setCursor({cap.x:.1f},{cap.y:.1f})")
        run_scene(cap, s, scene)
        if cap.n == 0:
            print("no frames captured"); sys.exit(1)
        subprocess.run([FFMPEG, "-y", "-framerate", str(fps), "-i", f"{tmp}/f%05d.jpg",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=1280:-2", out],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        sz = os.path.getsize(out) if os.path.exists(out) else 0
        print(f"live capture: {cap.n} frames @ {fps}fps -> {out} ({sz//1024}KB)")
    finally:
        proc.terminate(); shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
