const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const filename = path.join(root, file), child = new Module(filename, module);
  child.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = child.require.bind(child);
  child.require = name => Object.hasOwn(mocks, name) ? mocks[name] : name === './navigation-cache' ? load('services/navigation-cache.ts') : original(name);
  child._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
  return child.exports;
}
const { NavigationReadCache, navigationReadTargets } = load('services/navigation-cache.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('recent navigation uses the cached read, while manual refresh always fetches', async () => {
  let now = 100, reads = 0;
  const cache = new NavigationReadCache(() => now), read = async () => ({ count: ++reads });
  assert.deepEqual(await cache.read('same', read), { count: 1 });
  now += 4999;
  assert.deepEqual(await cache.read('same', read), { count: 1 });
  assert.equal(cache.peek('same').updatedAt, 100);
  assert.deepEqual(await cache.read('same', read, { force: true }), { count: 2 });
  now += 5000;
  assert.deepEqual(await cache.read('same', read), { count: 3 });
});
test('snapshots expire after thirty seconds and callers cannot mutate stored values', async () => {
  let now = 0;
  const cache = new NavigationReadCache(() => now);
  const result = await cache.read('rows', async () => [{ id: 1 }]);
  result[0].id = 9;
  const snapshot = cache.peek('rows'); snapshot.value[0].id = 7;
  assert.equal(cache.peek('rows').value[0].id, 1);
  now = 30_000;
  assert.equal(cache.peek('rows'), null);
});
test('concurrent prefetch and visible read share one request, even if one consumer cancels', async () => {
  const cache = new NavigationReadCache(), abort = new AbortController();
  let resolve, calls = 0;
  const reader = () => { calls++; return new Promise(done => { resolve = done; }); };
  const first = cache.read('same', reader, { signal: abort.signal }), second = cache.read('same', reader);
  await tick(); assert.equal(calls, 1);
  abort.abort(); await assert.rejects(first, { name: 'AbortError' });
  resolve({ id: 1 }); assert.deepEqual(await second, { id: 1 });
  assert.equal(cache.peek('same').value.id, 1);
});
test('logout and invalidation discard pending responses instead of repopulating the cache', async () => {
  const cache = new NavigationReadCache(); let resolve;
  const pending = cache.read('private', () => new Promise(done => { resolve = done; }));
  await tick(); cache.clear(); resolve({ secret: 'fixture' });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cache.peek('private'), null);
  assert.deepEqual(await cache.read('private', async () => ({ id: 2 })), { id: 2 });
});
test('failures are not cached and memory is bounded with least-recently-used eviction', async () => {
  const cache = new NavigationReadCache(Date.now, 30_000, 2);
  await assert.rejects(cache.read('error', async () => { throw new Error('offline'); }));
  assert.equal(cache.peek('error'), null);
  await cache.read('a', async () => 1); await cache.read('b', async () => 2); cache.peek('a');
  await cache.read('c', async () => 3);
  assert.equal(cache.peek('b'), null); assert.equal(cache.peek('a').value, 1);
});
test('prefetch targets only known read-only routes and pins both panel requests to the URL station', () => {
  assert.deepEqual(navigationReadTargets('/stations/39/dashboard'), [{ path: '/v2/stations/39', stationId: '39' }, { path: '/dashboard/panel', stationId: '39' }]);
  assert.deepEqual(navigationReadTargets('/chargers'), [{ path: '/v2/chargers' }, { path: '/v2/stations' }]);
  for (const href of ['/charge/token', '/reviews', '/invites', '/stations/new', '/stations/39/rfid', 'https://evil.invalid/stations', '//evil.invalid', '/stations/39/dashboard?next=evil']) assert.deepEqual(navigationReadTargets(href), []);
});

async function harness(action) {
  const originals = { window: global.window, sessionStorage: global.sessionStorage, fetch: global.fetch };
  const values = new Map(), calls = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let handler = () => Response.json([{ id: 1 }]);
  Object.assign(global, { window: Object.assign(new EventTarget(), { sessionStorage: storage, location: { hostname: 'localhost', pathname: '/stations' }, setTimeout, clearTimeout, atob }), sessionStorage: storage,
    fetch: async (url, init) => { calls.push({ url, init }); return handler(url, init); } });
  try {
    const service = load('services/emps-api.ts', { '@/services/emps-mappers': { mapResourceList: (_, rows) => rows, mapDashboardData: (summary, details) => ({ summary, ...details }) } });
    const session = { usuarioId: 'one', nome: 'Fixture', email: 'one@example.invalid', role: 'admin', modo: 'api', token: 'fixture' };
    service.frontSession.set(session);
    await action({ ...service, calls, session, respond: fn => { handler = fn; } });
  } finally { Object.assign(global, originals); }
}
test('API cache isolates users, station headers, and search queries', async () => {
  await harness(async ({ api, frontSession, selectedStation, session, calls }) => {
    selectedStation.set('7'); await api.list('sessoes', '100'); await api.list('sessoes', '100'); assert.equal(calls.length, 1);
    await api.list('sessoes', '101'); assert.equal(calls.length, 2);
    selectedStation.set('8'); assert.equal(api.cachedList('sessoes', '100'), null);
    await api.list('sessoes', '100'); assert.equal(calls.length, 3);
    frontSession.set({ ...session, usuarioId: 'two' }); assert.equal(api.cachedList('sessoes', '100'), null);
    await api.list('sessoes', '100'); assert.equal(calls.length, 4);
    frontSession.clear(); assert.equal(api.cachedList('sessoes', '100'), null);
  });
});
test('prefetch cannot write, cannot change selected station, and shares its response with the panel', async () => {
  await harness(async ({ api, selectedStation, calls, respond }) => {
    selectedStation.set('99'); respond(() => Response.json({ summary: {}, chargers: [], sessions: [], payments: [], alerts: [] }));
    await api.prefetchPage('/stations/7/dashboard'); await api.dashboard('7');
    assert.equal(calls.length, 2); assert.equal(selectedStation.get(), '99');
    for (const call of calls) { assert.equal(call.init.headers.get('X-Station-Id'), '7'); assert.equal(call.init.method ?? 'GET', 'GET'); }
    assert.ok(api.cachedDashboard('7')); assert.equal(api.cachedDashboard('8'), null);
  });
});
test('manual refresh, writes, and permission denial invalidate old snapshots', async () => {
  await harness(async ({ api, calls, respond }) => {
    await api.list('clientes'); await api.list('clientes', '', true); assert.equal(calls.length, 2);
    await api.platform('/anything', { method: 'POST', body: '{}' }); assert.equal(api.cachedList('clientes'), null);
    await api.list('clientes'); respond(() => Response.json({ message: 'Forbidden' }, { status: 403 }));
    await assert.rejects(api.list('clientes', '', true), /Forbidden/); assert.equal(api.cachedList('clientes'), null);
  });
});
test('auth, quotes, and GIE state never return navigation snapshots', async () => {
  await harness(async ({ api, calls }) => {
    for (const endpoint of ['/auth/me', '/charging-sessions/7/quote', '/stations/7/gie/state']) {
      await api.platform(endpoint); await api.platform(endpoint); assert.equal(api.cached(endpoint), null);
    }
    assert.equal(calls.length, 6);
  });
});
test('expired access tokens cannot display cached private data', async () => {
  await harness(async ({ api, frontSession, session }) => {
    await api.list('clientes'); assert.ok(api.cachedList('clientes'));
    const payload = Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url');
    frontSession.set({ ...session, token: `header.${payload}.signature` });
    assert.equal(api.cachedList('clientes'), null);
  });
});
