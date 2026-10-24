import { createRequire } from 'node:module';
import { timingSafeEqual } from 'node:crypto';
const require = createRequire(new URL('../site/emps-site-main/backend/package.json', import.meta.url));
const { WebSocketServer } = require('ws');
const equal = (a,b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));

/** RFC6455 WebSocket for embedded clients. This is deliberately not Socket.IO. */
export function attachEnergyWebSocket(server, { deviceIp, token, backendPort, stationId = '46' }) {
  if (!['13','46'].includes(stationId)) throw Error('Unsupported energy station');
  const wss = new WebSocketServer({ noServer:true, maxPayload:2048, perMessageDeflate:false });
  let active = null;
  const path = '/devices/maquete-01/energy/ws';
  async function api(suffix, body) {
    const r = await fetch(`http://127.0.0.1:${backendPort}/devices/maquete-01/energy/${suffix}`, {
      method:body === undefined ? 'GET':'POST', redirect:'error', signal:AbortSignal.timeout(2000),
      headers:{'x-device-token':token,'content-type':'application/json'},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
    if(!r.ok) {const error=Error('Upstream rejected');error.backendStatus=r.status;throw error;}
    return r.json();
  }
  server.on('upgrade',(req,socket,head)=>{
    if(req.method !== 'GET' || req.url !== path || req.headers.origin ||
       req.socket.remoteAddress?.replace(/^::ffff:/,'') !== deviceIp ||
       req.headers['x-station-id'] !== stationId || !equal(req.headers['x-device-token'],token)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',ws=>{
    if(active) active.close(4001,'Replaced'); active = ws;
    const connectedAt=Date.now();
    let channel=null, bootId=null, lastSeen=Date.now(), busy=false, receiving=false, closed=false;
    let budget=0, budgetAt=Date.now(), queued=0, inbound=Promise.resolve();
    const stop=(reason='transport')=>{ if(!closed){ closed=true;
      // Fixed diagnostic codes only; never echo payloads, credentials or upstream bodies.
      process.stdout.write(JSON.stringify({event:'maquete.energy.disconnect',stationId,reason,uptimeMs:Date.now()-connectedAt})+'\n');
      ws.close(4000,'Reconnect required'); } };
    const upstreamReason=error=>Number.isInteger(error?.backendStatus)?`backend_http_${error.backendStatus}`:'backend_unavailable';
    ws.on('error',()=>stop('socket_error'));
    ws.on('message',(raw,binary)=>{
      if(closed || binary || queued>=8) return stop('inbound_overflow');
      if(Date.now()-budgetAt>1000){budget=0;budgetAt=Date.now();}
      if(++budget>8) return stop('inbound_rate');
      queued++;
      inbound=inbound.then(async()=>{
      if(closed) { queued--; return; }
      receiving=true;
      try {
        const m=JSON.parse(raw.toString());
        if(!channel){
          if(m.type!=='hello' || m.stationId!==stationId || typeof m.bootId!=='string') throw Error('Hello');
          const result=await api('connect',{stationId,bootId:m.bootId,relayCapability:m.relayCapability,relayActiveLevel:m.relayActiveLevel});
          if(closed || active!==ws) throw Error('Replaced');
          channel=result.channelId;bootId=m.bootId;
          ws.send(JSON.stringify({type:'welcome',...result}));
        } else {
          if(!['heartbeat','ack'].includes(m.type) || m.channelId!==channel || m.bootId!==bootId || m.stationId!==stationId) throw Error('Identity');
          await api('report',m);
        }
        lastSeen=Date.now();
      } catch(error) { stop(Number.isInteger(error?.backendStatus)?upstreamReason(error):'invalid_or_unavailable_report'); } finally {receiving=false;queued--;}
      });
    });
    const timer=setInterval(async()=>{
      if(closed || Date.now()-lastSeen>5500) return stop('device_heartbeat_timeout');
      if(!channel || busy || receiving || queued) return;
      busy=true;
      try {
        const snapshot=await api(`snapshot?channelId=${encodeURIComponent(channel)}`);
        if(!closed && ws.readyState===1){
          if(ws.bufferedAmount>16384) return stop('output_backpressure');
          ws.send(JSON.stringify(snapshot),error=>{
            if(!error) void api('report',{type:'sent',channelId:channel,bootId,stationId,
              commandId:snapshot.commandId,sequence:snapshot.sequence,ev1:false,ev2:false}).catch(()=>{});
          });
        }
      } catch(error) { stop(upstreamReason(error)); } finally {busy=false;}
    },1000);
    timer.unref();
    ws.on('close',()=>{
      closed=true;clearInterval(timer);if(active===ws)active=null;
      if(channel) void api('report',{type:'disconnect',channelId:channel,bootId,stationId,ev1:false,ev2:false}).catch(()=>{});
    });
  });
  server.on('close',()=>{for(const ws of wss.clients)ws.terminate();wss.close();});
  return wss;
}
