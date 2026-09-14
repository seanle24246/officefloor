/* SOC-07 assignment views, presentation resolver, and unmounted accessible panel. */
(function(root,factory){const api=factory();root.OfficeAssignments=api;if(typeof module==='object'&&module.exports)module.exports=api;}(globalThis,()=>{
'use strict';
const ROOM_ONLY_PREFIX='station:room:';
const ASSIGNMENT_STATES=Object.freeze(['room_only','resolved','unresolved']);
const PRESENTATION_PRECEDENCE=Object.freeze(['real_work','manual_station','manual_room','role_fallback']);
const REAL_WORK_STATES=new Set(['asking','delivering']);
const REAL_WORK_ACTIVITY_KINDS=new Set(['walking','queued_ceo','queued_door','slumped','off_duty','ping_pong','beer_pong']);
const STABLE_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const deepFreeze=value=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.values(value).forEach(deepFreeze);return Object.freeze(value);};
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
function roomOnlyStationId(roomId){if(typeof roomId!=='string'||!STABLE_ID.test(roomId))throw Object.assign(new Error('room_id must be a stable non-empty ID'),{code:'invalid_room'});return `${ROOM_ONLY_PREFIX}${roomId}`;}
function roomIds(rooms){const result=new Set();for(const room of rooms){const id=typeof room==='object'?room.id:room;if(typeof id!=='string'||!STABLE_ID.test(id)||result.has(id))throw Object.assign(new Error('invalid room registry'),{code:'invalid_room'});result.add(id);}return result;}
function stationIndex(stations,rooms){const ids=roomIds(rooms),result=new Map();for(const station of stations){if(!station||typeof station.station_id!=='string'||!STABLE_ID.test(station.station_id)||!station.station_id.startsWith('station:')||station.station_id.startsWith(ROOM_ONLY_PREFIX)||!ids.has(station.room_id)||result.has(station.station_id))throw Object.assign(new Error('invalid station registry'),{code:'invalid_station'});result.set(station.station_id,clone(station));}return result;}
function normalizeAssignment(row){const fields=['agent_id','room_id','station_id'];if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join('|')!==fields.sort().join('|'))throw Object.assign(new Error('invalid assignment'),{code:'invalid_record'});const normalized=Object.fromEntries(fields.map(field=>[field,typeof row[field]==='string'&&field!=='agent_id'?row[field].trim():row[field]]));for(const field of fields)if(typeof normalized[field]!=='string'||!STABLE_ID.test(normalized[field]))throw Object.assign(new Error(`invalid ${field}`),{code:'invalid_record'});if(!normalized.station_id.startsWith('station:'))throw Object.assign(new Error('invalid station_id'),{code:'invalid_record'});return normalized;}
function assignmentView(assignment,{agentIds,rooms,stations}){const ids=roomIds(rooms),byStation=stationIndex(stations,rooms),row=normalizeAssignment(assignment);if(!ids.has(row.room_id))throw Object.assign(new Error('assignment names an unknown room'),{code:'invalid_room'});const roomOnly=roomOnlyStationId(row.room_id),station=byStation.get(row.station_id)||null;let state,missing_station_id=null;if(row.station_id===roomOnly)state='room_only';else if(!station){state='unresolved';missing_station_id=row.station_id;}else if(station.room_id!==row.room_id)throw Object.assign(new Error('station does not belong to assignment room'),{code:'station_room_mismatch'});else state='resolved';return deepFreeze({assignment:row,agent_present:new Set(agentIds).has(row.agent_id),state,station,missing_station_id});}
function stationTarget(stationId,effectiveModel){const candidates=(effectiveModel.furnishings||[]).filter(row=>row.station_id===stationId);for(const row of candidates)if(row.interaction_points?.length)return clone(row.interaction_points[0]);for(const row of candidates)if(row.source?.kind==='paired_chair')return clone(row.geometry.anchor);return candidates.length?clone(candidates[0].geometry.anchor):null;}
function roomTarget(roomId,rooms){const room=rooms.find(row=>row.id===roomId);return room?{x:room.x+room.w/2,y:room.y+room.h/2}:null;}
function realWork(agent){const activity=agent.activity||agent.truth_activity||{};return REAL_WORK_STATES.has(agent.state)||Boolean(agent.errand)||Boolean(agent.task_choreography)||(activity&&REAL_WORK_ACTIVITY_KINDS.has(activity.kind));}
function resolvePresentation(agent,assignment,{rooms,effectiveModel,roleFallback}){let result;if(realWork(agent)){result={source:'real_work',target:clone(agent.station||agent.home||roleFallback),hint:'truth choreography temporarily overrides manual assignment',assignment_state:null};}else if(assignment){const view=assignmentView(assignment,{agentIds:[agent.lane],rooms,stations:effectiveModel.stations||[]});if(view.state==='resolved')result={source:'manual_station',target:stationTarget(view.assignment.station_id,effectiveModel),hint:view.assignment.station_id,assignment_state:'resolved'};else result={source:'manual_room',target:roomTarget(view.assignment.room_id,rooms),hint:view.state==='unresolved'?`missing station ${view.missing_station_id}; using room fallback`:'room-only assignment',assignment_state:view.state};}else result={source:'role_fallback',target:clone(roleFallback),hint:'existing role-derived fallback',assignment_state:null};return deepFreeze(result);}
function element(document,tag,text=null){const node=document.createElement(tag);if(text!==null)node.textContent=text;return node;}
function createAssignmentPanel({document,agents,rooms,stations,assignments,revision,onSave}){
  if(!document?.createElement||typeof onSave!=='function')throw new TypeError('panel requires a document and save callback');
  const section=element(document,'section');section.setAttribute('role','region');section.setAttribute('aria-label','Room and desk assignments');
  const heading=element(document,'h2','Room and desk assignments');section.append(heading);
  const form=element(document,'form');form.setAttribute('aria-label','Edit assignment');
  const agentLabel=element(document,'label','Agent');const agentSelect=element(document,'select');agentSelect.setAttribute('name','agent_id');agentLabel.append(agentSelect);
  for(const agent of agents){const id=agent.agent_id||agent.lane||agent.id,option=element(document,'option',agent.name?`${agent.name} (${id})`:id);option.value=id;agentSelect.append(option);}
  const roomLabel=element(document,'label','Room');const roomSelect=element(document,'select');roomSelect.setAttribute('name','room_id');roomLabel.append(roomSelect);
  for(const room of rooms){const option=element(document,'option',room.label||room.id);option.value=room.id;roomSelect.append(option);}
  const stationLabel=element(document,'label','Desk or station');const stationSelect=element(document,'select');stationSelect.setAttribute('name','station_id');stationLabel.append(stationSelect);
  const refillStations=()=>{stationSelect.replaceChildren();const roomOnly=element(document,'option','Room only — no desk');roomOnly.value=roomOnlyStationId(roomSelect.value);stationSelect.append(roomOnly);for(const station of stations.filter(row=>row.room_id===roomSelect.value)){const option=element(document,'option',station.station_id);option.value=station.station_id;stationSelect.append(option);}};
  roomSelect.addEventListener('change',refillStations);refillStations();
  const status=element(document,'ul');status.setAttribute('aria-label','Current assignments');
  for(const assignment of assignments){const view=assignment.state?assignment:assignmentView(assignment,{agentIds:agents.map(a=>a.agent_id||a.lane||a.id),rooms,stations}),item=element(document,'li');item.setAttribute('data-agent-id',view.assignment.agent_id);item.textContent=view.state==='unresolved'?`${view.assignment.agent_id}: missing station ${view.missing_station_id}; deliberate reassignment required`:`${view.assignment.agent_id}: ${view.state==='room_only'?view.assignment.room_id:view.assignment.station_id}`;status.append(item);}
  const save=element(document,'button','Save assignment');save.type='submit';
  const clearStation=element(document,'button','Clear desk');clearStation.type='button';
  const clearAll=element(document,'button','Clear assignment');clearAll.type='button';
  form.append(agentLabel,roomLabel,stationLabel,save,clearStation,clearAll);
  form.addEventListener('submit',event=>{event.preventDefault();const station_id=stationSelect.value,room_id=roomSelect.value;onSave(station_id===roomOnlyStationId(room_id)?{operation:'assign_room',agent_id:agentSelect.value,room_id,expected_revision:revision}:{operation:'assign_station',agent_id:agentSelect.value,room_id,station_id,expected_revision:revision});});
  clearStation.addEventListener('click',()=>onSave({operation:'clear_station',agent_id:agentSelect.value,expected_revision:revision}));
  clearAll.addEventListener('click',()=>onSave({operation:'clear_all',agent_id:agentSelect.value,expected_revision:revision}));
  section.append(form,status);return section;
}
return Object.freeze({ROOM_ONLY_PREFIX,ASSIGNMENT_STATES,PRESENTATION_PRECEDENCE,roomOnlyStationId,assignmentView,resolvePresentation,createAssignmentPanel});
}));
