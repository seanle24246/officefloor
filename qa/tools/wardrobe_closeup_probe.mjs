// WARDROBE-CLOSEUP-01 browser probe: the "++" close-up studio on a served demo floor with agent_wardrobe forced on.
//
// Phase ON (flag forced on through the office-feature-flags meta, like dialogue_browser_probe.mjs):
//   - mounts the Looks preview (office.am.looks3d.js mount) with v2 looks for oscar, june and bear in many outfits
//     and hairstyles, front / side / back / head-and-shoulders, and screenshots each into the evidence dir;
//   - cost gate (WARDROBE-SEAM-SPECS §6): the figure's draws at close-up vs its floor build (<= +12, eyelids counted
//     mid-blink), one close-up at a time, close disposes the close-up geometry + material, and the main floor's draw
//     calls, memory and frame time are the same before opening and after closing (swiftshader: relative only);
//   - the seat inspector carries the Close-up button.
// Phase OFF: no studio module is fetched, no Close-up button, the Looks preview is today's floor preview.
// Until WARDROBE-RENDER-01's static/office.webgl.wardrobe.js exists, the page is served the local fixture figure
// (tests/fixtures/wardrobe_fixture_figure.mjs) at that URL by a CDP fetch intercept; the report says which ran.
// Usage: node qa/tools/wardrobe_closeup_probe.mjs [evidence-dir]   (or WARDROBE_CLOSEUP_SHOTS)
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startBrowser, evaluate, waitFor, stopChild, unusedPort, delay } from './astra_cdp.mjs';
import { spawnServer } from './browser_process.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const out = process.argv[2] || process.env.WARDROBE_CLOSEUP_SHOTS || path.join(root, 'qa/artifacts/WARDROBE-CLOSEUP-01');
const quick = process.env.WARDROBE_CLOSEUP_QUICK === '1';
mkdirSync(out, { recursive: true });
const catalog = JSON.parse(readFileSync(path.join(root, 'data/wardrobe-catalog.json'), 'utf8'));
const items = new Map(catalog.items.map((item) => [item.id, item]));
const realBuilder = existsSync(path.join(root, 'static/office.webgl.wardrobe.js'));
const fixture = readFileSync(path.join(root, 'tests/fixtures/wardrobe_fixture_figure.mjs'), 'utf8');

function look(model, hair, hairColor, skin, wear) {
  const worn = {};
  for (const [id, swatch = 0] of wear) {
    const item = items.get(id);
    assert.ok(item, `catalog item ${id}`);
    assert.ok(item.models.includes(model), `${id} on ${model}`);
    worn[item.slot] = { id, color: item.swatches[swatch % item.swatches.length] };
  }
  return { v: 2, model, tier: 'stylized', skin: catalog.skin_tones[skin],
    hair: { style: model === 'bear' ? 'bald' : hair, color: catalog.hair.colors[hairColor] }, wear: worn };
}

