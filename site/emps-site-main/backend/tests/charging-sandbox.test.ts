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
  const db = { ...tx, labChargeIntent: { findUnique: async () => intent },
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
    assert.equal(mirrorCalls, 0);
  } finally {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
