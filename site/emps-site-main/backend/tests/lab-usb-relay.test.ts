import assert from 'node:assert/strict';
import test from 'node:test';
import { usbRelayApproval, USB_RELAY_CAPABILITY } from '../src/lab-usb-relay-policy';
import { LabMaqueteService } from '../src/lab-maquete.service';

const config={stationId:46,energyStationId:13,deviceId:'maquete-01',token:'unit-test-only'};
const approvedEnv=()=>({NODE_ENV:'development',EMPS_LOCAL_LEGACY_INTEGRATION:'true',EMPS_REMOTE_DEVELOPMENT:'false',
  EMPS_PHYSICAL_COMMANDS_ENABLED:'false',EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED:'false',PAYMENT_PROVIDER:'sandbox',
  HOST:'127.0.0.1',DEMO_HISTORY_TEST_DATABASE:'emps_integration_test',
  DATABASE_URL:'mysql://emps_integration_app:unit-test@127.0.0.1:3308/emps_integration_test',
  OCPP_GATEWAY_URL:'',OCPP_GATEWAY_TOKEN:'',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',
  EMPS_MAQUETE_USB_HARDWARE_APPROVED:'true',EMPS_MAQUETE_USB_ELECTRICAL_SAFE:'true',
  EMPS_MAQUETE_USB_RELAY_ACTIVE_LEVEL:'LOW',EMPS_MAQUETE_USB_APPROVED_UNTIL:new Date(Date.now()+3600000).toISOString()});

test('USB approval is local, device/station/capability bound, expires and never enables production payments/OCPP',()=>{
 const env=approvedEnv();
 assert.equal(usbRelayApproval(config,true,Date.now(),env,'LOW').mode,'USB_RELAY_TEST');
 for(const change of [
  {NODE_ENV:'production'},{DATABASE_URL:env.DATABASE_URL.replace('3308','3306')},
  {DATABASE_URL:env.DATABASE_URL.replace('3308','3307')},{EMPS_PHYSICAL_COMMANDS_ENABLED:'true'},
  {EMPS_MAQUETE_USB_HARDWARE_APPROVED:'false'},{EMPS_MAQUETE_USB_ELECTRICAL_SAFE:'false'},
  {EMPS_MAQUETE_USB_RELAY_ACTIVE_LEVEL:'HIGH'},{EMPS_MAQUETE_USB_APPROVED_UNTIL:'invalid'},
  {EMPS_MAQUETE_USB_APPROVED_UNTIL:new Date(Date.now()-1).toISOString()},
  {EMPS_MAQUETE_USB_APPROVED_UNTIL:new Date(Date.now()+9*3600000).toISOString()},
 ]) assert.equal(usbRelayApproval(config,true,Date.now(),{...env,...change},'LOW').hardwareApproved,false);
 assert.equal(usbRelayApproval(config,false,Date.now(),env,'LOW').electricalSafe,false);
 assert.equal(usbRelayApproval({...config,deviceId:'another'},true,Date.now(),env,'LOW').hardwareApproved,false);
 assert.equal(usbRelayApproval({...config,energyStationId:46},true,Date.now(),env,'LOW').hardwareApproved,false);
 assert.equal(usbRelayApproval(config,true,Date.now(),env).hardwareApproved,false,'old firmware without polarity is not approved');
 const high={...env,EMPS_MAQUETE_USB_RELAY_ACTIVE_LEVEL:'HIGH'};
 assert.equal(usbRelayApproval(config,true,Date.now(),high,'HIGH').hardwareApproved,true);
 assert.equal(usbRelayApproval(config,true,Date.now(),high,'LOW').hardwareApproved,false);
 assert.equal(usbRelayApproval(config,true,Date.now(),high).hardwareApproved,false);
 assert.equal(usbRelayApproval(config,true,Date.now(),env,'HIGH').hardwareApproved,false);
});

