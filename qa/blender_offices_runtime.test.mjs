import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as THREE from '../static/vendor/three.module.js';
import { createBlenderAgents, zoneFor } from '../static/office.webgl.blender-agents.js';
import { buildBlenderGeometry, fetchSceneBuffer, fittedWorldWidth, resetWorldCamera2d } from '../static/office.webgl.blender-world.js';
import { sampleTrack, validateAnimation } from '../static/office.webgl.blender-animation.js';
import { initializeSceneController, runtimeState } from '../static/office.webgl.mount.js';
import * as sceneModule from '../static/office.webgl.scene.js';
import { world3dAgentHits } from '../static/office.webgl.pick.js';

const directory = fileURLToPath(new URL('../static/assets/blender-offices/', import.meta.url));
const manifests = ['tokyo3d'].map((key) => ({
  key, value: JSON.parse(readFileSync(`${directory}${key}/scene.json`, 'utf8')),
}));

test('module-backed WebGL controller exposes its authored runtime options', () => {
  const worldTheme = { key: 'tokyo3d' };
  const state = { options: { worldTheme, plateCapabilities: { editMode: false } } };
  assert.equal(runtimeState({ getRuntime: () => state }), state);
  assert.equal(runtimeState(state), state);
});

test('failed WebGL creation releases the loaded world and preserves the cause', async () => {
  const failure = new Error('renderer context lost');
  let releases = 0;
  const worldTheme = { dispose() { releases += 1; } };
  const sceneApi = { createScene() { throw failure; }, getRuntime: () => null };
  await assert.rejects(initializeSceneController(sceneApi, { worldTheme }),
    (error) => error === failure);
  assert.equal(releases, 1);
});

test('failed module-backed start disposes its new runtime and world once', async () => {
  const failure = new Error('frame scheduling failed');
  let state = null;
  let stops = 0;
  let releases = 0;
  const worldTheme = { dispose() { releases += 1; } };
  const sceneApi = {
    getRuntime: () => state,
    createScene(options) { state = { options }; return state; },
    start() { throw failure; },
    stop() { stops += 1; },
    dispose() { state.options.worldTheme.dispose(); state = null; },
  };
  await assert.rejects(initializeSceneController(sceneApi, { worldTheme }),
    (error) => error === failure);
  assert.equal(stops, 1);
  assert.equal(releases, 1);
  assert.equal(state, null);
});

test('activation failure never tears down an existing scene runtime', async () => {
  const oldState = { running: true };
  const failure = new Error('new creation rejected');
  let releases = 0;
  let oldDisposals = 0;
  const sceneApi = {
    getRuntime: () => oldState,
    createScene() { throw failure; },
    dispose() { oldDisposals += 1; },
  };
  await assert.rejects(initializeSceneController(sceneApi, {
    worldTheme: { dispose() { releases += 1; } },
  }), (error) => error === failure);
  assert.equal(releases, 1);
  assert.equal(oldDisposals, 0);
  assert.equal(oldState.running, true);
});

test('configured world failure after scene assignment releases partial runtime once', async () => {
  assert.equal(sceneModule.getRuntime(), null);
  const failure = new Error('authored scene configuration failed');
  let worldReleases = 0;
  let rendererReleases = 0;
  const renderer = {
    render() {}, setPixelRatio() {}, setSize() {},
    dispose() { rendererReleases += 1; },
  };
  const worldTheme = {
    isWorld3d: true,
    configureScene() { throw failure; },
    dispose() { worldReleases += 1; },
  };
  await assert.rejects(initializeSceneController(sceneModule, {
    canvas: {}, renderer, worldTheme,
    plateCapabilities: { world3d: true, editMode: false, vignettes: false, cars: false, trains: false },
  }), (error) => error === failure);
  assert.equal(sceneModule.getRuntime(), null);
  assert.equal(worldReleases, 1);
  assert.equal(rendererReleases, 1);
});

