// Local clone + loopback bridge only. No relay START, session, payment, firmware upload or model change.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../site/emps-site-main/backend/package.json',import.meta.url));
const {WebSocket}=require('ws');const {PrismaClient}=require('@prisma/client');
const root=new URL('../../EMPS_BACKUPS/',import.meta.url);
const runtime=JSON.parse(readFileSync(new URL('emps-legacy-integration.runtime.json',root),'utf8'));
const device=JSON.parse(readFileSync(new URL('emps-maquete-lab.runtime.json',root),'utf8'));
const env=Object.fromEntries(readFileSync(new URL('emps-legacy-integration.mysql.env',root),'utf8').trim().split(/\r?\n/).map(l=>{const p=l.indexOf('=');return[l.slice(0,p),l.slice(p+1)];}));
assert.equal(env.MYSQL_DATABASE,'emps_integration_test');assert.equal(device.stationId,46);
const db=new PrismaClient({datasourceUrl:`mysql://${encodeURIComponent(env.MYSQL_USER)}:${encodeURIComponent(env.MYSQL_PASSWORD)}@127.0.0.1:3308/emps_integration_test`});
const counts=async()=>({sessions:await db.chargingSession.count(),payments:await db.payment.count(),intents:await db.paymentIntent.count()});
const before=await counts();let ws;
try {
  const g=await fetch('http://127.0.0.1:8540/v1/stations/DEMO_POSTO_24H_001/cycle',{
    method:'POST',headers:{Authorization:`Bearer ${runtime.gieV3Token}`,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(60000)});
  assert.equal(g.status,200);const cycle=await g.json();assert.equal(cycle.state?.execution_allowed,true);
  const bootId='sim_energy_'+Date.now();
  ws=new WebSocket('ws://127.0.0.1:3012/devices/maquete-01/energy/ws',{headers:{'x-device-token':device.token,'x-station-id':'46'}});
  let channelId;const frames=[];let resolveFrame,rejectFrame;
  const ready=new Promise((res,rej)=>{resolveFrame=res;rejectFrame=rej;});
  const timeout=setTimeout(()=>rejectFrame(Error('No valid GIE snapshot within 20s')),20000);
  ws.on('message',raw=>{
    const m=JSON.parse(raw);
    if(m.type==='welcome')channelId=m.channelId;
    if(m.type==='energy.snapshot'){
      frames.push(m);
      assert.equal(m.evses.EV1.effectiveRelay,false);assert.equal(m.evses.EV2.effectiveRelay,false);
      ws.send(JSON.stringify({type:'ack',channelId,bootId,stationId:'46',commandId:m.commandId,sequence:m.sequence,accepted:m.valid,ev1:false,ev2:false}));
      if(m.valid && frames.filter(x=>x.valid).length>=2)resolveFrame(m);
    }
  });
  ws.on('error',rejectFrame);
  await once(ws,'open');ws.send(JSON.stringify({type:'hello',stationId:'46',bootId}));
  let frame=await ready;clearTimeout(timeout);
  assert.equal(frame.revision,cycle.revision);assert.equal(frame.generation,cycle.generation);
  assert.ok(Math.abs(frame.balance.residualKw)<=frame.balance.toleranceKw);
  const advance=await fetch('http://127.0.0.1:8540/v1/stations/DEMO_POSTO_24H_001/cycle',{
    method:'POST',headers:{Authorization:`Bearer ${runtime.gieV3Token}`,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(60000)});
  assert.equal(advance.status,200);const secondCycle=await advance.json();
  const deadline=Date.now()+15000;
  while(Date.now()<deadline && !frames.some(f=>f.valid && f.revision===secondCycle.revision)) await new Promise(r=>setTimeout(r,100));
  frame=frames.findLast(f=>f.valid && f.revision===secondCycle.revision);
  assert.ok(frame,'Updated GIE revision must arrive on the same WebSocket');assert.equal(frame.stationId,'46');
  await new Promise(r=>setTimeout(r,300));
  const login=await fetch('http://127.0.0.1:3011/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:runtime.adminEmail,password:runtime.adminPassword})});
  assert.equal(login.status,200);const {accessToken}=await login.json();
  const status=await(await fetch('http://127.0.0.1:3011/v2/stations/46/lab-device',{headers:{authorization:'Bearer '+accessToken}})).json();
  assert.equal(status.energyStream.lastAck.commandId,frame.commandId);assert.equal(status.energyStream.lastAck.accepted,true);
  ws.close();await once(ws,'close');
  const after=await counts();assert.deepEqual(after,before);
  mkdirSync(new URL('../reports/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../reports/maquete-energy-local.json',import.meta.url),JSON.stringify({at:new Date().toISOString(),before,after,
    source:'SOFTWARE_SIMULATOR_NO_GPIO',snapshots:frames.length,frame,dashboard:status.energyStream},null,2));
  console.log(JSON.stringify({passed:true,snapshots:frames.length,generation:frame.generation,revision:frame.revision,residualKw:frame.balance.residualKw,before,after,hardwareTested:false}));
} finally {ws?.terminate();await db.$disconnect();}
