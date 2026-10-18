// Black-box, local-only ESP32 client simulation. Writes exclusively to lab_* tables.
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
const bridge = 'http://127.0.0.1:3012';
const path = '/devices/maquete-01';
const bootId = `sim_${randomUUID().replaceAll('-', '')}`;

async function request(method, url, body, headers = {}, expected = 200) {
  const response = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${new URL(url).pathname}: HTTP ${response.status} ${text.slice(0, 180)}`);
  if (!text) return null;
  return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
}

const login = await request('POST', `${base}/auth/login`, {
  email: account.adminEmail, password: account.adminPassword,
});
assert.equal(typeof login.accessToken, 'string');
const userHeaders = { authorization: `Bearer ${login.accessToken}` };
const deviceHeaders = { 'x-device-token': maquete.token };
const station = `${base}/v2/stations/46/lab-device`;
const device = `${bridge}${path}`;

const unrelated = await request('GET', `${base}/v2/stations/13/lab-device`, undefined, userHeaders);
assert.equal(unrelated.available, false);
await request('POST', `${base}/v2/stations/13/lab-device/commands`,
  { evse: 'EV1', enabled: true, requestId: randomUUID() }, userHeaders, 403);
await request('GET', `${device}/commands/next`, undefined, {}, 403);
await request('GET', `${device}/commands/next`, undefined, { 'x-device-token': 'bad-token' }, 403);

let ev1 = false;
let ev2 = false;
let lastCommandId = null;
async function heartbeat() {
  return request('POST', `${device}/heartbeat`,
    { bootId, ev1, ev2, lastCommandId: lastCommandId ?? undefined }, deviceHeaders);
}
await heartbeat();
let current = await request('GET', station, undefined, userHeaders);
assert.equal(current.available, true);
assert.equal(current.bound, true);
assert.equal(Number(current.stationId), 46);
assert.equal(current.connected, true);
assert.equal(current.connectionSource, 'SIMULATOR');

// A fresh boot invalidates earlier starts. Drain any pending safety STOP from a prior smoke run.
for (let count = 0; count < 4; count++) {
  const response = await fetch(`${device}/commands/next`, {
    headers: deviceHeaders, signal: AbortSignal.timeout(10_000),
  });
  assert.ok([200, 204].includes(response.status));
  if (response.status === 204) break;
  const queued = await response.text();
  const [id, action] = queued.split('|');
  assert.match(action, /^EV[12]=0$/, 'Only a safety STOP can remain after a new boot');
  lastCommandId = id;
  await request('POST', `${device}/commands/ack`,
    { commandId: id, accepted: true, ev1: false, ev2: false }, deviceHeaders);
}

async function command(evse, enabled) {
  const requestId = randomUUID();
  const created = await request('POST', `${station}/commands`, { evse, enabled, requestId }, userHeaders, 201);
  assert.equal(created.command.evse, evse);
  assert.equal(created.command.enabled, enabled);
  const duplicate = await request('POST', `${station}/commands`, { evse, enabled, requestId }, userHeaders, 201);
  assert.equal(duplicate.command.id, created.command.id);
  const next = await request('GET', `${device}/commands/next`, undefined, deviceHeaders);
  const [id, action, ttl] = next.trim().split('|');
  assert.equal(id, created.command.id);
  assert.equal(action, `${evse}=${enabled ? 1 : 0}`);
  assert.ok(Number(ttl) > 0);
  if (evse === 'EV1') ev1 = enabled;
  else ev2 = enabled;
  const ack = await request('POST', `${device}/commands/ack`,
    { commandId: id, accepted: true, ev1, ev2 }, deviceHeaders);
  assert.equal(ack.status, 'ACKED');
  const secondAck = await request('POST', `${device}/commands/ack`,
    { commandId: id, accepted: true, ev1, ev2 }, deviceHeaders);
  assert.equal(secondAck.duplicate, true);
  lastCommandId = id;
  await heartbeat();
  const state = await request('GET', station, undefined, userHeaders);
  assert.equal(state.evses[evse].relayActive, enabled);
  assert.equal(state.evses[evse].lastCommandId, id);
  return state;
}

current = await command('EV1', true);
assert.equal(current.evses.EV2.relayActive, false);
current = await command('EV2', true);
assert.equal(current.evses.EV1.relayActive, true);
current = await command('EV1', false);
assert.equal(current.evses.EV2.relayActive, true);
current = await command('EV2', false);
assert.equal(current.evses.EV1.relayActive, false);

// A revoked START is never an authorization, even if its late ACK reports GPIO LOW.
const lateStart = await request('POST', `${station}/commands`,
  { evse: 'EV1', enabled: true, requestId: randomUUID() }, userHeaders, 201);
const deliveredStart = await request('GET', `${device}/commands/next`, undefined, deviceHeaders);
assert.equal(deliveredStart.split('|')[0], lateStart.command.id);
const safetyStop = await request('POST', `${station}/commands`,
  { evse: 'EV1', enabled: false, requestId: randomUUID() }, userHeaders, 201);
const lateAck = await request('POST', `${device}/commands/ack`,
  { commandId: lateStart.command.id, accepted: true, ev1: true, ev2: false }, deviceHeaders);
assert.notEqual(lateAck.status, 'ACKED');
ev1 = false; // Firmware fail-safe immediately turns its relay off on non-ACKED response.
const safeText = await heartbeat();
assert.match(safeText, /ev1Authorized=0/);
const stopWire = await request('GET', `${device}/commands/next`, undefined, deviceHeaders);
assert.equal(stopWire.split('|')[0], safetyStop.command.id);
const stopAck = await request('POST', `${device}/commands/ack`,
  { commandId: safetyStop.command.id, accepted: true, ev1: false, ev2: false }, deviceHeaders);
assert.equal(stopAck.status, 'ACKED');

const unknownTag = await request('POST', `${device}/rfid`, { uid: 'A1B2C3D4' }, deviceHeaders);
assert.equal(unknownTag.trim(), 'DENIED');
current = await request('GET', station, undefined, userHeaders);
assert.equal(current.evses.EV1.relayActive, false);
assert.equal(current.evses.EV2.relayActive, false);

console.log(JSON.stringify({
  result: 'simulator-pass', stationId: 46, deviceId: 'maquete-01',
  ev1: current.evses.EV1.state, ev2: current.evses.EV2.state,
  gieValid: current.gie.valid, scenarioAt: current.gie.scenarioAt,
  rfidUnknown: 'DENIED', operationalWrites: 'none',
}));