test('hidden avatar batch sources remain pickable behind opaque occlusion', () => {
  const avatar = { name: 'agent:alice', parent: null };
  const source = { visible: false, userData: { agentBatchSource: true }, parent: avatar };
  const shadow = { visible: true, material: { transparent: true, opacity: .05 }, parent: avatar };
  const furniture = { visible: true, material: { transparent: false, opacity: 1 }, parent: null };
  assert.deepEqual(world3dAgentHits([{ object: shadow }, { object: source }]), [{ object: source }]);
  assert.deepEqual(world3dAgentHits([{ object: furniture }, { object: source }]), []);
});

test('reference-aspect framing and center reset preserve the authored home view', () => {
  const camera = { orthoWidth: 44.5, aspect: 1610 / 977 };
  const aspect = 2.2;
  const home = { x: 20, y: -4, zoom: .9 };
  const view = { x: 90, y: 30, zoom: 1.8, tx: 1, ty: 2 };
  assert.ok(fittedWorldWidth(camera, aspect, home.zoom, home.zoom) > camera.orthoWidth);
  assert.ok(fittedWorldWidth(camera, aspect, home.zoom, view.zoom) < camera.orthoWidth);
  assert.equal(resetWorldCamera2d(view, home), true);
  assert.equal(view.zoom, home.zoom);
  assert.equal(view.x, home.x);
  assert.equal(view.y, home.y);
  assert.ok(Math.abs(fittedWorldWidth(camera, aspect, home.zoom, view.zoom)
    - camera.orthoWidth * aspect / camera.aspect) < 1e-9);
});

test('world camera follow resolves the requested live lane, never a stale selection', () => {
  const centers = [];
  const stage = { addEventListener() {} };
  const office = { state: { actors: new Map([
    ['alice', { x: 1, y: 2 }], ['bob', { x: 3, y: 4 }],
  ]), hitboxes: [] }, theme: {}, module(name, deps, factory) {
    this[name] = factory({ iso: (x, y) => ({ x, y }), clamp: (v) => v,
      TW: 32, TH: 16, WALL_H: 10 }, this.state);
  } };
  const context = { OFFICE: office, document: { getElementById: () => stage, body: null },
    window: { addEventListener() {}, devicePixelRatio: 1 }, innerWidth: 1200, innerHeight: 800,
    OfficeWebGLMount: { worldTheme: { isWorld3d: true,
      centerLane: (lane) => { centers.push(lane); return true; } } } };
  vm.runInNewContext(readFileSync(fileURLToPath(new URL('../static/office.camera.js', import.meta.url)), 'utf8'),
    context, { filename: 'office.camera.js' });
  office.camera.selected = 'alice';
  office.camera.panTo(3, 4);
  office.camera.panTo(office.state.actors.get('alice'));
  office.camera.panTo(200, 400);
  assert.deepEqual(centers, ['bob', 'alice']);
});

test('shipped chunks match the absolute-offset manifest contract', () => {
  for (const { key, value } of manifests) {
    assert.equal(value.sceneKey, key);
    const total = value.buffers.reduce((sum, part) => {
      assert.ok(part.byteLength <= 16 * 1024 * 1024);
      assert.equal(statSync(`${directory}${key}/${part.url}`).size, part.byteLength);
      return sum + part.byteLength;
    }, 0);
    assert.equal(total, value.stats.binaryBytes);
    for (const mesh of value.meshes) {
      for (const [part, stride] of [['position', 12], ['normal', 12], ['index', 4]]) {
        assert.ok(mesh[part].byteOffset + mesh[part].count * stride <= total);
      }
    }
    if (value.animation) {
      validateAnimation(value.animation);
      const names = new Set(value.animation.roots.map((track) => track.name));
      assert.deepEqual(new Set(value.meshes.filter((mesh) => mesh.animationRoot).map((mesh) => mesh.animationRoot)), names);
      const track = value.animation.roots[0];
      assert.deepEqual(sampleTrack(track, value.animation.period, 0).position.toArray(),
        sampleTrack(track, value.animation.period, value.animation.period).position.toArray());
    }
  }
});

