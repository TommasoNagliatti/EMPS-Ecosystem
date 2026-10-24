const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');

function load(file, mocks = {}) {
  const filename = path.resolve(root, file);
  const child = new Module(filename, module);
  child.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = child.require.bind(child);
  child.require = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name === 'next/link') return ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children);
    if (name === '@/components/shell/NavigationLink') return { NavigationLink: ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children) };
    if (name.startsWith('.') || name.startsWith('@/')) {
      const base = name.startsWith('@/') ? name.slice(2) : path.relative(root, path.resolve(path.dirname(filename), name));
      for (const extension of ['.ts', '.tsx']) if (fs.existsSync(path.join(root, base + extension))) return load(base + extension, mocks);
    }
    return originalRequire(name);
  };
  child._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return child.exports;
}

test('all station states open a station-specific panel, while setup remains separate', () => {
  const { StationListTable } = load('components/stations/StationListTable.tsx', {
    '@/services/emps-api': { selectedStation: { set() {} } },
    './StationPhoto': { StationPhoto: () => null },
    './StationListControls': { StationListColumns: () => null },
    './StationListPopover': { StationListPopover: ({ children }) => children(() => {}) },
  });
  const { stationListCopy } = load('components/stations/station-list-copy.ts');
  for (const [status, reviewState] of [['ACTIVE', 'APPROVED'], ['PENDING', 'PENDING_REVIEW'], ['DRAFT', 'DRAFT'], ['REJECTED', 'REJECTED'], ['INACTIVE', 'SUSPENDED']]) {
    for (const locale of ['pt-BR', 'en']) {
      const markup = renderToStaticMarkup(React.createElement(StationListTable, {
        rows: [{ id: '7', name: 'Fixture station', status, reviewState, membershipRole: 'OWNER', photos: [], powerLimitKw: null }],
        columns: [], favorites: [], copy: stationListCopy[locale], locale, loading: false, error: '',
        onRetry() {}, onColumnsChange() {}, onFavorite() {}, sort: null, onSort() {}, total: 1, page: 1, pageSize: 15, onPageChange() {}, onPageSizeChange() {},
      }));
      assert.equal((markup.match(/href="\/stations\/7\/dashboard"/g) ?? []).length, 2);
      assert.ok(markup.includes('href="/stations/7"'));
      assert.ok(markup.includes('href="/stations/7/telemetry"'));
      assert.ok(!markup.includes('href="/dashboard"'));
      assert.equal(markup.includes(stationListCopy[locale].continueDraft), ['DRAFT', 'REJECTED'].includes(reviewState));
    }
  }
});

test('legacy dashboard redirects to the installation list and panel route validates numeric IDs', async () => {
  const navigation = { redirect: target => { throw Object.assign(new Error('Redirect'), { target }); }, notFound: () => { throw new Error('Not found'); } };
  const dashboard = load('app/dashboard/page.tsx', { 'next/navigation': navigation });
  assert.throws(() => dashboard.default(), error => error.target === '/stations');
  const panel = load('app/stations/[id]/dashboard/page.tsx', {
    'next/navigation': navigation,
    '@/components/dashboard/RoleDashboard': { RoleDashboard: () => null },
    '@/components/stations/station-wizard-font': { stationWizardFont: { className: 'font' } },
  });
  const tree = await panel.default({ params: Promise.resolve({ id: '7' }) });
  assert.equal(tree.props.children.props.stationId, '7');
  assert.equal(tree.props.children.key, '7');
  for (const id of ['new', '0', '-1', '1.5', '9007199254740993']) await assert.rejects(panel.default({ params: Promise.resolve({ id }) }), /Not found/);
});

const settle = () => new Promise(resolve => setImmediate(resolve));
function panelHarness(warm = false) {
  const states = [], requests = [], selected = [], redirects = [];
  let cursor = 0, cleanup, pendingEffect, dependencies;
  let session = { usuarioId: 'fixture', nome: 'Fixture', email: 'fixture@example.invalid', role: 'goodwe', modo: 'api', token: 'fixture' };
  const router = { replace: target => redirects.push(target) };
  const react = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect(effect, next) {
      if (!dependencies || next.some((value, index) => value !== dependencies[index])) pendingEffect = () => { cleanup?.(); dependencies = next; cleanup = effect(); };
    },
  };
  const { RoleDashboard } = load('components/dashboard/RoleDashboard.tsx', {
    react,
    'next/navigation': { useRouter: () => router },
    'next/dynamic': () => function StationAdmin() { return null; },
    '@/services/emps-api': { api: { cached: (_path, _stationId, maxAge = 30_000) => warm && maxAge > 12_000 ? { value: { id: '7', name: 'Fixture' }, updatedAt: Date.now() - 12_000 } : null, ensureSession: async () => session, platform: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })) }, frontSession: { get: () => session }, selectedStation: { set: id => selected.push(id) }, EMPS_SESSION_CHANGED_EVENT: 'session' },
  });
  return { requests, selected, redirects,
    render(id = '7') { cursor = 0; return RoleDashboard({ stationId: id }); },
    flush() { const next = pendingEffect; pendingEffect = null; next?.(); },
    logout() { session = null; window.dispatchEvent(new Event('session')); },
    dispose() { cleanup?.(); },
  };
}

