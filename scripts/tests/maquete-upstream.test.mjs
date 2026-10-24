import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { maqueteUpstream } from '../maquete-upstream.mjs';
import { createMaqueteBridge } from '../maquete-lan-bridge.mjs';
const require=createRequire(new URL('../../site/emps-site-main/backend/package.json',import.meta.url));
const {WebSocket}=require('ws');
const token='unit-test-lan-device-credential-123456789';
const upstreamToken='unit-test-cloud-device-credential-123456789';
const options={token,upstreamToken,backendUrl:'https://preview.emps-charge.tech/api',remotePreview:true};

test('local default stays local; cloud requires exact HTTPS origin, opt-in and separate credential',()=>{
 assert.deepEqual(maqueteUpstream({token,backendPort:3011}),{base:'http://127.0.0.1:3011',token,remote:false});
 assert.equal(maqueteUpstream(options).base,'https://preview.emps-charge.tech/api');
 for(const patch of [{remotePreview:false},{upstreamToken:token},{upstreamToken:'short'},
  {backendUrl:'http://preview.emps-charge.tech/api'},{backendUrl:'https://emps-charge.tech/api'},
  {backendUrl:'https://preview.emps-charge.tech.evil.invalid/api'},
  {backendUrl:'https://user@preview.emps-charge.tech/api'},{backendUrl:'https://preview.emps-charge.tech:8443/api'},
  {backendUrl:'https://preview.emps-charge.tech/other'},{backendUrl:'https://preview.emps-charge.tech/api?token=no'},
  {backendUrl:'https://preview.emps-charge.tech/api#fragment'},{backendUrl:undefined}])
  assert.throws(()=>maqueteUpstream({...options,...patch}));
 assert.throws(()=>createMaqueteBridge({bindIp:'127.0.0.1',deviceIp:'127.0.0.1',stationId:'46',...options}));
});

test('LAN WS preserves snapshots and ACK over HTTPS, never sends LAN credential or falls back locally',async t=>{
 const original=globalThis.fetch;const seen=[];let offline=false;
 globalThis.fetch=async(url,init)=>{
  assert.ok(String(url).startsWith('https://preview.emps-charge.tech/api/devices/maquete-01/energy/'));
  assert.equal(init.headers['x-device-token'],upstreamToken);assert.equal(init.redirect,'error');
  const body=init.body?JSON.parse(init.body):null;seen.push({url:String(url),body});
  if(offline)return new Response('{}',{status:503});
  const value=String(url).endsWith('/connect')?{channelId:'cloud-channel',stationId:'13',mode:'SERIAL_ONLY'}:
    String(url).includes('/snapshot?')?{type:'energy.snapshot',stationId:'13',sequence:1,commandId:'cloud-command',valid:true}:{};
  return Response.json(value);
 };
 const bridge=createMaqueteBridge({bindIp:'127.0.0.1',deviceIp:'127.0.0.1',stationId:'13',...options});
 bridge.listen(0,'127.0.0.1');await once(bridge,'listening');
 t.after(()=>{bridge.close();globalThis.fetch=original;});
 const ws=new WebSocket(`ws://127.0.0.1:${bridge.address().port}/devices/maquete-01/energy/ws`,{headers:{'x-device-token':token,'x-station-id':'13'}});
 t.after(()=>ws.terminate());await once(ws,'open');
 let reply=once(ws,'message');ws.send(JSON.stringify({type:'hello',stationId:'13',bootId:'sim_cloud'}));
 assert.equal(JSON.parse((await reply)[0]).channelId,'cloud-channel');
 const snapshot=JSON.parse((await once(ws,'message'))[0]);assert.equal(snapshot.type,'energy.snapshot');
 ws.send(JSON.stringify({type:'ack',stationId:'13',bootId:'sim_cloud',channelId:'cloud-channel',commandId:'cloud-command',sequence:1,ev1:false,ev2:false,accepted:true}));
 await new Promise(r=>setTimeout(r,80));assert.ok(seen.some(x=>x.body?.type==='ack'));
 offline=true;await once(ws,'close');assert.ok(seen.length>=3);
});
