import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialSessionChannels,COMMERCIAL_LAB_CHANNELS,sessionIndication,maquetePresentation} from '../src/lab-session-mapping';
const now=new Date('2026-10-22T12:00:00Z');
function fixture(){
  const chargers=[{id:901,stationId:13,publicCode:COMMERCIAL_LAB_CHANNELS.EV2.publicCode},{id:907,stationId:13,publicCode:COMMERCIAL_LAB_CHANNELS.EV1.publicCode}];
  const sessions=chargers.map((c,i)=>({id:'s'+i,intentId:'i'+i,stationId:13,chargerId:c.id,status:'CHARGING',startedAt:new Date(+now-60000),endedAt:null,autoStopAt:new Date(+now+60000)}));
  const intents=sessions.map(s=>({id:s.intentId,stationId:13,chargerId:s.chargerId,status:'AUTHORIZED',expiresAt:new Date(+now-1000)}));
  const db={charger:{findMany:async()=>chargers},labChargeSession:{findMany:async(q:any)=>{assert.equal(q.where.stationId,13);assert.deepEqual(q.where.chargerId.in,[901,907]);return sessions;}},labChargeIntent:{findMany:async()=>intents}};
  return {db,sessions,intents,chargers};
}
test('public codes map EV1/EV2 independently of database IDs and sandbox evse labels',async()=>{
  const {db}=fixture();const c=await commercialSessionChannels(db,now);
  assert.equal(c.EV1.chargerId,907);assert.equal(c.EV2.chargerId,901);
  assert.equal(c.EV1.sessionId,'s1');assert.equal(c.EV2.sessionId,'s0');
  assert.equal(c.EV1.operationalAuthorized,true);assert.equal(c.EV2.sessionAuthorized,true);
});
test('stopped, expired, future, wrong station and revoked intent cannot authorize',async()=>{
  for(const change of [(f:any)=>f.sessions[1].status='FINISHED',(f:any)=>f.sessions[1].endedAt=now,
    (f:any)=>f.sessions[1].autoStopAt=now,(f:any)=>f.sessions[1].startedAt=new Date(+now+1),
    (f:any)=>f.sessions[1].stationId=46,(f:any)=>f.intents[1].status='CANCELED',
    (f:any)=>f.intents[1].chargerId=76,(f:any)=>f.intents[1].expiresAt=new Date(+now-120000)]){
    const f=fixture();change(f);const c=await commercialSessionChannels(f.db,now);assert.equal(c.EV1.operationalAuthorized,false);
  }
});
test('no session, absent charger and ambiguous sessions fail closed',async()=>{
  const f=fixture();f.sessions.push({...f.sessions[1],id:'duplicate'});assert.equal((await commercialSessionChannels(f.db,now)).EV1.sessionAuthorized,false);
  f.sessions.splice(0);assert.equal((await commercialSessionChannels(f.db,now)).EV2.sessionAuthorized,false);
  f.chargers.splice(0);assert.equal((await commercialSessionChannels(f.db,now)).EV1.chargerId,null);
});

test('four modes preserve operational sessions independently from energy and illustration',async()=>{
  const f=fixture();
  for (const mode of ['NORMAL','PRESENTATION','SIMULATION','MANUAL_DEMO']) {
    for(const valid of [true,false]) {
      const channels=await commercialSessionChannels(f.db,now);
      assert.equal(sessionIndication(channels.EV1),true);
      assert.equal(sessionIndication(channels.EV2),true);
      const p=maquetePresentation(mode,valid);
      assert.equal(p.participatesInBalance,false);
      assert.equal(p.solarSharePct,valid && mode==='NORMAL' ? 80 : null);
      assert.equal(p.gridSharePct,valid && mode==='NORMAL' ? 20 : null);
    }
  }
  f.sessions[1].status='FINISHED';
  let c=await commercialSessionChannels(f.db,now);
  assert.equal(sessionIndication(c.EV1),false);assert.equal(sessionIndication(c.EV2),true);
  f.sessions[0].status='FINISHED';c=await commercialSessionChannels(f.db,now);
  assert.equal(sessionIndication(c.EV2),false);
});

test('STOP of either channel preserves the other session, authorization and power',async()=>{
 for(const stopped of [0,1]) {
  const f=fixture();f.sessions.forEach((s:any,i:number)=>s.simulatedPowerKw=7+i);
  const before=await commercialSessionChannels(f.db,now);
  f.sessions[stopped].status='FINISHED';f.sessions[stopped].endedAt=now as any;
  const after=await commercialSessionChannels(f.db,now);
  const stoppedEv=stopped===0?'EV2':'EV1',other=stopped===0?'EV1':'EV2';
  assert.equal(sessionIndication(after[stoppedEv]),false);
  assert.equal(after[stoppedEv].sessionPowerKw,0);
  assert.deepEqual(after[other],before[other]);assert.equal(sessionIndication(after[other]),true);
 }
});
