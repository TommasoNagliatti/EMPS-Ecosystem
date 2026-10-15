import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {buildGieV3Provision} from '../src/gie-v3-provision';
import {parseGieV3Events,parseGieV3State} from '../src/gie-v3-contract';
import {GieV3Service} from '../src/gie-v3.service';
import {GieDemoInstallationsService} from '../src/gie-demo-installations.service';
import {assertGieV3ChargingMeter} from '../src/gie-v3-charging';
import {AdminOperationsService} from '../src/admin-operations.service';
import {GieController} from '../src/gie.service';
import {MobileService} from '../src/mobile.service';

const previous={url:process.env.GIE_V3_SERVICE_URL,token:process.env.GIE_V3_SERVICE_TOKEN,provisionToken:process.env.GIE_V3_PROVISIONING_TOKEN};
const originalFetch=globalThis.fetch;
afterEach(()=>{
  globalThis.fetch=originalFetch;
  if(previous.url===undefined)delete process.env.GIE_V3_SERVICE_URL;else process.env.GIE_V3_SERVICE_URL=previous.url;
  if(previous.token===undefined)delete process.env.GIE_V3_SERVICE_TOKEN;else process.env.GIE_V3_SERVICE_TOKEN=previous.token;
  if(previous.provisionToken===undefined)delete process.env.GIE_V3_PROVISIONING_TOKEN;else process.env.GIE_V3_PROVISIONING_TOKEN=previous.provisionToken;
});

function station(id:number){return {id,timezone:'America/Sao_Paulo',powerLimitKw:90,gieProvisioning:{v3Technical:{exportKw:60,
  inverters:[{inverterId:'INV_01',acKw:30},{inverterId:'INV_02',acKw:30}],
  batteryInverters:{bat1:'INV_01',bat2:'INV_02'},solarInverters:{pv1:'INV_01',pv2:'INV_02'}}},
  chargers:[{ocppIdentity:'EVSE_01',powerKw:22,configuredPowerLimitKw:22,administrativeStatus:'ENABLED'},
    {ocppIdentity:'EVSE_02',powerKw:22,configuredPowerLimitKw:22,administrativeStatus:'ENABLED'}],
  batteries:[1,2].map(i=>({id:`bat${i}`,capacityKwh:61.4,maxChargeKw:12,maxDischargeKw:12,socPercent:50,
    minSocPercent:20,maxSocPercent:95,efficiency:0.95,status:'CONFIGURED'})),
  solarAssets:[1,2].map(i=>({id:`pv${i}`,installedKwp:25,acPowerKw:30,status:'CONFIGURED'}))};}

test('approved provision preserves two batteries and converts percentage SoC once',()=>{
  const p=buildGieV3Provision(station(27));
  assert.equal(p.station_id,'EMPS_27');assert.equal(p.training_state,'BASELINE');
  assert.deepEqual(p.batteries.map(b=>[b.battery_id,b.soc_initial,b.inverter_id]),[['bat1',0.5,'INV_01'],['bat2',0.5,'INV_02']]);
  assert.equal(p.solar.reduce((sum,s)=>sum+s.dc_kwp,0),50);
  assert.equal(p.origin,'SIMULATED');
  assert.throws(()=>buildGieV3Provision({...station(27),gieProvisioning:{}}),/Inversores aprovados/);
  assert.throws(()=>buildGieV3Provision({...station(27),solarAssets:[{...station(27).solarAssets[0],acPowerKw:31}]}),/Potência AC solar/);
  assert.throws(()=>buildGieV3Provision({...station(27),batteries:[{...station(27).batteries[0],socPercent:0.5}]}),/Faixa SoC/);
});

