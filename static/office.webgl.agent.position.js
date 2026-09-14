/* office.webgl.agent.position.js — shared truth/actor position resolution. */

function finitePoint(value) {
  return Boolean(value && Number.isFinite(value.x) && Number.isFinite(value.y));
}

export function resolveAgentPosition(agent, actor = null) {
  const sources = [actor, agent, agent?.station, agent?.home, agent?.desk];
  for (const source of sources) {
    if (finitePoint(source)) {
      return Object.freeze({ x: source.x, y: source.y });
    }
  }
  return null;
}
