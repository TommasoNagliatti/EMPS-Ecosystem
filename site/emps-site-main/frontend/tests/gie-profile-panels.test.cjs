const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const observedAt = '2026-10-14T12:00:00Z';

function loadTs(relative, mocks = {}, cache = new Map()) {
  let filename = path.resolve(root, relative);
  if (!path.extname(filename)) filename += fs.existsSync(filename + '.ts') ? '.ts' : '.tsx';
  if (cache.has(filename)) return cache.get(filename).exports;
  const child = new Module(filename, module);
  child.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, child);
  const original = child.require.bind(child);
  child.require = specifier => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier.endsWith('.css')) return { __esModule: true, default: {} };
    if (specifier.startsWith('@/')) return loadTs(specifier.slice(2), mocks, cache);
    if (specifier.startsWith('.')) return loadTs(path.relative(root, path.resolve(path.dirname(filename), specifier)), mocks, cache);
    return original(specifier);
  };
  child._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return child.exports;
}

function workerDecision(stationId, evseCount, batteries = []) {
  const evse = Array.from({ length: evseCount }, (_, index) => ({
    id: `EVSE_${String(index + 1).padStart(2, '0')}`, max_kw: 22,
  }));
  return {
    timestamp: observedAt, execution_allowed: true, provenance: { origin: 'SIMULATED' },
    numeric_state: { building_kw: 11, solar_kw: 7, ev_demand_kw: 8, ev_served_kw: 8,
      evse_setpoints_kw: evse.map((_, index) => index + 2) },
    visual_state: { valid: true },
    station_extension: { station_id: stationId, equipment: { evse, batteries },
      battery_decisions: Object.fromEntries(batteries.map((battery, index) => [battery.id,
        { soc_after: index ? 0.68 : 0.41, charge_kw: index ? 0 : 3, discharge_kw: index ? 2 : 0 }])) },
    forecasts: { records: Array.from({ length: 48 }, (_, index) => ({
      timestamp: new Date(Date.parse(observedAt) + (index + 1) * 15 * 60_000).toISOString(),
      building_kw: 11, potencia_solicitada_prevista_kw: 8, solar_previsto_kw: 7,
    })) },
  };
}

function v3(stationId, gieStationId, evseCount, batteries = []) {
  return { station_id: stationId, gie_station_id: gieStationId, generation: 'generation-1',
    mode: 'NORMAL', observed_at: observedAt, online: true, source: 'SIMULATED',
    capabilities: { presentation: false, manual_demo: false },
    state: { station_id: gieStationId, generation: 'generation-1', source: 'SIMULATED',
      state: workerDecision(gieStationId, evseCount, batteries) },
    history: [{ station_id: gieStationId, issue_time: observedAt, origin: 'SIMULATED', status: 'ok' }] };
}

function renderGiePanel(stationId, state) {
  const values = [state, '', false, '', '1', true];
  let index = 0;
  const hooks = { ...React, useState: () => [values[index++], () => {}],
    useRef: value => ({ current: value }), useCallback: fn => fn, useEffect: () => {} };
  const { GieControls } = loadTs('components/energy/GieControls.tsx', {
    react: hooks,
    '@/services/emps-api': { api: {}, frontSession: { get: () => ({ role: 'admin' }) },
      selectedStation: { get: () => stationId } },
  });
  return renderToStaticMarkup(React.createElement(GieControls, { initialStationId: stationId, onState() {} }));
}

test('Shopping keeps its original unbound GIE presentation and four EVSE slots', () => {
  const commercial = { station_id: '42', mode: 'PRESENTATION', observed_at: observedAt,
    online: true, source: 'SIMULATED', state: workerDecision('Commercial_HighAutonomy_V2', 4),
    presentation: { scene_number: 5, name: 'Cena comercial', playing: true },
    manual_events: { EV_PEAK: 'Pico EV' } };
  const html = renderGiePanel('42', commercial);
  assert.match(html, /Carregadores · 4/);
  for (const slot of [1, 2, 3, 4]) assert.match(html, new RegExp(`EVSE_${String(slot).padStart(2, '0')}`));
  assert.match(html, /Cena 5 · Cena comercial/);
  assert.match(html, /Iniciar apresentação/);
  assert.match(html, /Reiniciar cenas/);
  assert.doesNotMatch(html, /Avançar 15 minutos simulados/);
  assert.match(html, /Setpoints são limites calculados, não potência medida/);
});

