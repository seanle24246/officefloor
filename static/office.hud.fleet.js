/* office.hud.fleet.js — sealed Fleet Health surface API.
 *
 * TERRA-147 owns the single top-center strip and its visual styling. This
 * module gives that truth-derived surface its stable HUD API without creating
 * a second strip or deriving a second set of numbers.
 */
(typeof OFFICE !== 'undefined' ? OFFICE : {
  module: (_name, _deps, factory) => {
    module.exports = factory(require('./office.hud.truth.js'), require('./office.hud.topbar.js'));
  },
}).module('hud.fleet', ['hud.truth', 'hud.topbar'], (truth, topbar) => {
'use strict';

function renderFleetHealth(world) {
  return topbar.renderTopbar(world);
}

return Object.freeze({
  HEALTH: truth.HEALTH,
  deriveFleetHealth: truth.deriveFleetHealth,
  renderFleetHealth,
  BAR_ID: topbar.BAR_ID,
});
});
