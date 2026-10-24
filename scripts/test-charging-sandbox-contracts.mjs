// Black-box App/Web Charge API contract test against the disposable 3308 clone.
// Uses only the local review account. Never invokes a provider or OCPP gateway.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const account = JSON.parse(readFileSync(resolve(repo, '..', 'EMPS_BACKUPS',
  'emps-legacy-integration.runtime.json'), 'utf8'));
const base = 'http://127.0.0.1:3011';
async function request(method, path, token, body, key, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.text();
  assert.equal(response.status, expected,
    `${method} ${path}: HTTP ${response.status} ${payload.slice(0, 180)}`);
  return payload ? JSON.parse(payload) : null;
}
const login = await request('POST', '/auth/login', undefined,
  { email: account.adminEmail, password: account.adminPassword });
assert.equal(typeof login.accessToken, 'string');
const token = login.accessToken;
const outcomes = [];

for (const [chargerId, evse, channel, method] of [
  [76, 'EV1', 'mobile/v1', 'pix'],
  [77, 'EV2', 'web-charge', 'card'],
]) {
  const qr = await request('GET', `/v2/stations/46/charging-sandbox/chargers/${chargerId}/qr`, token);
  assert.equal(qr.authenticatedOnly, true);
  assert.match(qr.code, /^LAB46-EV[12]-[0-9a-f]{8}$/);
  const publicQr = await fetch(`${base}/web-charge/qr/${encodeURIComponent(qr.code)}`,
    { signal: AbortSignal.timeout(12_000) });
  assert.ok([403, 404].includes(publicQr.status),
    `QR da estação privada exposto publicamente: ${publicQr.status}`);
  const authorizedQrPath = channel === 'mobile/v1' ?
    `/mobile/v1/qr/${encodeURIComponent(qr.code)}` :
    `/web-charge/authorized-qr/${encodeURIComponent(qr.code)}`;
  const resolved = await request('GET', authorizedQrPath, token);
  assert.equal(Number(resolved.charger?.id), chargerId);
  assert.equal(resolved.charger?.sandboxAvailable, true);
  assert.notEqual(resolved.charger?.physicalStatus, 'AVAILABLE');

  const intentKey = randomUUID();
  const intent = await request('POST', `/${channel}/payment-intents`, token,
    { chargerId: String(chargerId), method, spendingLimit: 20 }, intentKey, 201);
  assert.equal(intent.provider, 'sandbox');
  assert.equal(intent.sandbox, true);
  assert.equal(Number(intent.chargerId), chargerId);
  await request('GET', `/${channel}/payment-intents/${intent.id}`, token);

  const startKey = randomUUID();
  const startPath = channel === 'mobile/v1' ? '/mobile/v1/charging-sessions/start' : '/web-charge/sessions/start';
  const started = await request('POST', startPath, token,
    { qrBindingId: String(qr.qrBindingId), paymentIntentId: intent.id,
      spendingLimit: 20, idempotencyKey: startKey }, startKey, 201);
  assert.equal(Number(started.chargerId), chargerId);
  assert.equal(started.evse, evse);
  assert.equal(started.paymentProvider, 'sandbox');
  assert.equal(started.physicalMeter, false);
  const sessionPath = channel === 'mobile/v1' ?
    `/mobile/v1/charging-sessions/${started.id}` : `/web-charge/sessions/${started.id}`;
  await request('GET', sessionPath, token);
  if (channel === 'web-charge') {
    const quote = await request('GET', `/web-charge/sessions/${started.id}/billing`, token);
    assert.equal(quote.provider, 'sandbox');
  }

  await new Promise(resolve => setTimeout(resolve, 3_000));
  const stopPath = channel === 'mobile/v1' ?
    `/mobile/v1/charging-sessions/${started.id}/stop` :
    `/web-charge/sessions/${started.id}/stop`;
  const stopped = await request('POST', stopPath, token, undefined, randomUUID(), 201);
  assert.equal(stopped.status, 'completed');
  assert.equal(stopped.paymentStatus, 'approved');
  assert.ok(stopped.energyKwh > 0 && stopped.totalCost > 0);
  if (channel === 'web-charge') {
    const quote = await request('GET', `/web-charge/sessions/${started.id}/billing`, token);
    assert.equal(quote.provider, 'sandbox');
    await request('POST', `/web-charge/sessions/${started.id}/disconnect`, token, {}, undefined, 201);
    await request('POST', `/web-charge/sessions/${started.id}/payment`, token, {}, undefined, 201);
  }
  outcomes.push({ channel, chargerId, evse, method, sessionId: started.id });
}
console.log(JSON.stringify({ result: 'mobile-web-charge-contracts-pass', stationId: 46,
  publicQrDenied: true, physicalChargerAvailabilityFalsified: false,
  sandboxSessions: outcomes }));
