import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { AdminOperationsService } from '../src/admin-operations.service';

function fixture({ session: sessionOverrides = {}, receipt: receiptOverrides = {}, mode = 'sandbox', accepted = true, failure = false, missingReceipt = false } = {} as {
  session?: Record<string, unknown>;
  receipt?: Record<string, unknown>;
  mode?: string;
  accepted?: boolean;
  failure?: boolean;
  missingReceipt?: boolean;
}) {
  const session: any = {
    id: 130n, chargerId: 51, clientId: null, paymentIntentId: null,
    billingMode: 'PREPAID', sessionOrigin: 'ADMIN_SITE', preferredPaymentMethod: 'CASH',
    spendingLimit: new Prisma.Decimal(1), pricePerKwhSnapshot: new Prisma.Decimal('1.99'),
    fixedFeeSnapshot: new Prisma.Decimal(0), startTime: new Date(Date.now() - 75_000),
    status: 'ACTIVE', client: null, ...sessionOverrides,
  };
  const receipt: any = missingReceipt ? null : {
    id: 126n, sessionId: session.id, idempotencyKey: `cash-settle-${session.id}`,
    status: 'APPROVED', method: 'CASH', provider: 'CASH_REGISTER',
    amount: new Prisma.Decimal(1), amountReceived: new Prisma.Decimal(1), paidAt: new Date(),
    ...receiptOverrides,
  };
  const pending: unknown[] = [], commandWrites: any[] = [], dispatched: any[] = [];
  let receiptReads = 0;
  const db: any = {
    charger: { findUnique: async () => ({ id: 51, powerKw: 22, ocppIdentity: 'DEMO03', sessions: session.status === 'ACTIVE' ? [session] : [] }) },
    chargingSession: { update: async ({ data }: any) => { Object.assign(session, data); return session; } },
    chargerLiveStatus: { upsert: async () => ({ operationalStatus: 'AVAILABLE' }) },
    chargingCommand: { create: async () => ({ id: 333n }), update: async ({ data }: any) => { commandWrites.push(data); return data; } },
    payment: {
      findUnique: async ({ where }: any) => { receiptReads++; assert.equal(where.idempotencyKey, 'cash-settle-130'); return receipt; },
      findFirst: async () => receipt,
      upsert: async (args: any) => { pending.push(args); return args.create; },
    },
  };
  db.$transaction = async (callback: any) => callback(db);
  const service = new AdminOperationsService(db, {
    dispatch: async (command: any) => {
      dispatched.push(command);
      if (failure) throw new Error('gateway failed');
      return { accepted, mode, correlationId: 'sandbox_333' };
    },
  } as any, { publish: () => {} } as any, {} as any);
  return { service, session, receipt, pending, commandWrites, dispatched, receiptReads: () => receiptReads };
}

test('prepaid cashier stop finishes the covered session without a second receipt or pending invoice', async () => {
  const f = fixture(), originalReceipt = { ...f.receipt };
  const result = await f.service.sendCommand('51', 'encerrar_carga');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(f.session.status, 'FINISHED');
  assert.ok(f.session.endTime instanceof Date);
  assert.ok(f.session.energyKwh > 0);
  assert.ok(f.session.totalPrice > 0 && f.session.totalPrice <= 1);
  assert.deepEqual(f.pending, []);
  assert.deepEqual(f.receipt, originalReceipt);
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.dispatched[0].type, 'STOP');
  assert.equal(f.receiptReads(), 1);
  await assert.rejects(f.service.sendCommand('51', 'encerrar_carga'), /recarga ativa/);
  assert.equal(f.dispatched.length, 1);
});

for (const [name, overrides] of Object.entries({
  'missing receipt': { missingReceipt: true },
  'pending receipt': { receipt: { status: 'PENDING' } },
  'rejected receipt': { receipt: { status: 'REJECTED' } },
  'insufficient confirmed amount': { receipt: { amount: new Prisma.Decimal('0.10') } },
  'unconfirmed timestamp': { receipt: { paidAt: null } },
  'another session receipt': { receipt: { sessionId: 129n } },
  'external provider': { receipt: { provider: 'stripe' } },
  'noncash method': { receipt: { method: 'CARD' } },
})) {
  test(`prepaid stop does not invent confirmation with ${name}`, async () => {
    const f = fixture(overrides);
    await f.service.sendCommand('51', 'encerrar_carga');
    assert.equal(f.session.status, 'WAITING_PAYMENT');
    assert.equal(f.pending.length, 1);
  });
}

for (const [name, session] of Object.entries({
  postpaid: { billingMode: 'POSTPAID' },
  'customer session': { clientId: 8 },
  'mobile origin': { sessionOrigin: 'MOBILE_APP' },
  'noncash preference': { preferredPaymentMethod: 'CARD' },
})) {
  test(`stop preserves the existing billing path for ${name}`, async () => {
    const f = fixture({ session });
    await f.service.sendCommand('51', 'encerrar_carga');
    assert.equal(f.session.status, 'WAITING_PAYMENT');
    assert.equal(f.pending.length, 1);
    assert.equal(f.receiptReads(), 0);
  });
}

test('physical gateway acceptance still waits for telemetry instead of finishing or collecting money', async () => {
  const f = fixture({ mode: 'gateway' });
  const result = await f.service.sendCommand('51', 'encerrar_carga');
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(f.session.status, 'STOPPING');
  assert.equal(f.session.endTime, undefined);
  assert.equal(f.receiptReads(), 0);
  assert.deepEqual(f.pending, []);
});
test('gateway rejection does not finish a session or create a payment', async () => {
  const f = fixture({ accepted: false });
  await assert.rejects(f.service.sendCommand('51', 'encerrar_carga'), /recusou/);
  assert.equal(f.session.status, 'ACTIVE');
  assert.deepEqual(f.pending, []);
  assert.equal(f.commandWrites.at(-1).status, 'REJECTED');
});
test('gateway failure preserves the active session and logs failure, not financial success', async () => {
  const f = fixture({ failure: true });
  await assert.rejects(f.service.sendCommand('51', 'encerrar_carga'), /gateway failed/);
  assert.equal(f.session.status, 'ACTIVE');
  assert.deepEqual(f.pending, []);
  assert.equal(f.commandWrites.at(-1).status, 'FAILED');
});
test('legacy RFID demo stop remains finished without an individual payment', async () => {
  const f = fixture({ session: { rfidCredentialId: 'rfid_test' } });
  await f.service.sendCommand('51', 'encerrar_carga');
  assert.equal(f.session.status, 'FINISHED');
  assert.deepEqual(f.pending, []);
  assert.equal(f.receiptReads(), 0);
});
