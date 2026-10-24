import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {connect} from 'node:net';
import {randomBytes} from 'node:crypto';
import {createMaqueteBridge} from '../maquete-lan-bridge.mjs';
const require=createRequire(new URL('../../site/emps-site-main/backend/package.json',import.meta.url));
const {WebSocket}=require('ws');
const token='test-only-websocket-token-with-more-than-32-chars';
const listen=async s=>{s.listen(0,'127.0.0.1');await once(s,'listening');return s.address().port;};

test('commercial bridge authenticates station 13 and rejects the previous station',async t=>{
  const upstream=createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;
    const body=JSON.parse(text);assert.equal(body.stationId,'13');assert.equal(body.relayCapability,'emps.usb-relay.v1');assert.equal(body.relayActiveLevel,'HIGH');
    res.setHeader('content-type','application/json');res.end(JSON.stringify({channelId:'commercial',stationId:'13',mode:'SERIAL_ONLY'}));});
  const backendPort=await listen(upstream);
  const bridge=createMaqueteBridge({bindIp:'127.0.0.1',deviceIp:'127.0.0.1',token,backendPort,stationId:'13'});
  const port=await listen(bridge);t.after(()=>{bridge.close();upstream.close();});
  const url=`ws://127.0.0.1:${port}/devices/maquete-01/energy/ws`;
  const wrong=new WebSocket(url,{headers:{'x-device-token':token,'x-station-id':'46'}});
  await new Promise(resolve=>wrong.on('error',resolve));
  const ws=new WebSocket(url,{headers:{'x-device-token':token,'x-station-id':'13'}});
  await once(ws,'open');const welcome=once(ws,'message');ws.send(JSON.stringify({type:'hello',stationId:'13',bootId:'esp_test',relayCapability:'emps.usb-relay.v1',relayActiveLevel:'HIGH'}));
  assert.equal(JSON.parse((await welcome)[0]).stationId,'13');ws.close();await once(ws,'close');
});

test('Arduino extra headers must not end HTTP before User-Agent',async t=>{
  const bridge=createMaqueteBridge({bindIp:'127.0.0.1',deviceIp:'127.0.0.1',token});
  const port=await listen(bridge);t.after(()=>bridge.close());
  async function handshake(extraTerminator){
    const socket=connect(port,'127.0.0.1');const chunks=[];
    socket.on('data',chunk=>chunks.push(chunk));socket.on('error',()=>{});
    try {
      await once(socket,'connect');
      socket.write(`GET /devices/maquete-01/energy/ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nX-Device-Token: ${token}\r\nX-Station-Id: 46${extraTerminator ? '\r\n' : ''}\r\nUser-Agent: arduino-WebSocket-Client\r\n\r\n`);
      await new Promise(resolve=>setTimeout(resolve,250));
      const response=Buffer.concat(chunks);
      assert.ok(response.toString().startsWith('HTTP/1.1 101'));
      return response.subarray(response.indexOf('\r\n\r\n')+4);
    } finally {socket.destroy();}
  }
  assert.equal((await handshake(true))[0],0x88,'Premature end makes User-Agent invalid WebSocket data and closes the connection');
  assert.equal((await handshake(false)).length,0,'Correct Arduino handshake remains open');
});
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

test('back-to-back heartbeat and ACK are serialized without dropping the device',async t=>{
  const reports=[];
  const upstream=createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    res.setHeader('content-type','application/json');
    if(req.url.endsWith('/connect'))return res.end(JSON.stringify({channelId:'burst',stationId:'13',mode:'SERIAL_ONLY'}));
    if(req.url.includes('/snapshot?'))return res.end(JSON.stringify({type:'energy.snapshot'}));
    await new Promise(r=>setTimeout(r,80));reports.push(JSON.parse(raw));res.end('{}');
  });
  const backendPort=await listen(upstream);
  const bridge=createMaqueteBridge({bindIp:'127.0.0.1',deviceIp:'127.0.0.1',token,backendPort,stationId:'13'});
  const port=await listen(bridge);t.after(()=>{bridge.close();upstream.close();});
  const ws=new WebSocket(`ws://127.0.0.1:${port}/devices/maquete-01/energy/ws`,{headers:{'x-device-token':token,'x-station-id':'13'}});
  await once(ws,'open');const welcome=once(ws,'message');ws.send(JSON.stringify({type:'hello',stationId:'13',bootId:'burst'}));await welcome;
  for(const type of ['heartbeat','ack'])ws.send(JSON.stringify({type,stationId:'13',bootId:'burst',channelId:'burst',ev1:false,ev2:false}));
  await new Promise(r=>setTimeout(r,400));assert.equal(ws.readyState,WebSocket.OPEN);assert.deepEqual(reports.map(r=>r.type),['heartbeat','ack']);
  ws.close();await once(ws,'close');
});