// [name, look, views]
const LOOKS = [
  ['oscar-excision-jersey', look('oscar', 'quiff', 6, 4, [['excision-jersey', 0], ['joggers', 0], ['running-shoes', 1]]), ['front', 'side', 'back', 'face']],
  ['oscar-office', look('oscar', 'classic', 7, 3, [['office-shirt', 0], ['slacks', 0], ['oxfords', 0], ['skinny-tie', 2]]), ['front', 'side', 'back', 'face']],
  ['oscar-suit', look('oscar', 'side-part', 6, 5, [['two-piece-suit', 1], ['oxfords', 1], ['necktie', 3], ['reading-glasses', 0]]), ['front', 'face']],
  ['june-blouse', look('june', 'bun-classic', 1, 1, [['blouse', 1], ['pencil-skirt', 0], ['heels', 0], ['pearl-necklace', 0]]), ['front', 'side', 'back', 'face']],
  ['june-polo', look('june', 'ponytail', 0, 2, [['polo', 3], ['chino-shorts', 1], ['sneakers', 0], ['baseball-cap', 2]]), ['front', 'back']],
  ['oscar-hoodie', look('oscar', 'afro', 6, 10, [['hoodie', 2], ['joggers', 0], ['running-shoes', 1], ['headset', 0]]), ['front', 'face']],
  ['june-cardigan', look('june', 'bob', 2, 4, [['turtleneck', 1], ['cardigan', 2], ['jeans', 0], ['chelsea-boots', 0]]), ['front', 'side']],
  ['bear-weekend', look('bear', 'bald', 0, 8, [['tee', 1], ['puffer-vest', 2], ['cargo-shorts', 2], ['bucket-hat', 1]]), ['front', 'side', 'back', 'face']],
  ['bear-office', look('bear', 'bald', 0, 7, [['oxford', 0], ['suit-vest', 1], ['slacks', 2], ['bow-tie', 0]]), ['front', 'face']],
  ['oscar-denim', look('oscar', 'mullet', 9, 6, [['henley', 1], ['denim-jacket', 0], ['jeans', 1], ['work-boots', 0], ['knit-beanie', 3]]), ['front', 'back']],
  ['june-wrap', look('june', 'long-straight', 8, 0, [['wrap-dress', 2], ['flats', 1], ['scarf', 1]]), ['front', 'back', 'face']],
  ['oscar-blazer', look('oscar', 'pompadour', 1, 4, [['oxford', 3], ['blazer', 0], ['chinos', 1], ['loafers', 0], ['bow-tie', 4]]), ['front', 'side', 'face']],
  ['june-lab', look('june', 'braids', 6, 9, [['shell-top', 0], ['lab-coat', 0], ['culottes', 2], ['sandals', 0], ['safety-glasses', 0]]), ['front', 'back']],
  ['oscar-3piece', look('oscar', 'quiff', 7, 2, [['three-piece-suit', 2], ['loafers', 1], ['necktie', 0], ['wristwatch', 0]]), ['front', 'face']],
  ['june-coveralls', look('june', 'locs', 1, 11, [['coveralls', 1], ['work-boots', 1], ['hard-hat', 0], ['clipboard', 0]]), ['front', 'side']],
  ['oscar-zip', look('oscar', 'curly-top', 1, 8, [['quarter-zip', 3], ['chinos', 2], ['sneakers', 2], ['backpack', 1], ['coffee-mug', 0]]), ['front', 'back']],
  ['june-sweater', look('june', 'pixie', 4, 3, [['crew-sweater', 4], ['pleated-skirt', 1], ['loafers', 2], ['beret', 0]]), ['front', 'face']],
];
const HAIR_ROW = catalog.hair.styles.map((style) => style.id);
const HAIR_LOOK = (style, index) => look(index % 2 ? 'june' : 'oscar', style, [1, 7, 0, 2, 8, 6, 3, 9][index % 8], [2, 5, 8, 1, 10, 4][index % 6],
  [['tee', index % 8], ['slacks', 0]]);

function forceFlags(force) {
  return `(() => {
    const force = ${JSON.stringify(force)};
    const qs = Document.prototype.querySelector;
    Document.prototype.querySelector = function (selector) {
      const node = qs.call(this, selector);
      if (selector !== 'meta[name="office-feature-flags"]' || !node) return node;
      try { const value = JSON.parse(node.content); Object.assign(value.flags, force); return { content: JSON.stringify(value) }; }
      catch (_) { return node; }
    };
  })();`;
}

async function shot(cdp, file, rect) {
  const { data } = await cdp.call('Page.captureScreenshot', { format: 'png',
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 } });
  writeFileSync(path.join(out, file), Buffer.from(data, 'base64'));
  return file;
}

