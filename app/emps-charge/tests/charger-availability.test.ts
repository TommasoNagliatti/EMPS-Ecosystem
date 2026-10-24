import assert from 'node:assert/strict';
import test from 'node:test';
import type {Charger} from '../src/domain/models';
import {chargerAvailability} from '../src/domain/charger-availability';

const physical:Charger={id:'51',stationId:'13',publicCode:'CH-f2f059af5117b95fb970',qrToken:'qr-test',label:'DEMO 03',
 bay:'DEMO 03',connectorType:'Tipo 2',powerKw:22,pricePerKwh:2,status:'offline',lastUpdatedAt:'2026-10-24T00:00:00Z'};
const simulated:Charger={...physical,sandboxAvailable:true,physicalStatus:'OFFLINE',provenance:'SANDBOX_ESTIMATE',
 sandbox:{mode:'SANDBOX',status:'AVAILABLE',canStart:true,reason:null,physicalMeasurement:false}};

test('explicit server sandbox availability admits checkout without declaring physical availability',()=>{
 assert.equal(chargerAvailability(simulated).canStart,true);
 assert.match(chargerAvailability(simulated).message,/SANDBOX/);
 assert.equal(simulated.status,'offline');assert.equal(simulated.physicalStatus,'OFFLINE');
 assert.equal(chargerAvailability(physical).canStart,false);
 assert.equal(chargerAvailability({...physical,status:'available'}).canStart,true);
});
test('scenes, busy state and incomplete or inconsistent sandbox responses fail closed',()=>{
 for(const charger of [
  {...simulated,sandbox:undefined},
  {...simulated,provenance:undefined},
  {...simulated,sandboxAvailable:false},
  {...simulated,sandbox:{...simulated.sandbox!,status:'BLOCKED' as const,canStart:false,reason:'Cenas ativas'}},
  {...simulated,sandbox:{...simulated.sandbox!,status:'IN_USE' as const}},
  {...simulated,sandbox:{...simulated.sandbox!,canStart:false}},
 ]) assert.equal(chargerAvailability(charger).canStart,false);
 assert.equal(chargerAvailability({...simulated,sandbox:{...simulated.sandbox!,status:'IN_USE',canStart:false}}).status,'in_use');
});