function wire(sid:string,generation='g1'){
  return {station_id:sid,schema_version:'1.0',generation,revision:1,mode:'NORMAL',state:{timestamp:'2025-10-01T12:00:00-03:00',execution_allowed:true,provenance:{origin:'SIMULATED',station_id:sid}},
    capabilities:{forecasts:true,mpc_demo:true,physical_dispatch:false,load_balancer:true,presentation:false,manual_demo:false},
    source:'SIMULATED',hardware_commands_sent:false,history:[{station_id:sid,issue_time:'2025-10-01T12:00:00-03:00',origin:'SIMULATED',status:'ok'}]};
}
test('wire validation rejects another station, physical dispatch and stale event cursor',()=>{
  assert.throws(()=>parseGieV3State(wire('B'),'A'),/Identidade/);
  assert.throws(()=>parseGieV3State({...wire('A'),hardware_commands_sent:true},'A'),/inválido/);
  assert.throws(()=>parseGieV3State({...wire('A'),history:[{station_id:'B',issue_time:'2025-10-01T12:00:00-03:00',origin:'SIMULATED',status:'ok'}]},'A'),/Histórico/);
  const event={cursor:4,schema_version:'1.0',event_id:'e4',alert_id:'a',station_id:'A',emitted_at:'2026-10-14T12:00:00Z',transition:'CREATED',
    alert:{alert_id:'a',station_id:'A',generation:'g1',revision:1,code:'EV_POWER_LIMITED',title:'Demanda EV',description:'Simulação',severity:'warning',status:'OPEN',timestamp:'2025-10-01T12:00:00-03:00',provenance:{origin:'SIMULATED'}},
    physical_dispatch:false,hardware_commands_sent:false};
  assert.throws(()=>parseGieV3Events([event],'A',4),/inválido/);
  assert.equal(parseGieV3Events([event],'A',3)[0].alert.code,'EV_POWER_LIMITED');
});

test('two station responses remain isolated and a new generation replaces old decisions',async()=>{
  process.env.GIE_V3_SERVICE_URL='http://gie.local';process.env.GIE_V3_SERVICE_TOKEN='a'.repeat(32);
  const generations=new Map([['POST','g1'],['HOUSE','h1']]);
  const bindings=new Map([[1,{stationId:1,gieStationId:'POST',lastGeneration:null,lastEventCursor:0}],
    [2,{stationId:2,gieStationId:'HOUSE',lastGeneration:null,lastEventCursor:0}]]);
  const db={gieStationBinding:{findUnique:async({where:{stationId}}:any)=>bindings.get(stationId),
    update:async({where:{stationId},data}:any)=>Object.assign(bindings.get(stationId)!,data)}};
  globalThis.fetch=(async(input:any)=>{
    const url=new URL(String(input));const sid=url.pathname.split('/')[3];const generation=generations.get(sid)!;
    const result=url.pathname.endsWith('/health')?{station_id:sid,status:'running',generation,physical_dispatch:false}:
      url.pathname.endsWith('/events')?[]:wire(sid,generation);
    return {ok:true,json:async()=>result} as Response;
  }) as typeof fetch;
  const service=new GieV3Service(db as any,{} as any,{} as any);
  const [post,house]=await Promise.all([service.refresh(1),service.refresh(2)]);
  assert.equal(post.gie_station_id,'POST');assert.equal(house.gie_station_id,'HOUSE');
  assert.equal(post.generation,'g1');assert.equal(house.generation,'h1');
  generations.set('POST','g2');
  const restarted=await service.refresh(1);
  assert.equal(restarted.generation,'g2');assert.equal((restarted.state as any)?.execution_allowed,true);
  assert.equal((await service.refresh(2)).generation,'h1');
});

test('a failed Python provision leaves the EMPS station unbound',async()=>{
  process.env.GIE_V3_SERVICE_URL='http://gie.local';process.env.GIE_V3_PROVISIONING_TOKEN='p'.repeat(32);
  let localBindings=0;
  const db={station:{findUniqueOrThrow:async()=>station(27)},
    gieStationBinding:{findUnique:async()=>null,create:async()=>{localBindings++;}},
    $transaction:async()=>{localBindings++;}};
  globalThis.fetch=(async()=>({ok:false,status:403} as Response)) as typeof fetch;
  const service=new GieV3Service(db as any,{require:async()=>({id:27,reviewState:'APPROVED'})} as any,{} as any);
  await assert.rejects(service.provision({sub:'1'} as any,'27'),/GIE V3 respondeu 403/);
  assert.equal(localBindings,0);
});

