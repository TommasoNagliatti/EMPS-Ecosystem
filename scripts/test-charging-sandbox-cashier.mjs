// Black-box cashier test for the disposable local integration clone only.
// Run only after patch 0006 and the isolated API on 127.0.0.1:3011 are ready.
// The operator-confirmed receipts and sessions created here are SANDBOX records.
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
const cents = value => {
  const amount = Number(value);
  assert.ok(Number.isFinite(amount), 'Expected a finite monetary amount');
  return Math.round(amount * 100);
};
const ids = state => state.sessions.map(session => session.id).sort();

async function call(method, path, token, body, expected = 200) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12_000),
  });
  assert.equal(response.status, expected, `${method} ${path}: HTTP ${response.status}; expected ${expected}`);
  const payload = await response.text();
  return payload ? JSON.parse(payload) : null;
}

function checkCashier(view, { chargerId, evse, method, status }) {
  assert.equal(Number(view.stationId), 46);
  assert.equal(Number(view.chargerId), chargerId);
  assert.equal(view.evse, evse);
  assert.equal(view.status, status);
  assert.equal(view.paymentMethod, method);
  assert.equal(view.cashier, true);
  assert.equal(view.paymentStatus, 'received');
  assert.equal(view.receiptSource, 'OPERATOR_CONFIRMED');
  assert.equal(view.provenance, 'SANDBOX_ESTIMATE');
  assert.equal(view.paymentProvider, 'sandbox');
  assert.equal(view.physicalMeter, false);
  assert.equal(cents(view.amountReceived), 2000);
  assert.equal(cents(view.totalCost), cents(view.consumedAmount));
  assert.equal(cents(view.consumedAmount) + cents(view.remainingCredit), 2000);
  assert.equal(Number(view.estimatedKwhAtStart), 10);
  assert.equal(Number(view.pricePerKwh), 2);
  assert.ok(Number.isFinite(Date.parse(view.autoStopAt)), 'Budget deadline is missing');
}

const login = await call('POST', '/auth/login', undefined,
  { email: runtime.adminEmail, password: runtime.adminPassword });
assert.equal(typeof login.accessToken, 'string');
const token = login.accessToken;

// Abort before any successful POST if another local operator is charging or a device is online.
const initial = await call('GET', sandbox, token);
assert.equal(initial.mode, 'SANDBOX');
assert.equal(Number(initial.stationId), 46);
assert.deepEqual(initial.chargers.map(card => Number(card.chargerId)), [76, 77]);
assert.deepEqual(initial.chargers.map(card => card.evse), ['EV1', 'EV2']);
assert.ok(initial.sessions.every(session => session.status === 'completed'),
  'An existing SANDBOX session is active; finish it separately before this test');
for (const card of initial.chargers) {
  assert.notEqual(card.physicalStatus, 'AVAILABLE', 'A PENDING charger must not appear physically available');
  assert.equal(card.provenance, 'SANDBOX_ESTIMATE');
}
const device = await call('GET', '/v2/stations/46/lab-device', token);
assert.equal(device.connected, false, 'Disconnect the simulator/bridge before the offline cashier test');

const rejectedBody = { method: 'cash', amountReceived: 20,
  operatorConfirmed: true, idempotencyKey: randomUUID() };
await call('POST', `${sandbox}/chargers/76/cashier-start`, undefined, rejectedBody, 401);
await call('POST', `${sandbox}/chargers/76/cashier-start`, token,
  { ...rejectedBody, operatorConfirmed: false, idempotencyKey: randomUUID() }, 400);
await call('POST', `${sandbox}/chargers/76/cashier-start`, token,
  { ...rejectedBody, method: 'pix', idempotencyKey: randomUUID() }, 400);
await call('POST', '/v2/stations/13/charging-sandbox/chargers/76/cashier-start',
  token, { ...rejectedBody, idempotencyKey: randomUUID() }, 403);
const afterRejections = await call('GET', sandbox, token);
assert.deepEqual(ids(afterRejections), ids(initial), 'Rejected requests created a SANDBOX session');