test('panel restores session, validates station access, then sets context even for shared roles', async () => {
  const original = global.window;
  global.window = Object.assign(new EventTarget(), { location: { pathname: '/stations/7/dashboard' } });
  const h = panelHarness();
  try {
    h.render(); h.flush(); await settle();
    assert.deepEqual(h.selected, []);
    assert.equal(h.requests[0].url, '/v2/stations/7');
    assert.equal(h.requests[0].options.headers['X-Station-Id'], '7');
    h.requests[0].resolve({ id: '7' }); await settle();
    assert.deepEqual(h.selected, ['7']);
    assert.equal(h.render().props.stationId, '7');
    h.logout();
    assert.equal(h.redirects.at(-1), '/login?next=%2Fstations%2F7%2Fdashboard');
    assert.notEqual(h.render().props.stationId, '7');
  } finally { h.dispose(); global.window = original; }
});

test('denied access never selects the station or mounts its operational panel', async () => {
  const original = global.window;
  global.window = Object.assign(new EventTarget(), { location: { pathname: '/stations/7/dashboard' } });
  const h = panelHarness();
  try {
    h.render(); h.flush(); await settle(); h.requests[0].reject(new Error('Forbidden')); await settle();
    const markup = renderToStaticMarkup(h.render());
    assert.ok(markup.includes('Forbidden'));
    assert.ok(markup.includes('href="/stations"'));
    assert.deepEqual(h.selected, []);
  } finally { h.dispose(); global.window = original; }
});

test('a recently visited panel mounts immediately but still removes access when revalidation is denied', async () => {
  const original = global.window;
  global.window = Object.assign(new EventTarget(), { location: { pathname: '/stations/7/dashboard' } });
  const h = panelHarness(true);
  try {
    assert.equal(h.render().props.stationId, '7');
    h.flush(); await settle();
    assert.equal(h.requests[0].options.headers['X-Station-Id'], '7');
    h.requests[0].reject(new Error('Forbidden')); await settle();
    assert.notEqual(h.render().props.stationId, '7');
    assert.match(renderToStaticMarkup(h.render()), /Forbidden/);
    assert.deepEqual(h.selected, []);
  } finally { h.dispose(); global.window = original; }
});

test('logging out during authorization discards a late station response', async () => {
  const original = global.window;
  global.window = Object.assign(new EventTarget(), { location: { pathname: '/stations/7/dashboard' } });
  const h = panelHarness();
  try {
    h.render(); h.flush(); await settle();
    h.logout();
    assert.equal(h.requests[0].options.signal.aborted, true);
    h.requests[0].resolve({ id: '7' }); await settle();
    assert.deepEqual(h.selected, []);
    assert.notEqual(h.render().props.stationId, '7');
  } finally { h.dispose(); global.window = original; }
});

test('late authorization for a previous station cannot replace the new URL context', async () => {
  const original = global.window;
  global.window = Object.assign(new EventTarget(), { location: { pathname: '/stations/8/dashboard' } });
  const h = panelHarness();
  try {
    h.render('7'); h.flush(); await settle();
    h.render('8'); h.flush(); await settle();
    assert.equal(h.requests[0].options.signal.aborted, true);
    h.requests[1].resolve({ id: '8' }); await settle();
    h.requests[0].resolve({ id: '7' }); await settle();
    assert.deepEqual(h.selected, ['8']);
    assert.equal(h.render('8').props.stationId, '8');
    assert.notEqual(h.render('7').props.stationId, '7');
  } finally { h.dispose(); global.window = original; }
});

test('dashboard scopes its consolidated request to the URL ID, independent of stored selection', async () => {
  const originals = { window: global.window, sessionStorage: global.sessionStorage, fetch: global.fetch };
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const window = Object.assign(new EventTarget(), { sessionStorage: storage, location: { hostname: 'localhost', pathname: '/stations/7/dashboard' }, setTimeout, clearTimeout, atob });
  const calls = [];
  Object.assign(global, { window, sessionStorage: storage, fetch: async (url, init) => { calls.push({ url, init }); return Response.json({}); } });
  try {
    const { api, frontSession, selectedStation } = load('services/emps-api.ts', { '@/services/emps-mappers': { mapDashboardData: (summary, details) => ({ summary, ...details }) } });
    frontSession.set({ usuarioId: 'fixture', nome: 'Fixture', email: 'fixture@example.invalid', role: 'admin', modo: 'api', token: 'fixture-token' });
    selectedStation.set('99');
    await api.dashboard('7');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/dashboard/panel']);
    for (const call of calls) assert.equal(call.init.headers.get('X-Station-Id'), '7');
    assert.equal(selectedStation.get(), '99');
    await api.dashboard();
    for (const call of calls.slice(1)) assert.equal(call.init.headers.get('X-Station-Id'), '99');
  } finally { Object.assign(global, originals); }
});
