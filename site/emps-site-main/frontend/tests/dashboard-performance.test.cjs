const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const root = path.resolve(__dirname, '..');
function load(file, mocks) {
  const filename = path.join(root, file), child = new Module(filename, module);
  child.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = child.require.bind(child);
  child.require = name => Object.hasOwn(mocks, name) ? mocks[name] : name === './navigation-cache' ? load('services/navigation-cache.ts', {}) : original(name);
  child._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
  return child.exports;
}

test('disabled comparison history preserves references instead of invalidating the chart memo', () => {
  const { useStationHistory } = load('components/dashboard/use-station-history.ts', { react: { useState: () => [{ key: '', rows: [], loading: true }, () => {}], useEffect: fn => fn() }, '@/services/emps-api': { api: {} } });
  const first = useStationHistory('', 1, 2, 0), second = useStationHistory('', 1, 2, 1);
  assert.equal(first, second);
  assert.equal(first.rows, second.rows);
  assert.equal(first.loading, false);
});

async function apiHarness(status, action) {
  const originals = { window: global.window, sessionStorage: global.sessionStorage, fetch: global.fetch };
  const values = new Map(), calls = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  Object.assign(global, { window: Object.assign(new EventTarget(), { sessionStorage: storage, location: { hostname: 'localhost', pathname: '/stations/7/dashboard' }, setTimeout, clearTimeout, atob }), sessionStorage: storage,
    fetch: async (url, init) => { calls.push({ url, init }); return new URL(url).pathname === '/dashboard/panel' ? Response.json({ message: 'Fixture error' }, { status }) : Response.json({}); } });
  try {
    const { api, frontSession } = load('services/emps-api.ts', { '@/services/emps-mappers': { mapDashboardData: (summary, details) => ({ summary, ...details }) } });
    frontSession.set({ usuarioId: 'fixture', nome: 'Fixture', email: 'fixture@example.invalid', role: 'admin', modo: 'api', token: 'fixture-token' });
    await action(api, calls);
  } finally { Object.assign(global, originals); }
}
test('only a missing new endpoint falls back to the older five-request dashboard', async () => {
  await apiHarness(404, async (api, calls) => {
    await api.dashboard('7');
    assert.equal(calls.length, 6);
    assert.deepEqual(calls.slice(1).map(c => new URL(c.url).pathname).sort(), ['/alerts', '/chargers', '/charging-sessions', '/dashboard/summary', '/payments']);
    for (const call of calls) assert.equal(call.init.headers.get('X-Station-Id'), '7');
  });
});
test('permission and server errors do not trigger extra fallback requests', async () => {
  for (const status of [403, 429, 500]) await apiHarness(status, async (api, calls) => {
    await assert.rejects(api.dashboard('7'));
    assert.equal(calls.length, 1);
  });
});
test('overlapping dashboard refreshes share the current read instead of queuing another', async () => {
  const originalWindow = global.window, originalDocument = global.document;
  const states = [], refs = [], effects = [], requests = [];
  let stateIndex = 0, refIndex = 0, interval;
  global.window = { setTimeout: () => 1, clearTimeout() {}, setInterval: fn => { interval = fn; return 1; }, clearInterval() {} };
  global.document = { visibilityState: 'visible' };
  const hooks = { ...React, useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; }, useRef(initial) { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }); }, useCallback: fn => fn, useEffect: fn => effects.push(fn), startTransition: fn => fn() };
  try {
    const { AdminDashboard } = load('components/dashboard/AdminDashboard.tsx', { react: hooks,
      '@/components/energy/GieControls': { GieControls: () => null }, '@/components/shell/AppShell': { AppShell: () => null },
      '@/components/realtime/RealtimeProvider': { useRealtime: () => ({ changeRevision: 0, connectionVersion: 0, status: 'connected' }) },
      '@/domain/gie': { energyFromGie: () => ({}) }, './StationDashboard': { StationDashboard: () => null },
      '@/services/emps-api': { isDemoMode: false, api: { cachedDashboard: () => null, dashboard: () => new Promise(resolve => requests.push(resolve)) } } });
    const render = () => { stateIndex = 0; refIndex = 0; return AdminDashboard({ stationId: '7' }); };
    render(); effects.splice(0).forEach(effect => effect());
    requests[0]({ energyFlow: {} }); await new Promise(resolve => setImmediate(resolve));
    const panel = render().props.children;
    panel.props.onRefresh(); panel.props.onRefresh(); interval();
    assert.equal(requests.length, 2);
    requests[1]({ energyFlow: {} }); await new Promise(resolve => setImmediate(resolve));
    global.document.visibilityState = 'hidden'; interval();
    assert.equal(requests.length, 2);
  } finally { global.window = originalWindow; global.document = originalDocument; }
});

test('GIE polling waits for completion, backs off offline, and skips hidden pages', async () => {
  const originalDocument = global.document, originalTimeout = global.setTimeout, originalClear = global.clearTimeout;
  const effects = [], timers = [], requests = [], received = [];
  let index = 0;
  global.document = { visibilityState: 'visible' };
  global.setTimeout = (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; };
  global.clearTimeout = () => {};
  const hooks = { ...React, useState(initial) { const current = index++; return [current === 1 ? '13' : (typeof initial === 'function' ? initial() : initial), () => {}]; }, useRef: value => ({ current: value }), useEffect: fn => effects.push(fn), useCallback: fn => fn };
  try {
    const { GieControls } = load('components/energy/GieControls.tsx', { react: hooks,
      './GieControls.module.css': { __esModule: true, default: {} },
      '@/services/emps-api': { frontSession: { get: () => null }, selectedStation: { get: () => '13' }, api: { gieState: () => new Promise(resolve => requests.push(resolve)), platform: async () => ({ presentationTools: false }), stations: async () => [] } } });
    GieControls({ onState: state => received.push(state) });
    const cleanup = effects[2]();
    assert.equal(requests.length, 1); assert.equal(timers.length, 0);
    requests[0]({ online: false, station_id: '13', state: null });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(timers[0].delay, 30000);
    timers[0].fn(); assert.equal(requests.length, 2); assert.equal(timers.length, 1);
    requests[1]({ online: true, station_id: '13', state: null });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(timers[1].delay, 5000);
    global.document.visibilityState = 'hidden'; timers[1].fn();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 2); assert.equal(timers[2].delay, 30000);
    global.document.visibilityState = 'visible'; timers[2].fn();
    assert.equal(requests.length, 3);
    cleanup(); requests[2]({ online: true, station_id: '13', state: null });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(timers.length, 3); assert.equal(received.length, 2);
  } finally { global.document = originalDocument; global.setTimeout = originalTimeout; global.clearTimeout = originalClear; }
});
