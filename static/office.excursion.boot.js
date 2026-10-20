/* OfficeExcursion — the public "teleport idle seats to another scene" API, plus the one WebGL cutaway hook.
 * No work at all while the office_excursions flag is off (default).
 *
 *   OfficeExcursion.registerScene(def)          add a scene (see office.excursion.core.js for the shape)
 *   OfficeExcursion.start(id, { lanes?, ask? }) cast idle seats (narrowed by lanes, capped by capacity);
 *                                               ask:true shows the consent prompt first. false if off/busy.
 *   OfficeExcursion.end()                       bring everyone home now
 *   OfficeExcursion.active()                    { scene, phase, lanes } | null
 *   OfficeExcursion.scenes() / scene(id)        what is registered
 */
(function (root) {
  'use strict';
  const FLAG = 'office_excursions';
  const core = root.OfficeExcursionCore;
  if (!core?.createRegistry) return;
  const registry = core.createRegistry();
  let controller = null;
  let context = null; // newest { THREE, renderer, palette } from the floor renderer

  function flagOn() {
    try { return root.OfficeFeatureFlags?.enabled(FLAG) === true; } catch (_) { return false; }
  }
  function editorActive() {
    try { return root.OFFICE?.state?.customization?.editorActive?.() === true; } catch (_) { return false; }
  }
  function drop() {
    try { controller?.dispose(); } catch (_) {}
    controller = null;
  }
  // Every scene's view is wrapped so the FICTION frame is generic, not a per-scene promise.
  function wrapView(scene, view) {
    const ui = root.OfficeExcursionUI;
    let framed = false;
    return {
      setActions: (actions) => view.setActions?.(actions),
      loading: () => view.loading(),
      cutaway: (args) => {
        if (!framed) { ui?.chrome.enter(scene); framed = true; }
        view.cutaway(args);
      },
      dispose: (opts) => {
        try { view.dispose(opts); } finally { ui?.chrome.leave(); }
      },
    };
  }
  function ensure() {
    if (controller) return true;
    const runtime = root.OfficeExcursionRuntime;
    const effects = root.OfficeFloorEffects;
    const ui = root.OfficeExcursionUI;
    const state = root.OFFICE?.state;
    const actors = root.OFFICE?.actors;
    if (!runtime?.create || !effects?.clockReading || !ui?.consent
        || !state?.actors || !actors?.homeTile) return false;
    controller = runtime.create({
      core,
      scenes: registry,
      enabled: flagOn,
      clock: (w, n) => effects.clockReading(w, n),
      storage: {
        getItem: (k) => root.localStorage.getItem(k),
        setItem: (k, v) => root.localStorage.setItem(k, v),
      },
      consent: ui.consent,
      buildView: (scene) => {
        if (!context) throw new Error('excursion: no renderer yet');
        return wrapView(scene, scene.buildView(context));
      },
      // Actors snap home; truth rows are only read.
      restore: (lanes, w) => {
        for (const lane of lanes) {
          const agent = w?.agents?.find((a) => a && a.lane === lane);
          if (!agent) continue;
          const actor = state.actors.get(lane);
          const p = actors.homeTile(agent);
          if (!actor || !p) continue;
          actor.x = p.x;
          actor.y = p.y;
          actor.path = [];
          actor.moving = false;
        }
      },
    });
    return true;
  }

  function start(sceneId, opts) {
    if (!registry.get(sceneId)) throw new Error(`excursion: unknown scene "${sceneId}"`);
    if (!flagOn() || editorActive()) return false;
    try { return ensure() && controller.start(sceneId, opts || {}) === true; } catch (_) { drop(); return false; }
  }
  function end() {
    try { return controller ? controller.end() === true : false; } catch (_) { drop(); return false; }
  }
  function active() {
    try { return controller ? controller.active() : null; } catch (_) { return null; }
  }

  // true iff an excursion owns the canvas this frame (the floor render is skipped).
  function drawFrame(frameContext) {
    const flag = flagOn();
    if (!flag && !controller) return false;
    if (editorActive()) { drop(); return false; }
    try {
      if (!controller && !ensure()) return false;
      context = { THREE: frameContext.THREE, renderer: frameContext.renderer, palette: frameContext.palette };
      const result = controller.frame(frameContext.world, Date.now() / 1000);
      if (!flag) { controller = null; return false; }
      return result === true;
    } catch (_) {
      drop();
      return false;
    }
  }

  root.OfficeExcursion = Object.freeze({
    registerScene: registry.register,
    scene: registry.get,
    scenes: () => registry.list().map((s) => s.id),
    start, end, active,
  });
  root.OFFICE ||= {};
  root.OFFICE.excursions = Object.freeze({ drawFrame });
})(globalThis);
