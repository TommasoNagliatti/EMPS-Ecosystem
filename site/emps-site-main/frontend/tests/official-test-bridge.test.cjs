const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const filename = path.join(__dirname, '../server/official-test-bridge.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { createBridgeState, handleOfficialTestRequest } = loaded.exports;
const NOW = 10_000;

function request(route, method = 'GET', body, extra = {}) {
  const headers = { host: 'localhost:3010', origin: 'http://localhost:3010', authorization: 'Bearer fixture', 'x-station-id': '13', ...extra };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request('http://localhost:3010/api/official-test/' + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
function fixture(overrides = {}) {
  const calls = [];
  const state = createBridgeState();
  const options = { enabled: true, sandboxVerifiedUntil: NOW + 60_000, now: () => NOW, state,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      const route = new URL(url).pathname.slice(1);
      if (overrides[route]) return overrides[route](init);
      const payload = route === 'auth/me' ? { id: 7, role: 'ADMIN' }
        : route === 'chargers/49' ? { id: 49, stationId: 13 }
        : route === 'charging-sessions' ? [{ id: '900', chargerId: 49 }]
        : route === 'charging-sessions/900' ? { stationId: 13, chargerId: 49, clientId: null, paymentIntentId: null, sessionOrigin: 'ADMIN_SITE' }
        : { sessaoId: '900' };
      return Response.json(payload);
    }
  };
  return { calls, options, state, handle: (route, method, body, headers) => handleOfficialTestRequest(request(route, method, body, headers), route.split('/'), options) };
}
const prepay = { motivo: 'fallback_qr_code', origem: 'caixa', modo: 'pre_pago', tarifaKwh: 2, valorRecebido: 1, operadorId: 'not-trusted' };

test('bridge is off by default, never contacting the official service', async () => {
  const f = fixture(); f.options.enabled = false;
  assert.equal((await f.handle('auth/health')).status, 404); assert.equal(f.calls.length, 0);
});
test('GET is authenticated upstream, pinned to HTTPS and never cached', async () => {
  const f = fixture(); const response = await f.handle('dashboard/panel');
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(f.calls[0].url, 'https://api.emps-charge.tech/dashboard/panel');
  assert.equal(f.calls[0].init.redirect, 'error');
  assert.equal(f.calls[0].init.headers.get('Authorization'), 'Bearer fixture');
  assert.equal(f.calls[0].init.headers.get('X-Station-Id'), '13');
});
test('missing authentication and forged browser origins are refused before upstream', async () => {
  const f = fixture();
  assert.equal((await f.handle('chargers', 'GET', undefined, { authorization: '' })).status, 401);
  assert.equal((await f.handle('auth/login', 'POST', {}, { origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await f.handle('auth/login', 'POST', {}, { origin: '' })).status, 403);
  assert.equal((await f.handle('chargers', 'GET', undefined, { host: 'attacker.invalid' })).status, 403);
  assert.equal(f.calls.length, 0);
});
test('only the explicit read allowlist is reachable, not arbitrary paths or encoded traversal', async () => {
  const f = fixture();
  for (const route of ['admin/secrets', 'http://attacker.invalid', 'v2/stations/../keys', 'auth/registration', 'mobile/payments']) {
    assert.ok([400, 403].includes((await f.handle(route)).status));
  }
  assert.equal(f.calls.length, 0);
});
test('mutations other than station-13 cash and its stop cannot reach upstream', async () => {
  const f = fixture();
  for (const route of ['payments/simulate', 'payments/1/approve', 'auth/register', 'v2/stations', 'stations/13/gie/activate', 'chargers/2/manual-release', 'chargers/49/status']) {
    assert.equal((await f.handle(route, 'POST', prepay)).status, 403);
  }
  assert.equal((await f.handle('chargers/49', 'DELETE')).status, 403); assert.equal(f.calls.length, 0);
});
test('sandbox verification must be recent, finite and not expired', async () => {
  for (const expires of [NaN, NOW, NOW - 1, NOW + 24 * 60 * 60_000 + 1]) {
    const f = fixture(); f.options.sandboxVerifiedUntil = expires;
    assert.equal((await f.handle('chargers/49/manual-release', 'POST', prepay)).status, 403);
    assert.equal(f.calls.length, 0);
  }
});
test('selected station and actual upstream charger ownership both gate mutation', async () => {
  const f = fixture();
  assert.equal((await f.handle('chargers/49/manual-release', 'POST', prepay, { 'x-station-id': '39' })).status, 403);
  assert.equal(f.calls.length, 0);
  const other = fixture({ 'chargers/49': () => Response.json({ stationId: 39 }) });
  assert.equal((await other.handle('chargers/49/manual-release', 'POST', prepay)).status, 403);
  assert.equal(other.calls.filter(call => call.init.method === 'POST').length, 0);
});
test('upstream validates identity; client role/operator claims are not trusted', async () => {
  const unknown = fixture({ 'auth/me': () => Response.json({ role: 'ADMIN' }) });
  assert.equal((await unknown.handle('chargers/49/manual-release', 'POST', prepay)).status, 401);
  const f = fixture(); assert.equal((await f.handle('chargers/49/manual-release', 'POST', prepay)).status, 200);
  assert.equal(JSON.parse(f.calls.at(-1).init.body).operadorId, '7');
  assert.deepEqual(f.state.sessions.get('900'), { chargerId: '49', operatorId: '7' });
});
test('global CUSTOMER role does not override station membership; official denial remains authoritative', async () => {
  const owner = fixture({ 'auth/me': () => Response.json({ id: 7, role: 'CUSTOMER' }) });
  assert.equal((await owner.handle('chargers/49/manual-release', 'POST', prepay)).status, 200);
  const viewer = fixture({ 'auth/me': () => Response.json({ id: 7, role: 'CUSTOMER' }), 'chargers/49/manual-release': () => Response.json({ message: 'Sem permissao para operar esta estacao' }, { status: 403 }) });
  assert.equal((await viewer.handle('chargers/49/manual-release', 'POST', prepay)).status, 403);
  assert.equal(viewer.state.sessions.size, 0);
});
test('noncash fields, excessive amounts and malformed payloads are rejected', async () => {
  for (const payload of [{ ...prepay, valorRecebido: 101 }, { ...prepay, valorRecebido: 0.1 }, { ...prepay, provider: 'stripe' }, { ...prepay, origem: 'app' }, [], null]) {
    const f = fixture(); assert.equal((await f.handle('chargers/49/manual-release', 'POST', payload)).status, 400);
    assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 0);
  }
});
test('historical sessions cannot be settled or stopped', async () => {
  const f = fixture();
  assert.equal((await f.handle('charging-sessions/900/settle-cash', 'POST', { origem: 'caixa' })).status, 403);
  assert.equal((await f.handle('chargers/49/commands', 'POST', { command: 'encerrar_carga' })).status, 403);
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 0);
});
test('a new test session can be stopped, without arbitrary device commands', async () => {
  const f = fixture(); await f.handle('chargers/49/manual-release', 'POST', prepay);
  assert.equal((await f.handle('chargers/49/commands', 'POST', { command: 'encerrar_carga' })).status, 200);
  assert.equal((await f.handle('chargers/49/commands', 'POST', { command: 'reiniciar_equipamento' })).status, 403);
});
test('another operator or an external payment intent cannot mutate a tracked test', async () => {
  for (const mutate of ['operator', 'payment', 'client', 'station']) {
    const f = fixture({ 'charging-sessions/900': () => Response.json({ stationId: mutate === 'station' ? 39 : 13, chargerId: 49, clientId: mutate === 'client' ? 8 : null, paymentIntentId: mutate === 'payment' ? 4 : null, sessionOrigin: 'ADMIN_SITE' }) });
    f.state.sessions.set('900', { chargerId: '49', operatorId: mutate === 'operator' ? '8' : '7' });
    assert.equal((await f.handle('chargers/49/commands', 'POST', { command: 'encerrar_carga' })).status, 403);
    assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 0);
  }
});
test('upstream denial propagates without success or retrying a mutation', async () => {
  const f = fixture({ 'chargers/49/manual-release': () => Response.json({ message: 'indisponivel' }, { status: 409 }) });
  assert.equal((await f.handle('chargers/49/manual-release', 'POST', prepay)).status, 409);
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1); assert.equal(f.state.sessions.size, 0);
});
test('uncertain POST fails without replay, releases lock and asks for reconciliation', async () => {
  const f = fixture({ 'chargers/49/manual-release': () => { throw new Error('timeout'); } });
  const response = await f.handle('chargers/49/manual-release', 'POST', prepay);
  assert.equal(response.status, 502); assert.match((await response.json()).message, /nao repita/);
  assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 1); assert.equal(f.state.busy.size, 0);
});
test('auth forwards only the refresh cookie and preserves production cookie security', async () => {
  const f = fixture({ 'auth/refresh': () => new Response('{}', { headers: { 'Set-Cookie': 'emps_web_refresh=fixture; Path=/auth; HttpOnly; Secure; SameSite=Lax; Expires=Wed, 14 Oct 2026 12:00:00 GMT' } }) });
  const response = await f.handle('auth/refresh', 'POST', undefined, { cookie: 'other=sensitive; emps_web_refresh=fixture' });
  assert.equal(f.calls[0].init.headers.get('Cookie'), 'emps_web_refresh=fixture');
  const cookie = response.headers.get('Set-Cookie');
  assert.match(cookie, /Path=\/api\/official-test\/auth/); assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
});
test('oversized streamed bodies stop before login reaches upstream', async () => {
  const f = fixture();
  assert.equal((await f.handle('auth/login', 'POST', { password: 'a'.repeat(17_000) })).status, 413); assert.equal(f.calls.length, 0);
});
test('concurrent operations on the same charger do not dispatch twice', async () => {
  const f = fixture(); f.state.busy.add('49');
  assert.equal((await f.handle('chargers/49/manual-release', 'POST', prepay)).status, 409);
  assert.equal(f.state.busy.has('49'), true); assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 0);
});
test('only successful new session IDs enter the private local audit journal, without credentials', async () => {
  const f = fixture(), journal = [];
  f.options.onSessionCreated = (id, session) => journal.push({ id, ...session });
  assert.equal((await f.handle('chargers/49/manual-release', 'POST', prepay)).status, 200);
  assert.deepEqual(journal, [{ id: '900', chargerId: '49', operatorId: '7' }]);
  assert.doesNotMatch(JSON.stringify(journal), /fixture|token|password|Bearer/);
});
test('settlement cannot duplicate an existing receipt or settle a prepaid session again', async () => {
  for (const payload of [{ billingMode: 'PREPAID', payments: [] }, { billingMode: 'POSTPAID', payments: [{ status: 'APPROVED' }] }]) {
    const f = fixture({ 'charging-sessions/900': () => Response.json({ stationId: 13, chargerId: 49, clientId: null, paymentIntentId: null, sessionOrigin: 'ADMIN_SITE', ...payload }) });
    f.state.sessions.set('900', { chargerId: '49', operatorId: '7' });
    assert.equal((await f.handle('charging-sessions/900/settle-cash', 'POST', { origem: 'caixa', valorRecebido: 1 })).status, 409);
    assert.equal(f.calls.filter(call => call.init.method === 'POST').length, 0);
  }
});
