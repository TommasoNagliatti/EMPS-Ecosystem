import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {Prisma} from '@prisma/client';
import {newLifecycleSnapshot,stopLifecycle,disconnectLifecycle,confirmCashRefund,presentLifecycle,lifecycleOf,assertNoPendingRemoval} from '../src/charge-lifecycle';
import {calculateSession,invoice,ledgerOf,initialBilling,unknownFacts} from '../src/tariff-engine';
import {prepaidStopDecision,PrepaidBudgetService} from '../src/prepaid-budget.service';
import {assertLifecycleBudget,assertPrepaidRuntime} from '../src/prepaid-domain';
import {AdminOperationsService} from '../src/admin-operations.service';
import {ChargeLifecycleService} from '../src/charge-lifecycle.service';
import {ChargingGatewayService} from '../src/charging-gateway.service';
import {dashboardSummary} from '../src/dashboard-summary';

const at=new Date('2026-10-13T13:00:00.900Z');
const after=(seconds:number)=>new Date(at.getTime()+seconds*1000);
const stopped=()=>stopLifecycle(newLifecycleSnapshot(),at,'8.89',10);

test('R$ 10 received, R$ 8.89 consumed: R$ 1.11 due, never a fabricated refund',()=>{
 const view=presentLifecycle(stopped(),at)!;
 assert.equal(view.energyAmount,'8.89');assert.equal(view.refund!.dueAmount,'1.11');
 assert.equal(view.refund!.returnedAmount,'0.00');assert.equal(view.refund!.status,'PENDING_CASH_RETURN');
 assert.equal(view.overstayAmount,null);
});
test('meter overrun is retained for audit but never charged above the authorized budget',()=>{
 const snapshot=stopLifecycle(newLifecycleSnapshot(),at,12,10,10);
 const view=presentLifecycle(snapshot,at)!;
 assert.equal(view.energyAmount,'10.00');assert.equal(view.rawEnergyAmount,'12.00');assert.equal(view.absorbedOverrunAmount,'2.00');assert.equal(view.refund!.dueAmount,'0.00');
 const interval={...unknownFacts(at.toISOString()),start_at:at.toISOString(),end_at:after(60).toISOString(),energy_kwh:'10'};
 const bill=calculateSession('test',[interval],after(60).toISOString(),null,true,10);
 assert.equal(bill.customer.total_amount,'10.00');assert.equal(bill.customer.energy_amount,'19.90');assert.equal(bill.customer.budget_adjustment_amount,'9.90');
});
test('the 10-minute grace starts on confirmed stop, not START, payment or STOP request',()=>{
 assert.equal(presentLifecycle(newLifecycleSnapshot(),at)!.removalDeadline,null);
 assert.equal(presentLifecycle(stopped(),after(599))!.remainingGraceSeconds,1);
 assert.equal(presentLifecycle(stopped(),after(600))!.occupancyState,'GRACE');
 assert.equal(presentLifecycle(stopped(),after(601))!.occupancyState,'OVERSTAY');
 assert.equal(presentLifecycle(stopped(),after(601))!.overstaySeconds,1);
});
test('removal freezes separate occupancy time across reloads without changing energy',()=>{
 const snapshot=disconnectLifecycle(stopped(),after(1200),'OPERATOR_CONFIRMED_SANDBOX');
 const view=presentLifecycle(snapshot,after(86400))!;
 assert.equal(view.occupancyState,'REMOVED');assert.equal(view.overstaySeconds,600);
 assert.equal(view.energyAmount,'8.89');assert.equal(view.overstayAmount,null);
 assert.deepEqual(disconnectLifecycle(snapshot,after(1500),'OPERATOR_CONFIRMED_SANDBOX'),snapshot);
});
test('cash refund needs the exact unused value and authenticated operator; retry is idempotent',()=>{
 assert.throws(()=>confirmCashRefund(stopped(),10,'64',after(2)));
 assert.throws(()=>confirmCashRefund(stopped(),'1.10','64',after(2)));
 assert.throws(()=>confirmCashRefund(stopped(),'1.11','',after(2)));
 const refunded=confirmCashRefund(stopped(),'1.11','64',after(2));
 assert.equal(presentLifecycle(refunded)!.refund!.status,'CONFIRMED_CASH_RETURN');
 assert.equal(presentLifecycle(refunded)!.refund!.dueAmount,'0.00');
 assert.deepEqual(confirmCashRefund(refunded,'1.11','64',after(999)),refunded);
});
test('invalid snapshots and backward removal dates fail closed',()=>{
 assert.throws(()=>disconnectLifecycle(newLifecycleSnapshot(),after(1),'OPERATOR_CONFIRMED_SANDBOX'));
 assert.throws(()=>disconnectLifecycle(stopped(),after(-1),'OPERATOR_CONFIRMED_SANDBOX'));
 assert.throws(()=>lifecycleOf({chargeLifecycle:{version:'PREPAID_LIMIT_V2',graceSeconds:15}}));
 assert.equal(lifecycleOf(null),null);
});
test('old invoices keep 15 min / original fee; new prepaid bills energy only and tracks 10 min separately',()=>{
 const old=calculateSession('old',[],at.toISOString(),after(1200).toISOString());
 assert.equal(old.overstay.grace_minutes,15);assert.equal(old.customer.overstay_fee,'1.25');
 const next=calculateSession('new',[],at.toISOString(),after(1200).toISOString(),true);
 assert.equal(next.overstay.grace_minutes,10);assert.equal(next.customer.overstay_fee,'0.00');assert.equal(next.overstay.fee_per_minute,null);
 assert.equal(ledgerOf({billingSnapshot:newLifecycleSnapshot()}),null);
 const ledger={tariff_version:'SP_ENEL_PROTO_V1',phase:'awaiting_disconnect',charge_completed_at:at.toISOString(),intervals:[],chargeLifecycle:lifecycleOf(stopped())};
 assert.equal(invoice({id:'new',tariffVersion:'SP_ENEL_PROTO_V1',billingSnapshot:ledger,disconnectedAt:after(1200)})!.customer.total_amount,'0.00');
});
test('safe budget admission reserves monitor/dispatch time and validates power',()=>{
 assert.doesNotThrow(()=>assertLifecycleBudget(10,22,'1.99',0));
 assert.throws(()=>assertLifecycleBudget('.10',22,'1.99',0));
 assert.throws(()=>assertLifecycleBudget(10,null,'1.99',0));
 const session:any={spendingLimit:new Prisma.Decimal(10),charger:{powerKw:22},billingSnapshot:newLifecycleSnapshot(),energyKwh:new Prisma.Decimal(0),pricePerKwhSnapshot:new Prisma.Decimal('1.99'),fixedFeeSnapshot:new Prisma.Decimal(0),startTime:at};
 assert.equal(prepaidStopDecision(session,after(100)).stop,false);
 assert.equal(prepaidStopDecision(session,after(800)).stop,true);
 assert.equal(prepaidStopDecision({...session,charger:{powerKw:0}},after(1)).reason,'MISSING_POWER_BOUND');
});
test('prepaid cannot start without its monitor or outside the configured operational scope',()=>{
 const jobs=process.env.EMPS_BACKGROUND_JOBS_ENABLED,stations=process.env.CHARGE_RUNTIME_STATION_IDS;
 try{
  process.env.EMPS_BACKGROUND_JOBS_ENABLED='false';assert.throws(()=>assertPrepaidRuntime(13));
  process.env.EMPS_BACKGROUND_JOBS_ENABLED='true';process.env.CHARGE_RUNTIME_STATION_IDS='13';
  assert.doesNotThrow(()=>assertPrepaidRuntime(13));assert.throws(()=>assertPrepaidRuntime(39));
 }finally{if(jobs===undefined)delete process.env.EMPS_BACKGROUND_JOBS_ENABLED;else process.env.EMPS_BACKGROUND_JOBS_ENABLED=jobs;if(stations===undefined)delete process.env.CHARGE_RUNTIME_STATION_IDS;else process.env.CHARGE_RUNTIME_STATION_IDS=stations;}
});

