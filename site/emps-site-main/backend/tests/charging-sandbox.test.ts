import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { ChargingSandboxService, chargingSandboxEnabled, estimateSandboxEnergy, sandboxBudgetDeadline } from '../src/charging-sandbox.service';

function cloneEnvironment(): NodeJS.ProcessEnv {
  return { NODE_ENV: 'development', EMPS_CHARGING_SANDBOX_ENABLED: 'true',
    EMPS_LOCAL_LEGACY_INTEGRATION: 'true', EMPS_REMOTE_DEVELOPMENT: 'false',
    EMPS_PHYSICAL_COMMANDS_ENABLED: 'false', EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED: 'false',
    PAYMENT_PROVIDER: 'sandbox', HOST: '127.0.0.1', DEMO_HISTORY_TEST_DATABASE: 'emps_integration_test',
    DATABASE_URL: 'mysql://emps_integration_app:local-test@127.0.0.1:3308/emps_integration_test',
    EMPS_MAQUETE_STATION_ID: '46' };
}

test('mobile availability observes session occupation and GIE mode without changing hardware state',async()=>{
 let occupied=false,blocked=false;
 const db:any={labChargeSession:{findFirst:async()=>occupied ? {status:'CHARGING'} : null}};
 const service:any=new ChargingSandboxService(db,{} as never,{assertChargerStartMode:async(id:number)=>{
   assert.equal(id,13);if(blocked)throw new Error('PRESENTATION');}} as never);
 service.charger=async()=>({charger:{id:51,stationId:13}});
 service.autoStopDue=async()=>{};
 assert.deepEqual(await service.mobileAvailability(51),{mode:'SANDBOX',status:'AVAILABLE',canStart:true,reason:null,physicalMeasurement:false});
 occupied=true;
 assert.equal((await service.mobileAvailability(51)).status,'IN_USE');
 assert.equal((await service.mobileAvailability(51)).canStart,false);
 occupied=false;blocked=true;
 assert.equal((await service.mobileAvailability(51)).status,'BLOCKED');
 assert.equal((await service.mobileAvailability(51)).canStart,false);
});

test('sandbox customer reads cannot expose private fixtures to an unrelated account',async()=>{
 const saved={...process.env};
 try {
  Object.assign(process.env,cloneEnvironment());
  for(const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OCPP_GATEWAY_URL','OCPP_GATEWAY_TOKEN'])delete process.env[key];
  const db:any={qrBinding:{findFirst:async()=>({id:69,chargerId:76})}};
  let checked=0;
  const service=new ChargingSandboxService(db,{require:async()=>{checked++;throw new Error('Sem permissão nesta estação');}} as never,{} as never);
  assert.equal(await service.mobileAccess(76),null);
  assert.equal(await service.mobileAccess(67,'64'),null);
  await assert.rejects(()=>service.mobileAccess(76,'999'),/Sem permissão/);
  assert.equal(checked,1);
 }finally{
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];
  Object.assign(process.env,saved);
 }
});

test('charging sandbox admits only audited clone and explicit station/device environment', () => {
  const safe = cloneEnvironment();
  assert.equal(chargingSandboxEnabled(safe), true);
  for (const unsafe of [
    { ...safe, EMPS_CHARGING_SANDBOX_ENABLED: 'false' },
    { ...safe, EMPS_MAQUETE_STATION_ID: '39' },
    { ...safe, DATABASE_URL: 'mysql://emps_integration_app:local-test@127.0.0.1:3306/emps_db' },
    { ...safe, DATABASE_URL: 'mysql://emps_integration_app:local-test@hostinger.example:3308/emps_integration_test' },
    { ...safe, EMPS_PHYSICAL_COMMANDS_ENABLED: 'true' },
    { ...safe, PAYMENT_PROVIDER: 'stripe' },
    { ...safe, OCPP_GATEWAY_URL: 'http://127.0.0.1:9000' },
  ]) assert.equal(chargingSandboxEnabled(unsafe), false);
});

test('sandbox energy and BRL amount are explicit estimates capped by authorized limit', () => {
  const start = new Date('2026-10-18T12:00:00.000Z');
  const oneHour = new Date('2026-10-18T13:00:00.000Z');
  const rate = new Prisma.Decimal('2.00'), fee = new Prisma.Decimal('0.00');
  const full = estimateSandboxEnergy(start, oneHour, new Prisma.Decimal('18.040'), rate, fee, new Prisma.Decimal('100.00'));
  assert.equal(full.energy.toFixed(3), '18.040');
  assert.equal(full.amount.toFixed(2), '36.08');
  const capped = estimateSandboxEnergy(start, oneHour, new Prisma.Decimal('18.040'), rate, fee, new Prisma.Decimal('20.00'));
  assert.equal(capped.energy.toFixed(3), '10.000');
  assert.equal(capped.amount.toFixed(2), '20.00');
  const before = estimateSandboxEnergy(start, new Date(start.getTime() - 1000), new Prisma.Decimal('18.040'), rate, fee, new Prisma.Decimal('20.00'));
  assert.equal(before.energy.toFixed(3), '0.000');
});

