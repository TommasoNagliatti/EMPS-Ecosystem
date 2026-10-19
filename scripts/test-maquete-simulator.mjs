// Black-box lab mirror test. Charging starts in the normal SANDBOX flow;
// this client only emulates ESP32 heartbeat/GPIO ACK and never touches hardware.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privateRoot = resolve(repo, '..', 'EMPS_BACKUPS');
const account = JSON.parse(readFileSync(resolve(privateRoot, 'emps-legacy-integration.runtime.json'), 'utf8'));
const maquete = JSON.parse(readFileSync(resolve(privateRoot, 'emps-maquete-lab.runtime.json'), 'utf8'));
assert.equal(maquete.deviceId, 'maquete-01');
assert.equal(maquete.stationId, 46);
const base = 'http://127.0.0.1:3011';
const device = 'http://127.0.0.1:3012/devices/maquete-01';
const sandbox = `${base}/v2/stations/46/charging-sandbox`;
const lab = `${base}/v2/stations/46/lab-device`;
const bootId = `sim_${randomUUID().replaceAll('-', '')}`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(method, url, body, headers = {}, expected = 200) {
  const response = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  assert.equal(response.status, expected,
    `${method} ${new URL(url).pathname}: HTTP ${response.status} ${text.slice(0, 180)}`);
  if (!text) return null;
  return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
}

const login = await request('POST', `${base}/auth/login`, {
  email: account.adminEmail, password: account.adminPassword,
});
assert.equal(typeof login.accessToken, 'string');
const userHeaders = { authorization: `Bearer ${login.accessToken}` };
const deviceHeaders = { 'x-device-token': maquete.token };

await request('GET', `${base}/v2/stations/13/charging-sandbox`, undefined, userHeaders, 403);
await request('POST', `${lab}/commands`,
  { evse: 'EV1', enabled: true, requestId: randomUUID() }, userHeaders, 409);
await request('GET', `${device}/commands/next`, undefined, {}, 403);
await request('GET', `${device}/commands/next`, undefined, { 'x-device-token': 'bad-token' }, 403);

const initial = await request('GET', lab, undefined, userHeaders);
assert.equal(initial.bound, true);
if (initial.connected) {
  // A previous one-shot simulator can still be visible until its heartbeat expires.
  await wait(13_000);
  const active = await request('GET', lab, undefined, userHeaders);
  if (active.connected) throw new Error('Outro cliente da maquete está ativo; encerre-o antes do teste');
}

let ev1 = false;
let ev2 = false;
let lastCommandId = null;
const activeSessions = new Set();
async function heartbeat() {
  return request('POST', `${device}/heartbeat`, {
    bootId, ev1, ev2, ...(lastCommandId ? { lastCommandId } : {}),
  }, deviceHeaders);
}
await heartbeat();
let current = await request('GET', lab, undefined, userHeaders);
assert.equal(current.connected, true);
assert.equal(current.connectionSource, 'SIMULATOR');

async function next(expectedAction, attempts = 40) {
  for (let count = 0; count < attempts; count++) {
    const response = await fetch(`${device}/commands/next`, {
      headers: deviceHeaders, signal: AbortSignal.timeout(10_000),
    });
    assert.ok([200, 204].includes(response.status), `Fila da maquete: HTTP ${response.status}`);
    if (response.status === 200) {
      const [id, action, ttlText] = (await response.text()).trim().split('|');
      assert.match(id, /^[0-9a-f-]{36}$/i);
      assert.ok(Number(ttlText) > 0 && Number(ttlText) <= 15_000);
      assert.equal(action, expectedAction);
      return id;
    }
    await wait(100);
  }
  throw new Error(`Comando ${expectedAction} não apareceu na fila`);
}
async function ack(id, accepted = true) {
  return request('POST', `${device}/commands/ack`, {
    commandId: id, accepted, ev1, ev2,
  }, deviceHeaders);
}
async function drainSafetyStops() {
  for (let count = 0; count < 4; count++) {
    const response = await fetch(`${device}/commands/next`, {
      headers: deviceHeaders, signal: AbortSignal.timeout(10_000),
    });
    assert.ok([200, 204].includes(response.status));
    if (response.status === 204) return;
    const [id, action] = (await response.text()).trim().split('|');
    assert.match(action, /^EV[12]=0$/, 'Após novo boot somente STOP de segurança pode permanecer');
    const result = await ack(id);
    assert.equal(result.status, 'ACKED');
    lastCommandId = id;
  }
  throw new Error('A fila de STOP de segurança não esvaziou');
}
await drainSafetyStops();

