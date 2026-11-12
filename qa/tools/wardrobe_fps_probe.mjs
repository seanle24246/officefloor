#!/usr/bin/env node
// WARDROBE-RENDER-01 fps gate (WARDROBE-SEAM-SPECS.md §6, "By cost i mean fps"). One headless run, two served demo
// floors: BASELINE = agent_wardrobe off (today's figures); DRESSED = agent_wardrobe on with every agent wearing
// top + outer + bottom + feet + head + neck + eyes + hand. The dressing arrives the way saved looks do: a fetch shim
// adds the additive /api/state `looks` key (never a world clone). Date.now is pinned to the same origin in both runs.
// Per phase: 300 frames with the floor forced to render every rAF; reports renderer.info draw calls / triangles /
// geometries and the median frame time (update + render + a 1-px readPixels sync). Swiftshader timings are relative
// only. Gate: calls <= 1.10x, triangles <= 2.0x, median frame <= 1.10x baseline.
// usage: node qa/tools/wardrobe_fps_probe.mjs [--frames N] [--json out.json] [--shots dir]
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import resolvePython from './python_interpreter.js';
import { startBrowser, evaluate, waitFor, delay, stopChild, unusedPort } from './astra_cdp.mjs';
import { spawnServer } from './browser_process.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const FRAMES = Number(arg('--frames', '300'));
const JSON_OUT = arg('--json', '');
const SHOTS = arg('--shots', '');
const ROUNDS = Number(arg('--rounds', '3'));
const VARIANT = arg('--variant', 'varied'); // varied: every agent its own outfit and colours; uniform: one outfit
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const FLAG_ON = `import sys, runpy
sys.path.insert(0, ${JSON.stringify(ROOT)})
from server import feature_flags as ff
real = ff.resolve_feature_flags
ff.resolve_feature_flags = lambda *a, **k: {**real(*a, **k), 'agent_wardrobe': True}
sys.argv = ['serve.py'] + sys.argv[1:]
runpy.run_path(${JSON.stringify(path.join(ROOT, 'serve.py'))}, run_name='__main__')`;

const PIN_CLOCK = `(() => { const origin = Date.UTC(2026, 9, 28, 15, 0, 0); const t0 = performance.now();
  Date.now = () => Math.floor(origin + performance.now() - t0); })();`;

// Installed before navigation. Every agent gets a full outfit drawn from the catalog the page itself loaded, chosen
// by a lane hash so both models and many colours appear. The shim only ADDS the looks key.
const DRESS_SHIM = (variant) => `(() => {
  if (!/[?&]dress=1/.test(location.search)) return;
  const real = window.fetch.bind(window);
  const hash = (text) => { let h = 2166136261; for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const dress = (lane, index) => {
    const catalog = window.OFFICE?.wardrobeCatalog?.CATALOG; const api = window.OFFICE?.avatar?.appearance;
    if (!catalog || !api?.migrateV1) return null;
    const base = api.migrateV1(api.deriveDefault({ lane }), lane);
    const seed = ${variant === 'uniform' ? '7' : 'hash(lane)'};
    const pick = (list, salt) => list[(seed >>> salt) % list.length];
    const model = base.model;
    const items = (slot) => catalog.items.filter((item) => item.slot === slot && item.models.includes(model));
    const wear = {};
    for (const [slot, salt] of [['top', 1], ['outer', 3], ['bottom', 5], ['feet', 7], ['head', 9], ['neck', 11], ['eyes', 13], ['hand', 15]]) {
      const item = pick(items(slot), salt);
      wear[slot] = { id: item.id, color: pick(item.swatches, salt + 2) };
    }
    const styles = catalog.hair.styles.filter((style) => style.models.includes(model));
    return { ...base, skin: pick(catalog.skin_tones, 4), hair: { style: pick(styles, 6).id, color: pick(catalog.hair.colors, 8) }, wear };
  };
  window.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : (input && input.url) || '';
    const res = await real(input, init);
    if (!/\\/api\\/state(\\?|$)/.test(u) || !res.ok) return res;
    const data = await res.clone().json();
    const looks = {};
    (data.agents || []).forEach((agent, index) => { const look = dress(agent.lane, index); if (look) looks[agent.lane] = look; });
    window.__dressed = Object.keys(looks).length;
    return new Response(JSON.stringify({ ...data, looks: { revision: 1, looks } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
})();`;

