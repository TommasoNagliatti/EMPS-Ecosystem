import assert from 'node:assert/strict';
import test from 'node:test';
import { energySnapshot, effectiveRelay, EnergyOrderGuard } from '../src/lab-energy-contract';
import { LabMaqueteService } from '../src/lab-maquete.service';
import type { GieV3Envelope } from '../src/gie-v3.service';
const now=Date.parse('2026-10-22T12:00:00Z');
test('JSON viewer reads exact transmitted frame without generating commands; access and station isolation',async()=>{
  const g=fixture();g.observed_at=new Date().toISOString();let allowed=true;
  const service=new LabMaqueteService({labChargeSession:{findMany:async()=>[]}} as any,
    {require:async(_u:any,id:string)=>{if(!allowed)throw Error('Forbidden');return {id:Number(id)};}} as any,
    {cachedState:()=>g,refresh:async()=>g} as any);
  service.heartbeat=async()=>'';
  const config={stationId:46,deviceId:'maquete-01',token:'private-not-in-json'};
  (service as any).config=()=>config;
  const open=await service.openEnergyStream(config,{stationId:'46',bootId:'esp_viewer'});
  const frame=await service.energyFrame(config,open.channelId);
  assert.equal((await service.energyJson({} as any,'46')).snapshot,null);
  await service.energyReport(config,{type:'sent',stationId:'46',bootId:'esp_viewer',channelId:open.channelId,commandId:frame.commandId,sequence:frame.sequence,ev1:false,ev2:false});
  const view=await service.energyJson({} as any,'46');assert.deepEqual(view.snapshot,frame);assert.equal(view.current,true);
  assert.equal(JSON.stringify(view).includes(config.token),false);
  await service.energyJson({} as any,'46');assert.equal((service as any).stream.sequence,1);
  assert.equal((await service.energyJson({} as any,'13')).snapshot,null);
  allowed=false;await assert.rejects(service.energyJson({} as any,'46'),/Forbidden/);
  allowed=true;(service as any).stream=null;assert.equal((await service.energyJson({} as any,'46')).current,false);
});
function commercialFixture(): GieV3Envelope {
  const g=fixture();g.station_id='13';g.gie_station_id='Commercial_HighAutonomy_V2';
  const d=g.state as any;delete d.station_extension;
  d.provenance.station_id=g.gie_station_id;
  d.numeric_state.battery_soc_pct=60;
  d.numeric_state.evses={EVSE4:{allocated_kw:2},EVSE2:{allocated_kw:6},EVSE3:{allocated_kw:4},EVSE1:{allocated_kw:8}};
  d.flows={solar_to_building_kw:10,solar_to_ev_kw:20,solar_to_battery_kw:5,solar_to_grid_kw:5};
  return g;
}
test('commercial: two display channels, all four EVSEs balanced, single scenario SOC',()=>{
  const g=commercialFixture(),s=energySnapshot(g,13,now);
  assert.equal(s.valid,true);assert.equal(s.evses.EV1.allocatedKw,8);assert.equal(s.evses.EV2.allocatedKw,6);
  assert.equal(s.balance.totalEvKw,20);assert.equal(s.balance.residualKw,0);
  assert.equal(s.battery.socMeanPct,60);assert.equal(s.battery.socBasis,'SINGLE_SCENARIO_SOC');
  assert.equal(s.battery.BAT_01.socPct,null);assert.equal(s.battery.BAT_02.socPct,null);
  assert.equal(energySnapshot(g,46,now).valid,false);
  delete (g.state as any).numeric_state.evses.EVSE4;
  assert.equal(energySnapshot(g,13,now).valid,false);
});
test('commercial stream never borrows Posto sessions or authorizations',async()=>{
  const g=commercialFixture();g.observed_at=new Date().toISOString();
  const service=new LabMaqueteService({charger:{findMany:async()=>[]},labChargeSession:{findMany:async()=>{throw Error('Cross-station session lookup');}}} as any,{} as any,
    {cachedState:(id:number)=>{assert.equal(id,13);return g;},refresh:async(id:number)=>{assert.equal(id,13);return g;}} as any);
  service.heartbeat=async()=>'';
  const config={stationId:46,energyStationId:13,deviceId:'maquete-01',token:'test-only'};
  await assert.rejects(service.openEnergyStream(config,{stationId:'46',bootId:'esp_test'}));
  const open=await service.openEnergyStream(config,{stationId:'13',bootId:'esp_test'});
  const f=await service.energyFrame(config,open.channelId);assert.equal(f.stationId,'13');assert.equal(f.valid,true);
  assert.equal(f.evses.EV1.sessionAuthorized,false);assert.equal(f.evses.EV2.operationalAuthorized,false);
  assert.equal(f.evses.EV1.effectiveRelay,false);
  await service.energyReport(config,{type:'ack',stationId:'13',bootId:'esp_test',channelId:open.channelId,commandId:f.commandId,sequence:f.sequence,accepted:true,ev1:false,ev2:false});
});
test('existing App session indication survives GIE offline; relay stays blocked',async()=>{
  const g=commercialFixture();g.observed_at=new Date().toISOString();
  const db:any={charger:{findMany:async()=>[{id:51,stationId:13,publicCode:'CH-f2f059af5117b95fb970'}]},
    labChargeSession:{findMany:async()=>[{id:'app-session',intentId:'intent',stationId:13,chargerId:51,status:'CHARGING',startedAt:new Date(Date.now()-1000),endedAt:null,autoStopAt:new Date(Date.now()+60000)}]},
    labChargeIntent:{findMany:async()=>[{id:'intent',stationId:13,chargerId:51,status:'AUTHORIZED',expiresAt:new Date(Date.now()+60000)}]}};
  const service=new LabMaqueteService(db,{} as any,{cachedState:()=>g,refresh:async()=>g} as any);service.heartbeat=async()=>'';
  const config={stationId:46,energyStationId:13,deviceId:'maquete-01',token:'test'};
  const open=await service.openEnergyStream(config,{stationId:'13',bootId:'sim_test'});
  const a=await service.energyFrame(config,open.channelId);assert.equal(a.evses.EV1.chargingRequested,true);assert.equal(a.evses.EV1.effectiveRelay,false);
  assert.equal(a.evses.EV2.chargingRequested,false,'Allocation alone cannot stand for a session');
  g.online=false;const b=await service.energyFrame(config,open.channelId);assert.equal(b.evses.EV1.chargingRequested,true);assert.equal(b.evses.EV1.effectiveRelay,false);
});
function fixture(): GieV3Envelope {
  return {station_id:'46',gie_station_id:'DEMO_POSTO_24H_001',generation:'g1',revision:1,online:true,
    observed_at:new Date(now).toISOString(),mode:'NORMAL',source:'SIMULATED',physical_dispatch:false,hardware_commands_sent:false,health:null,
    state:{timestamp:'2025-10-01T12:00:00-03:00',execution_allowed:true,
      provenance:{origin:'SIMULATED',station_id:'DEMO_POSTO_24H_001'},visual_state:{valid:true,solar_active:true},
      numeric_state:{solar_kw:40,building_kw:10,grid_import_kw:0,grid_export_kw:5,battery_charge_kw:5,battery_discharge_kw:0,ev_served_kw:20},
      load_balancer:{setpoints_kw:{EVSE_02:8,EVSE_01:12}},
      station_extension:{station_id:'DEMO_POSTO_24H_001',physical_dispatch:false,solar_used_kw:40,solar_curtailed_kw:0,
        battery_decisions:{BAT_02:{soc_after:0.7,charge_kw:3,discharge_kw:0},BAT_01:{soc_after:0.5,charge_kw:2,discharge_kw:0}}}}};
}
test('day: export, battery charging, two EVSEs mapped by identity and original scenario date',()=>{
  const s=energySnapshot(fixture(),46,now);assert.equal(s.valid,true);assert.equal(s.balance.residualKw,0);
  assert.equal(s.evses.EV1.allocatedKw,12);assert.equal(s.evses.EV2.allocatedKw,8);
  assert.equal(s.battery.socMeanPct,60);assert.equal(s.battery.BAT_01.socPct,50);
  assert.equal(s.building.lightOn,true);assert.equal(s.solar.ledGpio,null);assert.match(s.scenarioAt!,/^2025/);
  assert.equal(s.balance.modeledLossesKw,null);assert.equal(s.physicalMeasurement,false);
});
test('night: import plus discharge balances building and both vehicles',()=>{
  const g=fixture(),d=g.state as any;Object.assign(d.numeric_state,{solar_kw:0,grid_import_kw:20,grid_export_kw:0,battery_charge_kw:0,battery_discharge_kw:10});
  Object.assign(d.station_extension,{solar_used_kw:0});d.visual_state.solar_active=false;
  const s=energySnapshot(g,46,now);assert.equal(s.valid,true);assert.equal(s.balance.residualKw,0);
});
test('curtailment and explicitly modeled losses are separate from generated solar',()=>{
  const g=fixture(),d=g.state as any;Object.assign(d.numeric_state,{solar_kw:50,losses_kw:2,grid_export_kw:3});d.station_extension.solar_curtailed_kw=10;
  const s=energySnapshot(g,46,now);assert.equal(s.valid,true);assert.equal(s.balance.modeledLossesKw,2);
});
test('missing, invalid, stale, wrong station, offline and unbalanced snapshots fail closed',()=>{
  for(const change of [
    (g:any)=>g.online=false,(g:any)=>g.station_id='47',(g:any)=>g.revision=0,
    (g:any)=>g.observed_at=new Date(now-6001).toISOString(),(g:any)=>g.observed_at=new Date(now+1).toISOString(),
    (g:any)=>g.state.numeric_state.solar_kw=null,(g:any)=>g.state.numeric_state.grid_import_kw=NaN,
    (g:any)=>g.state.numeric_state.building_kw=999,(g:any)=>g.state.station_extension.physical_dispatch=true,
    (g:any)=>g.state.provenance.station_id='other',(g:any)=>g.state.load_balancer.setpoints_kw.EVSE_01=undefined]) {
    const g=fixture();change(g);const s=energySnapshot(g,46,now);assert.equal(s.valid,false);assert.equal(s.evses.EV1.gieAuthorized,false);
    assert.equal(s.building.lightOn,true);
  }
  const g=fixture();(g.state as any).station_extension.battery_decisions.BAT_01.soc_after=null;
  assert.equal(energySnapshot(g,46,now).battery.socMeanPct,null);
});
test('tolerance is numerical only; allocation and revision cannot be replayed',()=>{
  const g=fixture();(g.state as any).numeric_state.building_kw+=0.00001;assert.equal(energySnapshot(g,46,now).valid,true);
  (g.state as any).numeric_state.building_kw+=0.01;assert.equal(energySnapshot(g,46,now).valid,false);
  const order=new EnergyOrderGuard();assert.equal(order.accept('g1',2),true);assert.equal(order.accept('g1',1),false);
  assert.equal(order.accept('g2',1),true);assert.equal(order.accept('g1',3),false);
});
test('each interlock is required; GIE alone can never energize a relay',()=>{
  const flags={valid:true,gieAuthorized:true,sessionAuthorized:true,operationalAuthorized:true,connected:true,electricalSafe:true,hardwareApproved:true};
  assert.equal(effectiveRelay(flags),true);
  for(const k of Object.keys(flags)) assert.equal(effectiveRelay({...flags,[k]:false}),false);
});
test('stream: two sessions, expired authorization, ACK, replay, reconnect and disconnect',async()=>{
  const g=fixture();g.observed_at=new Date().toISOString();
  let expired=false;
  const db:any={labChargeSession:{findMany:async()=>expired?[]:[{id:'s1',evse:'EV1',chargerId:76,autoStopAt:new Date(Date.now()+10000)},{id:'s2',evse:'EV2',chargerId:77,autoStopAt:new Date(Date.now()+10000)}]},
    labDeviceCommand:{findMany:async()=>[{id:'a1',requestId:'s1',evse:'EV1'},{id:'a2',requestId:'s2',evse:'EV2'}]}};
  const service=new LabMaqueteService(db,{} as any,{cachedState:()=>g,refresh:async()=>g} as any);
  service.heartbeat=async()=>'';
  const config={stationId:46,deviceId:'maquete-01',token:'test-only'};
  const open=await service.openEnergyStream(config,{stationId:'46',bootId:'sim_test'});
  const frame=await service.energyFrame(config,open.channelId);
  assert.equal(frame.evses.EV1.sessionAuthorized,true);assert.equal(frame.evses.EV2.operationalAuthorized,true);
  assert.equal(frame.evses.EV1.effectiveRelay,false);assert.equal(frame.hardwareApproved,false);
  const report={type:'ack',stationId:'46',bootId:'sim_test',channelId:open.channelId,commandId:frame.commandId,sequence:frame.sequence,accepted:true,ev1:false,ev2:false};
  await service.energyReport(config,report);assert.deepEqual(await service.energyReport(config,report),{duplicate:true});
  expired=true;const next=await service.energyFrame(config,open.channelId);assert.equal(next.evses.EV1.sessionAuthorized,false);
  await assert.rejects(service.energyReport(config,report),/ACK/);
  await service.openEnergyStream(config,{stationId:'46',bootId:'sim_new'});
  await assert.rejects(service.energyFrame(config,open.channelId),/Stream/);
});
test('expired ACK, wrong boot, GPIO active and lost heartbeat are rejected',async()=>{
  const service=new LabMaqueteService({labChargeSession:{findMany:async()=>[]}} as any,{} as any,
    {cachedState:()=>null,refresh:async()=>null} as any);
  service.heartbeat=async()=>'';
  const config={stationId:46,deviceId:'maquete-01',token:'test-only'};
  const open=await service.openEnergyStream(config,{stationId:'46',bootId:'esp_serial'});
  const frame=await service.energyFrame(config,open.channelId);assert.equal(frame.valid,false);
  const report={type:'ack',stationId:'46',bootId:'esp_serial',channelId:open.channelId,
    commandId:frame.commandId,sequence:frame.sequence,accepted:false,ev1:false,ev2:false};
  await assert.rejects(service.energyReport(config,{...report,bootId:'esp_wrong'}),/inválido/);
  (service as any).stream.latest.expires=Date.now()-1;
  await assert.rejects(service.energyReport(config,report),/ACK/);
  await assert.rejects(service.energyReport(config,{...report,type:'heartbeat',ev1:true}),/Relés/);
  await service.openEnergyStream(config,{stationId:'46',bootId:'esp_again'});
  (service as any).stream.seenAt=Date.now()-6001;
  await assert.rejects(service.energyFrame(config,(service as any).stream.id),/Stream/);
});

