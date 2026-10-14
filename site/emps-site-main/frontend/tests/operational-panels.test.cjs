const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const cache = new Map();
let navigationSnapshot = null;
function loadTs(relative) {
  let filename = path.resolve(root, relative);
  if (!path.extname(filename)) filename += fs.existsSync(filename + '.ts') ? '.ts' : '.tsx';
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const instance = new Module(filename, module);
  cache.set(filename, instance);
  const nativeRequire = Module.createRequire(filename);
  instance.require = specifier => {
    if (specifier.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, name) => String(name) }) };
    if (specifier === '@/components/shell/AppShell') return { AppShell: ({ children }) => React.createElement('main', null, children) };
    if (specifier === '@/services/emps-api') return { api: { cached: () => null, cachedList: () => navigationSnapshot }, isReadOnlyMode: true, frontSession: { get: () => null } };
    if (specifier === '@/components/shell/NavigationLink') return { NavigationLink: ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children) };
    if (specifier === '@/components/realtime/RealtimeProvider') return { useRealtime: () => ({ connectionVersion: 0, status: 'disabled', topicRevisions: {} }) };
    if (specifier.startsWith('@/')) return loadTs(specifier.slice(2));
    if (specifier.startsWith('.')) return loadTs(path.relative(root, path.resolve(path.dirname(filename), specifier)));
    return nativeRequire(specifier);
  };
  instance._compile(compiled, filename);
  return instance.exports;
}
const model = loadTs('components/operations/operational-model.ts');
const chargers = loadTs('components/chargers/charger-list-model.ts');
const now = new Date('2026-10-12T12:00:00');
const client = (status = 'ativo') => ({ usuarioId: '1', nome: 'José Almeida', email: 'example@example.invalid', telefone: '', veiculo: '', placa: '', status, totalSessoes: 0, totalGasto: 0, criadoEm: now.toISOString() });
const session = overrides => ({ sessaoId: '1', usuarioId: '1', usuarioNome: 'Example', carregadorId: '1', carregadorNome: 'EVSE', status: 'finalizada', dataInicio: now.toISOString(), dataFim: now.toISOString(), duracaoMinutos: 10, energiaKwh: 5, valorTotal: 10, statusPagamento: 'aprovado', ...overrides });
const payment = overrides => ({ pagamentoId: '1', sessaoId: '1', usuarioId: '1', usuarioNome: 'Example', carregadorId: '1', valorTotal: 10, status: 'aprovado', metodo: 'PIX', dataPagamento: now.toISOString(), transactionId: null, ...overrides });
const alert = overrides => ({ alertaId: '1', carregadorId: null, carregadorNome: null, titulo: 'Alerta', descricao: 'Example', severidade: 'alta', status: 'aberto', origem: 'EMPS', dataCriacao: now.toISOString(), ...overrides });
const charger = overrides => ({ id: 1, name: 'EVSE José', stationId: 39, ocppIdentity: 'OCPP-39', powerKw: '7.4', connectorType: 'TYPE2', administrativeStatus: 'ENABLED', station: { id: 39, name: 'Instalação Centro', reviewState: 'APPROVED' }, liveStatus: null, qrBindings: [], ...overrides });

