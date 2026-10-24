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
  const filename = path.join(root, file), child = new Module(filename, module);
  child.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = child.require.bind(child);
  child.require = name => Object.hasOwn(mocks, name) ? mocks[name]
    : name.endsWith('.css') ? { __esModule: true, default: {} }
    : name.startsWith('@/') ? load(name.slice(2) + (name.includes('NavigationLink') ? '.tsx' : '.ts'), mocks)
    : name.startsWith('./station-monitoring') ? load('domain/station-monitoring.ts', mocks) : original(name);
  child._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, filename);
  return child.exports;
}
const m = load('domain/station-insights.ts');
const monitoring = load('domain/station-monitoring.ts');
const { mapAlert, mapDashboardData } = load('services/emps-mappers.ts');
const tz = 'America/Sao_Paulo', now = Date.parse('2026-10-12T20:00:00Z');
const paidAt = '2026-10-12T12:00:00Z';
const records = (payments = [], sessions = []) => ({ complete: true, payments, sessions });
const payment = (id, status, amount, date = paidAt) => ({ id, status, amount, paidAt: date });
const session = (id, paymentStatus, amount) => ({ id, status: 'FINISHED', amount, paymentStatus, endedAt: paidAt });

test('confirmed partial cash return is debited on its actual day; an unused balance is not a refund',()=>{
 const p={...payment('1','APPROVED',10),cashReturnedAmount:1.11,cashReturnedAt:paidAt};
 assert.equal(m.financialToday(records([p]),tz,now).received,8.89);
 assert.equal(m.financialToday(records([{...p,paidAt:'2026-10-11T12:00:00Z'}]),tz,now).received,-1.11);
 assert.equal(m.financialToday(records([{...p,cashReturnedAmount:0,cashReturnedAt:null}]),tz,now).received,10);
 assert.equal(m.financialToday(records([{...p,cashReturnedAt:null}]),tz,now).received,null);
});

