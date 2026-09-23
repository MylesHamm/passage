import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyVesselType,normalizeVesselTypeCode,vesselTypeLabel} from '../lib/vessel-types.mjs';

test('missing, unavailable and malformed vessel codes stay explicitly unknown',()=>{
 for(const code of [null,undefined,'',' ',false,true,0,'0',NaN,Infinity,80.5,-1,100,{},[],[80],'8e1','0x50']) {
  assert.equal(normalizeVesselTypeCode(code),null);assert.equal(classifyVesselType(code),'unknown');
 }
});
test('AIS ship-type categories are shared by provider parsing and browser labels',()=>{
 for(const [code,type] of [[80,'tanker'],[89,'tanker'],['80','tanker'],[70,'cargo'],[79,'cargo'],[60,'passenger'],[50,'service'],[35,'military'],[30,'fishing'],[36,'leisure'],[37,'leisure'],[90,'other']]) assert.equal(classifyVesselType(code),type);
 assert.equal(vesselTypeLabel('passenger'),'Passenger');assert.equal(vesselTypeLabel('unknown'),'Type not reported');assert.equal(vesselTypeLabel('constructor'),'Type not reported');
});

const now=Date.parse('2026-09-13T18:00:00Z');
const position={mmsi:'123456789',latitude:25.4,longitude:55.3,positionTime:'2026-09-13T17:59:00Z',sourceAt:'2026-09-13T17:59:00Z',provider:'Open Waters'};
const typed={...position,provider:'AISStream',positionTime:'2026-09-13T17:58:00Z',shipTypeCode:80,shipTypeObservedAt:'2026-09-13T17:50:00Z',shipTypeTimestampBasis:'provider',shipTypeProvider:'AISStream'};

test('merge preserves the freshest position and independently dated category provenance',async()=>{
 const {mergeVesselPositions}=await import('../dist/vessel-data.mjs');
 const [v]=mergeVesselPositions([position,typed],now);
 assert.equal(v.provider,'Open Waters');assert.equal(v.positionTime,position.positionTime);assert.equal(v.sourceAt,position.sourceAt);assert.equal(v.shipType,'tanker');assert.equal(v.shipTypeProvider,'AISStream');assert.equal(v.shipTypeObservedAt,typed.shipTypeObservedAt.replace('Z','.000Z'));assert.equal(v.ageSeconds,60);assert.equal(v.stale,false);
});
test('merge ignores expired, invalid and future coordinates without suppressing other valid reports',async()=>{
 const {mergeVesselPositions}=await import('../dist/vessel-data.mjs');
 const records=[position,{...position,positionTime:'2026-09-13T18:01:00Z'}, {...position,mmsi:'223456789',positionTime:'2026-09-13T17:30:00Z'}, {...position,mmsi:'323456789',latitude:NaN}, {...position,mmsi:'423456789',longitude:181}, {...position,mmsi:'bad'}];
 const result=mergeVesselPositions(records,now);assert.equal(result.length,1);assert.equal(result[0].positionTime,position.positionTime);
});
test('merge never borrows undated or expired type metadata from another provider',async()=>{
 const {mergeVesselPositions}=await import('../dist/vessel-data.mjs');
 for(const at of [undefined,'bad','2026-09-12T18:00:00Z','2026-09-13T18:01:00Z']) {
  const [v]=mergeVesselPositions([position,{...typed,shipTypeObservedAt:at}],now);
  assert.equal(v.shipType,'unknown');assert.equal(v.shipTypeProvider,null);
 }
});
test('fresh snapshot type remains usable with its original provider without inventing a metadata timestamp',async()=>{
 const {mergeVesselPositions}=await import('../dist/vessel-data.mjs');
 const [v]=mergeVesselPositions([{...position,shipTypeCode:80},typed],now);
 assert.equal(v.shipType,'tanker');assert.equal(v.shipTypeProvider,'Open Waters');assert.equal(v.shipTypeObservedAt,null);
});
test('type metadata may outlive an expired position but cannot restore that position',async()=>{
 const {mergeVesselPositions}=await import('../dist/vessel-data.mjs');
 const old={...typed,positionTime:'2026-09-13T16:00:00Z'};
 assert.equal(mergeVesselPositions([old],now).length,0);
 const [v]=mergeVesselPositions([position,old],now);assert.equal(v.shipType,'tanker');assert.equal(v.positionTime,position.positionTime);
});