const temp = mkdtempSync('/tmp/wardrobe-closeup-');
let server;
const report = { builder: realBuilder ? 'static/office.webgl.wardrobe.js (WARDROBE-RENDER-01)' : 'local fixture (tests/fixtures/wardrobe_fixture_figure.mjs)', shots: [] };
try {
  const port = Number(process.env.WARDROBE_CLOSEUP_PORT) || await unusedPort();
  const url = `http://127.0.0.1:${port}`;
  mkdirSync(path.join(temp, 'org'));
  server = spawnServer('python3', ['serve.py', '--demo', '--allrepos', path.join(temp, 'org'), '--port', String(port)],
    { cwd: root, stdio: 'ignore', env: { ...process.env, OFFICE_STATE: path.join(temp, 'state') } });
  await waitFor(async () => { try { return (await fetch(url)).ok; } catch { return false; } }, 'demo server', 30000);
  for (const mode of ['on', 'off']) {
    let browser;
    try {
      browser = await startBrowser(path.join(temp, `profile-${mode}`));
      const { cdp } = browser;
      const errors = [];
      const fetched = [];
      cdp.on('Runtime.exceptionThrown', (event) => errors.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text));
      cdp.on('Network.requestWillBeSent', (event) => fetched.push(event.request.url));
      await cdp.call('Page.enable'); await cdp.call('Runtime.enable'); await cdp.call('Network.enable');
      await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      if (!realBuilder) {
        await cdp.call('Fetch.enable', { patterns: [{ urlPattern: '*/office.webgl.wardrobe.js*', requestStage: 'Request' }] });
        cdp.on('Fetch.requestPaused', (event) => {
          void cdp.call('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }],
            body: Buffer.from(fixture).toString('base64') });
        });
      }
      await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: forceFlags({ agent_wardrobe: mode === 'on' }) });
      await cdp.call('Page.navigate', { url: `${url}/?welcome-seen=true&theme=off` });
      await waitFor(() => evaluate(cdp, "document.readyState==='complete'"), 'document', 30000);
      await evaluate(cdp, "document.querySelector('#nux-accept')?.click();document.querySelector('#dismissWelcome')?.click()");
      await waitFor(() => evaluate(cdp, 'window.OfficeWebGLMount?.active&&OFFICE?.webgl?.getRuntime?.().sceneSpec?.agents?.length>0'), 'WebGL floor', 40000);
      await delay(1500);

      // the inspector button (seat selection through the camera, like a click on the agent)
      const lane = await evaluate(cdp, 'OFFICE.state.world.agents[0].lane');
      await evaluate(cdp, `(()=>{OFFICE.camera.selected=${JSON.stringify(lane)};OFFICE.inspector?.render?.();
        document.getElementById('inspector').classList.add('open');return true;})()`);
      await delay(300);
      const button = await evaluate(cdp, "Boolean(document.querySelector('#inspector .inspector-wardrobe-closeup'))");
      // with the real v2 contract in the tree, the button opens the studio dialog; Escape closes and frees it
      let inspector = null;
      if (mode === 'on' && realBuilder) {
        await evaluate(cdp, "document.querySelector('#inspector .inspector-wardrobe-closeup').click();true");
        await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('.wardrobe-closeup-overlay .wardrobe-studio canvas'))"), 'inspector close-up', 30000);
        await delay(800);
        const box = await evaluate(cdp, "(()=>{const r=document.querySelector('.wardrobe-closeup-dialog').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
        report.shots.push(await shot(cdp, 'inspector-closeup.png', box));
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await delay(300);
        inspector = await evaluate(cdp, `(async()=>{const c=await import('/office.webgl.wardrobe.closeup.js');const s=await import('/office.webgl.wardrobe.studio.js');
          return {overlay:Boolean(document.querySelector('.wardrobe-closeup-overlay')),studio:Boolean(s.currentStudio()),closeup:c.closeupStats()};})()`);
        assert.deepEqual(inspector, { overlay: false, studio: false, closeup: { geometries: 0, materials: 0, attached: false } }, 'inspector close-up closes clean');
      }
      if (mode === 'on') report.inspector = inspector;
      await evaluate(cdp, "document.getElementById('inspector').classList.remove('open');OFFICE.camera.selected=null;true");

      // floor cost before the close-up opens
      const floorSample = `(async()=>{const rt=OFFICE.webgl.getRuntime();const r=rt.renderer;const calls=[];const times=[];let last=0;
        await new Promise(done=>{let n=0;const step=t=>{if(last)times.push(t-last);last=t;calls.push(r.info.render.calls);if(++n>=${quick ? 40 : 150})done();else requestAnimationFrame(step);};requestAnimationFrame(step);});
        const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
        return {calls:med(calls),frameMs:med(times),memory:{...r.info.memory}};})()`;
      const before = await evaluate(cdp, floorSample);

      const host = `(()=>{let h=document.getElementById('closeup-probe-host');if(!h){h=document.createElement('div');h.id='closeup-probe-host';
        h.style.cssText='position:fixed;left:20px;top:20px;width:400px;height:560px;z-index:99999';document.body.append(h);}return h;})()`;
      // flag off the Looks tab still passes today's v1 look; flag on, a v2 draft
      const firstLook = mode === 'on' ? JSON.stringify(LOOKS[0][1]) : "OFFICE.appearance.appearanceFor({lane:'closeup-probe'})";
      await evaluate(cdp, `(async()=>{const h=${host};const m=await import('/office.am.looks3d.js');
        window.__closeupProbe={m,handle:m.mount(h,{lane:'closeup-probe',state:'working'},${firstLook})};return true;})()`);
      if (mode === 'off') {
        await delay(1500);
        const off = await evaluate(cdp, `(()=>({canvas:Boolean(document.querySelector('#closeup-probe-host canvas')),
          studio:Boolean(document.querySelector('#closeup-probe-host .wardrobe-studio'))}))()`);
        await evaluate(cdp, 'window.__closeupProbe.handle.dispose();document.getElementById("closeup-probe-host").remove();true');
        const studioFetched = fetched.some((u) => /office\.webgl\.wardrobe\.(studio|closeup)|sku\.pack\.foragents\.closeup/.test(u));
        report.off = { button, studioFetched, ...off, errors: errors.length };
        assert.equal(button, false, 'flag off: no Close-up button');
        assert.equal(studioFetched, false, 'flag off: studio never fetched');
        assert.equal(off.studio, false, 'flag off: no studio');
        assert.equal(off.canvas, true, "flag off: today's floor preview canvas");
        assert.deepEqual(errors, [], JSON.stringify(errors));
        continue;
      }
      assert.equal(button, true, 'flag on: Close-up button in the inspector');
      const studioReady = `(async()=>{const s=await import('/office.webgl.wardrobe.studio.js');return Boolean(s.currentStudio());})()`;
      await waitFor(() => evaluate(cdp, studioReady), 'studio mounted', 30000);
      const rect = await evaluate(cdp, "(()=>{const r=document.getElementById('closeup-probe-host').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
      const settle = `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))`;

      const costs = [];
      for (const [name, value, views] of quick ? LOOKS.slice(0, 3) : LOOKS) {
        await evaluate(cdp, `(async()=>{const s=await import('/office.webgl.wardrobe.studio.js');const st=s.currentStudio();
          window.__closeupProbe.handle.update(${JSON.stringify(value)});st.setZoom(0);st.setView('front');await ${settle};return true;})()`);
        const cost = await evaluate(cdp, `(async()=>{const s=await import('/office.webgl.wardrobe.studio.js');const m=s.currentStudio().measure();
          const st=s.currentStudio().stats();return {...m, rules:st.detail.rules, dropped:st.detail.dropped};})()`);
        costs.push({ name, ...cost });
        for (const view of views) {
          await evaluate(cdp, `(async()=>{const s=await import('/office.webgl.wardrobe.studio.js');const st=s.currentStudio();
            st.setZoom(${view === 'face' ? 1 : 0});st.setView(${JSON.stringify(view === 'face' ? 'front' : view)});await ${settle};return true;})()`);
          report.shots.push(await shot(cdp, `closeup-${name}-${view}.png`, rect));
        }
        // a three-quarter turn by drag (pointer events on the canvas)
        if (views.includes('side')) {
          await evaluate(cdp, `(async()=>{const s=await import('/office.webgl.wardrobe.studio.js');const st=s.currentStudio();st.setZoom(0);st.setView('front');await ${settle};
            const c=st.canvas;const r=c.getBoundingClientRect();const o={bubbles:true,pointerId:7,clientY:r.y+200};
            c.dispatchEvent(new PointerEvent('pointerdown',{...o,clientX:r.x+100}));c.dispatchEvent(new PointerEvent('pointermove',{...o,clientX:r.x+170}));
            c.dispatchEvent(new PointerEvent('pointerup',{...o,clientX:r.x+170}));await ${settle};return true;})()`);
          report.shots.push(await shot(cdp, `closeup-${name}-drag34.png`, rect));
        }
      }
      if (!quick) {
        for (const [index, style] of HAIR_ROW.entries()) {
          await evaluate(cdp, `(async()=>{const s=await import('/office.webgl.wardrobe.studio.js');const st=s.currentStudio();
            window.__closeupProbe.handle.update(${JSON.stringify(HAIR_LOOK(style, index))});st.setZoom(1);st.setView('front');await ${settle};
            st.setView('front');return true;})()`);
          await evaluate(cdp, `(async()=>{const s=await import('/office.webgl.wardrobe.studio.js');const st=s.currentStudio();
            const c=st.canvas;const r=c.getBoundingClientRect();const o={bubbles:true,pointerId:8,clientY:r.y+200};
            c.dispatchEvent(new PointerEvent('pointerdown',{...o,clientX:r.x+100}));c.dispatchEvent(new PointerEvent('pointermove',{...o,clientX:r.x+160}));
            c.dispatchEvent(new PointerEvent('pointerup',{...o,clientX:r.x+160}));await ${settle};return true;})()`);
          report.shots.push(await shot(cdp, `hair-${String(index + 1).padStart(2, '0')}-${style}.png`, rect));
        }
      }

      // the floor with the close-up open (a paid item shown above loads the paid store geometry on demand, which
      // floor agents wearing paid items then draw too: compare the close against this, and report the first sample)
      const during = await evaluate(cdp, floorSample);

      // one close-up at a time: a second mount replaces the first
      const single = await evaluate(cdp, `(async()=>{const s=await import('/office.webgl.wardrobe.studio.js');const first=s.currentStudio();
        const h2=document.createElement('div');h2.style.cssText='position:fixed;left:440px;top:20px;width:200px;height:280px';document.body.append(h2);
        const second=s.mountStudio(h2,{lane:'closeup-probe-2'},${JSON.stringify(LOOKS[2][1])});await ${settle};
        const count=document.querySelectorAll('.wardrobe-studio').length;second.dispose();h2.remove();
        return {count, firstGone:!document.querySelector('#closeup-probe-host .wardrobe-studio'), current:Boolean(s.currentStudio())};})()`);

      // close: dispose, then the close-up owns nothing and the floor is unchanged
      const closed = await evaluate(cdp, `(async()=>{const c=await import('/office.webgl.wardrobe.closeup.js');window.__closeupProbe.handle.dispose();
        document.getElementById('closeup-probe-host')?.remove();return c.closeupStats();})()`);
      await delay(500);
      const after = await evaluate(cdp, floorSample);
      report.on = { button, costs: costs.map(({ rules, ...rest }) => ({ ...rest, specific: rules.filter((r) => r.specific).length, rules: rules.length })),
        single, closed, floorBefore: before, floorWhileOpen: during, floorAfter: after, errors };
      for (const cost of costs) {
        assert.ok(cost.addedCalls <= 12, `${cost.name}: +${cost.addedCalls} draws over the floor build`);
        assert.deepEqual(cost.dropped, [], `${cost.name}: nothing dropped by the budget guard`);
        assert.ok(cost.pixelRatio >= 1.5 && cost.pixelRatio <= 3, `${cost.name}: pixel ratio ${cost.pixelRatio}`);
      }
      assert.equal(single.count, 1, 'one close-up at a time');
      assert.deepEqual(closed, { geometries: 0, materials: 0, attached: false }, 'close disposes the close-up');
      // the close-up has its own renderer, so the floor's numbers move only with the live demo floor itself
      // (walkers, bubbles): a median over the sample, within a couple of draws
      const near = (a, b) => Math.abs(a - b) <= Math.max(2, b * 0.005);
      assert.ok(near(after.calls, during.calls), `main floor draw calls: closing the close-up changes nothing (${during.calls} -> ${after.calls})`);
      assert.ok(near(after.memory.geometries, during.memory.geometries) && after.memory.textures === during.memory.textures,
        `main floor renderer memory: closing the close-up changes nothing (${JSON.stringify(during.memory)} -> ${JSON.stringify(after.memory)})`);
      assert.ok(after.calls <= before.calls * 1.01 + 4, 'main floor draw calls before open vs after close');
      assert.deepEqual(errors, [], JSON.stringify(errors));
    } finally {
      browser?.cdp.close();
      await stopChild(browser?.child);
    }
  }
  writeFileSync(path.join(out, 'closeup-report.json'), JSON.stringify(report, null, 2));
  const worst = Math.max(...report.on.costs.map((cost) => cost.addedCalls));
  console.log(`PASS wardrobe_closeup_probe: builder=${realBuilder ? 'real' : 'fixture'}; ${report.on.costs.length} looks, worst +${worst} draws (<=12); `
    + `one close-up at a time; close frees close-up geometry+material; floor calls before/open/closed ${report.on.floorBefore.calls}/${report.on.floorWhileOpen.calls}/${report.on.floorAfter.calls}; `
    + `flag-off inert; shots=${report.shots.length}`);
} finally {
  await stopChild(server);
  rmSync(temp, { recursive: true, force: true });
}