test('Posto V3 shows two EVSEs and two separate battery decisions, only as simulation', () => {
  const post = v3('51', 'DEMO_POSTO_24H_001', 2,
    [{ id: 'BAT_01', nominal_kwh: 61.4 }, { id: 'BAT_02', nominal_kwh: 61.4 }]);
  const html = renderGiePanel('51', post);
  assert.match(html, /DEMO_POSTO_24H_001/);
  assert.match(html, /Carregadores · 2/);
  assert.match(html, /EVSE_01/);
  assert.match(html, /EVSE_02/);
  assert.match(html, /BAT_01/);
  assert.match(html, /BAT_02/);
  assert.match(html, /SoC simulado: 41%/);
  assert.match(html, /SoC simulado: 68%/);
  assert.match(html, /Previsões · 48 intervalos de 15 min/);
  assert.match(html, /Dados SIMULATED · sem despacho físico/);
  assert.match(html, /Avançar 15 minutos simulados/);
  assert.doesNotMatch(html, /Iniciar apresentação|Vincular EVSE|Pagamento/);
});

test('Residência V3 shows one EVSE and explicitly no battery or commercial controls', () => {
  const html = renderGiePanel('52', v3('52', 'DEMO_CASA_001', 1));
  assert.match(html, /DEMO_CASA_001/);
  assert.match(html, /Carregadores · 1/);
  assert.match(html, /EVSE_01/);
  assert.doesNotMatch(html, /EVSE_02|BAT_01|BAT_02/);
  assert.match(html, /Sem bateria cadastrada neste perfil/);
  assert.match(html, /Previsões · 48 intervalos de 15 min/);
  assert.doesNotMatch(html, /Iniciar apresentação|Vincular EVSE|Pagamento/);
});

test('an offline demo dashboard cannot display stale allocation as live energy', () => {
  const offline = { ...v3('51', 'DEMO_POSTO_24H_001', 2), online: false };
  const html = renderGiePanel('51', offline);
  assert.match(html, /Serviço indisponível/);
  assert.match(html, /Dados indisponíveis/);
  assert.match(html, /Carregadores · indisponível/);
  assert.doesNotMatch(html, /Alocação simulada: 2 kW|Avançar 15 minutos simulados/);
});

test('GIE notices stay scoped to their installation, marked simulated, and report offline health', () => {
  const { StationNotices } = loadTs('components/dashboard/StationNotices.tsx');
  const alerts = [
    { alertaId: 'post-alert', estacaoId: '51', titulo: 'Limite do posto', descricao: 'Demanda simulada',
      carregadorNome: null, origem: 'GIE', modo: 'simulado', severidade: 'alta', status: 'aberto',
      dataCriacao: '2026-10-14T11:59:00Z' },
    { alertaId: 'house-alert', estacaoId: '52', titulo: 'Aviso da residência', descricao: 'Outra estação',
      carregadorNome: null, origem: 'GIE', modo: 'simulado', severidade: 'baixa', status: 'aberto',
      dataCriacao: '2026-10-14T11:58:00Z' },
  ];
  const props = { alerts, stationId: '51', timezone: 'America/Sao_Paulo',
    now: Date.parse(observedAt), onAll() {}, gie: v3('51', 'DEMO_POSTO_24H_001', 2) };
  const online = renderToStaticMarkup(React.createElement(StationNotices, props));
  assert.match(online, /GIE · simulação/);
  assert.match(online, /Limite do posto/);
  assert.match(online, /GIE · simulado/);
  assert.doesNotMatch(online, /Aviso da residência/);
  const offline = renderToStaticMarkup(React.createElement(StationNotices,
    { ...props, gie: { ...props.gie, online: false } }));
  assert.match(offline, /GIE offline/);
  assert.match(offline, /Limite do posto/);
});
