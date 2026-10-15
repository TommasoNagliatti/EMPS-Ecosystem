import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Prisma} from '@prisma/client';
import {chargeLifecycleEnabled,chargeLifecycleStationIds,assertChargePolicySelection,newLifecycleSnapshot,stopLifecycle,lifecycleOf,CHARGE_POLICY_VERSION,assertNoPendingRemoval} from '../src/charge-lifecycle';
import {calculateSession,ledgerOf,invoice,tariffQuote,unknownFacts} from '../src/tariff-engine';
import {MobileService} from '../src/mobile.service';
import {SessionBillingService} from '../src/session-billing.service';
import {ChargingGatewayService} from '../src/charging-gateway.service';
import {GieService} from '../src/gie.service';
import {normalizeChargingSession} from '../../../../app/emps-charge/src/domain/normalizers';
import {requiresConnectorRemoval,canConfirmConnectorRemoval} from '../../../../app/emps-charge/src/domain/charge-lifecycle';

function environment(values:Record<string,string|undefined>){
 const saved=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
 for(const [key,value] of Object.entries(values)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 return()=>{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}};
}

test('new lifecycle is opt-in, scoped to valid station IDs and never enables every station',()=>{
 assert.equal(chargeLifecycleEnabled(13,{}),false);
 assert.equal(chargeLifecycleEnabled(13,{PREPAID_LIFECYCLE_STATION_IDS:''}),false);
 assert.deepEqual(chargeLifecycleStationIds({PREPAID_LIFECYCLE_STATION_IDS:'13, 39,13'}),[13,39]);
 assert.equal(chargeLifecycleEnabled(14,{PREPAID_LIFECYCLE_STATION_IDS:'13,39'}),false);
 for(const value of ['*','true','0','-1','13,','4294967296','13,wrong'])assert.throws(()=>chargeLifecycleStationIds({PREPAID_LIFECYCLE_STATION_IDS:value}));
});

test('old clients work by default; enabling V2 requires compatible terms at START',()=>{
 const restore=environment({PREPAID_LIFECYCLE_STATION_IDS:undefined});
 try{
  assert.equal(assertChargePolicySelection(13),false);
  assert.throws(()=>assertChargePolicySelection(13,CHARGE_POLICY_VERSION));
  process.env.PREPAID_LIFECYCLE_STATION_IDS='13';
  assert.throws(()=>assertChargePolicySelection(13));
  assert.equal(assertChargePolicySelection(13,CHARGE_POLICY_VERSION),true);
  assert.equal(assertChargePolicySelection(39),false);
 }finally{restore();}
});

test('persisted V2 remains readable after its opt-in is disabled; legacy pricing stays unchanged',()=>{
 const restore=environment({PREPAID_LIFECYCLE_STATION_IDS:undefined});
 try{
  const snapshot=stopLifecycle(newLifecycleSnapshot(),new Date('2026-10-13T13:00:00Z'),'8.89',10);
  assert.equal(lifecycleOf(snapshot)!.graceSeconds,600);
  assert.equal(ledgerOf({tariffVersion:null,billingSnapshot:snapshot}),null);
  assert.equal(invoice({id:'900',tariffVersion:null,billingSnapshot:snapshot}),null);
  const old=calculateSession('old',[],'2026-10-13T13:00:00Z','2026-10-13T13:20:00Z');
  assert.equal(old.customer.overstay_fee,'1.25');assert.equal(old.overstay.grace_minutes,15);
  assert.equal(tariffQuote().overstay_fee_per_minute,'0.25');
  assert.equal(tariffQuote(undefined,true).overstay_grace_minutes,10);
  assert.equal(tariffQuote(undefined,true).overstay_fee_per_minute,null);
  assert.equal(tariffQuote(undefined,true).overstay_fee_cap,null);
 }finally{restore();}
});