for(const activeLevel of ['LOW','HIGH'])test(`USB ${activeLevel} stream: START both, hold, STOP independently, scenes, expired permission and reconnect fail safe`,async()=>{
 const env={...approvedEnv(),EMPS_MAQUETE_USB_RELAY_ACTIVE_LEVEL:activeLevel};const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
 Object.assign(process.env,env);
 try {
  let active=[51,49], mode='CHARGER_DEMO', online=true;
  const sessions=()=>active.map(chargerId=>({id:`s${chargerId}`,intentId:`i${chargerId}`,stationId:13,chargerId,
   status:'CHARGING',startedAt:new Date(Date.now()-10000),endedAt:null,autoStopAt:new Date(Date.now()+60000),simulatedPowerKw:5}));
  const db:any={charger:{findMany:async()=>[{id:51,stationId:13,publicCode:'CH-f2f059af5117b95fb970'},
   {id:49,stationId:13,publicCode:'CH-26f5af4e137bbe735ed5'}]},labChargeSession:{findMany:async()=>sessions()},
   labChargeIntent:{findMany:async()=>active.map(chargerId=>({id:`i${chargerId}`,stationId:13,chargerId,status:'AUTHORIZED',expiresAt:new Date(Date.now()+60000)}))}};
  const gie=()=>({station_id:'13',gie_station_id:'Commercial_HighAutonomy_V2',generation:'g1',revision:1,
   online,mode,observed_at:new Date().toISOString(),source:'SIMULATED',physical_dispatch:false,hardware_commands_sent:false,
   state:{timestamp:'2026-07-15 09:00:00',execution_allowed:true,visual_state:{valid:true},
    provenance:{origin:'SIMULATED',station_id:'Commercial_HighAutonomy_V2'},
    numeric_state:{solar_kw:40,building_kw:10,grid_import_kw:0,grid_export_kw:20,battery_charge_kw:0,battery_discharge_kw:0,
     ev_served_kw:10,evses:{EVSE1:{allocated_kw:5},EVSE2:{allocated_kw:5},EVSE3:{allocated_kw:0},EVSE4:{allocated_kw:0}}},
    flows:{solar_to_building_kw:10,solar_to_ev_kw:10,solar_to_battery_kw:0,solar_to_grid_kw:20}}});
  const service=new LabMaqueteService(db,{} as any,{cachedState:gie,refresh:async()=>gie()} as any);
  service.heartbeat=async()=>'';
  const old=await service.openEnergyStream(config,{stationId:'13',bootId:'esp_old'});
  assert.equal(old.mode,'SERIAL_ONLY');
  assert.equal((await service.energyFrame(config,old.channelId)).evses.EV1.effectiveRelay,false);
  const missing=await service.openEnergyStream(config,{stationId:'13',bootId:'esp_missing',relayCapability:USB_RELAY_CAPABILITY});
  assert.equal(missing.mode,'SERIAL_ONLY');
  const mismatch=await service.openEnergyStream(config,{stationId:'13',bootId:'esp_mismatch',relayCapability:USB_RELAY_CAPABILITY,relayActiveLevel:activeLevel==='HIGH'?'LOW':'HIGH'});
  assert.equal(mismatch.mode,'SERIAL_ONLY');
  const open=await service.openEnergyStream(config,{stationId:'13',bootId:'esp_usb',relayCapability:USB_RELAY_CAPABILITY,relayActiveLevel:activeLevel});
  assert.equal(open.mode,'USB_RELAY_TEST');
  await assert.rejects(service.energyFrame(config,old.channelId),/Stream/);
  const report=(f:any,ev1:boolean,ev2:boolean)=>({type:'ack',stationId:'13',bootId:'esp_usb',channelId:open.channelId,
    commandId:f.commandId,sequence:f.sequence,accepted:true,ev1,ev2});
  const both=await service.energyFrame(config,open.channelId);
  assert.equal(both.valid,true);assert.equal(both.evses.EV1.effectiveRelay,true);assert.equal(both.evses.EV2.effectiveRelay,true);
  assert.equal(both.relayApproval.activeLevel,activeLevel);assert.equal(both.relayApproval.polarityMatched,true);
  assert.equal(both.physicalMeasurement,false);
  await service.energyReport(config,report(both,true,true));
  assert.equal((service as any).stream.ack.ev1,true);
  const hold=await service.energyFrame(config,open.channelId);
  assert.equal(hold.evses.EV1.effectiveRelay,true);assert.equal(hold.evses.EV2.effectiveRelay,true);
  active=[49];const stop1=await service.energyFrame(config,open.channelId);
  assert.equal(stop1.evses.EV1.effectiveRelay,false);assert.equal(stop1.evses.EV2.effectiveRelay,true);
  // In-flight heartbeat from the previous frame must not disconnect the other EV.
  await service.energyReport(config,{...report(hold,true,true),type:'heartbeat'});
  await service.energyReport(config,report(stop1,false,true));
  active=[51];const stop2=await service.energyFrame(config,open.channelId);
  assert.equal(stop2.evses.EV1.effectiveRelay,true);assert.equal(stop2.evses.EV2.effectiveRelay,false);
  mode='PRESENTATION';const scene=await service.energyFrame(config,open.channelId);
  assert.equal(scene.evses.EV1.effectiveRelay,false);assert.equal(scene.evses.EV2.effectiveRelay,false);
  mode='CHARGER_DEMO';online=false;
  assert.equal((await service.energyFrame(config,open.channelId)).evses.EV1.effectiveRelay,false);
  online=true;active=[];
  assert.equal((await service.energyFrame(config,open.channelId)).evses.EV1.effectiveRelay,false);
  process.env.EMPS_MAQUETE_USB_APPROVED_UNTIL=new Date(Date.now()-1).toISOString();
  const expired=await service.energyFrame(config,open.channelId);assert.equal(expired.mode,'SERIAL_ONLY');
  assert.equal(expired.evses.EV1.effectiveRelay,false);
  await assert.rejects(service.energyReport(config,report(expired,true,false)),/Relés/);
 } finally {for(const key of Object.keys(env)){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
});