async function charge(chargerId, evse, method) {
  const startKey = randomUUID();
  const input = { method, spendingLimit: 20, idempotencyKey: startKey };
  const started = await request('POST', `${sandbox}/chargers/${chargerId}/start`, input, userHeaders, 201);
  activeSessions.add(started.id);
  assert.equal(started.status, 'charging');
  assert.equal(Number(started.chargerId), chargerId);
  assert.equal(started.evse, evse);
  assert.equal(started.paymentProvider, 'sandbox');
  assert.equal(started.physicalMeter, false);
  assert.equal(started.provenance, 'SANDBOX_ESTIMATE');
  const duplicate = await request('POST', `${sandbox}/chargers/${chargerId}/start`, input, userHeaders, 201);
  assert.equal(duplicate.id, started.id);

  const startedState = await request('GET', sandbox, undefined, userHeaders);
  assert.equal(startedState.mode, 'SANDBOX');
  assert.equal(startedState.chargers.find(c => Number(c.chargerId) === chargerId)?.sandboxStatus, 'CHARGING');
  const startId = await next(`${evse}=1`);
  if (evse === 'EV1') ev1 = true;
  else ev2 = true;
  const startAck = await ack(startId);
  assert.equal(startAck.status, 'ACKED');
  const duplicateAck = await ack(startId);
  assert.equal(duplicateAck.duplicate, true);
  lastCommandId = startId;
  await heartbeat();
  current = await request('GET', lab, undefined, userHeaders);
  assert.equal(current.evses[evse].relayActive, true);

  const stopKey = randomUUID();
  const stopInput = { idempotencyKey: stopKey };
  const completed = await request('POST', `${sandbox}/sessions/${started.id}/stop`, stopInput, userHeaders, 201);
  activeSessions.delete(started.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.paymentProvider, 'sandbox');
  assert.equal(completed.paymentStatus, 'approved');
  assert.equal(completed.physicalMeter, false);
  const repeatedStop = await request('POST', `${sandbox}/sessions/${started.id}/stop`, stopInput, userHeaders, 201);
  assert.equal(repeatedStop.id, completed.id);
  const stopId = await next(`${evse}=0`);
  if (evse === 'EV1') ev1 = false;
  else ev2 = false;
  const stopAck = await ack(stopId);
  assert.equal(stopAck.status, 'ACKED');
  lastCommandId = stopId;
  await heartbeat();
  current = await request('GET', lab, undefined, userHeaders);
  assert.equal(current.evses[evse].relayActive, false);
  const completedState = await request('GET', sandbox, undefined, userHeaders);
  assert.equal(completedState.sessions.find(s => s.id === started.id)?.status, 'completed');
  const completedRetry = await request('POST', `${sandbox}/chargers/${chargerId}/start`, input, userHeaders, 201);
  assert.equal(completedRetry.id, started.id);
  assert.equal(completedRetry.status, 'completed');
  const afterRetry = await fetch(`${device}/commands/next`, {
    headers: deviceHeaders, signal: AbortSignal.timeout(10_000),
  });
  assert.equal(afterRetry.status, 204, 'Repetir START após STOP não pode enfileirar novo comando para a maquete');
  return { started, completed };
}

try {
  const first = await charge(76, 'EV1', 'pix');
  const second = await charge(77, 'EV2', 'card');
  assert.notEqual(first.started.id, second.started.id);

  // A STOP delivered before a late START ACK revokes the device authorization.
  const late = await request('POST', `${sandbox}/chargers/76/start`,
    { method: 'wallet', spendingLimit: 20, idempotencyKey: randomUUID() }, userHeaders, 201);
  activeSessions.add(late.id);
  const lateStartId = await next('EV1=1');
  await request('POST', `${sandbox}/sessions/${late.id}/stop`, { idempotencyKey: randomUUID() }, userHeaders, 201);
  activeSessions.delete(late.id);
  const safetyStopId = await next('EV1=0');
  ev1 = true; // The emulated late GPIO report must not reauthorize a completed session.
  const lateAck = await ack(lateStartId);
  assert.notEqual(lateAck.status, 'ACKED');
  ev1 = false; // Firmware would fail safe when a late ACK is rejected.
  const safeText = await heartbeat();
  assert.match(safeText, /ev1Authorized=0/);
  const stopAck = await ack(safetyStopId);
  assert.equal(stopAck.status, 'ACKED');
  lastCommandId = safetyStopId;

  const unknownTag = await request('POST', `${device}/rfid`, { uid: 'A1B2C3D4' }, deviceHeaders);
  assert.equal(unknownTag.trim(), 'DENIED');
  current = await request('GET', lab, undefined, userHeaders);
  assert.equal(current.evses.EV1.relayActive, false);
  assert.equal(current.evses.EV2.relayActive, false);

  console.log(JSON.stringify({
    result: 'sandbox-device-mirror-pass', stationId: 46, deviceId: 'maquete-01',
    client: 'SIMULATOR', chargers: [76, 77], completedSessions: 3,
    paymentMethods: ['pix', 'card', 'wallet'], lateAck: lateAck.status,
    gieValid: current.gie.valid, scenarioAt: current.gie.scenarioAt,
    hardwareTested: false,
  }));
} finally {
  for (const id of activeSessions) {
    try { await request('POST', `${sandbox}/sessions/${id}/stop`, { idempotencyKey: randomUUID() }, userHeaders, 201); }
    catch { /* A failed test must not conceal its original error. */ }
  }
  ev1 = false;
  ev2 = false;
  try { await heartbeat(); } catch { /* Backend may have stopped. */ }
}
