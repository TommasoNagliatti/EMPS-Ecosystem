// Software-only client. Never claims to measure energy or energize GPIOs.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../site/emps-site-main/backend/package.json',import.meta.url));
const {WebSocket}=require('ws');
const config=JSON.parse(readFileSync(new URL('../../EMPS_BACKUPS/emps-maquete-lab.runtime.json',import.meta.url),'utf8'));
if(config.stationId!==46 || config.deviceId!=='maquete-01')throw Error('Only local Posto 46 is supported');
const bootId='sim_'+randomUUID();let stopped=false, socket, retry;
function connect(){
  if(stopped)return;
  socket=new WebSocket('ws://127.0.0.1:3012/devices/maquete-01/energy/ws',{headers:{'x-device-token':config.token,'x-station-id':'46'}});
  let channelId=null,lastSequence=0,deadline=0;
  const send=(type,extra={})=>socket.readyState===1 && socket.send(JSON.stringify({type,stationId:'46',bootId,channelId,ev1:false,ev2:false,...extra}));
  socket.on('open',()=>send('hello'));
  socket.on('error',()=>{});
  socket.on('message',raw=>{
    const m=JSON.parse(raw);
    if(m.type==='welcome'){channelId=m.channelId;return;}
    if(m.type!=='energy.snapshot'||m.stationId!=='46'||m.channelId!==channelId||m.bootId!==bootId||
       m.sequence<=lastSequence||m.expiresAtMs<=Date.now()||m.evses.EV1.effectiveRelay!==false||m.evses.EV2.effectiveRelay!==false){socket.close();return;}
    lastSequence=m.sequence;deadline=m.expiresAtMs;
    console.log(JSON.stringify({client:'SIMULATOR_NO_GPIO',sequence:m.sequence,revision:m.revision,valid:m.valid,
      solarKw:m.solar.generatedKw,grid:m.grid,battery:m.battery,buildingLight:true,relays:'BLOCKED'}));
    send('ack',{commandId:m.commandId,sequence:m.sequence,accepted:m.valid});
  });
  const heartbeat=setInterval(()=>{if(channelId)send('heartbeat');if(deadline && Date.now()>deadline){deadline=0;console.log('SIMULATOR: snapshot expired; outputs OFF, building light ON');}},2000);
  socket.on('close',()=>{clearInterval(heartbeat);console.log('SIMULATOR: disconnected; outputs OFF, building light ON');if(!stopped)retry=setTimeout(connect,3000);});
}
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stopped=true;clearTimeout(retry);socket?.close();});
connect();