test('provision requires read scope before persisting the station binding',async()=>{
  process.env.GIE_V3_SERVICE_URL='http://gie.local';process.env.GIE_V3_PROVISIONING_TOKEN='p'.repeat(32);
  process.env.GIE_V3_SERVICE_TOKEN='r'.repeat(32);
  let localBindings=0;
  const db={station:{findUniqueOrThrow:async()=>station(27)},
    gieStationBinding:{findUnique:async()=>null,create:async()=>{localBindings++;}},
    $transaction:async()=>{localBindings++;}};
  globalThis.fetch=(async(input:any)=>String(input).endsWith('/v2/stations')
    ? {ok:true,json:async()=>({station_id:'EMPS_27'})} as Response
    : {ok:false,status:403} as Response) as typeof fetch;
  const service=new GieV3Service(db as any,{require:async()=>({id:27,reviewState:'APPROVED'})} as any,{} as any);
  await assert.rejects(service.provision({sub:'1'} as any,'27'),/GIE V3 respondeu 403/);
  assert.equal(localBindings,0);
});

test('an alert feed failure does not erase a valid energy decision',async()=>{
  process.env.GIE_V3_SERVICE_URL='http://gie.local';process.env.GIE_V3_SERVICE_TOKEN='a'.repeat(32);
  const db={gieStationBinding:{findUnique:async()=>({stationId:1,gieStationId:'POST',lastGeneration:'g1',lastEventCursor:0})}};
  globalThis.fetch=(async(input:any)=>{
    const path=new URL(String(input)).pathname;
    if(path.endsWith('/events'))return {ok:false,status:503} as Response;
    return {ok:true,json:async()=>path.endsWith('/health')
      ? {station_id:'POST',status:'running',generation:'g1',physical_dispatch:false}:wire('POST')} as Response;
  }) as typeof fetch;
  const result=await new GieV3Service(db as any,{} as any,{} as any).refresh(1);
  assert.equal(result.online,true);
  assert.equal(result.event_feed_error,'GIE V3 respondeu 503');
  assert.equal((result.state as any)?.execution_allowed,true);
});

test('GIE event revisions update one EMPS alert and keep acknowledgement distinct from resolution',async()=>{
  const binding={stationId:1,lastEventCursor:0};
  const alerts=new Map<string,any>();let nextId=1n;const published:any[]=[];
  const tx={$queryRaw:async()=>[],gieStationBinding:{findUniqueOrThrow:async()=>binding,update:async({data}:any)=>Object.assign(binding,data)},
    alert:{findUnique:async({where}:any)=>alerts.get(where.gieAlertId)??null,
      create:async({data}:any)=>{const row={...data,id:nextId++};alerts.set(data.gieAlertId,row);return row},
      update:async({where,data}:any)=>{const row=[...alerts.values()].find(a=>a.id===where.id);Object.assign(row,data);return row}}};
  const db={$transaction:async(fn:any)=>fn(tx)};
  const service=new GieV3Service(db as any,{} as any,{publish:(event:any)=>published.push(event)} as any);
  const event=(cursor:number,revision:number,state:'OPEN'|'ACKNOWLEDGED'|'RESOLVED')=>({
    cursor,schema_version:'1.0',event_id:`alert:${revision}`,alert_id:'alert',station_id:'POST',emitted_at:'2026-10-14T12:00:00Z',
    transition:state==='OPEN'?'CREATED':state==='ACKNOWLEDGED'?'ACKNOWLEDGED':'RESOLVED',
    alert:{alert_id:'alert',station_id:'POST',generation:'g1',revision,code:'MPC_INFEASIBLE',title:'MPC inviável',
      description:'Condição simulada',severity:'critical',status:state,timestamp:'2025-10-01T12:00:00-03:00',
      acknowledged_at:state==='ACKNOWLEDGED'?'2026-10-14T12:01:00Z':null,
      resolved_at:state==='RESOLVED'?'2026-10-14T12:02:00Z':null,provenance:{origin:'SIMULATED'}},
    physical_dispatch:false,hardware_commands_sent:false});
  await (service as any).persistEvent(1,event(1,1,'OPEN'));
  await (service as any).persistEvent(1,event(1,1,'OPEN'));
  assert.equal(alerts.size,1);assert.equal(alerts.get('alert').status,'OPEN');
  await (service as any).persistEvent(1,event(2,2,'ACKNOWLEDGED'));
  assert.equal(alerts.get('alert').status,'CHECKING');assert.equal(alerts.get('alert').resolvedAt,null);
  await (service as any).persistEvent(1,event(3,3,'RESOLVED'));
  assert.equal(alerts.get('alert').status,'RESOLVED');assert.equal(binding.lastEventCursor,3);
  assert.ok(published.every(e=>e.stationId===1));
});

