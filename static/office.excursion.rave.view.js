/* Example scene "rave": a detached, disposable low-poly warehouse. Registered, never scheduled —
   it only runs when something calls OfficeExcursion.start('rave'). */
(function(root) {
'use strict';
function create({THREE:T,renderer,palette}) {
  let overlay=null, scene=null, camera=null, dancers=[], lights=[], actions={};
  const colors=['#88dedb','#bb9ee9','#e9a476','#c7dfa4'];
  const doc=root.document;
  function node(tag,className,text,parent) {
    const el=doc.createElement(tag); el.className=className; el.textContent=text;
    parent?.appendChild(el); return el;
  }
  function panel(id) {
    overlay?.remove(); overlay=node('section','excursion-rave','',doc.body); overlay.id=id;
    return overlay;
  }
  function button(text,parent,click,primary=false) {
    const b=node('button',primary?'rave-primary':'',text,parent); b.type='button'; b.onclick=click; return b;
  }
  function loading() {
    const p=panel('excursion-rave-loading'); p.setAttribute('role','status');
    const inner=node('div','','',p); node('div','rave-loading-disc','♪',inner);
    node('div','rave-eyebrow','🎭 AFTER HOURS',inner); node('h2','','Finding the frequency…',inner);
    node('p','','Next stop: the warehouse',inner);
  }
  function box(parent,w,h,d,x,y,z,color,emissive=false) {
    const m=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshStandardMaterial({color,roughness:.85,metalness:.08,...(emissive?{emissive:color,emissiveIntensity:.65}:{})}));
    m.position.set(x,y,z); parent.add(m); return m;
  }
  function build(agents) {
    scene=new T.Scene(); scene.background=new T.Color(palette?.background||'#070a12');
    camera=new T.PerspectiveCamera(38,1,.1,150); camera.position.set(19,19,24); camera.lookAt(0,0,-1);
    scene.add(new T.HemisphereLight('#b7c9f5','#202534',2.5));
    const sun=new T.DirectionalLight('#e2e8f4',3); sun.position.set(4,12,8); scene.add(sun);
    box(scene,22,.5,19,0,-.45,0,'#1e242e');
    box(scene,22,7,.45,0,3,-9.5,'#171e2a');
    box(scene,.4,7,19,-11,3,0,'#202839');
    for(let x=-9;x<=9;x+=3) box(scene,.13,7,.12,x,3,-9.1,'#4b5666');
    for(let z=-7;z<=7;z+=3) box(scene,.15,.15,18,0,6.3,z,'#4b5666').rotation.y=Math.PI/2;
    for(let x=0;x<8;x++) for(let z=0;z<7;z++) {
      box(scene,1.55,.12,1.55,(x-3.5)*1.6,-.1,(z-2.5)*1.6,(x+z)%4===0?colors[(x+z)%colors.length]:'#344053',(x+z)%4===0);
    }
    box(scene,12,.7,3,0,.1,-7,'#343e51');
    box(scene,6,1.6,1.5,0,1,-7,'#111923');
    box(scene,6.1,.1,1.6,0,1.85,-7,'#67737e');
    box(scene,5,.08,.05,0,1.4,-6.21,colors[0],true);
    for(const x of [-1.8,1.8]) {
      const disc=new T.Mesh(new T.CylinderGeometry(.55,.55,.08,16),new T.MeshStandardMaterial({color:'#111923'})); disc.position.set(x,1.96,-7); scene.add(disc);
      box(scene,.7,.05,.65,0,1.96,-7,'#9fb0bd');
    }
    for(const x of [-7.5,7.5]) {
      box(scene,1.8,3.7,1.4,x,1.5,-7,'#111923');
      for(const y of [.6,2.2]) {
        const cone=new T.Mesh(new T.CylinderGeometry(.59,.59,.12,12),new T.MeshStandardMaterial({color:'#4b5666'}));
        cone.rotation.x=Math.PI/2; cone.position.set(x,y,-6.22); scene.add(cone);
      }
    }
    for(let i=0;i<4;i++) {
      const beam=new T.Mesh(new T.ConeGeometry(1.7,8,12,1,true),new T.MeshBasicMaterial({color:colors[i],transparent:true,opacity:.065,side:T.DoubleSide,depthWrite:false}));
      beam.position.set((i-1.5)*4,2.6,-3); beam.rotation.z=(i-1.5)*.13; scene.add(beam); lights.push(beam);
      box(scene,.6,.25,.5,(i-1.5)*4,6.2,-4,colors[i],true);
    }
    const mirror=new T.Mesh(new T.IcosahedronGeometry(.8,1),new T.MeshStandardMaterial({color:'#aebdcc',metalness:.85,roughness:.22,flatShading:true}));
    mirror.position.set(0,5.8,0); scene.add(mirror); lights.push(mirror);
    const cols=Math.min(10,Math.max(3,Math.ceil(Math.sqrt(agents.length*1.3))));
    dancers=agents.map((a,i)=>{
      const g=new T.Group(); const rows=Math.ceil(agents.length/cols); const spacing=Math.min(2.1,11/Math.max(cols,rows));
      g.position.set(((i%cols)-(cols-1)/2)*spacing,0,(Math.floor(i/cols)-(rows-1)/2)*spacing+1.3);
      const scale=agents.length>50?.65:1; g.scale.setScalar(scale); scene.add(g);
      const shirt=colors[i%4]; box(g,.58,.8,.34,0,1.05,0,shirt); box(g,.48,.48,.44,0,1.74,0,'#c9a98a');
      box(g,.5,.13,.46,0,2,0,'#343638');
      for(const x of [-.17,.17]) box(g,.23,.65,.28,x,.33,0,'#2b323d');
      const arms=[-.46,.46].map(x=>box(g,.2,.7,.23,x,1.2,0,shirt));
      for(const x of [-.1,.1]) box(g,.055,.055,.02,x,1.76,.23,'#171919');
      return {g,arms,base:g.position.clone(),seed:i*.91};
    });
    const p=panel('excursion-rave-venue'), head=node('div','rave-venue-head','',p);
    const title=node('div','','',head); node('div','rave-eyebrow','🎭 FICTION · OFFICE EXCURSIONS / 001',title); node('h2','','AFTER HOURS',title); node('p','','THE WAREHOUSE · AFTER HOURS',title);
    button('Head back',head,()=>actions.back?.());
    const foot=node('div','','',p); node('div','rave-guest-caption','🎭 Dancing here · real status stays in the inspector',foot);
    const guests=node('div','rave-guests','',foot);
    agents.forEach(a=>{
      const b=button(a.name||a.lane,guests,()=>{ root.OFFICE.camera.selected=a.lane; root.OFFICE.inspector?.renderInspector?.(); });
      b.dataset.excursionLane=a.lane; b.setAttribute('aria-label',`${a.name||a.lane} — fictional rave; inspect real status`);
    });
  }
  function cutaway({agents,elapsed}) {
    if(!scene) build(agents);
    const t=root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?0:elapsed;
    dancers.forEach(({g,arms,base,seed})=>{g.position.y=base.y+Math.abs(Math.sin(t*2+seed))*.09;g.rotation.y=Math.sin(t*.9+seed)*.25;arms.forEach((a,j)=>{a.rotation.z=Math.sin(t*2+seed+j)*.45;});});
    lights.forEach((l,i)=>{ l.rotation.y=t*.15+i; });
    const canvas=renderer.domElement; camera.aspect=canvas.clientWidth/Math.max(1,canvas.clientHeight); camera.updateProjectionMatrix(); renderer.render(scene,camera);
  }
  function dispose({immediate=true}={}) {
    overlay?.remove(); overlay=null;
    scene?.traverse(o=>{o.geometry?.dispose();if(o.material) o.material.dispose();});
    scene=null;camera=null;dancers=[];lights=[];
    if(!immediate) {
      const veil=node('div','excursion-rave rave-return-veil','',doc.body);
      veil.setAttribute('aria-hidden','true');
      root.setTimeout(()=>veil.remove(),350);
    }
  }
  return {loading,cutaway,dispose,setActions:value=>{actions=value;}};
}
root.OfficeExcursionRaveView=Object.freeze({create});
// RAVE-SCHED-01: flag rave_schedule (default off) offers the trip once a week, Friday 18:00 office time
// (office day 1 is Monday, so weekday 5 = FRI). Off: no schedule key at all, exactly as before.
const raveScheduled=root.OfficeFeatureFlags?.enabled?.('rave_schedule')===true
  && typeof root.OfficeExcursionCore?.weeklyWindow==='function';
root.OfficeExcursion?.registerScene({
  id:'rave', title:'The Warehouse', label:'After hours', capacity:128, durationMs:60000, buildView:create,
  invite:{heading:'Your employees are tired. Do you wanna take them on an office trip?',body:'A little music. A change of scene. The warehouse, after hours.'},
  ...(raveScheduled?{schedule:root.OfficeExcursionCore.weeklyWindow(5,18)}:{}),
});
})(globalThis);