function sessionFixture(v1=true,physical=false){
 const at=new Date('2026-10-13T13:00:00Z'),end=new Date('2026-10-13T13:01:00Z');
 const intervals=[{...unknownFacts(at.toISOString()),start_at:at.toISOString(),end_at:end.toISOString(),energy_kwh:'1'}];
 const bill=calculateSession('900',intervals,end.toISOString(),null,true,10);
 const base=v1?{tariff_version:'SP_ENEL_PROTO_V1',phase:'frozen',intervals,meter_energy_kwh:'1',last_at:end.toISOString(),facts:unknownFacts(end.toISOString()),charge_completed_at:end.toISOString(),breakdown:bill}:undefined;
 const snapshot=stopLifecycle(newLifecycleSnapshot(base),end,'1.99',undefined,10);
 if(physical)(snapshot as any).chargeLifecycle.startedAt=at.toISOString();
 const live:any={operationalStatus:'FINISHING',currentPowerKw:0};
 const row:any={id:900n,clientId:1,guestId:null,chargerId:51,tariffVersion:v1?'SP_ENEL_PROTO_V1':null,billingSnapshot:snapshot,endTime:end,startTime:at,requestedAt:at,disconnectedAt:null,status:v1?'WAITING_PAYMENT':'FINISHED',paymentIntentId:1n,paymentIntent:{id:1n,provider:'sandbox',method:'CARD',authorizedAmount:new Prisma.Decimal(10)},payments:[],commands:[],charger:{id:51,stationId:13,liveStatus:live,powerKw:22},durationSeconds:60,energyKwh:new Prisma.Decimal(1),totalPrice:new Prisma.Decimal('1.99'),fixedFeeSnapshot:0,pricePerKwhSnapshot:new Prisma.Decimal('1.99'),spendingLimit:new Prisma.Decimal(10)};
 let writes=0;
 const db:any={user:{findUnique:async({where}:any)=>({id:where.id,accountStatus:'ACTIVE'})},
  chargingSession:{findUniqueOrThrow:async()=>row,findFirst:async({where}:any)=>where.clientId!==undefined&&where.clientId!==row.clientId?null:row,
   update:async({data}:any)=>{writes++;return Object.assign(row,data);}},
  chargingCommand:{findFirst:async()=>null},
  payment:{upsert:async({create}:any)=>{const payment={id:1n,...create};row.payments.push(payment);return payment;}},
  chargerLiveStatus:{updateMany:async({where,data}:any)=>{if(where.operationalStatus!==live.operationalStatus||where.currentPowerKw!==live.currentPowerKw)return {count:0};writes++;Object.assign(live,data);return {count:1};}},
  $queryRaw:async()=>[],};db.$transaction=async(fn:any)=>fn(db);
 const realtime:any={publish:()=>{}},billing=new SessionBillingService(db,{} as any,realtime);
 const mobile=new MobileService(db,{} as any,{} as any,{} as any,realtime,undefined,billing);
 return {row,live,db,billing,mobile,writes:()=>writes};
}

test('paid V2 receipt preserves lifecycle and offers removal without charging twice',async()=>{
 const restore=environment({OCPP_GATEWAY_URL:undefined});
 try{
  const f=sessionFixture();await f.mobile.settleConfirmedStop('900');
  assert.equal(f.row.status,'FINISHED');assert.equal(f.live.operationalStatus,'FINISHING');
  const paid=normalizeChargingSession((f.mobile as any).presentSession(f.row))!;
  assert.equal(paid.status,'completed');assert.equal(requiresConnectorRemoval(paid),true);
  assert.equal(canConfirmConnectorRemoval(paid),true);
  await assert.rejects(assertNoPendingRemoval(f.db,51));
  const count=f.row.payments.length;
  await f.billing.disconnect('1','900');await f.billing.disconnect('1','900');
  assert.equal(f.live.operationalStatus,'AVAILABLE');assert.equal(f.row.payments.length,count);
  assert.equal(requiresConnectorRemoval(normalizeChargingSession((f.mobile as any).presentSession(f.row))),false);
 }finally{restore();}
});

test('non-V1 new prepaid can confirm removal using the existing mobile endpoint',async()=>{
 const restore=environment({OCPP_GATEWAY_URL:undefined});
 try{
  const f=sessionFixture(false);await f.billing.disconnect('1','900');
  assert.equal(f.live.operationalStatus,'AVAILABLE');assert.ok(f.row.disconnectedAt);
  assert.equal(f.row.status,'FINISHED');assert.equal(f.row.payments.length,0);
 }finally{restore();}
});