test('demo installation creation is owner scoped, private and idempotent',async()=>{
  const previousPin=process.env.GIE_COMMERCIAL_STATION_ID;
  const previousGateway=process.env.OCPP_GATEWAY_URL,previousToken=process.env.OCPP_GATEWAY_TOKEN;
  process.env.GIE_COMMERCIAL_STATION_ID='42';
  delete process.env.OCPP_GATEWAY_URL;delete process.env.OCPP_GATEWAY_TOKEN;
  const ownerId=723;const bindings=new Map<string,any>();let nextStation=100;
  const stations:any[]=[],chargers:any[]=[],batteries:any[]=[],solar:any[]=[];
  const tx={$queryRaw:async()=>[],chargingSession:{count:async()=>{throw new Error('A recarga comercial ativa não deve impedir a demonstração');}},
    gieStationBinding:{findUnique:async({where}:any)=>{
      if(where.stationId===42)throw new Error('Shopping não deve receber vínculo V3');
      return where.stationId?bindings.get(`station:${where.stationId}`):bindings.get(where.gieStationId);
    }},
    station:{create:async({data}:any)=>{const id=nextStation++;const row={id,...data};stations.push(row);
      const binding={stationId:id,gieStationId:data.gieBinding.create.gieStationId,profile:data.gieBinding.create.profile,
        station:{adminId:data.adminId,visibility:data.visibility,reviewState:data.reviewState,status:data.status,chargers:[] as any[]}};
      bindings.set(binding.gieStationId,binding);bindings.set(`station:${id}`,binding);return row}},
    charger:{create:async({data}:any)=>{chargers.push(data);const binding=bindings.get(`station:${data.stationId}`);binding.station.chargers.push(data);return data}},stationSolarAsset:{create:async({data}:any)=>{solar.push(data);return data}},
    stationBattery:{create:async({data}:any)=>{batteries.push(data);return data}},stationAuditEvent:{create:async()=>({})}};
  const db={$transaction:async(fn:any)=>fn(tx)},access={presentation:async()=>undefined,require:async(_u:any,id:string)=>({id:Number(id),adminId:ownerId})};
  const preflights:string[]=[];
  const service=new GieDemoInstallationsService(db as any,access as any,
    {preflightFixture:async(id:string)=>{preflights.push(id);return {status:'stopped'};}} as any);
  try{
    const first=await service.ensure({sub:String(ownerId)} as any,'42');
    const again=await service.ensure({sub:String(ownerId)} as any,'42');
    assert.equal(first.ownerId,ownerId);assert.equal(first.installations.length,2);
    assert.deepEqual(preflights.sort(),['DEMO_CASA_001','DEMO_CASA_001','DEMO_POSTO_24H_001','DEMO_POSTO_24H_001']);
    assert.deepEqual(again.installations.map(i=>i.created),[false,false]);
    assert.equal(stations.length,2);assert.equal(chargers.length,3);assert.equal(batteries.length,2);
    assert.deepEqual([...bindings.keys()].filter(key=>!key.startsWith('station:')).sort(),['DEMO_CASA_001','DEMO_POSTO_24H_001']);
    assert.ok(stations.every(s=>s.gieBinding.create.origin==='SIMULATED'&&s.gieProvisioning.origin==='SIMULATED'&&s.gieProvisioning.physical_dispatch===false));
    assert.equal(solar.reduce((sum,a)=>sum+Number(a.installedKwp),0),55.5);
    assert.ok(stations.every(s=>s.adminId===ownerId&&s.visibility==='PRIVATE'&&s.reviewState==='DRAFT'&&!s.latitude&&!s.longitude));
    assert.ok(chargers.every(c=>c.administrativeStatus==='PENDING'&&c.ocppIdentity.startsWith('SIMULATED_')));
  }finally{if(previousPin===undefined)delete process.env.GIE_COMMERCIAL_STATION_ID;else process.env.GIE_COMMERCIAL_STATION_ID=previousPin;
    if(previousGateway===undefined)delete process.env.OCPP_GATEWAY_URL;else process.env.OCPP_GATEWAY_URL=previousGateway;
    if(previousToken===undefined)delete process.env.OCPP_GATEWAY_TOKEN;else process.env.OCPP_GATEWAY_TOKEN=previousToken;}
});

