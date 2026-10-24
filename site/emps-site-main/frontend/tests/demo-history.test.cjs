const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
function load(file, mocks = {}, cache = new Map()) {
  let filename = path.resolve(root, file);
  if (!path.extname(filename)) filename += fs.existsSync(filename + '.ts') ? '.ts' : '.tsx';
  if (cache.has(filename)) return cache.get(filename).exports;
  const child = new Module(filename, module);
  child.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, child);
  const original = child.require.bind(child);
  child.require = specifier => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (specifier.startsWith('@/')) return load(specifier.slice(2), mocks, cache);
    if (specifier.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), specifier)), mocks, cache);
    return original(specifier);
  };
  child._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return child.exports;
}

test('dataset coverage and monthly comparison preserve the original historical months', () => {
  const { monthlyCoverage, monthlyMean, sourceLocalDay } = load('domain/demo-history.ts');
  assert.equal(monthlyCoverage('2025-01-08', '2025-12-31'), 12);
  assert.equal(monthlyCoverage('2024-11-01', '2025-02-01'), 4);
  assert.equal(monthlyCoverage('bad', '2025-02-01'), 0);
  assert.deepEqual(monthlyMean({ sessions: 24, deliveredKwh: 480, revenueSimulated: 1440 }, 12),
    { sessions: 2, deliveredKwh: 40, revenueSimulated: 120 });
  assert.equal(sourceLocalDay('2026-07-01T02:45:00.000Z'), '2026-06-30');
  assert.equal(sourceLocalDay('2025-01-01T03:00:00.000Z'), '2025-01-01');
});

test('network charts omit shared commercial source unless Prédio is selected', () => {
  const { demoNetworkTotalStations } = load('domain/demo-history.ts');
  const stations = [
    { station: { id: 39 }, networkAggregation: { included: true } },
    { station: { id: 13 }, networkAggregation: { included: false, duplicateOfStationId: 39 } },
    { station: { id: 46 }, networkAggregation: { included: true } },
  ];
  assert.deepEqual(demoNetworkTotalStations(stations, '').map(row => row.station.id), [39, 46]);
  assert.deepEqual(demoNetworkTotalStations(stations.filter(row => row.station.id === 13), '13')
    .map(row => row.station.id), [13]);
});

test('Shopping preview cards receive June simulated totals by their explicit local source identities', () => {
  const { demoChargerCardHistory } = load('domain/demo-history.ts');
  const cards = ['AC_01', 'AC_02', 'AC_03', 'AC_04'].map((source, index) => ({
    carregadorId: String(101 + index), nome: `${source} · referência local`,
    serialNumber: `LOCAL_ONLY_SHOPPING_${source}`,
  }));
  const rows = [
    { sourceChargerId: 'AC_01', chargerId: null, sessions: 154, deliveredKwh: 2253.72, revenueSimulated: 4958.23 },
    { sourceChargerId: 'AC_02', chargerId: null, sessions: 126, deliveredKwh: 1907.42, revenueSimulated: 4196.32 },
    { sourceChargerId: 'AC_03', chargerId: null, sessions: 108, deliveredKwh: 1913.49, revenueSimulated: 4209.65 },
    { sourceChargerId: 'AC_04', chargerId: null, sessions: 116, deliveredKwh: 1718.01, revenueSimulated: 3779.63 },
  ];
  const mapped = demoChargerCardHistory(cards, rows, []);
  assert.deepEqual(Object.keys(mapped), ['101', '102', '103', '104']);
  for (const [index, row] of rows.entries()) {
    assert.deepEqual(mapped[String(101 + index)], { sessions: row.sessions, deliveredKwh: row.deliveredKwh,
      revenueSimulated: row.revenueSimulated, utilizationPct: null });
  }
  assert.equal(Object.values(mapped).reduce((sum, item) => sum + item.sessions, 0), 504);
  assert.equal(Number(Object.values(mapped).reduce((sum, item) => sum + item.deliveredKwh, 0).toFixed(2)), 7792.64);
  assert.equal(Number(Object.values(mapped).reduce((sum, item) => sum + item.revenueSimulated, 0).toFixed(2)), 17143.83);
});

test('historical card mapping requires a database ID or an unambiguous local preview marker', () => {
  const { demoChargerCardHistory } = load('domain/demo-history.ts');
  const row = { sourceChargerId: 'AC_01', chargerId: null, sessions: 3, deliveredKwh: 17,
    revenueSimulated: 39 };
  const real = { carregadorId: '900', nome: 'AC_01 · referência local', serialNumber: 'OCPP_REAL_900' };
  const preview = { carregadorId: '101', nome: 'AC_01 · referência local',
    serialNumber: 'LOCAL_ONLY_SHOPPING_AC_01' };
  assert.deepEqual(demoChargerCardHistory([real], [row], []), {});
  assert.deepEqual(demoChargerCardHistory([preview, { ...preview, carregadorId: '102' }], [row], []), {});
  assert.equal(demoChargerCardHistory([real, preview], [row], [
    { sourceChargerId: 'AC_01', utilizationPct: 52 },
  ])['101'].utilizationPct, 52);
  assert.equal(demoChargerCardHistory([real], [{ ...row, chargerId: 900 }], [])['900'].sessions, 3);
});

