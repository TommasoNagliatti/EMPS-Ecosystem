import assert from 'node:assert/strict';
import test from 'node:test';
import {GieService} from '../src/gie.service';

test('GIE legado apresenta quatro EVSE sem converter setpoints simulados em energia faturável',async()=>{
  const saved={...process.env},originalFetch=globalThis.fetch;
  Object.assign(process.env,{GIE_STATION_ID:'13',GIE_SERVICE_URL:'http://gie.test',GIE_SERVICE_TOKEN:'test-token'});
  delete process.env.OCPP_GATEWAY_URL;delete process.env.OCPP_GATEWAY_TOKEN;
  const events:any[]=[];let sessionWrites=0,liveWrites=0;
  const session={id:900n,status:'ACTIVE'};
  const mappings=[1,2,3,4].map(evseSlot=>({chargerId:48+evseSlot,evseSlot,
    chargers:{powerKw:22,configuredPowerLimitKw:22,sessions:evseSlot===2?[session]:[]}}));
  const db:any={gieStationBinding:{findUnique:async()=>null},gieEvseMapping:{findMany:async()=>mappings},
    chargingSession:{update:async()=>{sessionWrites++;throw Error('GIE não pode gravar sessão');}},
    chargerLiveStatus:{update:async()=>{liveWrites++;throw Error('GIE não pode gravar medição');}}};
  globalThis.fetch=async(url:any,options:any)=>{
    if(String(url).endsWith('/context')){
      const context=JSON.parse(options.body);
      assert.equal(context.demands.length,4);
      assert.equal(context.demands[1].session_id,'900');
    }
    return new Response(JSON.stringify({station_id:'13',mode:'MANUAL_DEMO',state:{execution_allowed:true,numeric_state:{evse_setpoints_kw:[0,22,0,0]},visual_state:{valid:true}}}),{status:200});
  };
  try{
    const service=new GieService(db,{publish:(e:any)=>events.push(e)} as any);
    assert.equal(service.manages({stationId:13}),false);
    const state=await service.refresh();
    assert.equal(state.online,true);
    assert.deepEqual(state.state?.numeric_state.evse_setpoints_kw,[0,22,0,0]);
    assert.equal(service.billingFacts().source,'unclassified_no_surcharge');
    assert.equal(sessionWrites,0);assert.equal(liveWrites,0);assert.deepEqual(events,[]);
    globalThis.fetch=async()=>{throw Error('offline')};
    assert.equal((await service.refresh()).online,false);
    assert.equal(sessionWrites,0);assert.equal(liveWrites,0);
    process.env.OCPP_GATEWAY_URL='http://physical-gateway.test';
    assert.equal(service.manages({stationId:13}),false);
    process.env.OCPP_GATEWAY_TOKEN='test-gateway-token';
    assert.equal(service.manages({stationId:13}),true);
    assert.equal(service.manages({stationId:14}),false);
  }finally{globalThis.fetch=originalFetch;for(const k of ['GIE_STATION_ID','GIE_SERVICE_URL','GIE_SERVICE_TOKEN','OCPP_GATEWAY_URL','OCPP_GATEWAY_TOKEN']){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
});
