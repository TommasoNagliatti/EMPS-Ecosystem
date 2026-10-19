// Local black-box charging test with no ESP32, GPIO, OCPP, or external payment.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = JSON.parse(readFileSync(resolve(repo, '..', 'EMPS_BACKUPS',
  'emps-legacy-integration.runtime.json'), 'utf8'));
const api = 'http://127.0.0.1:3011';
const endpoint = `${api}/v2/stations/46/charging-sandbox`;

async function call(method, url, body, token, expected = 200) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12_000),
  });
  const value = await response.text();
  assert.equal(response.status, expected,
    `${method} ${new URL(url).pathname}: HTTP ${response.status} ${value.slice(0, 180)}`);
  return value ? JSON.parse(value) : null;
}

const login = await call('POST', `${api}/auth/login`, {
  email: runtime.adminEmail, password: runtime.adminPassword,
});
assert.equal(typeof login.accessToken, 'string');
const token = login.accessToken;
await call('GET', `${api}/v2/stations/13/charging-sandbox`, undefined, token, 403);
await call('GET', `${endpoint}/chargers/76/qr`, undefined, undefined, 401);

const initial = await call('GET', endpoint, undefined, token);
assert.equal(initial.mode, 'SANDBOX');
assert.equal(Number(initial.stationId), 46);
assert.deepEqual(initial.chargers.map(row => Number(row.chargerId)), [76, 77]);
assert.deepEqual(initial.chargers.map(row => row.evse), ['EV1', 'EV2']);
for (const card of initial.chargers) {
  assert.notEqual(card.physicalStatus, 'AVAILABLE', 'PENDING charger cannot become physically available');
  assert.equal(card.provenance, 'SANDBOX_ESTIMATE');
}
const qr = await call('GET', `${endpoint}/chargers/76/qr`, undefined, token);
assert.equal(qr.authenticatedOnly, true);
assert.equal(Number(qr.chargerId), 76);
assert.equal(typeof qr.publicToken, 'string');

const results = [];
for (const [chargerId, evse, method] of [[76, 'EV1', 'pix'], [77, 'EV2', 'card'], [76, 'EV1', 'wallet']]) {
  const startKey = randomUUID();
  const startBody = { method, spendingLimit: 20, idempotencyKey: startKey };
  const started = await call('POST', `${endpoint}/chargers/${chargerId}/start`, startBody, token, 201);
  assert.equal(started.status, 'charging');
  assert.equal(Number(started.chargerId), chargerId);
  assert.equal(started.evse, evse);
  assert.equal(started.paymentProvider, 'sandbox');
  assert.equal(started.physicalMeter, false);
  assert.equal(started.provenance, 'SANDBOX_ESTIMATE');
  const duplicateStart = await call('POST', `${endpoint}/chargers/${chargerId}/start`, startBody, token, 201);
  assert.equal(duplicateStart.id, started.id);
  const active = await call('GET', endpoint, undefined, token);
  assert.equal(active.chargers.find(row => Number(row.chargerId) === chargerId)?.sandboxStatus, 'CHARGING');
  await new Promise(resolve => setTimeout(resolve, 3_000));

  const stopBody = { idempotencyKey: randomUUID() };
  const stopped = await call('POST', `${endpoint}/sessions/${started.id}/stop`, stopBody, token, 201);
  assert.equal(stopped.status, 'completed');
  assert.equal(stopped.paymentStatus, 'approved');
  assert.equal(stopped.paymentProvider, 'sandbox');
  assert.equal(stopped.physicalMeter, false);
  assert.ok(stopped.energyKwh > 0 && stopped.totalCost > 0 && stopped.totalCost <= 20);
  const duplicateStop = await call('POST', `${endpoint}/sessions/${started.id}/stop`, stopBody, token, 201);
  assert.equal(duplicateStop.id, stopped.id);
  results.push({ chargerId, evse, method, sessionId: stopped.id,
    estimatedKwh: stopped.energyKwh, sandboxAmount: stopped.totalCost });
}

const final = await call('GET', endpoint, undefined, token);
for (const result of results) {
  assert.equal(final.sessions.find(row => row.id === result.sessionId)?.status, 'completed');
  assert.equal(final.chargers.find(row => Number(row.chargerId) === result.chargerId)?.sandboxStatus, 'FINISHED');
}
console.log(JSON.stringify({ result: 'stage1-sandbox-pass', stationId: 46,
  sessions: results, operationalLedgerCheck: 'verify clone counts separately', deviceRequired: false,
  physicalMeter: false }));