test('chunk assembly rejects missing bytes and places rigid roots in one group', async () => {
  const combined = await fetchSceneBuffer({ buffers: [
    { url: 'one.bin', byteLength: 8 }, { url: 'two.bin', byteLength: 4 },
  ], stats: { binaryBytes: 12 } }, 'https://example.invalid/', async (url) => ({
    ok: true, arrayBuffer: async () => (url.endsWith('one.bin') ? Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)
      : Uint8Array.of(9, 10, 11, 12)).buffer,
  }));
  assert.deepEqual([...new Uint8Array(combined)], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  await assert.rejects(() => fetchSceneBuffer({ buffers: [{ url: 'bad.bin', byteLength: 5 }] },
    'https://example.invalid/', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })),
  /size mismatch/);

  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = new Uint32Array([0, 1, 2]);
  const bytes = new Uint8Array(positions.byteLength + normals.byteLength + indices.byteLength);
  bytes.set(new Uint8Array(positions.buffer), 0);
  bytes.set(new Uint8Array(normals.buffer), positions.byteLength);
  bytes.set(new Uint8Array(indices.buffer), positions.byteLength + normals.byteLength);
  const descriptor = { material: 0, animationRoot: 'belt', name: 'test-triangle',
    position: { byteOffset: 0, count: 3 }, normal: { byteOffset: positions.byteLength, count: 3 },
    index: { byteOffset: positions.byteLength + normals.byteLength, count: 3 } };
  const built = buildBlenderGeometry({ version: 1, materials: [{ color: [1, 1, 1] }],
    meshes: [descriptor, { ...descriptor, name: 'second-triangle' }] }, bytes.buffer);
  assert.equal(built.groups.size, 1);
  assert.equal(built.groups.get('belt').children.length, 2);
  built.root.traverse((object) => { object.geometry?.dispose?.(); object.material?.dispose?.(); });
});

test('real zone, capacity and mixed-zone positions are honest and separate', () => {
  assert.equal(zoneFor({ room: 'ceo', role: 'CEO' }), 'ceo');
  assert.equal(zoneFor({ station: { room: 'kitchen' }, room: 'bullpen' }), 'bar');
  for (const { value } of manifests) {
    const planner = createBlenderAgents(value);
    const rows = [
      ...Array.from({ length: 17 }, (_, n) => ({ lane: `dev-${String(n).padStart(2, '0')}`, room: 'bullpen' })),
      ...Array.from({ length: 9 }, (_, n) => ({ lane: `rev-${String(n).padStart(2, '0')}`, room: 'review' })),
      ...Array.from({ length: 3 }, (_, n) => ({ lane: `ceo-${String(n).padStart(2, '0')}`, room: 'ceo' })),
      ...Array.from({ length: 4 }, (_, n) => ({ lane: `rest-${String(n).padStart(2, '0')}`, room: 'bench' })),
    ];
    planner.update(rows, 0);
    const snapshot = planner.snapshot();
    assert.equal(snapshot.shown + snapshot.overflow, rows.length);
    assert.ok(snapshot.standing > 0);
    const shown = rows.map((row) => planner.placement(row.lane)).filter(Boolean);
    for (let i = 0; i < shown.length; i += 1) {
      assert.ok(planner.nav.cellAt(shown[i].position[0], shown[i].position[2]));
      for (let j = i + 1; j < shown.length; j += 1) {
        assert.ok(Math.hypot(shown[i].position[0] - shown[j].position[0],
          shown[i].position[2] - shown[j].position[2]) >= .899);
      }
    }
  }
});

test('published room change follows exported walkable grid', () => {
  const planner = createBlenderAgents(manifests[0].value);
  planner.update([{ lane: 'alice', room: 'bullpen' }], 0);
  const before = [...planner.placement('alice').position];
  let moved = false;
  for (let frame = 0; frame < 120; frame += 1) {
    planner.update([{ lane: 'alice', room: 'bullpen', station: { room: 'review' } }], .05);
    const pos = planner.placement('alice').position;
    assert.ok(planner.nav.cellAt(pos[0], pos[2]));
    if (Math.hypot(pos[0] - before[0], pos[2] - before[2]) > .1) moved = true;
  }
  assert.equal(moved, true);
});