test('EV1/EV2 START, hold across all modes, STOP and reconnect keep energy separate',async()=>{
  const g=commercialFixture();g.observed_at=new Date().toISOString();
  let active:number[]=[];
  const db:any={charger:{findMany:async()=>[
    {id:51,stationId:13,publicCode:'CH-f2f059af5117b95fb970'},
    {id:49,stationId:13,publicCode:'CH-26f5af4e137bbe735ed5'}]},
    labChargeSession:{findMany:async()=>active.map(id=>({id:'s'+id,intentId:'i'+id,stationId:13,chargerId:id,status:'CHARGING',startedAt:new Date(Date.now()-1000),endedAt:null,autoStopAt:new Date(Date.now()+60000)}))},
    labChargeIntent:{findMany:async()=>active.map(id=>({id:'i'+id,stationId:13,chargerId:id,status:'AUTHORIZED',expiresAt:new Date(Date.now()+60000)}))}};
  const service=new LabMaqueteService(db,{} as any,{cachedState:()=>g,refresh:async()=>g} as any);service.heartbeat=async()=>'';
  const config={stationId:46,energyStationId:13,deviceId:'maquete-01',token:'test'};
  let open=await service.openEnergyStream(config,{stationId:'13',bootId:'sim_1'});
  const original=JSON.stringify(g.state);
  for(active of [[],[51],[49],[51,49],[]]) {
    for(const mode of ['NORMAL','PRESENTATION','SIMULATION','MANUAL_DEMO']) {
      g.mode=mode;
      for(let repeat=0;repeat<3;repeat++) {
        const f=await service.energyFrame(config,open.channelId);
        assert.equal(f.evses.EV1.chargingRequested,active.includes(51));
        assert.equal(f.evses.EV2.chargingRequested,active.includes(49));
        assert.equal(f.evses.EV1.effectiveRelay,false);assert.equal(f.evses.EV2.effectiveRelay,false);
        assert.equal(f.balance.residualKw,0);assert.equal(JSON.stringify(g.state),original);
      }
    }
  }
  active=[51,49];const previous=open;
  await service.energyReport(config,{type:'disconnect',stationId:'13',bootId:'sim_1',channelId:open.channelId,ev1:false,ev2:false});
  await assert.rejects(service.energyFrame(config,previous.channelId));
  open=await service.openEnergyStream(config,{stationId:'13',bootId:'sim_2'});
  const resumed=await service.energyFrame(config,open.channelId);
  assert.equal(resumed.evses.EV1.sessionId,'s51');assert.equal(resumed.evses.EV2.sessionId,'s49');
  assert.equal(resumed.evses.EV1.effectiveRelay,false);
});
