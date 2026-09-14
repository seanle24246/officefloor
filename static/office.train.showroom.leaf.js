/* office.train.showroom.leaf.js — DOM-free train showroom animation updates. */

import { WALK_CADENCE, walkPose } from './office.webgl.mesh.agent.js';

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function smooth(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function updateDoors(doorLeaves, doorOpenDistance, amount) {
  for (const leaf of doorLeaves) {
    leaf.position.x = leaf.userData.closedX
      + leaf.userData.openDirection * doorOpenDistance * amount;
  }
}

export function placePassenger(record, progress, elapsed) {
  const local = clamp01((progress - record.entry.delay) / 0.50);
  record.object.visible = local > 0;
  if (!record.object.visible) return;

  const doorX = record.entry.doorX;
  const outward = smooth(Math.min(1, local * 1.55));
  const spread = smooth(Math.max(0, (local - 0.45) / 0.55));
  record.object.position.set(
    doorX + (record.entry.targetX - doorX) * spread,
    0.44 + 0.22 * (1 - outward),
    1.18 + (4.34 - 1.18) * outward,
  );
  record.object.rotation.y = spread > 0.03
    ? (record.entry.targetX < doorX ? -Math.PI / 2 : Math.PI / 2)
    : 0;

  const pose = walkPose(elapsed * WALK_CADENCE + record.entry.delay * 9);
  const moving = local < 0.98 ? 1 : 0;
  if (record.rig.figure) record.rig.figure.position.y = pose.bob * moving;
  if (record.rig.leftLeg) record.rig.leftLeg.rotation.x = pose.leg * moving;
  if (record.rig.rightLeg) record.rig.rightLeg.rotation.x = -pose.leg * moving;
  if (record.rig.leftArm) record.rig.leftArm.rotation.x = pose.arm * moving;
  if (record.rig.rightArm) record.rig.rightArm.rotation.x = -pose.arm * moving;
}
