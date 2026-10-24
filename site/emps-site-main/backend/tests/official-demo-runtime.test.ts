import assert from 'node:assert/strict';
import test from 'node:test';
import { APPROVED_DATA_SHA, APPROVED_SCHEMA_SHA, OFFICIAL_DATABASE_UUID, demoCardDatabaseScope,
  demoIntegrationActive, demoManagerAccess, demoStaffNetworkScope, initializeOfficialDemoRuntime,
  officialDemoRuntimeActive } from '../src/official-demo-runtime';
import { chargingSandboxEnabled } from '../src/charging-sandbox.service';
import { localLegacyIntegrationActive } from '../src/local-legacy-integration';
import { labConfig } from '../src/lab-maquete-domain';
import { usbRelayApproval } from '../src/lab-usb-relay-policy';

const env = (): NodeJS.ProcessEnv => ({NODE_ENV:'production',DATABASE_URL:'mysql://emps_app:test-only@127.0.0.1:3306/emps_db',
  EMPS_OFFICIAL_DEMO_RUNTIME:'OFFICIAL',EMPS_OFFICIAL_SCHEMA_SHA256:APPROVED_SCHEMA_SHA,EMPS_OFFICIAL_DATA_SHA256:APPROVED_DATA_SHA,
  EMPS_MAQUETE_STATION_ID:'46',EMPS_MAQUETE_DEVICE_ID:'maquete-01',EMPS_CHARGING_SANDBOX_ENABLED:'true',
  EMPS_MAQUETE_LAB_ENABLED:'true',EMPS_MAQUETE_GIE_STATION_ID:'13',EMPS_MAQUETE_DEVICE_TOKEN:'unit-test-device-token-32-characters-long',
  PAYMENT_PROVIDER:'stripe',HOST:'0.0.0.0'});
