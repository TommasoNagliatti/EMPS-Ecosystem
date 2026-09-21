import assert from 'node:assert/strict';
import test from 'node:test';
import {Prisma} from '@prisma/client';
import {GieService} from '../src/gie.service';

test('GIE publica telemetria para REST refetch e zera potência sandbox se ficar offline',async()=>{
  const saved={...process.env},originalFetch=globalThis.fetch;
  Object.assign(process.env,{GIE_STATION_ID:'13',GIE_SERVICE_URL:'http://gie.test',GIE_SERVICE_TOKEN:'test-token',OCPP_GATEWAY_URL:''});
  const events:any[]=[];let writes=0;
  const session={id:900n,clientId:65,chargerId:49,status:'ACTIVE',energyKwh:new Prisma.Decimal(0),pricePerKwhSnapshot:new Prisma.Decimal(1.89),fixedFeeSnapshot:new Prisma.Decimal(.5),spendingLimit:null,startTime:new Date(),requestedAt:new Date(),meterStartKwh:new Prisma.Decimal(0)};
  const live:any={currentPowerKw:0,lastSeenAt:new Date()};
  const mapping={chargerId:49,evseSlot:2,chargers:{powerKw:22,configuredPowerLimitKw:22,sessions:[session]}};
  const db:any={gieEvseMapping:{findMany:async()=>[mapping]},$queryRaw:async()=>[],chargingSession:{findFirst:async()=>({...session}),update:async({data}:any)=>{Object.assign(session,data);writes++}},chargerLiveStatus:{findUnique:async()=>({...live}),update:async({data}:any)=>Object.assign(live,data)}};
  db.$transaction=async(fn:any)=>fn(db);
  globalThis.fetch=async(url:any,options:any)=>{
    if(String(url).endsWith('/context')){const context=JSON.parse(options.body);assert.equal(context.demands[0].evse_slot,2);assert.equal(context.demands[0].session_id,'900');}
    return new Response(JSON.stringify({station_id:'13',mode:'MANUAL_DEMO',state:{execution_allowed:true,numeric_state:{evse_setpoints_kw:[0,22,0,0]},visual_state:{valid:true}}}),{status:200});
  };
  try{
    const service=new GieService(db,{publish:(e:any)=>events.push(e)} as any);
    assert.equal((await service.refresh()).online,true);assert.equal(live.currentPowerKw,22);
    assert.deepEqual(events[0],{topic:'session.updated',entityId:900n,customerId:65,operational:true});
    globalThis.fetch=async()=>{throw Error('offline')};
    assert.equal((await service.refresh()).online,false);assert.equal(live.currentPowerKw,0);
    const previousWrites=writes;process.env.OCPP_GATEWAY_URL='http://physical-gateway.test';
    await service.refresh();assert.equal(writes,previousWrites,'não fabrica medição quando gateway físico está configurado');
  }finally{globalThis.fetch=originalFetch;for(const k of ['GIE_STATION_ID','GIE_SERVICE_URL','GIE_SERVICE_TOKEN','OCPP_GATEWAY_URL']){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
});