test('prepaid deadline caps energy at the original tariff even when checked late', () => {
  const start = new Date('2026-10-18T12:00:00.000Z');
  const power = new Prisma.Decimal('18.040');
  const rate = new Prisma.Decimal('2.00');
  const fee = new Prisma.Decimal('0.00');
  const received = new Prisma.Decimal('20.00');
  const deadline = sandboxBudgetDeadline(start, power, rate, fee, received);
  assert.equal(deadline.toISOString(), '2026-10-18T12:33:15.566Z');
  const settled = estimateSandboxEnergy(start, deadline, power, rate, fee, received);
  const late = estimateSandboxEnergy(start, new Date(deadline.getTime() + 60_000), power, rate, fee, received);
  assert.equal(settled.energy.toFixed(3), '10.000');
  assert.equal(settled.amount.toFixed(2), '20.00');
  assert.equal(late.energy.toFixed(3), settled.energy.toFixed(3));
  assert.equal(late.amount.toFixed(2), settled.amount.toFixed(2));
});

test('idempotent START replay after STOP returns finished session without a new device START', async () => {
  const env = cloneEnvironment(), keys = Object.keys(env);
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  const intentId = '3e6df91a-97a6-4854-b83f-11b5fb718cf0';
  const sessionId = '5d2379e8-0c0c-4bca-94c7-42c46d5ba229';
  const intent = { id: intentId, stationId: 46, chargerId: 76, actorUserId: 64,
    paymentMethod: 'pix', pricePerKwh: new Prisma.Decimal('2'), fixedFee: new Prisma.Decimal('0'),
    spendingLimit: new Prisma.Decimal('20'), status: 'AUTHORIZED', qrBindingId: 69,
    expiresAt: new Date(Date.now() + 60_000) };
  const session = { id: sessionId, intentId, stationId: 46, chargerId: 76, actorUserId: 64,
    evse: 'EV1', status: 'FINISHED', startKey: 'repeat-key',
    startedAt: new Date('2026-10-18T12:00:00Z'), endedAt: new Date('2026-10-18T12:10:00Z'),
    simulatedPowerKw: new Prisma.Decimal('18.04'), energyKwh: new Prisma.Decimal('3.006'),
    totalAmount: new Prisma.Decimal('6.01') };
  const tx = {
    $queryRaw: async () => [],
    gieStationBinding: { findUnique: async () => ({ profile: 'POSTO', origin: 'SIMULATED' }) },
    charger: { findUnique: async () => ({ id: 76, stationId: 46, administrativeStatus: 'PENDING',
      ocppIdentity: 'SIMULATED_DEMO_POSTO_24H_001_EVSE_01' }) },
    labChargeSession: { findUnique: async () => session },
  };
  const db = { ...tx, labChargeIntent: { findUnique: async () => intent, findUniqueOrThrow: async () => intent },
    labChargePayment: { findUnique: async () => ({ id: 'payment-evidence', status: 'APPROVED', amount: session.totalAmount }) },
    labChargeReceipt: { findUnique: async () => null },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) };
  const access = { require: async () => ({ visibility: 'PRIVATE', reviewState: 'DRAFT' }) };
  let mirrorCalls = 0;
  const maquete = { issue: async () => { mirrorCalls++; throw new Error('device START must not be called'); } };
  try {
    Object.assign(process.env, env);
    const service = new ChargingSandboxService(db as never, access as never, maquete as never);
    const result = await service.startFromIntent({ sub: '64' }, '46', intentId, 'repeat-key');
    assert.equal(result.id, sessionId);
    assert.equal(result.status, 'completed');
    assert.equal(result.outcome, 'finished');
    assert.equal('receipt' in result && result.receipt?.transactionId, 'payment-evidence');
    assert.equal(mirrorCalls, 0);
  } finally {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('closing one session never updates or bills the other charger',async()=>{
 for(const target of ['ev1','ev2']) {
  const now=new Date(),start=new Date(+now-10000),decimal=(x:string)=>new Prisma.Decimal(x);
  const sessions:any=Object.fromEntries(['ev1','ev2'].map((id,i)=>[id,{id,intentId:'intent-'+id,stationId:13,actorUserId:105,chargerId:i?49:51,
    status:'CHARGING',startedAt:start,endedAt:null,autoStopAt:new Date(+now+60000),simulatedPowerKw:decimal('7'),energyKwh:decimal('0'),totalAmount:decimal('0'),evse:i?'EV1':'EV3'}]));
  const other=target==='ev1'?'ev2':'ev1',before=JSON.stringify(sessions[other]);const billed:string[]=[];
  const tx:any={$queryRaw:async()=>[],labChargeSession:{findUnique:async(q:any)=>sessions[q.where.id],findUniqueOrThrow:async(q:any)=>sessions[q.where.id],
    update:async(q:any)=>{assert.equal(q.where.id,target);return Object.assign(sessions[q.where.id],q.data);}},
    labChargeIntent:{findUniqueOrThrow:async()=>({id:'intent-'+target,paymentMethod:'pix',pricePerKwh:decimal('2'),fixedFee:decimal('0'),spendingLimit:decimal('20')})},
    labChargeReceipt:{findUnique:async()=>null},labChargePayment:{create:async(q:any)=>{billed.push(q.data.sessionId);}}};
  const db:any={...tx,$transaction:async(fn:any)=>fn(tx)};
  const service:any=new ChargingSandboxService(db,{} as any,{} as any);
  service.assert=()=>{};service.station=async()=>{};service.charger=async()=>({});service.sessionView=(s:any)=>({id:s.id,status:s.status});
  const result=await service.closeSession(target,'stop-one',now,false,{sub:'105'});
  assert.equal(result.id,target);assert.equal(sessions[target].status,'FINISHED');
  assert.equal(JSON.stringify(sessions[other]),before);assert.deepEqual(billed,[target]);
 }
});