const open = new Set();
const results = [];
try {
  for (const [chargerId, evse, method] of [[76, 'EV1', 'cash'], [77, 'EV2', 'pos']]) {
    const path = `${sandbox}/chargers/${chargerId}/cashier-start`;
    const body = { method, amountReceived: 20, operatorConfirmed: true, idempotencyKey: randomUUID() };
    const started = await call('POST', path, token, body, 201);
    open.add(started.id);
    checkCashier(started, { chargerId, evse, method, status: 'charging' });
    assert.equal(started.returnStatus, 'NONE');
    assert.equal(started.deviceMirror, 'UNAVAILABLE', 'Offline device must not confirm a physical START');

    const duplicateStart = await call('POST', path, token, body, 201);
    assert.equal(duplicateStart.id, started.id, 'Same cashier key created another session');
    checkCashier(duplicateStart, { chargerId, evse, method, status: 'charging' });
    await call('POST', path, token, { ...body, method: method === 'cash' ? 'pos' : 'cash' }, 409);

    const active = await call('GET', sandbox, token);
    const card = active.chargers.find(row => Number(row.chargerId) === chargerId);
    assert.equal(card?.sandboxStatus, 'CHARGING');
    assert.equal(card?.session?.id, started.id);
    assert.notEqual(card?.physicalStatus, 'AVAILABLE');
    assert.equal(active.sessions.filter(row => row.id === started.id).length, 1);

    await new Promise(resolve => setTimeout(resolve, 3_000));
    const stopPath = `${sandbox}/sessions/${started.id}/stop`;
    const stopBody = { idempotencyKey: randomUUID() };
    const stopped = await call('POST', stopPath, token, stopBody, 201);
    open.delete(started.id);
    checkCashier(stopped, { chargerId, evse, method, status: 'completed' });
    assert.ok(stopped.energyKwh > 0, 'Early stop has no estimated energy');
    assert.ok(cents(stopped.consumedAmount) > 0 && cents(stopped.consumedAmount) < 2000,
      'Early stop should consume less than the R$ 20 received');
    assert.equal(stopped.returnStatus, 'PENDING', 'Unused cashier balance must remain pending');

    const duplicateStop = await call('POST', stopPath, token, stopBody, 201);
    assert.equal(duplicateStop.id, stopped.id);
    assert.equal(cents(duplicateStop.consumedAmount), cents(stopped.consumedAmount));
    assert.equal(cents(duplicateStop.remainingCredit), cents(stopped.remainingCredit));
    const lateStartReplay = await call('POST', path, token, body, 201);
    assert.equal(lateStartReplay.id, stopped.id, 'Replay after STOP created another session');
    assert.equal(lateStartReplay.status, 'completed');
    assert.equal(cents(lateStartReplay.remainingCredit), cents(stopped.remainingCredit));
    results.push({ chargerId, evse, method, sessionId: stopped.id,
      amountReceived: stopped.amountReceived, consumedAmount: stopped.consumedAmount,
      remainingCredit: stopped.remainingCredit, returnStatus: stopped.returnStatus });
  }
} finally {
  // On a failed assertion, leave no test session charging. Never change another session.
  for (const sessionId of open) {
    try {
      await call('POST', `${sandbox}/sessions/${sessionId}/stop`, token,
        { idempotencyKey: randomUUID() }, 201);
    } catch {
      console.error(`Could not stop test SANDBOX session ${sessionId}; inspect it locally`);
    }
  }
}

const final = await call('GET', sandbox, token);
const newIds = ids(final).filter(id => !ids(initial).includes(id));
assert.deepEqual(newIds, results.map(row => row.sessionId).sort(),
  'Replays or rejected calls created duplicate sessions');
for (const result of results) {
  const row = final.sessions.find(session => session.id === result.sessionId);
  assert.equal(final.sessions.filter(session => session.id === result.sessionId).length, 1);
  checkCashier(row, { ...result, status: 'completed' });
  assert.equal(cents(row.consumedAmount), cents(result.consumedAmount));
  assert.equal(cents(row.remainingCredit), cents(result.remainingCredit));
  assert.equal(row.returnStatus, 'PENDING');
}
console.log(JSON.stringify({ result: 'cashier-sandbox-pass', stationId: 46,
  negativeRequestsRejected: 4, deviceConnected: false, physicalMeter: false,
  newSessionCount: newIds.length, sessions: results,
  receiptRowCount: 'requires separate read-only database verification' }));
