/* A landed beer break fills its mug before reusing the normal sip gesture. */
import { mountBeerProp, updateBeerProp } from './office.webgl.beerprop.js';
import { reachRightHand } from './office.webgl.arm.rig.js';

export const POUR_SECONDS = 5;
export function beerPourAge(actor) {
  const state = actor?.idleActivity;
  if (state?.kind !== 'beer' || state.depth !== 'deep' || !state.tapId
      || !['settling', 'active'].includes(state.beat) || actor.moving || !Number.isFinite(actor.x) || !Number.isFinite(actor.y) || !Number.isFinite(state.target?.x) || !Number.isFinite(state.target?.y)
      || Math.hypot(actor.x-state.target?.x, actor.y-state.target?.y) > .08) return null;
  if (!Number.isFinite(state.tick)) return null;
  return Math.max(0, state.tick - 8);
}

export function clearBeerTap(current) {
  const pour = current.tapPour;
  if (!pour) return;
  pour.stream.removeFromParent();
  pour.stream.geometry.dispose();
  pour.stream.material.dispose();
  if (pour.handle) pour.handle.rotation.x = pour.handleRotation;
  const body = current.beerProp?.root.getObjectByName('beer:body');
  const foam = current.beerProp?.root.getObjectByName('beer:foam');
  if (body) body.scale.y = 1;
  if (foam) foam.position.y = -.025;
  current.tapPour = null;
}

export function syncBeerTap(current, actor, frame, ctx) {
  const age = beerPourAge(actor);
  const state = actor?.idleActivity;
  const tap = frame.content.children.find(object =>
    (object.userData?.stable_furnishing_id || (object.userData?.placement_id ? `placement:${object.userData.placement_id}` : null)) === state?.tapId
    && object.getObjectByName('lounge-parts:draft-tower'));
  if (frame.world3dPlacement || age === null || age >= POUR_SECONDS || !tap) {
    clearBeerTap(current);
    return false;
  }
  if (!current.rig?.rightForearm) return false;
  if (current.tapPour && current.tapPour.tap !== tap) clearBeerTap(current);
  const T = ctx.THREE;
  if (!current.tapPour) {
    const stream = new T.Mesh(new T.CylinderGeometry(.025,.025,.35,8),
      new T.MeshStandardMaterial({color:'#e9b52d'}));
    stream.name = 'beer:tap-stream';
    frame.content.add(stream);
    const handle = tap.getObjectByName('lounge-part:tap handles')?.children[0];
    current.tapPour = {tap, stream, handle, handleRotation:handle?.rotation.x || 0};
  }
  const {stream, handle, handleRotation} = current.tapPour;
  tap.updateWorldMatrix(true,true);
  const nozzle = tap.localToWorld(new T.Vector3(-.14,1.62,.25));
  const target = nozzle.clone(); target.y -= .35;
  const rig = current.rig;
  const forward = new T.Vector3(0,0,1).applyQuaternion(tap.getWorldQuaternion(new T.Quaternion()));
  rig.figure.rotation.y = Math.atan2(forward.x,forward.z) - 2.35;
  rig.figure.updateWorldMatrix(true,true);
  reachRightHand(rig,rig.rightArm.parent.worldToLocal(target.clone()),.2,ctx);
  current.beerProp ||= mountBeerProp(rig.rightHand,ctx);
  updateBeerProp(current.beerProp,rig.figure,0);
  rig.rightHand.updateWorldMatrix(true,true);
  current.beerProp.root.position.copy(rig.rightHand.worldToLocal(target));
  stream.position.copy(frame.content.worldToLocal(nozzle.clone()));
  stream.position.y -= .175;
  stream.visible = age > .6 && age < 4.4;
  const fill = Math.max(.05,Math.min(1,(age-.6)/3.8));
  current.beerProp.root.getObjectByName('beer:body').scale.y = fill;
  current.beerProp.root.getObjectByName('beer:foam').position.y = -.28 + .255*fill;
  if (handle) handle.rotation.x = handleRotation + (stream.visible ? -.3 : 0);
  return true;
}