test('received cash excludes pending, declined and refunded records', () => {
  const result = m.financialToday(records([payment('1', 'APPROVED', 12), payment('2', 'PENDING', 90), payment('3', 'DECLINED', 25), payment('4', 'REFUNDED', 100)]), tz, now);
  assert.equal(result.received, 12);
  assert.equal(result.energyCost, null);
  assert.equal(result.operationalMargin, null);
});
test('financial day follows station timezone and excludes future payments', () => {
  const result = m.financialToday(records([payment('1', 'APPROVED', 3, '2026-10-12T02:30:00Z'), payment('2', 'APPROVED', 5, '2026-10-12T03:00:00Z'), payment('3', 'APPROVED', 7, '2026-10-13T02:00:00Z')]), tz, now);
  assert.equal(result.day, '2026-10-12');
  assert.equal(result.received, 5);
});
test('absent or incomplete financial responses never become zero revenue', () => {
  assert.equal(m.financialToday(undefined, tz, now).received, null);
  assert.equal(m.financialToday({ ...records(), complete: false }, tz, now).received, null);
  assert.equal(m.financialToday(records(), tz, now).received, 0);
});
test('approved payments require a confirmed value and date', () => {
  for (const p of [payment('1', 'APPROVED', null), payment('1', 'APPROVED', -1), payment('1', 'APPROVED', 30, null), payment('1', 'UNKNOWN', 30)]) {
    assert.equal(m.financialToday(records([p]), tz, now).received, null);
  }
  assert.equal(m.financialToday(records([payment('1', 'APPROVED', 0)]), tz, now).received, 0);
});
test('pending closed sessions are separate from received cash and not added twice', () => {
  const result = m.financialToday(records([payment('1', 'APPROVED', 20), payment('1', 'APPROVED', 20)], [session('1', 'PENDING', 40), session('1', 'PENDING', 40), session('2', 'APPROVED', 20), { ...session('3', 'PENDING', 60), status: 'ACTIVE' }]), tz, now);
  assert.equal(result.received, 20);
  assert.equal(result.outstanding, 40);
});
test('cash totals use integer cents and require stable record IDs', () => {
  assert.equal(m.financialToday(records([payment('1', 'APPROVED', .1), payment('2', 'APPROVED', .2)]), tz, now).received, .3);
  assert.equal(m.financialToday(records([payment('', 'APPROVED', 20)]), tz, now).received, null);
});
test('missing invoice status and value keep outstanding total unavailable', () => {
  assert.equal(m.financialToday(records([], [session('1', '', 20)]), tz, now).outstanding, null);
  assert.equal(m.financialToday(records([], [session('1', 'PENDING', null)]), tz, now).outstanding, null);
});
test('mapper retains unknown financial fields and trusts completeness only for consolidated arrays', () => {
  const resources = { carregadores: [], sessoes: [], pagamentos: [{ id: '1', status: 'APPROVED', amount: null, paidAt }], alertas: [] };
  const data = mapDashboardData({}, resources, true);
  assert.equal(data.financeRecords.payments[0].amount, null);
  assert.equal(data.financeRecords.complete, true);
  assert.equal(mapDashboardData({}, resources).financeRecords.complete, false);
  assert.equal(mapDashboardData({}, { ...resources, pagamentos: {} }, true).financeRecords.complete, false);
});
test('notice feed is scoped, deduplicated, ordered and capped, without generating events', () => {
  const base = { status: 'aberto', dataCriacao: paidAt };
  const rows = [1, 2, 3, 4].map(n => ({ ...base, alertaId: String(n), estacaoId: '39', dataCriacao: `2026-10-12T1${n}:00:00Z` }));
  rows.push(rows[0], { ...base, alertaId: 'other', estacaoId: '40' }, { ...base, alertaId: 'resolved', status: 'resolvido' }, { ...base, alertaId: 'bad', dataCriacao: '' }, { ...base, alertaId: 'future', dataCriacao: '2026-10-13T10:00:00Z' });
  assert.deepEqual(m.stationNotices(rows, '39', now).map(a => a.alertaId), ['4', '3', '2']);
  assert.deepEqual(m.stationNotices([], '39', now), []);
});
test('an open alert never implies a confirmed GIE command', () => {
  const alert = mapAlert({ id: '1', title: 'Request', origin: 'GIE', createdAt: paidAt });
  assert.equal(alert.origem, 'GIE');
  assert.equal(alert.fase, undefined);
  assert.equal(mapAlert({ id: '1', phase: 'CONFIRMED' }).fase, 'confirmado');
  assert.equal(mapAlert({ id: '1' }).dataCriacao, '');
});
test('GIE status distinguishes offline, stale, wrong station, simulation and future clock', () => {
  const gie = { online: true, station_id: '39', observed_at: new Date(now).toISOString(), mode: 'PRESENTATION', isolated: true };
  assert.equal(m.gieHealth(gie, '39', now).state, 'simulated');
  assert.equal(m.gieHealth({ ...gie, online: false }, '39', now).state, 'offline');
  assert.equal(m.gieHealth(gie, '40', now).state, 'offline');
  assert.equal(m.gieHealth({ ...gie, isolated: false }, '39', now + 120000).label, 'GIE sem atualização há 2 min');
  assert.equal(m.gieHealth({ ...gie, isolated: false }, '39', now - 120000).state, 'stale');
  assert.equal(m.gieHealth(gie, '39', now - 120000).state, 'simulated');
});
test('power points preserve source and quality; gap markers stay missing', () => {
  const points = monitoring.normalizeReadings([0, 60].map(minute => ({ measuredAt: new Date(now + minute * 60000).toISOString(), source: { id: 'source', label: 'Meter' }, provenance: 'MEASURED', measurementQuality: 'GOOD', solarPowerKw: 2 })), tz, now);
  assert.equal(points[0].sourceLabel, 'Meter');
  assert.equal(points[0].quality, 'GOOD');
  assert.equal(monitoring.withGaps(points)[1].quality, 'MISSING');
  assert.equal(monitoring.withGaps(points)[1].solar, null);
});
test('financial card renders unavailable costs and routes to existing payments without write controls', () => {
  const { StationFinancialSummary } = load('components/dashboard/StationFinancialSummary.tsx', {
    '@/components/shell/NavigationLink': { NavigationLink: props => React.createElement('a', props) },
  });
  const html = renderToStaticMarkup(React.createElement(StationFinancialSummary, { timezone: tz, now }));
  assert.match(html, /Indisponível/);
  assert.match(html, /A calcular/);
  assert.match(html, /href="\/payments"/);
  assert.doesNotMatch(html, /<form|lucro líquido<\/|R\$.*0,00/);
});
test('notice card renders a real empty state and never synthesizes GIE actions', () => {
  const { StationNotices } = load('components/dashboard/StationNotices.tsx');
  const html = renderToStaticMarkup(React.createElement(StationNotices, { alerts: [], stationId: '39', timezone: tz, now, onAll() {} }));
  assert.match(html, /Sem avisos registrados/);
  assert.match(html, /Histórico de ações do GIE indisponível/);
  assert.doesNotMatch(html, /Redistribuiu|22 kW|11 kW/);
});
test('default power chart has exactly three curves and one axis chart, without tariff or SOC plots', () => {
  const refs = [], stateChanges = [];
  const recharts = Object.fromEntries(['Bar', 'BarChart', 'CartesianGrid', 'Line', 'LineChart', 'ReferenceLine', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map(name => [name, name]));
  const { MonitoringChart, csvCell } = load('components/dashboard/MonitoringChart.tsx', { recharts, react: { ...React, useMemo: fn => fn(), useState: value => [typeof value === 'function' ? value() : value, next => stateChanges.push(next)], useRef: value => { const ref = { current: value }; refs.push(ref); return ref; } } });
  const range = monitoring.dateWindow('2026-10-12', 'day', tz);
  const props = { points: monitoring.demoReadings('2026-10-12', tz), previousPoints: [], previousRange: range, period: 'day', view: 'power', onView() {}, controls: null, loading: false, error: '', periodLabel: 'Historico selecionado', range, timezone: tz };
  const tree = MonitoringChart.type(props);
  const elements = [];
  function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; elements.push(node); visit(node.props.children); }
  visit(tree);
  assert.equal(elements.filter(node => node.type === 'LineChart').length, 1);
  assert.deepEqual(elements.filter(node => node.type === 'Line' && !node.props.hide).map(node => node.props.dataKey), ['solar', 'load', 'charger']);
  assert.equal(elements.filter(node => node.type === 'YAxis').length, 1);
  assert.equal(elements.some(node => ['soc', 'importTariff', 'exportTariff'].includes(node.props.dataKey)), false);
  refs[0].current = { open: true };
  tree.props.onKeyDown({ key: 'Escape' });
  assert.equal(stateChanges.length, 0);
  refs[0].current.open = false;
  tree.props.onKeyDown({ key: 'Escape' });
  assert.deepEqual(stateChanges, [false]);
  assert.equal(csvCell('=HYPERLINK("unsafe")'), '"\'=HYPERLINK(""unsafe"")"');
  assert.equal(csvCell(-3), '"-3"');
  const emptyHtml = renderToStaticMarkup(MonitoringChart.type({ ...props, points: [] }));
  assert.match(emptyHtml, /Sem leituras neste período/);
  assert.doesNotMatch(emptyHtml, /Ver exemplo|fictício|onExample/);
});