async function apiHarness(action) {
  const originals = { window: global.window, sessionStorage: global.sessionStorage, fetch: global.fetch };
  const values = new Map(), calls = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let respond = () => Response.json({ context: 'SIMULATED', station: { id: 51 }, stations: [] });
  Object.assign(global, {
    window: Object.assign(new EventTarget(), { sessionStorage: storage, location: { hostname: 'localhost', pathname: '/stations' }, setTimeout, clearTimeout, atob }),
    sessionStorage: storage,
    fetch: async (url, init) => { calls.push({ url, init }); return respond(url, init); },
  });
  try {
    const service = load('services/emps-api.ts', {
      '@/services/emps-mappers': { mapResourceList: (_, rows) => rows, mapDashboardData: (summary, details) => ({ summary, ...details }) },
    });
    service.frontSession.set({ usuarioId: 'owner', nome: 'Owner', email: 'owner@example.invalid', role: 'admin', modo: 'api', token: 'fixture' });
    await action({ ...service, calls, setResponse: fn => { respond = fn; } });
  } finally { Object.assign(global, originals); }
}

test('demo reads carry JWT, station scope, filters and never call financial mutation routes', async () => {
  await apiHarness(async ({ api, selectedStation, calls, setResponse }) => {
    selectedStation.set('99');
    setResponse(() => Response.json({ context: 'SIMULATED', station: { id: 51 } }));
    await api.demoHistoryStation('51', { from: '2025-01-01', to: '2025-01-31', channel: 'APP_EMPS', method: 'PIX' });
    assert.match(calls[0].url, /\/demo-history\/stations\/51\?from=2025-01-01&to=2025-01-31&channel=APP_EMPS&method=PIX$/);
    assert.equal(calls[0].init.headers.get('X-Station-Id'), '51');
    assert.equal(calls[0].init.headers.get('Authorization'), 'Bearer fixture');
    assert.equal(calls[0].init.method ?? 'GET', 'GET');
    assert.equal(selectedStation.get(), '99');
    assert.equal(calls.length, 1);
  });
});

test('analytical history uses the same owner-scoped simulated source and validates the response', async () => {
  await apiHarness(async ({ api, calls, setResponse }) => {
    setResponse(() => Response.json({ context: 'SIMULATED', station: { id: 51 },
      source: { datasetKey: 'casa_v1' }, points: [], buckets: [] }));
    await api.demoHistoryAnalytics('51', { from: '2025-02-01', to: '2025-02-28', grain: 'month' });
    assert.match(calls[0].url, /\/demo-history\/stations\/51\/analytics\?from=2025-02-01&to=2025-02-28&grain=month$/);
    assert.equal(calls[0].init.headers.get('X-Station-Id'), '51');
    assert.equal(calls[0].init.headers.get('Authorization'), 'Bearer fixture');
    assert.equal(calls[0].init.method ?? 'GET', 'GET');
    setResponse(() => Response.json({ context: 'OPERATIONAL', station: { id: 51 }, points: [], buckets: [] }));
    await assert.rejects(api.demoHistoryAnalytics('51', { from: '2025-02-01', to: '2025-02-28', grain: 'month' }, true), /não pôde ser validada/);
  });
});

test('dashboard uses exact interval kWh while historical power stays descriptive', () => {
  const { demoEnergyBuckets, demoEnergyTotals, demoPowerPoints, demoHistoricalFlow } = load('domain/demo-monitoring.ts');
  const analytics = { context: 'SIMULATED', source: { datasetKey: 'casa_v1' },
    period: { from: '2025-02-01', to: '2025-02-01', grain: 'day' },
    totals: { intervalCount: 1, buildingKwh: 1.75, solarKwh: null, evDeliveredKwh: 2.3, gridImportKwh: null },
    points: [{ at: '2025-02-01T03:00:00.000Z', buildingKw: 7, solarKw: null,
      evDeliveredKw: 10, gridKw: null, intervalCount: 1 }],
    buckets: [{ start: '2025-02-01T03:00:00.000Z', end: '2025-02-01T04:00:00.000Z',
      buildingKwh: 1.75, solarKwh: null, evDeliveredKwh: 2.3, gridImportKwh: null }],
  };
  const totals = demoEnergyTotals(analytics), buckets = demoEnergyBuckets(analytics, 'America/Sao_Paulo');
  const points = demoPowerPoints(analytics, Date.parse('2025-02-01T03:00:00.000Z'), 'America/Sao_Paulo');
  const flow = demoHistoricalFlow(analytics);
  assert.equal(totals.charger, 2.3);
  assert.equal(buckets[0].charger, 2.3);
  assert.equal(points[0].charger, 10);
  assert.equal(flow.chargerPowerKw, 10);
  assert.equal(flow.updatedAt, '2025-02-01T03:00:00.000Z');
  assert.equal(totals.solar, null);
  assert.equal(totals.imported, null);
  assert.equal(flow.gridPowerKw, null);
});