test('removal remains owner-scoped and physical sessions cannot be manually released after gateway config disappears',async()=>{
 const restore=environment({OCPP_GATEWAY_URL:undefined});
 try{
  const f=sessionFixture(false,true);
  await assert.rejects(f.billing.disconnect('2','900'),/não encontrada/);
  await assert.rejects(f.billing.disconnect('1','900'),/gateway fisico/);
  assert.equal(f.live.operationalStatus,'FINISHING');assert.equal(f.writes(),0);
  const view=normalizeChargingSession((f.mobile as any).presentSession(f.row))!;
  assert.equal(requiresConnectorRemoval(view),true);assert.equal(canConfirmConnectorRemoval(view),false);
 }finally{restore();}
});

test('legacy gateway contract still uses commands only; V2 keeps hard-limit verification',async context=>{
 const restore=environment({OCPP_GATEWAY_URL:'https://gateway.fixture.invalid',OCPP_GATEWAY_TOKEN:'fixture',EMPS_REMOTE_DEVELOPMENT:'false',EMPS_PHYSICAL_COMMANDS_ENABLED:'true'});
 const calls:string[]=[];
 context.mock.method(globalThis,'fetch',async(url:any)=>{calls.push(String(url));return Response.json({accepted:true});});
 try{
  assert.equal((await new ChargingGatewayService().dispatch({chargerId:51,commandId:'fixture',type:'START'})).accepted,true);
  assert.deepEqual(calls,['https://gateway.fixture.invalid/commands']);
  await assert.rejects(new ChargingGatewayService().dispatch({chargerId:51,commandId:'fixture',type:'START',energyLimitKwh:'5.000'}));
  assert.equal(calls.at(-1),'https://gateway.fixture.invalid/capabilities');
 }finally{restore();}
});

test('GIE presentation setpoints cannot change either historical or new commercial billing snapshots',async()=>{
 const restore=environment({OCPP_GATEWAY_URL:undefined,EMPS_REMOTE_DEVELOPMENT:'false',GIE_STATION_ID:'13',GIE_SERVICE_URL:'http://gie.test',GIE_SERVICE_TOKEN:'test-token'});
 const originalFetch=globalThis.fetch;
 try{
  const fixture=(snapshot:any)=>{
   const row:any={id:900n,status:'ACTIVE',billingSnapshot:snapshot,energyKwh:new Prisma.Decimal(0),totalPrice:new Prisma.Decimal(0)};
   let updates=0;
   const db:any={gieStationBinding:{findUnique:async()=>null},gieEvseMapping:{findMany:async()=>[{chargerId:51,evseSlot:1,chargers:{powerKw:22,configuredPowerLimitKw:22,sessions:[row]}}]},
    chargingSession:{update:async()=>{updates++;}},chargerLiveStatus:{update:async()=>{updates++;}}};
   return {row,updates:()=>updates,service:new GieService(db,{publish:()=>{}} as any)};
  };
  globalThis.fetch=async()=>Response.json({station_id:'13',mode:'NORMAL',state:{execution_allowed:true,numeric_state:{evse_setpoints_kw:[22]}}});
  const old=fixture(null);await old.service.refresh();assert.equal(old.updates(),0);
  const next=fixture(newLifecycleSnapshot());await next.service.refresh();
  assert.equal(next.updates(),0);assert.equal(next.row.energyKwh.toString(),'0');assert.equal(next.row.totalPrice.toString(),'0');
  assert.ok(lifecycleOf(next.row.billingSnapshot));
 }finally{globalThis.fetch=originalFetch;restore();}
});

test('portable START rebuilds before launching and retains V2 process ownership',()=>{
 const root=join(__dirname,'../../../..'),script=readFileSync(join(root,'scripts/start-local.ps1'),'utf8');
 assert.ok(script.indexOf('nest.js')<script.indexOf('start-ecosystem.cjs'));
 assert.match(script,/LASTEXITCODE -ne 0[\s\S]*Backend build failed/);
 assert.ok(script.includes("$arguments += '--v2'"));
 assert.doesNotMatch(script,/prisma (?:migrate|db push|db seed)|docker[^\n]+down[^\n]+-v/);
});
