/* Rigid Blender root playback, sampled in exported Three.js Y-up coordinates. */
import * as THREE from './vendor/three.module.js';

const finiteArray = (value, length) => Array.isArray(value) && value.length === length
  && value.every(Number.isFinite);

export function validateAnimation(animation) {
  if (!animation || !Number.isFinite(animation.period) || animation.period <= 0
    || !Array.isArray(animation.roots)) throw new Error('Invalid Tokyo animation header');
  const names = new Set();
  for (const track of animation.roots) {
    if (typeof track.name !== 'string' || !track.name || names.has(track.name)
      || !Array.isArray(track.keyframes) || track.keyframes.length < 2) {
      throw new Error(`Invalid Tokyo animation track: ${track?.name ?? 'unnamed'}`);
    }
    names.add(track.name);
    let previous = -Infinity;
    for (const key of track.keyframes) {
      if (!Number.isFinite(key.time) || key.time <= previous
        || !finiteArray(key.position, 3) || !finiteArray(key.quaternion, 4)) {
        throw new Error(`Invalid Tokyo animation sample: ${track.name}`);
      }
      previous = key.time;
    }
    const first = track.keyframes[0];
    const last = track.keyframes.at(-1);
    if (Math.abs(first.time) > 1e-6 || Math.abs(last.time - animation.period) > 1e-5) {
      throw new Error(`Tokyo animation track does not span the loop: ${track.name}`);
    }
    const samePosition = first.position.every((value, index) => Math.abs(value - last.position[index]) < 1e-3);
    const dot = first.quaternion.reduce((sum, value, index) => sum + value * last.quaternion[index], 0);
    if (!samePosition || Math.abs(dot) < 0.999) {
      throw new Error(`Tokyo animation track does not close its loop: ${track.name}`);
    }
  }
  return animation;
}

export function sampleTrack(track, period, elapsed) {
  const time = ((elapsed % period) + period) % period;
  const keys = track.keyframes;
  let low = 0; let high = keys.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (keys[middle].time <= time) low = middle;
    else high = middle;
  }
  const before = keys[low]; const after = keys[high];
  const alpha = THREE.MathUtils.clamp((time - before.time) / (after.time - before.time), 0, 1);
  const position = new THREE.Vector3(...before.position).lerp(new THREE.Vector3(...after.position), alpha);
  const quaternion = new THREE.Quaternion(...before.quaternion)
    .slerp(new THREE.Quaternion(...after.quaternion), alpha).normalize();
  return { position, quaternion };
}

export function createAnimationPlayer(animation, groups) {
  if (!animation) {
    if (groups.size) throw new Error('Scene has moving meshes without animation tracks');
    return null;
  }
  validateAnimation(animation);
  const tracks = new Map(animation.roots.map((track) => [track.name, track]));
  for (const name of groups.keys()) if (!tracks.has(name)) {
    throw new Error(`Moving scene mesh has no animation track: ${name}`);
  }
  for (const name of tracks.keys()) if (!groups.has(name)) {
    throw new Error(`Animation track has no moving scene mesh: ${name}`);
  }
  function update(elapsed) {
    for (const [name, group] of groups) {
      const transform = sampleTrack(tracks.get(name), animation.period, elapsed);
      group.position.copy(transform.position);
      group.quaternion.copy(transform.quaternion);
    }
  }
  update(0);
  return {
    update,
    snapshot(elapsed) {
      return {
        roots: groups.size,
        period: animation.period,
        phase: +(((elapsed % animation.period) + animation.period) % animation.period).toFixed(3),
        transforms: [...groups].slice(0, 3).map(([name, group]) => ({
          name,
          position: group.position.toArray().map((value) => +value.toFixed(3)),
          quaternion: group.quaternion.toArray().map((value) => +value.toFixed(3)),
        })),
      };
    },
  };
}