const MEASURE = (frames) => `(async () => {
  const runtime = OFFICE.webgl.getRuntime();
  const renderer = runtime.renderer; const gl = renderer.getContext();
  const realRender = renderer.render.bind(renderer);
  const draws = []; const times = []; const pixel = new Uint8Array(4);
  const renders = [];
  renderer.render = (scene, camera) => { const t = performance.now(); realRender(scene, camera); renders.push(performance.now() - t); draws.push([renderer.info.render.calls, renderer.info.render.triangles]); };
  const realRaf = runtime.options.requestAnimationFrame;
  runtime.options.alwaysRender = true;
  await new Promise((resolve) => {
    runtime.options.requestAnimationFrame = (callback) => realRaf((now) => {
      const start = performance.now();
      callback(now);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      times.push(performance.now() - start);
      if (times.length >= ${frames} + 20) resolve();
    });
  });
  runtime.options.requestAnimationFrame = realRaf; renderer.render = realRender; runtime.options.alwaysRender = undefined;
  const measured = times.slice(20).sort((a, b) => a - b);
  const steady = draws.slice(-${frames});
  const median = (values) => values[Math.floor(values.length / 2)];
  let agents = 0; let wear = 0;
  runtime.scene.traverse((node) => { if (/^agent:/.test(node.name || '')) agents += 1; if (/^wear:/.test(node.name || '')) wear += 1; });
  return {
    frames: measured.length,
    medianFrameMs: median(measured),
    medianRenderCallMs: median(renders.slice(-${frames}).sort((a, b) => a - b)),
    p90FrameMs: measured[Math.floor(measured.length * 0.9)],
    calls: median(steady.map((row) => row[0]).sort((a, b) => a - b)),
    maxCalls: Math.max(...steady.map((row) => row[0])),
    triangles: median(steady.map((row) => row[1]).sort((a, b) => a - b)),
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
    agents, wearGroups: wear,
  };
})()`;

async function server(temp, flagOn, port) {
  const args = flagOn ? ['-c', FLAG_ON, '--demo', '--port', String(port)]
    : [path.join(ROOT, 'serve.py'), '--demo', '--port', String(port)];
  const child = spawnServer(resolvePython(process.env.PYTHON), args,
    { cwd: ROOT, stdio: 'ignore', env: { ...process.env, OFFICE_STATE: path.join(temp, `state-${port}`) } });
  const url = `http://127.0.0.1:${port}`;
  await waitFor(async () => { try { return (await fetch(`${url}/api/state`)).ok; } catch { return false; } }, 'server', 30000);
  return { child, url };
}

