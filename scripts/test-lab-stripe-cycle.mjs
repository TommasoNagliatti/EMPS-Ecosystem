import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../site/emps-site-main/backend/package.json', import.meta.url));
const envFile = path => Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(s => /^[A-Z_]+=/.test(s)).map(s => {
  const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
}));
const env = envFile(new URL('../../EMPS_BACKUPS/emps-legacy-integration.mysql.env', import.meta.url));
assert.equal(env.MYSQL_USER, 'emps_integration_app'); assert.equal(env.MYSQL_DATABASE, 'emps_integration_test');
const key = envFile(new URL('../site/emps-site-main/backend/.env.presentation', import.meta.url)).STRIPE_SECRET_KEY;
assert.ok(key.startsWith('sk_test_'));
const stripe = new (require('stripe'))(key);
const db = new (require('@prisma/client').PrismaClient)({ datasources: { db: { url: `mysql://${env.MYSQL_USER}:${encodeURIComponent(env.MYSQL_PASSWORD)}@127.0.0.1:3308/emps_integration_test` } } });
const runtime = JSON.parse(readFileSync(new URL('../../EMPS_BACKUPS/emps-legacy-integration.runtime.json', import.meta.url), 'utf8'));
let token, session, intentId;
async function call(path, body, idempotencyKey) {
  const r = await fetch('http://127.0.0.1:3011' + path, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = await r.json(); assert.ok(r.ok, `${path}: HTTP ${r.status}`); return data;
}
const counts = async () => [await db.chargingSession.count(), await db.payment.count(), await db.paymentIntent.count()];
try {
  const before = await counts();
  assert.equal(await db.labChargeSession.count({ where: { chargerId: 49, status: { in: ['CHARGING', 'STARTING', 'FINISHING'] } } }), 0, 'Preserve any active user session');
  token = (await call('/auth/login', { email: runtime.adminEmail, password: runtime.adminPassword })).accessToken;
  const qr = await db.qrBinding.findFirstOrThrow({ where: { chargerId: 49, isActive: true } });
  const intent = await call('/web-charge/payment-intents', { chargerId: '49', method: 'card', spendingLimit: 20 }, randomUUID());
  intentId = intent.id; assert.equal(intent.provider, 'stripe'); assert.equal(intent.status, 'requires_action');
  const row = await db.labChargeIntent.findUniqueOrThrow({ where: { id: intent.id } });
  const confirmed = await stripe.paymentIntents.confirm(row.cardIntentId, { payment_method: 'pm_card_visa' });
  assert.equal(confirmed.livemode, false); assert.equal(confirmed.status, 'requires_capture');
  assert.equal((await call('/web-charge/payment-intents/' + intent.id)).status, 'authorized');
  session = await call('/web-charge/sessions/start', { qrBindingId: String(qr.id), paymentIntentId: intent.id, spendingLimit: 20 }, randomUUID());
  assert.equal(session.status, 'charging');
  const stopKey = randomUUID();
  const ended = await call('/web-charge/sessions/' + session.id + '/stop', {}, stopKey);
  assert.equal(ended.status, 'completed'); assert.equal(ended.receipt.provider, 'stripe_test');
  const repeated = await call('/web-charge/sessions/' + session.id + '/stop', {}, stopKey);
  assert.equal(repeated.receipt.transactionId, ended.receipt.transactionId);
  assert.equal(await db.labChargePayment.count({ where: { sessionId: session.id } }), 1);
  const pi = await stripe.paymentIntents.retrieve(row.cardIntentId);
  assert.equal(pi.status, 'succeeded'); assert.equal(pi.livemode, false);
  assert.equal(pi.amount_received, Math.round(Number(ended.receipt.amountPaid) * 100));
  assert.deepEqual(await counts(), before);
  console.log(JSON.stringify({ result: 'PASS', sessionId: session.id, capturedTestBRL: ended.receipt.amountPaid, duplicatePayments: 0, operationalCounts: before }));
} finally {
  if (session) {
    const stored = await db.labChargeSession.findUnique({ where: { id: session.id } });
    if (stored?.status === 'CHARGING') await call('/web-charge/sessions/' + session.id + '/stop', {}, randomUUID());
  } else if (intentId) await call('/web-charge/payment-intents/' + intentId + '/cancel', {});
  await db.$disconnect();
}
