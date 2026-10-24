// Read-only regression check for all four GIE station contexts after lab bridge startup.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const account = JSON.parse(readFileSync(resolve(repo, '..', 'EMPS_BACKUPS', 'emps-legacy-integration.runtime.json'), 'utf8'));
const base = 'http://127.0.0.1:3011';
const login = await fetch(`${base}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: account.adminEmail, password: account.adminPassword }),
  signal: AbortSignal.timeout(10_000),
});
assert.equal(login.status, 200);
const auth = { authorization: `Bearer ${(await login.json()).accessToken}` };
const stations = [13, 39, 46, 47];
const results = [];
for (const stationId of stations) {
  const health = await fetch(`${base}/stations/${stationId}/gie/health`, {
    headers: auth, signal: AbortSignal.timeout(35_000),
  });
  assert.equal(health.status, 200, `GIE station ${stationId} HTTP ${health.status}`);
  const info = await health.json();
  assert.equal(info.online, true, `GIE station ${stationId} offline`);
  results.push({ stationId, online: info.online, source: info.source ?? 'LEGACY' });
  const lab = await fetch(`${base}/v2/stations/${stationId}/lab-device`, {
    headers: auth, signal: AbortSignal.timeout(10_000),
  });
  assert.equal(lab.status, 200);
  assert.equal((await lab.json()).available, stationId === 46);
}
console.log(JSON.stringify({ result: 'four-gie-contexts-pass', stations: results, labBoundOnlyTo: 46 }));
