import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {createMaqueteBridge} from '../maquete-lan-bridge.mjs';
const require=createRequire(new URL('../../site/emps-site-main/backend/package.json',import.meta.url));
const {WebSocket}=require('ws');
const token='test-only-websocket-token-with-more-than-32-chars';
const listen=async s=>{s.listen(0,'127.0.0.1');await once(s,'listening');return s.address().port;};
test('pure WebSocket authenticates device/station, carries snapshots/ACK and disconnects on lost heartbeat',async t=>{
  const reports=[];let seq=0;
  const upstream=createServer(async(req,res)=>{
    assert.equal(req.headers['x-device-token'],token);
    let body='';for await(const c of req)body+=c;
    res.setHeader('content-type','application/json');
    if(req.url.endsWith('/connect'))res.end(JSON.stringify({channelId:'test-channel',stationId:'46',mode:'SERIAL_ONLY'}));
    else if(req.url.includes('/snapshot?'))res.end(JSON.stringify({type:'energy.snapshot',stationId:'46',sequence:++seq,source:'SIMULATED',valid:true}));
    else {reports.push(JSON.parse(body));res.end('{}');}
  });
  const backendPort=await listen(upstream),bridge=createMaqueteBridge({bindIp:'127.0.0.1',deviceIp:'127.0.0.1',port:3012,backendPort,token});
  const port=await listen(bridge);t.after(()=>{bridge.close();upstream.close();});
  const url=`ws://127.0.0.1:${port}/devices/maquete-01/energy/ws`;
  for(const headers of [{'x-device-token':'bad','x-station-id':'46'},{'x-device-token':token,'x-station-id':'47'}]){
    const denied=new WebSocket(url,{headers});await new Promise(resolve=>{denied.on('error',resolve);});
  }
  const ws=new WebSocket(url,{headers:{'x-device-token':token,'x-station-id':'46'}});await once(ws,'open');
  const welcome=once(ws,'message');ws.send(JSON.stringify({type:'hello',stationId:'46',bootId:'sim_test'}));
  assert.equal(JSON.parse((await welcome)[0]).channelId,'test-channel');
  const snapshot=JSON.parse((await once(ws,'message'))[0]);assert.equal(snapshot.source,'SIMULATED');
  ws.send(JSON.stringify({type:'ack',channelId:'test-channel',bootId:'sim_test',stationId:'46',ev1:false,ev2:false,sequence:1,commandId:'test',accepted:true}));
  await once(ws,'close');assert.ok(reports.some(r=>r.type==='ack'));assert.ok(seq>=1);
});
