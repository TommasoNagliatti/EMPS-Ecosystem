// Local clone only. No device, physical dispatch, or external payments.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const runtime = JSON.parse(readFileSync(fileURLToPath(new URL('../../EMPS_BACKUPS/emps-legacy-integration.runtime.json', import.meta.url)), 'utf8'));
const base = 'http://127.0.0.1:3011';
const root = '/v2/stations/46/charging-sandbox';
let token;
async function call(path, body, key, expected = body === undefined ? 200 : 201) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {}),
      ...(key ? {'idempotency-key': key} : {}) },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(15000) });
  const payload = await response.json();
  assert.equal(response.status, expected, `${path}: HTTP ${response.status}: ${response.ok ? '' : payload.message}`);
  return payload;
}
token = (await call('/auth/login', {email: runtime.adminEmail, password: runtime.adminPassword}, undefined, 200)).accessToken;
const initial = await call(root);
assert.equal(initial.mode, 'SANDBOX');
assert.ok(initial.sessions.every(s => s.status === 'completed'), 'Existing session active: do not interfere');
assert.equal((await call('/v2/stations/46/lab-device')).connected, false, 'Device must be offline');
const created = new Set();
const evidence = [];
async function state(expectedIds) {
  const data = await call(root);
  const running = data.chargers.filter(c => c.sandboxStatus === 'CHARGING');
  assert.deepEqual(running.map(c => Number(c.chargerId)), expectedIds);
  assert.ok(data.normalScenario, 'Current simulated energy scenario missing');
  assert.ok(Math.abs(data.normalScenario.balanceResidualKw) < 0.000001);
  assert.equal(data.normalScenario.chargerPowerKw, running.reduce((sum,c) => sum + c.simulatedPowerKw, 0));
  assert.ok(data.chargers.every(c => c.physicalStatus !== 'AVAILABLE'));
  evidence.push({active: expectedIds, powerKw: data.normalScenario.chargerPowerKw, balance: data.normalScenario.balanceResidualKw});
}
async function stop(id) { const value = await call(`${root}/sessions/${id}/stop`, {idempotencyKey: randomUUID()}); created.delete(id); return value; }
try {
  await state([]);
  const first = await call(`${root}/chargers/76/cashier-start`, {method:'cash', amountReceived:20, operatorConfirmed:true, idempotencyKey:randomUUID()}); created.add(first.id);
  await state([76]);
  const second = await call(`${root}/chargers/77/cashier-start`, {method:'cash', amountReceived:20, operatorConfirmed:true, idempotencyKey:randomUUID()}); created.add(second.id);
  await state([76,77]);
  await stop(first.id); await state([77]);
  await stop(second.id); await state([]);
  for (const id of [76,77]) {
    const qr = await call(`${root}/chargers/${id}/qr`);
    const resolved = await call('/web-charge/authorized-qr/'+encodeURIComponent(qr.publicToken));
    assert.equal(Number(resolved.charger.id), id);
    assert.equal(resolved.mode,'SANDBOX');
    assert.equal(resolved.physicalGateway,false);
    assert.equal(resolved.charger.sandboxAvailable,true);
    const payment = await call('/web-charge/payment-intents', {chargerId:String(id), method:'pix', spendingLimit:20},randomUUID());
    const startBody = {qrBindingId:String(resolved.qrBindingId),paymentIntentId:String(payment.id),spendingLimit:20};
    const startKey = randomUUID();
    const session = await call('/web-charge/sessions/start',startBody,startKey); created.add(session.id);
    assert.equal(session.provenance,'SANDBOX_ESTIMATE');
    assert.equal((await call('/web-charge/sessions/start',startBody,startKey)).id,session.id);
    await state([id]);
    const stopKey=randomUUID();
    const ended=await call('/web-charge/sessions/'+session.id+'/stop',{},stopKey);
    assert.equal(ended.status,'completed');
    assert.equal(ended.receipt.sandbox,true);
    assert.equal((await call('/web-charge/sessions/'+session.id+'/stop',{},stopKey)).id,ended.id);
    created.delete(session.id);
    await state([]);
  }
  console.log(JSON.stringify({result:'PASS',evidence,browserValidated:false,physicalDeviceValidated:false}));
} finally {
  for(const id of created) {
    try { await stop(id); } catch(error) { console.error(`Test session ${id} requires cleanup: ${error.message}`); }
  }
}