const temp = mkdtempSync(path.join(os.tmpdir(), 'wardrobe-fps-'));
const children = [];
let browser = null;
try {
  const ports = [Number(process.env.WARDROBE_PORT_OFF) || await unusedPort(), Number(process.env.WARDROBE_PORT_ON) || await unusedPort()];
  const off = await server(temp, false, ports[0]); children.push(off.child);
  const on = await server(temp, true, ports[1]); children.push(on.child);
  browser = await startBrowser(path.join(temp, 'profile'));
  const { cdp } = browser;
  const errors = [];
  cdp.on('Runtime.exceptionThrown', (e) => errors.push(e.exceptionDetails?.exception?.description || 'exception'));
  await cdp.call('Page.enable'); await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: PIN_CLOCK });
  await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: DRESS_SHIM(VARIANT) });
  const ev = (s) => evaluate(cdp, s);
  const shot = async (name) => {
    if (!SHOTS) return;
    const r = await cdp.call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
  };
  const boot = async (url, query = '') => {
    await cdp.call('Page.navigate', { url: `${url}/?welcome-seen=true${query}` });
    await waitFor(() => ev("!!(globalThis.OFFICE?.state?.world?.agents && globalThis.OFFICE?.webgl?.getRuntime?.()?.renderer)"), 'floor boot', 90000);
    await delay(3000);
    await ev("document.querySelector('#nux-accept')?.click()"); await delay(600);
    await ev("[...document.querySelectorAll('button')].find((b) => /accept\\s*&?\\s*enter|got it|^accept|dismiss|continue|^skip/i.test(b.textContent.trim()))?.click()");
    await delay(4000);
  };

  // ROUNDS (default 3) alternating rounds per phase; each phase keeps its best (lowest-median) round, so a burst of load from
  // another process on the box cannot fail or pass the gate on its own. Draw calls/triangles are deterministic.
  let baseline = null;
  let dressed = null;
  const rounds = []; // every round as measured (the gate uses each phase's best)
  const better = (a, b) => (!a || b.medianFrameMs < a.medianFrameMs ? b : a);
  for (let round = 0; round < ROUNDS; round += 1) {
    await boot(off.url);
    assert.equal(await ev("OfficeFeatureFlags.enabled('agent_wardrobe')"), false, 'baseline: flag off');
    const baseRound = await ev(MEASURE(FRAMES));
    rounds.push({ phase: 'baseline', round, ...baseRound });
    baseline = better(baseline, baseRound);
    console.error(`baseline round ${round}: ${JSON.stringify(baseRound)}`);
    if (round === 0) await shot('fps-baseline.png');
    // --variant none: flag on, nobody dressed (today's looks migrated) -- isolates the flag's non-clothing cost.
    await boot(on.url, VARIANT === 'none' ? '' : '&dress=1');
    assert.equal(await ev("OfficeFeatureFlags.enabled('agent_wardrobe')"), true, 'dressed: flag on');
    if (VARIANT !== 'none') await waitFor(() => ev('(window.__dressed || 0) > 0'), 'looks shim applied', 20000);
    await delay(2000);
    if (process.env.WARDROBE_PROFILE && round === 0) {
      await cdp.call('Profiler.enable'); await cdp.call('Profiler.start');
      await ev(MEASURE(60));
      const { profile } = await cdp.call('Profiler.stop');
      const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
      console.error([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${(v / 1000).toFixed(0)}ms ${k}`).join('\n'));
    }
    const dressedRound = await ev(MEASURE(FRAMES));
    rounds.push({ phase: 'dressed', round, ...dressedRound });
    dressed = better(dressed, dressedRound);
    console.error(`dressed round ${round}: ${JSON.stringify(dressedRound)}`);
  }
  await shot(`fps-dressed-${VARIANT}.png`);
  if (SHOTS) {
    // Zoomed floor views (after measuring, so they never touch the numbers): three agents up close.
    for (const index of [0, 5, 11]) {
      await ev(`(() => { const a = OFFICE.state.actors.get(OFFICE.state.world.agents[${index}].lane);
        OFFICE.camera.cam.zoom = 2.6; OFFICE.camera.panTo(a.x, a.y); OFFICE.webgl.getRuntime().options.alwaysRender = true; })()`);
      await delay(1500);
      await shot(`floor-zoom-${VARIANT}-${index}.png`);
    }
  }
  const ratio = {
    calls: dressed.calls / baseline.calls,
    triangles: dressed.triangles / baseline.triangles,
    frame: dressed.medianFrameMs / baseline.medianFrameMs,
  };
  const report = { variant: VARIANT, frames: FRAMES, baseline, dressed, ratio, rounds, errors };
  if (JSON_OUT) writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(errors, [], 'no page errors');
  if (VARIANT !== 'none') assert.ok(dressed.wearGroups >= dressed.agents, `every agent dressed: ${dressed.wearGroups} wear groups / ${dressed.agents} agents`);
  assert.ok(ratio.calls <= 1.10, `draw calls ${dressed.calls} > 1.10 x ${baseline.calls}`);
  assert.ok(ratio.triangles <= 2.0, `triangles ${dressed.triangles} > 2.0 x ${baseline.triangles}`);
  assert.ok(ratio.frame <= 1.10, `median frame ${dressed.medianFrameMs.toFixed(2)} ms > 1.10 x ${baseline.medianFrameMs.toFixed(2)} ms`);
  console.log(`PASS wardrobe_fps_probe: ${VARIANT} dressed ${dressed.agents} agents; calls ${baseline.calls}->${dressed.calls} `
    + `(x${ratio.calls.toFixed(3)}), triangles ${baseline.triangles}->${dressed.triangles} (x${ratio.triangles.toFixed(3)}), `
    + `median frame ${baseline.medianFrameMs.toFixed(2)}->${dressed.medianFrameMs.toFixed(2)} ms (x${ratio.frame.toFixed(3)}, swiftshader, relative only)`);
} finally {
  browser?.cdp.close();
  await stopChild(browser?.child);
  for (const child of children) await stopChild(child);
  rmSync(temp, { recursive: true, force: true });
}