test('demo bootstrap cannot write local rows when a GIE profile preflight fails',async()=>{
  const old=process.env.GIE_COMMERCIAL_STATION_ID;
  process.env.GIE_COMMERCIAL_STATION_ID='42';
  let transactions=0;
  const service=new GieDemoInstallationsService({$transaction:async()=>{transactions++;}} as any,
    {require:async()=>({id:42,adminId:1})} as any,
    {preflightFixture:async()=>{throw new Error('GIE indisponível');}} as any);
  try{await assert.rejects(service.ensure({sub:'1'} as any,'42'),/GIE indisponível/);assert.equal(transactions,0);}
  finally{if(old===undefined)delete process.env.GIE_COMMERCIAL_STATION_ID;else process.env.GIE_COMMERCIAL_STATION_ID=old;}
});

test('demo bootstrap still requires the real commercial station pin and ownership',async()=>{
  const oldPin=process.env.GIE_COMMERCIAL_STATION_ID,oldGateway=process.env.OCPP_GATEWAY_URL,oldToken=process.env.OCPP_GATEWAY_TOKEN;
  delete process.env.GIE_COMMERCIAL_STATION_ID;delete process.env.OCPP_GATEWAY_URL;delete process.env.OCPP_GATEWAY_TOKEN;
  let preflights=0,transactions=0;
  const service=new GieDemoInstallationsService({$transaction:async()=>{transactions++;}} as any,
    {require:async()=>({id:42,adminId:1})} as any,
    {preflightFixture:async()=>{preflights++;}} as any);
  try{await assert.rejects(service.ensure({sub:'1'} as any,'42'),/identidade real/);
    assert.equal(preflights,0);assert.equal(transactions,0);}
  finally{if(oldPin===undefined)delete process.env.GIE_COMMERCIAL_STATION_ID;else process.env.GIE_COMMERCIAL_STATION_ID=oldPin;
    if(oldGateway===undefined)delete process.env.OCPP_GATEWAY_URL;else process.env.OCPP_GATEWAY_URL=oldGateway;
    if(oldToken===undefined)delete process.env.OCPP_GATEWAY_TOKEN;else process.env.OCPP_GATEWAY_TOKEN=oldToken;}
});

test('a V3 binding cannot start charging from simulated setpoints without an OCPP meter path',async()=>{
  const old=process.env.OCPP_GATEWAY_URL,oldToken=process.env.OCPP_GATEWAY_TOKEN;delete process.env.OCPP_GATEWAY_URL;delete process.env.OCPP_GATEWAY_TOKEN;
  let profile='BASELINE';const tx={gieStationBinding:{findUnique:async()=>({stationId:42,profile})}};
  try{
    await assert.rejects(assertGieV3ChargingMeter(tx as any,42),/medição OCPP validado/);
    process.env.OCPP_GATEWAY_URL='http://gateway.internal';process.env.OCPP_GATEWAY_TOKEN='test-token';
    await assertGieV3ChargingMeter(tx as any,42);
    for(const demo of ['POSTO','CASA']){
      profile=demo;
      await assert.rejects(assertGieV3ChargingMeter(tx as any,42),/não aceita recargas ou pagamentos/);
    }
  }finally{if(old===undefined)delete process.env.OCPP_GATEWAY_URL;else process.env.OCPP_GATEWAY_URL=old;
    if(oldToken===undefined)delete process.env.OCPP_GATEWAY_TOKEN;else process.env.OCPP_GATEWAY_TOKEN=oldToken;}
});