function cashFixture(mode='sandbox',accepted=true){
 const session:any={id:900n,chargerId:51,clientId:null,paymentIntentId:null,rfidCredentialId:null,status:'ACTIVE',sessionOrigin:'ADMIN_SITE',billingMode:'PREPAID',preferredPaymentMethod:'CASH',startTime:new Date(Date.now()-100000),requestedAt:at,energyKwh:new Prisma.Decimal('4.467'),pricePerKwhSnapshot:new Prisma.Decimal('1.99'),fixedFeeSnapshot:new Prisma.Decimal(0),spendingLimit:new Prisma.Decimal(10),billingSnapshot:newLifecycleSnapshot(),stopIdempotencyKey:null};
 const receipt:any={sessionId:900n,amount:new Prisma.Decimal(10),status:'APPROVED',method:'CASH',provider:'CASH_REGISTER',paidAt:at};
 const live:any={operationalStatus:'CHARGING'},dispatched:any[]=[],pending:any[]=[];
 const db:any={
  charger:{findUnique:async()=>({id:51,powerKw:22,sessions:session.status==='ACTIVE'?[session]:[]})},
  chargingSession:{findUniqueOrThrow:async()=>session,update:async({data}:any)=>Object.assign(session,data),updateMany:async({where,data}:any)=>{if(where.status!==session.status)return {count:0};Object.assign(session,data);return {count:1}}},
  chargingCommand:{create:async()=>({id:12n}),update:async()=>({})},
  chargerLiveStatus:{upsert:async({update}:any)=>Object.assign(live,update)},
  payment:{findUnique:async()=>receipt,findFirst:async()=>receipt,upsert:async(v:any)=>pending.push(v)},
  $queryRaw:async()=>[],
 };db.$transaction=async(fn:any)=>fn(db);
 const service=new AdminOperationsService(db,{dispatch:async(c:any)=>{dispatched.push(c);return {mode,accepted,correlationId:'test'}}} as any,{publish:()=>{}} as any,{} as any,{manages:()=>true} as any);
 return {service,session,receipt,live,dispatched,pending};
}
test('new cashier STOP closes energy and refund but holds FINISHING until connector removal',async()=>{
 const f=cashFixture();await f.service.sendCommand('51','encerrar_carga','900','AUTHORIZED_LIMIT');
 assert.equal(f.session.status,'FINISHED');assert.equal(f.session.totalPrice,8.89);
 assert.equal(f.live.operationalStatus,'FINISHING');assert.equal(f.live.currentPowerKw,0);
 assert.equal(presentLifecycle(f.session.billingSnapshot)!.refund!.dueAmount,'1.11');assert.equal(f.pending.length,0);
 assert.equal(f.receipt.amount.toFixed(2),'10.00');
});
test('budget STOP never targets a replacement session and concurrent STOP dispatches once',async()=>{
 const f=cashFixture();await assert.rejects(f.service.sendCommand('51','encerrar_carga','899'),/sessao.*mudou/);assert.equal(f.dispatched.length,0);
 const results=await Promise.allSettled([f.service.sendCommand('51','encerrar_carga','900'),f.service.sendCommand('51','encerrar_carga','900')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.dispatched.length,1);
});
test('physical STOP acceptance is not confirmation and does not start grace/refund',async()=>{
 const f=cashFixture('gateway');await f.service.sendCommand('51','encerrar_carga','900');
 assert.equal(f.session.status,'STOPPING');assert.equal(presentLifecycle(f.session.billingSnapshot)!.stoppedAt,null);
});
test('failed/rejected stop restores ACTIVE without inventing energy stop',async()=>{
 const f=cashFixture('sandbox',false);await assert.rejects(f.service.sendCommand('51','encerrar_carga','900'));
 assert.equal(f.session.status,'ACTIVE');assert.equal(f.session.stopIdempotencyKey,null);assert.equal(presentLifecycle(f.session.billingSnapshot)!.stoppedAt,null);
});
test('budget monitor routes cashier to admin and mobile to its own settlement path',async()=>{
 const old=process.env.EMPS_BACKGROUND_JOBS_ENABLED;process.env.EMPS_BACKGROUND_JOBS_ENABLED='true';
 try{
  const cash=cashFixture().session;cash.startTime=new Date(Date.now()-1000_000);cash.charger={powerKw:22};
  const app={...cash,id:901n,paymentIntentId:1n};const calls:any[]=[],queries:any[]=[];
  const service=new PrepaidBudgetService({chargingSession:{findMany:async(q:any)=>{queries.push(q);return [cash,app]}}} as any,{stopForBudget:async(...args:any[])=>calls.push(['app',...args])} as any,{sendCommand:async(...args:any[])=>calls.push(['cash',...args])} as any);
  await service.tick();assert.equal(calls.length,2);assert.equal(calls[0][0],'cash');assert.equal(calls[0][3],'900');assert.equal(calls[1][0],'app');
  assert.equal(queries[0].where.OR[1].billingSnapshot.equals,'PREPAID_LIMIT_V2');
 }finally{if(old===undefined)delete process.env.EMPS_BACKGROUND_JOBS_ENABLED;else process.env.EMPS_BACKGROUND_JOBS_ENABLED=old;}
});
test('cash return audit is written once and rejects unconfirmed or changed receipts',async()=>{
 const s:any={id:900n,chargerId:51,endTime:at,totalPrice:new Prisma.Decimal('8.89'),billingSnapshot:stopped(),charger:{stationId:13},payments:[{id:1n,idempotencyKey:'cash-settle-900',amount:new Prisma.Decimal(10),status:'APPROVED',method:'CASH',provider:'CASH_REGISTER',paidAt:at}]};
 const audits:any[]=[],db:any={$queryRaw:async()=>[],chargingSession:{findUniqueOrThrow:async()=>s,update:async({data}:any)=>Object.assign(s,data)},stationAuditEvent:{create:async(a:any)=>audits.push(a)}};db.$transaction=async(fn:any)=>fn(db);
 const service=new ChargeLifecycleService(db,{publish:()=>{}} as any,{} as any);
 await assert.rejects(service.confirmRefund('900',10,'64'));
 await service.confirmRefund('900',1.11,'64');await service.confirmRefund('900',1.11,'64');assert.equal(audits.length,1);
 s.payments[0].amount=new Prisma.Decimal(9);await assert.rejects(service.confirmRefund('900',1.11,'64'));
});
test('physical event endpoint rejects unknown gateway before touching database',async()=>{
 const service=new ChargeLifecycleService({} as any,{} as any,{} as any);
 await assert.rejects(service.deviceEvent('900','not-authorized',{chargerId:51,ocppIdentity:'DEMO',event:'stop_confirmed',occurredAt:at.toISOString(),meterTotalKwh:10}));
});
test('a finished energy payment cannot admit another car while its connector remains occupied',async()=>{
 const queries:any[]=[];
 await assert.rejects(assertNoPendingRemoval({chargingSession:{findFirst:async(q:any)=>{queries.push(q);return {id:900n}}}} as any,51));
 assert.equal(queries[0].where.billingSnapshot.equals,'PREPAID_LIMIT_V2');
 await assertNoPendingRemoval({chargingSession:{findFirst:async()=>null}} as any,51);
});
test('physical START confirmation requires an accepted command and does not fabricate measured power',async()=>{
 const env={url:process.env.OCPP_GATEWAY_URL,token:process.env.OCPP_GATEWAY_TOKEN};
 process.env.OCPP_GATEWAY_URL='https://gateway.test';process.env.OCPP_GATEWAY_TOKEN='fixture';
 try{
  const s:any={id:900n,chargerId:51,requestedAt:after(-1),status:'STARTING',billingSnapshot:newLifecycleSnapshot(),charger:{stationId:13,ocppIdentity:'EVSE-51'},commands:[{id:12n,type:'START_CHARGING',status:'ACCEPTED'}]};
  const live:any={},db:any={$queryRaw:async()=>[],chargingSession:{findUniqueOrThrow:async()=>s,update:async({data}:any)=>Object.assign(s,data)},chargerLiveStatus:{update:async({data}:any)=>Object.assign(live,data)},chargingCommand:{update:async()=>({})}};db.$transaction=async(fn:any)=>fn(db);
  const service=new ChargeLifecycleService(db,{publish:()=>{}} as any,{} as any);
  const input:any={chargerId:51,ocppIdentity:'EVSE-51',event:'start_confirmed',occurredAt:at.toISOString(),meterTotalKwh:100};
  await service.deviceEvent('900','fixture',input);assert.equal(s.status,'ACTIVE');assert.equal(live.currentPowerKw,0);assert.equal(s.meterStartKwh,100);
  await service.deviceEvent('900','fixture',input);await assert.rejects(service.deviceEvent('900','fixture',{...input,meterTotalKwh:101}));
 }finally{if(env.url===undefined)delete process.env.OCPP_GATEWAY_URL;else process.env.OCPP_GATEWAY_URL=env.url;if(env.token===undefined)delete process.env.OCPP_GATEWAY_TOKEN;else process.env.OCPP_GATEWAY_TOKEN=env.token;}
});
test('confirmed physical meter stops energy, starts grace, and authenticated removal frees the connector',async()=>{
 const env={url:process.env.OCPP_GATEWAY_URL,token:process.env.OCPP_GATEWAY_TOKEN};
 process.env.OCPP_GATEWAY_URL='https://gateway.test';process.env.OCPP_GATEWAY_TOKEN='fixture';
 try{
  const s:any={id:900n,chargerId:51,startTime:after(-1000),requestedAt:after(-1000),status:'STOPPING',endTime:null,energyKwh:new Prisma.Decimal(0),meterStartKwh:new Prisma.Decimal(100),pricePerKwhSnapshot:new Prisma.Decimal('1.99'),fixedFeeSnapshot:new Prisma.Decimal(0),billingSnapshot:newLifecycleSnapshot(),charger:{id:51,stationId:13,ocppIdentity:'EVSE-51'},payments:[{idempotencyKey:'cash-settle-900',status:'APPROVED',method:'CASH',provider:'CASH_REGISTER',paidAt:at,amount:new Prisma.Decimal(10)}],commands:[{id:12n,type:'STOP_CHARGING',status:'ACCEPTED'}]};
  const live:any={operationalStatus:'CHARGING',currentPowerKw:22};let commands=0;
  const db:any={$queryRaw:async()=>[],chargingSession:{findUniqueOrThrow:async()=>s,update:async({data}:any)=>Object.assign(s,data)},chargerLiveStatus:{update:async({data}:any)=>Object.assign(live,data),updateMany:async({data}:any)=>{Object.assign(live,data);return {count:1}}},chargingCommand:{update:async()=>{commands++;}}};db.$transaction=async(fn:any)=>fn(db);
  const service=new ChargeLifecycleService(db,{publish:()=>{}} as any,{settleConfirmedStop:async()=>{}} as any);
  const input:any={chargerId:51,ocppIdentity:'EVSE-51',event:'stop_confirmed',occurredAt:at.toISOString(),meterTotalKwh:104.467};
  await assert.rejects(service.deviceEvent('900','fixture',{...input,ocppIdentity:'WRONG'}));
  await service.deviceEvent('900','fixture',input);assert.equal(s.status,'FINISHED');assert.equal(live.operationalStatus,'FINISHING');assert.equal(presentLifecycle(s.billingSnapshot)!.refund!.dueAmount,'1.11');
  await service.deviceEvent('900','fixture',input);assert.equal(commands,1);
  await assert.rejects(service.deviceEvent('900','fixture',{...input,meterTotalKwh:105}));
  await service.deviceEvent('900','fixture',{...input,event:'connector_removed',occurredAt:after(1200).toISOString()});
  assert.equal(live.operationalStatus,'AVAILABLE');assert.equal(presentLifecycle(s.billingSnapshot)!.overstaySeconds,600);
 }finally{if(env.url===undefined)delete process.env.OCPP_GATEWAY_URL;else process.env.OCPP_GATEWAY_URL=env.url;if(env.token===undefined)delete process.env.OCPP_GATEWAY_TOKEN;else process.env.OCPP_GATEWAY_TOKEN=env.token;}
});
test('confirmed cash returns reduce cash flow on the return day, not by rewriting the original receipt',()=>{
 const payment:any={status:'APPROVED',method:'CASH',amount:10,paidAt:after(-86400),createdAt:after(-86400),cashReturnedAmount:'1.11',cashReturnedAt:at.toISOString()};
 const summary=dashboardSummary([],[],[payment],[],after(1));assert.equal(summary.revenueToday,-1.11);
 assert.equal(payment.amount,10);assert.equal(summary.revenueMonth,8.89);
});
test('hard energy limit capability is required before sending a physical prepaid START',async t=>{
 const env={url:process.env.OCPP_GATEWAY_URL,token:process.env.OCPP_GATEWAY_TOKEN};
 process.env.OCPP_GATEWAY_URL='https://gateway.test';process.env.OCPP_GATEWAY_TOKEN='fixture';
 const calls:string[]=[];
 t.mock.method(globalThis,'fetch',async(url:any)=>{calls.push(String(url));return Response.json({hardEnergyLimit:false});});
 try{await assert.rejects(new ChargingGatewayService().dispatch({chargerId:51,commandId:'12',type:'START',energyLimitKwh:'5.000'}));assert.deepEqual(calls,['https://gateway.test/capabilities']);}
 finally{if(env.url===undefined)delete process.env.OCPP_GATEWAY_URL;else process.env.OCPP_GATEWAY_URL=env.url;if(env.token===undefined)delete process.env.OCPP_GATEWAY_TOKEN;else process.env.OCPP_GATEWAY_TOKEN=env.token;}
});
