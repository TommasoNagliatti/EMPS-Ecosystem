// Verifies the disposable local clone's prepaid background deadline without browser polling.
// Creates one R$ 1 operator-confirmed SANDBOX charge, never an operational payment.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = JSON.parse(readFileSync(resolve(repo, '..', 'EMPS_BACKUPS',
  'emps-legacy-integration.runtime.json'), 'utf8'));
const api = 'http://127.0.0.1:3011';
const sandbox = '/v2/stations/46/charging-sandbox';

async function call(method, path, token, body, status = 200) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, status, `${method} ${path}: HTTP ${response.status}`);
  return response.json();
}

const login = await call('POST', '/auth/login', undefined,
  { email: runtime.adminEmail, password: runtime.adminPassword });
const token = login.accessToken;
const initial = await call('GET', sandbox, token);
assert.equal(initial.mode, 'SANDBOX');
assert.ok(initial.sessions.every(row => row.status === 'completed'),
  'Another SANDBOX session is active; do not interfere with it');
const charger = initial.chargers.find(row => Number(row.chargerId) === 76);
assert.equal(charger?.evse, 'EV1');
assert.notEqual(charger?.physicalStatus, 'AVAILABLE');

let started;
try {
  started = await call('POST', `${sandbox}/chargers/76/cashier-start`, token,
    { method: 'cash', amountReceived: 1, operatorConfirmed: true,
      idempotencyKey: randomUUID() }, 201);
  assert.equal(started.status, 'charging');
  assert.equal(started.amountReceived, 1);
  assert.equal(started.estimatedKwhAtStart, 0.5);
  assert.equal(started.provenance, 'SANDBOX_ESTIMATE');
  const waitMs = Date.parse(started.autoStopAt) + 6_000 - Date.now();
  assert.ok(waitMs > 0 && waitMs < 180_000, 'Unexpected prepaid deadline');
  await new Promise(resolve => setTimeout(resolve, waitMs)); // Deliberately no HTTP poll.
  const settled = await call('GET', sandbox, token);
  const session = settled.sessions.find(row => row.id === started.id);
  assert.equal(session?.status, 'completed');
  assert.equal(session?.paymentMethod, 'cash');
  assert.equal(session?.paymentStatus, 'received');
  assert.equal(session?.amountReceived, 1);
  assert.equal(session?.energyKwh, 0.5);
  assert.equal(session?.consumedAmount, 1);
  assert.equal(session?.remainingCredit, 0);
  assert.equal(session?.returnStatus, 'NONE');
  assert.equal(session?.physicalMeter, false);
  assert.equal(settled.chargers.find(row => Number(row.chargerId) === 76)?.sandboxStatus, 'FINISHED');
  console.log(JSON.stringify({ result: 'prepaid-background-deadline-pass', stationId: 46,
    chargerId: 76, sessionId: session.id, amountReceived: 1, estimatedKwh: 0.5,
    consumedAmount: 1, remainingCredit: 0, physicalMeter: false,
    elapsedSeconds: Math.round((Date.now() - Date.parse(started.startedAt)) / 1000) }));
} finally {
  if (started) {
    try {
      const state = await call('GET', sandbox, token);
      if (state.sessions.find(row => row.id === started.id)?.status === 'charging') {
        await call('POST', `${sandbox}/sessions/${started.id}/stop`, token,
          { idempotencyKey: randomUUID() }, 201);
        console.error('Test charge was stopped during cleanup; inspect deadline failure');
      }
    } catch {
      console.error(`Could not confirm cleanup for SANDBOX session ${started.id}`);
    }
  }
}