test('active and inactive filters use exact status matching', () => {
  assert.equal(model.matchesStatus('clientes', client('inativo'), 'ativo'), false);
  assert.equal(model.matchesStatus('clientes', client('ativo'), 'ativo'), true);
  assert.equal(model.matchesStatus('clientes', client('inativo'), 'inativo'), true);
});
test('critical alert filter matches severity, not text or another status', () => {
  assert.equal(model.matchesStatus('alertas', alert({ severidade: 'critica' }), 'critica'), true);
  assert.equal(model.matchesStatus('alertas', alert({ titulo: 'Critica' }), 'critica'), false);
  assert.equal(model.matchesStatus('alertas', alert(), 'todos'), true);
});
test('search normalizes accents, case and surrounding whitespace', () => {
  assert.equal(model.matchesSearch(client(), '  JOSE ALMEIDA  '), true);
  assert.equal(model.matchesSearch(client(), 'missing'), false);
});
test('periods cover today, Monday-to-today and month-to-today in local calendar', () => {
  assert.deepEqual(model.periodRange('day', {}, now), { from: '2026-10-12', to: '2026-10-12' });
  assert.deepEqual(model.periodRange('week', {}, new Date('2026-10-18T12:00:00')), { from: '2026-10-12', to: '2026-10-18' });
  assert.deepEqual(model.periodRange('month', {}, now), { from: '2026-10-01', to: '2026-10-12' });
  assert.deepEqual(model.periodRange('all', {}, now), { from: '', to: '' });
});
test('custom dates preserve bounds and include the end of the last day', () => {
  const range = { from: '2026-10-08', to: '2026-10-08' };
  assert.deepEqual(model.periodRange('custom', range, now), range);
  assert.equal(model.matchesDate(session({ dataInicio: '2026-10-08T23:59:59.999' }), range), true);
  assert.equal(model.matchesDate(session({ dataInicio: '2026-10-09T00:00:00' }), range), false);
  assert.equal(model.matchesDate(session({ dataInicio: '2026-10-07T23:59:59.999' }), range), false);
});
test('missing confirmation is not assigned a fictional date', () => {
  const row = payment({ dataPagamento: null, status: 'pendente' });
  assert.equal(model.matchesDate(row, { from: '', to: '' }), true);
  assert.equal(model.matchesDate(row, { from: '2026-10-01', to: '' }), false);
  assert.equal(model.matchesDate(payment({ dataPagamento: 'bad-date' }), { from: '2026-10-01', to: '' }), false);
  assert.equal(model.matchesDate(session(), { from: '2026-10-13', to: '2026-10-01' }), false);
});
test('pagination clamps pages after filtering without changing rows', () => {
  const rows = Array.from({ length: 51 }, (_, i) => i);
  assert.deepEqual(model.pageSlice(rows, 3).rows, [50]);
  assert.equal(model.pageSlice(rows, 50).currentPage, 3);
  assert.equal(model.pageSlice([], 5).first, 0);
  assert.equal(model.pageSlice([1], 0).currentPage, 1);
  assert.equal(rows.length, 51);
});
test('payment summary counts only amounts belonging to each payment state', () => {
  const summary = model.resourceSummary('pagamentos', [payment(), payment({ status: 'pendente', valorTotal: 4 }), payment({ status: 'estornado', valorTotal: 2 }), payment({ status: 'recusado', valorTotal: 20 })]);
  assert.deepEqual(summary.map(metric => metric.value), [4, 10, 4, 2]);
});
test('session summary aggregates energy and active/unpaid sessions separately', () => {
  const summary = model.resourceSummary('sessoes', [session(), session({ status: 'ativa', energiaKwh: 2 }), session({ status: 'aguardando_pagamento', energiaKwh: 1 })]);
  assert.deepEqual(summary.map(metric => metric.value), [3, 1, 8, 1]);
});
test('resolved critical alerts do not count as current critical incidents', () => {
  assert.deepEqual(model.resourceSummary('alertas', [alert({ severidade: 'critica' }), alert({ severidade: 'critica', status: 'resolvido' })]).map(metric => metric.value), [2, 1, 1, 1]);
});
test('sorting is immutable and places unconfirmed payments after dated ones', () => {
  const rows = [payment({ pagamentoId: 'pending', dataPagamento: null }), payment({ pagamentoId: 'old', dataPagamento: '2026-10-01' }), payment({ pagamentoId: 'new', dataPagamento: '2026-10-08' })];
  assert.deepEqual(model.sortRows(rows, 'recent').map(row => row.pagamentoId), ['new', 'old', 'pending']);
  assert.deepEqual(model.sortRows(rows, 'oldest').map(row => row.pagamentoId), ['old', 'new', 'pending']);
  assert.equal(rows[0].pagamentoId, 'pending');
});
test('alert ordering prioritizes unresolved severity before resolved incidents', () => {
  const rows = [alert({ alertaId: 'resolved', severidade: 'critica', status: 'resolvido' }), alert({ alertaId: 'low', severidade: 'baixa' }), alert({ alertaId: 'critical', severidade: 'critica' })];
  assert.deepEqual(model.sortRows(rows, 'priority').map(row => row.alertaId), ['critical', 'low', 'resolved']);
});
test('enabled registration alone never means available or connected', () => {
  assert.equal(chargers.chargerState(charger(), now.getTime()).key, 'unknown');
  assert.equal(chargers.chargerPower(charger(), now.getTime()), null);
});
test('only recent telemetry enables charger state and current-power display', () => {
  const liveStatus = { operationalStatus: 'CHARGING', currentPowerKw: '3.5', lastSeenAt: now.toISOString() };
  assert.equal(chargers.chargerState(charger({ liveStatus }), now.getTime()).key, 'charging');
  assert.equal(chargers.chargerPower(charger({ liveStatus }), now.getTime()), 3.5);
  for (const lastSeenAt of [null, 'invalid', new Date(now.getTime() - 901000).toISOString(), new Date(now.getTime() + 6000).toISOString()]) {
    const row = charger({ liveStatus: { ...liveStatus, lastSeenAt } });
    assert.equal(chargers.chargerState(row, now.getTime()).key, 'unknown');
    assert.equal(chargers.chargerPower(row, now.getTime()), null);
  }
});
test('administrative status overrides live telemetry and search combines identifiers', () => {
  const liveStatus = { operationalStatus: 'CHARGING', currentPowerKw: '3.5', lastSeenAt: now.toISOString() };
  assert.equal(chargers.chargerState(charger({ administrativeStatus: 'DISABLED', liveStatus }), now.getTime()).key, 'disabled');
  assert.equal(chargers.chargerState(charger({ administrativeStatus: 'MAINTENANCE', liveStatus }), now.getTime()).key, 'maintenance');
  assert.equal(chargers.matchesCharger(charger(), 'jose', '39', 'unknown', now.getTime()), true);
  assert.equal(chargers.matchesCharger(charger(), 'OCPP-39', '40', 'all', now.getTime()), false);
});
test('all four operational pages render accessible search and honest loading states', () => {
  const { OperationalPage } = loadTs('components/operations/OperationalPage.tsx');
  for (const resource of ['sessoes', 'pagamentos', 'clientes', 'alertas']) {
    const html = renderToStaticMarkup(React.createElement(OperationalPage, { resource }));
    assert.match(html, /aria-label="Buscar /);
    assert.match(html, /Somente leitura/);
    assert.match(html, /Carregando dados/);
    assert.doesNotMatch(html, /Contrato canônico|dados puros/);
  }
});

test('a warm operational page renders its rows immediately and preserves the actual consultation timestamp', () => {
  navigationSnapshot = { value: [client()], updatedAt: Date.parse('2026-10-12T12:00:00Z') };
  try {
    const { OperationalPage } = loadTs('components/operations/OperationalPage.tsx');
    const html = renderToStaticMarkup(React.createElement(OperationalPage, { resource: 'clientes' }));
    assert.match(html, /Jos[eé] Almeida/);
    assert.doesNotMatch(html, /Carregando dados|Consultando registros/);
    assert.match(html, /dateTime="2026-10-12T12:00:00.000Z"/);
  } finally { navigationSnapshot = null; }
});
test('shared summary does not turn an unavailable query into zero', () => {
  const { OperationsSummary } = loadTs('components/operations/OperationsUI.tsx');
  const html = renderToStaticMarkup(React.createElement(OperationsSummary, { loading: true, metrics: [{ label: 'Clientes', value: 0 }] }));
  assert.match(html, /<dd>—<\/dd>/);
  assert.match(html, /aria-busy="true"/);
});
test('charger view separates infrastructure and requests, with safe QR creation guard', () => {
  const source = fs.readFileSync(path.join(root, 'components/chargers/ChargerProvisioningPage.tsx'), 'utf8');
  assert.match(source, /if \(view === 'requests'\) void load\(\)/);
  assert.doesNotMatch(source, /Nenhuma bomba entra no aplicativo/);
  const qr = fs.readFileSync(path.join(root, 'components/chargers/CanonicalChargers.tsx'), 'utf8');
  assert.ok(qr.indexOf('if (isReadOnlyMode) return;') < qr.indexOf("method: 'POST'"));
});

test('missing references and rated power remain unknown, while a measured zero is valid', () => {
  assert.equal(model.displayReference('cliente-sem-id'), 'Não associado');
  assert.equal(model.displayReference('118'), '118');
  for (const powerKw of [null, '', 'invalid', '-1', 0]) assert.equal(chargers.chargerNominalPower(charger({ powerKw })), null);
  assert.equal(chargers.chargerNominalPower(charger()), 7.4);
  const liveStatus = { operationalStatus: 'AVAILABLE', currentPowerKw: '0', lastSeenAt: now.toISOString() };
  assert.equal(chargers.chargerPower(charger({ liveStatus }), now.getTime()), 0);
  assert.equal(chargers.chargerPower(charger({ liveStatus: { ...liveStatus, currentPowerKw: '-1' } }), now.getTime()), null);
});

test('remote startup passes an absolute launcher identity to the safe stop helper', () => {
  const script = fs.readFileSync(path.resolve(root, '../../../scripts/start-remote-dev.ps1'), 'utf8');
  assert.match(script, /\$arguments = @\(\(Join-Path \$backend 'scripts\/remote-development\.cjs'\)\)/);
  const launcher = fs.readFileSync(path.resolve(root, '../backend/scripts/remote-development.cjs'), 'utf8');
  assert.match(launcher, /NEXT_PUBLIC_EMPS_READ_ONLY:'true'/);
});
