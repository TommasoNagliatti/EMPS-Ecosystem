// Explicit local clone only; existing App SANDBOX endpoints, no external payments.
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {PrismaClient}=require('../site/emps-site-main/backend/node_modules/@prisma/client');
const {LabMaqueteService}=require('../site/emps-site-main/backend/dist/lab-maquete.service');
const root='C:/goodwill_ai/EMPS_BACKUPS/';
const runtime=JSON.parse(fs.readFileSync(root+'emps-legacy-integration.runtime.json','utf8'));
const env=Object.fromEntries(fs.readFileSync(root+'emps-legacy-integration.mysql.env','utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
assert.equal(env.MYSQL_DATABASE,'emps_integration_test');assert.equal(env.MYSQL_USER,'emps_integration_app');
const db=new PrismaClient({datasourceUrl:`mysql://${env.MYSQL_USER}:${encodeURIComponent(env.MYSQL_PASSWORD)}@127.0.0.1:3308/emps_integration_test`});
let token;const started=[];
async function call(path,body){const r=await fetch('http://127.0.0.1:3011'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...(body?{'Idempotency-Key':randomUUID()}:{})},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.ok(r.ok,`${path}: ${r.status}`);return d;}
const counts=async()=>({sessions:await db.chargingSession.count(),payments:await db.payment.count(),intents:await db.paymentIntent.count()});
(async()=>{try{
  const before=await counts();token=(await call('/auth/login',{email:runtime.adminEmail,password:runtime.adminPassword})).accessToken;
  const native=await(await fetch('http://127.0.0.1:8540/v1/stations/Commercial_HighAutonomy_V2/state',{headers:{authorization:'Bearer '+runtime.gieV3Token}})).json();
  const envelope=()=>({station_id:'13',gie_station_id:native.station_id,generation:native.generation,revision:native.revision,online:true,observed_at:new Date().toISOString(),state:native.state,source:'SIMULATED',physical_dispatch:false,hardware_commands_sent:false});
  // Isolated service instance inspects the real session rows without replacing the real ESP32 connection.
  const service=new LabMaqueteService(db,{}, {cachedState:()=>envelope(),refresh:async()=>envelope()});service.heartbeat=async()=>'';
  const config={stationId:46,energyStationId:13,deviceId:'maquete-01',token:'test-instance-only'};
  const channel=await service.openEnergyStream(config,{stationId:'13',bootId:'sim_app_test'});
  const evidence=[];
  for(const [ev,code] of [['EV1','CH-f2f059af5117b95fb970'],['EV2','CH-26f5af4e137bbe735ed5']]){
    const c=await db.charger.findUniqueOrThrow({where:{publicCode:code}});assert.equal(c.stationId,13);
    assert.equal(await db.labChargeSession.count({where:{chargerId:c.id,status:{in:['STARTING','CHARGING','FINISHING']}}}),0,'User session active: abort');
    const qr=await db.qrBinding.findFirstOrThrow({where:{chargerId:c.id,isActive:true,revokedAt:null}});
    const resolve=await call('/mobile/v1/qr/'+qr.publicToken);assert.equal(resolve.mode,'SANDBOX');
    const intent=await call('/mobile/v1/payment-intents',{chargerId:String(c.id),method:'pix',spendingLimit:20});
    const session=await call('/mobile/v1/charging-sessions/start',{qrBindingId:String(qr.id),paymentIntentId:intent.id,spendingLimit:20});started.push(session.id);
    const frame=await service.energyFrame(config,channel.channelId);assert.equal(frame.evses[ev].sessionId,session.id);assert.equal(frame.evses[ev].chargerId,c.id);
    assert.equal(frame.evses[ev].sessionAuthorized,true);assert.equal(frame.evses[ev].operationalAuthorized,true);assert.equal(frame.evses[ev].effectiveRelay,false);
    assert.equal(frame.evses[ev].chargingRequested,true);
    evidence.push({ev,chargerId:c.id,sessionId:session.id,chargingRequested:frame.evses[ev].chargingRequested});
  }
  const both=await service.energyFrame(config,channel.channelId);assert.equal(both.evses.EV1.sessionAuthorized,true);assert.equal(both.evses.EV2.sessionAuthorized,true);
  for(const id of [...started]){const stopped=await call('/mobile/v1/charging-sessions/'+id+'/stop',{});assert.equal(stopped.receipt.sandbox,true);started.splice(started.indexOf(id),1);}
  const off=await service.energyFrame(config,channel.channelId);assert.equal(off.evses.EV1.chargingRequested,false);assert.equal(off.evses.EV2.chargingRequested,false);
  assert.deepEqual(await counts(),before);const result={passed:true,hardwareTested:false,evidence,operationalUnchanged:before};
  fs.writeFileSync(root+'commercial-maquete-session-test.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{for(const id of started)await call('/mobile/v1/charging-sessions/'+id+'/stop',{}).catch(()=>console.error('Test session requires cleanup: '+id));await db.$disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1});