test('administrative charger commands never reach either simulated installation',async()=>{
  const old=process.env.OCPP_GATEWAY_URL,oldToken=process.env.OCPP_GATEWAY_TOKEN;
  process.env.OCPP_GATEWAY_URL='http://gateway.internal';process.env.OCPP_GATEWAY_TOKEN='test-token';
  let dispatched=0;
  let profile='POSTO';
  const db={charger:{findUnique:async()=>({id:51,stationId:101,sessions:[]})},
    gieStationBinding:{findUnique:async()=>({profile})}};
  const service=new AdminOperationsService(db as any,{dispatch:async()=>{dispatched++;}} as any,{} as any,{} as any);
  try{
    for(const demo of ['POSTO','CASA']){
      profile=demo;
      await assert.rejects(service.sendCommand('51','reiniciar_equipamento'),/não aceita comandos/);
      await assert.rejects(service.sendCommand('51','liberar_conector'),/não aceita comandos/);
    }
    assert.equal(dispatched,0);
  }finally{if(old===undefined)delete process.env.OCPP_GATEWAY_URL;else process.env.OCPP_GATEWAY_URL=old;
    if(oldToken===undefined)delete process.env.OCPP_GATEWAY_TOKEN;else process.env.OCPP_GATEWAY_TOKEN=oldToken;}
});

test('payment authorization never reaches a provider for either simulated installation',async()=>{
  const old=process.env.OCPP_GATEWAY_URL,oldToken=process.env.OCPP_GATEWAY_TOKEN;
  process.env.OCPP_GATEWAY_URL='http://gateway.internal';process.env.OCPP_GATEWAY_TOKEN='test-token';
  let profile='POSTO',paymentWrites=0,providerCalls=0;
  const db={user:{findUnique:async()=>({accountStatus:'ACTIVE'})},paymentIntent:{findUnique:async()=>null,
      upsert:async()=>{paymentWrites++;}},charger:{findFirst:async()=>({id:51,stationId:101,station:{visibility:'PRIVATE',guestAllowed:false}})},
    gieStationBinding:{findUnique:async()=>({profile})}};
  const service=new MobileService(db as any,{} as any,{createIntent:async()=>{providerCalls++;}} as any,{} as any,{} as any);
  try{
    for(const demo of ['POSTO','CASA']){
      profile=demo;
      await assert.rejects(service.createPaymentIntent('723',{chargerId:'51',spendingLimit:10,method:'CARD'} as any,
        'gie-demo-payment-123456789'),/não aceita recargas ou pagamentos/);
    }
    assert.equal(paymentWrites,0);assert.equal(providerCalls,0);
  }finally{if(old===undefined)delete process.env.OCPP_GATEWAY_URL;else process.env.OCPP_GATEWAY_URL=old;
    if(oldToken===undefined)delete process.env.OCPP_GATEWAY_TOKEN;else process.env.OCPP_GATEWAY_TOKEN=oldToken;}
});

test('three station GIE routes retain legacy commercial and isolate both V3 identities',async()=>{
  const routed:string[]=[];
  const legacy={allowed:async()=>undefined,refresh:async()=>{routed.push('legacy');return {station_id:'42',mode:'PRESENTATION'};}};
  const v3={binding:async(id:number)=>id===42?null:{stationId:id},state:async(_user:any,id:string)=>{
    routed.push(id);return {gie_station_id:id==='101'?'DEMO_POSTO_24H_001':'DEMO_CASA_001'};
  }};
  const controller=new GieController(legacy as any,v3 as any,{} as any,
    {require:async()=>undefined} as any,{matches:()=>false} as any);
  const req={user:{sub:'723'}} as any;
  assert.equal((await controller.state(req,'42')).station_id,'42');
  assert.equal((await controller.state(req,'101')).gie_station_id,'DEMO_POSTO_24H_001');
  assert.equal((await controller.state(req,'102')).gie_station_id,'DEMO_CASA_001');
  assert.deepEqual(routed,['legacy','101','102']);
});
