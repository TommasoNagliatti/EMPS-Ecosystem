const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const test = require('node:test');

function loadTs(filename, dependencies = {}) {
  const loaded = new Module(filename, module);
  loaded.paths = module.paths;
  loaded.require = name => name in dependencies ? dependencies[name] : module.require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return loaded.exports;
}

const lifecycleHelpers = loadTs(path.join(__dirname, '../domain/charge-lifecycle.ts'));
const lifecycle = {
  version: 'PREPAID_LIMIT_V2', serverTime: '2026-10-13T13:00:00Z',
  stoppedAt: '2026-10-13T13:00:00Z', disconnectedAt: null,
  removalDeadline: '2026-10-13T13:10:00Z', graceSeconds: 600,
  remainingSeconds: 600, occupancyState: 'GRACE', overstaySeconds: 0,
  removalConfirmationMode: 'customer',
};
const resolved = {
  qrBindingId: '1', charger: { id: '1', label: 'Vaga 1', status: 'available', powerKw: 22, pricePerKwh: 1 },
  station: { name: 'Station', address: 'Address', city: 'City', visibility: 'PUBLIC', availableNow: true, openingHours: '', amenities: [], photos: [] },
};
const paid = {
  id: '7', chargerId: '1', stationId: '1', status: 'completed', outcome: 'finished',
  startedAt: '2026-10-13T12:00:00Z', endedAt: '2026-10-13T13:00:00Z',
  energyKwh: 0.8, powerKw: 0, totalCost: 0.8, spendingLimit: 1,
  durationSeconds: 3600, paymentMethod: 'pix', telemetrySource: 'sandbox',
  receipt: { amountPaid: '0.80', provider: 'SANDBOX', sandbox: true, transactionId: 't1', method: 'pix' },
  lifecycle,
};

function render(session, resolution = resolved, identity = 'account') {
  let index = 0;
  const effects = [];
  const states = [resolution, identity, session, false, '20', 'card', false, false, '', false, '', ''];
  const hooks = {
    ...React,
    useState: () => [states[index++], () => {}],
    useRef: value => ({ current: value }),
    useCallback: callback => callback,
    useEffect: callback => effects.push(callback),
  };
  const component = loadTs(path.join(__dirname, '../components/charge/WebCharge.tsx'), {
    react: hooks,
    'next/link': { default: 'a' },
    'lucide-react': { Zap: 'i', CheckCircle2: 'i', MapPin: 'i' },
    '@/services/emps-api': { api: { ensureSession: async () => ({ token: 'test-session' }) }, empsApiUrl: 'https://api.example.invalid' },
    '@/components/stations/StationPhoto': { StationPhoto: 'img' },
    './charge.module.css': { default: {} },
    './StripeCard': { StripeCard: 'div' },
    '@/domain/charge-lifecycle': lifecycleHelpers,
    '@/domain/request-id': loadTs(path.join(__dirname, '../domain/request-id.ts')),
  });
  return { tree: component.WebCharge({ token: 'qr-test' }), effects };
}

function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate));
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)];
}
function label(node) {
  if (Array.isArray(node)) return node.map(label).join('');
  if (React.isValidElement(node)) return label(node.props.children);
  return typeof node === 'string' ? node : '';
}
function button(tree, text) {
  return elements(tree, node => node.type === 'button' && label(node) === text)[0];
}

test('paid Web Charge session still exposes removal and blocks a new charging session', () => {
  const { tree } = render(paid);
  assert.ok(button(tree, 'Confirmar retirada do conector'));
  assert.equal(button(tree, 'Nova recarga').props.disabled, true);
  assert.equal(button(tree, 'Conector retirado \u00b7 finalizar pagamento'), undefined);
});

test('manual removal sends only disconnect and refresh, never a second payment', async () => {
  const { tree } = render(paid);
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, method: init.method || 'GET' });
    return { ok: true, json: async () => ({ ...paid, lifecycle: { ...lifecycle, disconnectedAt: '2026-10-13T13:01:00Z' } }) };
  };
  try {
    await button(tree, 'Confirmar retirada do conector').props.onClick();
    assert.deepEqual(calls, [
      { url: 'https://api.example.invalid/web-charge/sessions/7/disconnect', method: 'POST' },
      { url: 'https://api.example.invalid/web-charge/sessions/7', method: 'GET' },
    ]);
  } finally { global.fetch = previousFetch; }
});

test('physical removal is gateway-only and removal releases the new charging action', () => {
  const { tree } = render({ ...paid, lifecycle: { ...lifecycle, removalConfirmationMode: 'gateway' } });
  assert.equal(button(tree, 'Confirmar retirada do conector'), undefined);
  assert.match(label(tree), /Aguardando confirma/);
  assert.equal(button(tree, 'Nova recarga').props.disabled, true);
  const removed = render({ ...paid, lifecycle: { ...lifecycle, disconnectedAt: '2026-10-13T13:01:00Z' } });
  assert.equal(button(removed.tree, 'Nova recarga').props.disabled, false);
});

test('legacy V1 settlement action is preserved and a finished legacy session does not poll', () => {
  const legacy = { ...paid, lifecycle: undefined, receipt: undefined, tariffVersion: 'V1', billingFrozen: false };
  assert.ok(button(render(legacy).tree, 'Conector retirado \u00b7 finalizar pagamento'));
  const result = render({ ...paid, lifecycle: undefined });
  assert.equal(button(result.tree, 'Nova recarga').props.disabled, false);
  assert.equal(result.effects[1](), undefined);
});

test('paid sessions with pending removal continue refreshing until the connector is removed', () => {
  const { effects } = render(paid);
  const cleanup = effects[1]();
  assert.equal(typeof cleanup, 'function');
  cleanup();
  const removed = render({ ...paid, lifecycle: { ...lifecycle, disconnectedAt: '2026-10-13T13:01:00Z' } });
  assert.equal(removed.effects[1](), undefined);
});

test('only an authenticated, explicitly authorized sandbox can start with a physical offline charger', () => {
  const offline = { ...resolved, charger: { ...resolved.charger, status: 'offline' } };
  const sandbox = { ...offline, mode: 'SANDBOX', paymentProvider: 'sandbox', physicalGateway: false,
    charger: { ...offline.charger, sandboxAvailable: true, provenance: 'SANDBOX_ESTIMATE',
      physicalStatus: 'UNKNOWN' } };
  const action = 'Autorizar e iniciar recarga';
  assert.equal(button(render(null, offline).tree, action).props.disabled, true);
  assert.equal(button(render(null, sandbox).tree, action).props.disabled, false);
  assert.equal(button(render(null, sandbox, 'guest').tree, action).props.disabled, true);
  assert.equal(button(render(null, { ...sandbox, guestAllowed: true }, 'guest').tree, action).props.disabled, false);
  assert.equal(button(render(null, { ...sandbox, physicalGateway: true }).tree, action).props.disabled, true);
  assert.match(label(render(null, sandbox).tree), /sem despacho físico/);
});