test('owner overview ignores a previously selected station and validates simulated provenance', async () => {
  await apiHarness(async ({ api, selectedStation, calls, setResponse }) => {
    selectedStation.set('99');
    setResponse(() => Response.json({ context: 'SIMULATED', stations: [] }));
    await api.demoHistoryNetwork({ channel: 'CAIXA', method: 'CASH' });
    assert.match(calls[0].url, /\/demo-history\/network\?channel=CAIXA&method=CASH$/);
    assert.equal(calls[0].init.headers.has('X-Station-Id'), false);
    assert.equal(calls[0].init.method ?? 'GET', 'GET');
    setResponse(() => Response.json({ context: 'OPERATIONAL', stations: [] }));
    await assert.rejects(api.demoHistoryNetwork({}, true), /não pôde ser validado/);
    setResponse(() => Response.json({ context: 'SIMULATED', station: { id: 52 } }));
    await assert.rejects(api.demoHistoryStation('51', {}, true), /não pôde ser validado/);
  });
});

test('front-only preview does not display fixed paid sessions, revenue or sold kWh', async () => {
  const previous = process.env.NEXT_PUBLIC_EMPS_DEMO_MODE;
  process.env.NEXT_PUBLIC_EMPS_DEMO_MODE = 'true';
  try {
    await apiHarness(async ({ api, calls }) => {
      const panel = await api.dashboard('51');
      assert.equal(panel.resumo.receitaHoje, 0);
      assert.equal(panel.resumo.receitaMes, 0);
      assert.equal(panel.resumo.energiaHojeKwh, 0);
      assert.equal(panel.resumo.sessoesHoje, 0);
      assert.equal(panel.financeRecords.complete, true);
      assert.deepEqual(panel.sessoes, []);
      assert.deepEqual(panel.pagamentos, []);
      assert.deepEqual(await api.list('sessoes'), []);
      assert.deepEqual(await api.list('pagamentos'), []);
      assert.equal(calls.length, 0);
    });
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_EMPS_DEMO_MODE;
    else process.env.NEXT_PUBLIC_EMPS_DEMO_MODE = previous;
  }
});

test('station history shows simulated provenance, source dates and payments without operational receipt controls', () => {
  const wrap = ({ children }) => React.createElement('div', null, children);
  const chart = Object.fromEntries(['CartesianGrid', 'Legend', 'Line', 'LineChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map(name => [name, wrap]));
  const { DemoStationDetail } = load('components/demo-history/DemoHistoryViews.tsx', {
    recharts: chart,
    '@/components/shell/NavigationLink': { NavigationLink: ({ href, children }) => React.createElement('a', { href }, children) },
    '@/services/emps-api': { api: {} },
  });
  const data = {
    context: 'SIMULATED', station: { id: 51, name: 'Posto 24h', gieProfile: 'POSTO', gieStationId: 'DEMO_POSTO_24H_001' },
    batch: { id: 1, datasetKey: 'posto_24h_v1', periodStart: '2025-01-01', periodEnd: '2025-12-31', scenarioVersion: 'v1' },
    summary: { attempts: 2, sessions: 1, deliveredKwh: 10, revenueSimulated: 23, avgTicket: 23, avgEnergy: 10 },
    chargers: [{ sourceChargerId: 'EVSE_01', chargerId: 1, sessions: 1, deliveredKwh: 10, revenueSimulated: 23 }],
    monthly: [{ month: '2025-01', sessions: 1, deliveredKwh: 10, revenueSimulated: 23 }],
    hours: [{ hour: 8, sessions: 1 }], channels: [{ channel: 'APP_EMPS', sessions: 1, revenueSimulated: 23 }],
    methods: [{ method: 'PIX', sessions: 1, revenueSimulated: 23 }],
    readings: [{ intervalStart: '2025-01-01', buildingKw: 10, solarKw: 2, gridKw: 8, evDeliveredKw: 5,
      buildingKwh: 240, solarKwh: 48, gridKwh: 192, evDeliveredKwh: 120 }],
    sessions: [{ sourceSessionId: 'source-1', sourceChargerId: 'EVSE_01', startTime: '2025-01-01T11:00:00Z', endTime: '2025-01-01T12:00:00Z', deliveredKwh: 10, amount: 23, channel: 'APP_EMPS', method: 'PIX', status: 'COMPLETED' }],
  };
  const html = renderToStaticMarkup(React.createElement(DemoStationDetail, { data }));
  assert.match(html, /Histórico demonstrativo · SIMULATED/);
  assert.match(html, /2025/);
  assert.match(html, /R\$\s*23,00/);
  assert.match(html, /source-1/);
  assert.match(html, /DEMO_POSTO_24H_001 · perfil POSTO/);
  assert.match(html, /App EMPS/);
  assert.doesNotMatch(html, /Receita recebida|Concluir pagamento|Iniciar recarga/);
});
