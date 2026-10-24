// Demonstration-only RFID enrollment/approval/revocation through local APIs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privateRoot = resolve(repo, '..', 'EMPS_BACKUPS');
const account = JSON.parse(readFileSync(resolve(privateRoot, 'emps-legacy-integration.runtime.json'), 'utf8'));
const maquete = JSON.parse(readFileSync(resolve(privateRoot, 'emps-maquete-lab.runtime.json'), 'utf8'));
assert.equal(maquete.stationId, 46);
const api = 'http://127.0.0.1:3011';
const bridge = 'http://127.0.0.1:3012/devices/maquete-01';
const uid = 'A1B2C3D4'; // Synthetic test identifier; not a person's card.

async function call(url, body, headers) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  assert.ok(response.ok, `${new URL(url).pathname}: HTTP ${response.status} ${text.slice(0, 100)}`);
  return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
}

const login = await call(`${api}/auth/login`, { email: account.adminEmail, password: account.adminPassword });
const owner = { authorization: `Bearer ${login.accessToken}` };
const device = { 'x-device-token': maquete.token };
const enrolled = await call(`${api}/v2/stations/46/lab-device/rfid-tags`, { uid, label: 'USUARIO 01' }, owner);
assert.equal(enrolled.source, 'LAB_DISPLAY_ONLY');
const allowed = await call(`${bridge}/rfid`, { uid }, device);
assert.equal(allowed.trim(), 'APPROVED|USUARIO 01');
await call(`${api}/v2/stations/46/lab-device/rfid-tags/${enrolled.id}/revoke`, {}, owner);
const denied = await call(`${bridge}/rfid`, { uid }, device);
assert.equal(denied.trim(), 'DENIED');
const stateResponse = await fetch(`${api}/v2/stations/46/lab-device`, { headers: owner });
assert.equal(stateResponse.status, 200);
const state = await stateResponse.json();
assert.equal(state.evses.EV1.relayActive, false);
assert.equal(state.evses.EV2.relayActive, false);
console.log(JSON.stringify({ result: 'rfid-display-only-pass', approved: true, revoked: true, relaysActive: false }));