function database() {
  const tx:any = {
    $queryRaw:async()=>[{databaseName:'emps_db',serverUuid:OFFICIAL_DATABASE_UUID,version:'8.0.46'}],
    station:{findMany:async()=>[
      {id:13,adminId:64,name:'Prédio Comercial',visibility:'PUBLIC'},
      {id:39,adminId:105,name:'Shopping Frei Caneca'},
      ...[46,47].map(id=>({id,adminId:105,visibility:'PRIVATE',reviewState:'DRAFT',guestAllowed:false}))]},
    gieStationBinding:{findMany:async()=>[
      {stationId:13,gieStationId:'Commercial_HighAutonomy_V2',profile:'COMMERCIAL',origin:'SIMULATED'},
      {stationId:46,gieStationId:'DEMO_POSTO_24H_001',profile:'POSTO',origin:'SIMULATED'},
      {stationId:47,gieStationId:'DEMO_CASA_001',profile:'CASA',origin:'SIMULATED'}]},
    charger:{findMany:async()=>[
      {id:49,stationId:13,publicCode:'CH-26f5af4e137bbe735ed5'},
      {id:50,stationId:13},{id:51,stationId:13,publicCode:'CH-f2f059af5117b95fb970'},
      ...[[76,46,'SIMULATED_DEMO_POSTO_24H_001_EVSE_01'],[77,46,'SIMULATED_DEMO_POSTO_24H_001_EVSE_02'],
        [78,47,'SIMULATED_DEMO_CASA_001_EVSE_01']].map(([id,stationId,ocppIdentity])=>({id,stationId,ocppIdentity,administrativeStatus:'PENDING'}))]},
    labDevice:{findUnique:async()=>({stationId:46})},
    stationStaff:{findMany:async()=>[39,46,47].map(stationId=>({stationId,staffRole:'MANAGER'}))},
    demoImportBatch:{findMany:async()=>[
      ...[13,39].map(stationId=>({stationId,origin:'SIMULATED',datasetSha256:'87de2c756128656571a63b48a38082226f4c005e1fe9525ea52b96b67b168b49'})),
      {stationId:46,origin:'SIMULATED',datasetSha256:'1f1a5e480ba83864ae7bfc5d58bd5bbe6e165306f0cafea6dd6f06e19280da6c'},
      {stationId:47,origin:'SIMULATED',datasetSha256:'df9e559f72002bbd2ba1179811eb8219d8027f1313c9b7922e03290ee2866e16'}]},
  };
  return {tx,db:{$transaction:async(fn:any)=>fn(tx)} as any};
}
test('official flag alone never enables lab, charging or manager exceptions; failed re-admission revokes readiness',async()=>{
  const e=env(), {db}=database();
  assert.equal(officialDemoRuntimeActive(e),false);
  assert.equal(chargingSandboxEnabled(e),false);
  await initializeOfficialDemoRuntime(db,e);
  assert.equal(officialDemoRuntimeActive(e),true);
  assert.equal(demoIntegrationActive(e),true);
  assert.equal(localLegacyIntegrationActive(e),false);
  assert.equal(chargingSandboxEnabled(e),true);
  assert.equal(demoCardDatabaseScope(e),'emps_db');
  assert.equal(labConfig(e)?.energyStationId,13);
  for(const id of [13,39,46,47])assert.equal(demoManagerAccess(id,e),true);
  assert.equal(demoManagerAccess(11,e),false);
  assert.deepEqual(demoStaffNetworkScope(64,e),{OR:[{adminId:64},{id:{in:[13,39,46,47]},staff:{some:{userId:64,staffRole:{in:['OWNER','MANAGER']}}}}]});
  assert.equal(officialDemoRuntimeActive({...e,DATABASE_URL:e.DATABASE_URL!.replace('3306','3307')}),false);
  const {db:wrong,tx}=database();tx.$queryRaw=async()=>[{databaseName:'emps_db',serverUuid:'other',version:'8.0.46'}];
  await assert.rejects(initializeOfficialDemoRuntime(wrong,e),/identity mismatch/);
  assert.equal(chargingSandboxEnabled(e),false);
});
test('startup rejects mismatched station ownership, physical charger, provenance and GIE profile',async()=>{
  for(const [delegate,change]of [
    ['station',(rows:any[])=>rows.map(r=>r.id===46?{...r,adminId:64}:r)],
    ['station',(rows:any[])=>rows.map(r=>r.id===47?{...r,visibility:'PUBLIC'}:r)],
    ['charger',(rows:any[])=>rows.map(r=>r.id===51?{...r,stationId:46}:r)],
    ['charger',(rows:any[])=>rows.map(r=>r.id===78?{...r,administrativeStatus:'APPROVED'}:r)],
    ['gieStationBinding',(rows:any[])=>[...rows,{stationId:39,profile:'COMMERCIAL',origin:'SIMULATED'}]],
    ['demoImportBatch',(rows:any[])=>rows.map(r=>r.stationId===47?{...r,datasetSha256:'changed'}:r)],
  ] as const){
    const {db,tx}=database(),read=tx[delegate].findMany;tx[delegate].findMany=async()=>change(await read());
    await assert.rejects(initializeOfficialDemoRuntime(db,env()),/mismatch/);
    assert.equal(demoIntegrationActive(env()),false);
  }
  for(const changed of [{EMPS_OFFICIAL_DATA_SHA256:'unreviewed'},{OCPP_GATEWAY_URL:'http://physical'},
    {DATABASE_URL:'mysql://root:never@127.0.0.1:3306/emps_db'},{EMPS_LOCAL_LEGACY_INTEGRATION:'true'}])
    await assert.rejects(initializeOfficialDemoRuntime(database().db,{...env(),...changed}));
});
test('official USB stays blocked without separately scoped, unexpired electrical approval',async()=>{
  const e={...env(),EMPS_MAQUETE_USB_HARDWARE_APPROVED:'true',EMPS_MAQUETE_USB_ELECTRICAL_SAFE:'true',
    EMPS_MAQUETE_USB_RELAY_ACTIVE_LEVEL:'HIGH',EMPS_MAQUETE_USB_APPROVED_UNTIL:new Date(Date.now()+3600000).toISOString()};
  await initializeOfficialDemoRuntime(database().db,e);
  const config=labConfig(e)!;
  assert.equal(usbRelayApproval(config,true,Date.now(),e,'HIGH').hardwareApproved,false);
  const scoped={...e,EMPS_OFFICIAL_USB_RELAY_SCOPE:'LOW_VOLTAGE_USB_ONLY'};
  await initializeOfficialDemoRuntime(database().db,scoped);
  assert.equal(usbRelayApproval(config,true,Date.now(),scoped,'HIGH').hardwareApproved,true);
  assert.equal(usbRelayApproval(config,true,Date.now()+7200000,scoped,'HIGH').hardwareApproved,false);
  assert.equal(usbRelayApproval(config,true,Date.now(),scoped,'LOW').hardwareApproved,false);
  assert.equal(usbRelayApproval(config,false,Date.now(),scoped,'HIGH').hardwareApproved,false);
  await initializeOfficialDemoRuntime(database().db,{EMPS_OFFICIAL_DEMO_RUNTIME:'OFF'});
});
