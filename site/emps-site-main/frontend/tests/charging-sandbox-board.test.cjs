const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
function load(relative, mocks = {}, cache = new Map()) {
  let filename = path.resolve(root, relative);
  if (!path.extname(filename)) filename += fs.existsSync(`${filename}.ts`) ? '.ts' : '.tsx';
  if (cache.has(filename)) return cache.get(filename).exports;
  const child = new Module(filename, module);
  child.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, child);
  const original = child.require.bind(child);
  child.require = specifier => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier.endsWith('.css')) return { __esModule: true, default: {} };
    if (specifier.startsWith('@/')) return load(specifier.slice(2), mocks, cache);
    return original(specifier);
  };
  child._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return child.exports;
}

const charger = { carregadorId: '76', nome: 'EVSE_01', status: 'offline', estacaoId: '46',
  administrativeStatus: 'PENDING', potenciaMaximaKw: 22, potenciaAtualKw: 0, tarifaKwh: 1.5,
  tipoConector: 'Tipo 2', localizacao: 'Posto 24h', serialNumber: 'LAB-76',
  ultimaComunicacao: '2026-10-18T00:00:00Z', temperaturaC: null, energiaHojeKwh: 0,
  receitaHoje: 0, usuarioAtualId: null, sessoesHoje: 0, ocupacaoHojePercent: 0,
  tempoMedioSessaoMinutos: 0, motivoFalha: null, motivoAtencao: null };
const status = { mode: 'SANDBOX', stationId: 46, chargers: [{ chargerId: 76, evse: 'EV1',
  physicalStatus: 'OFFLINE', sandboxStatus: 'AVAILABLE', simulatedPowerKw: null,
  pricePerKwh: 1.5, fixedFee: 0,
  estimatedEnergyKwh: null, estimatedCost: null, provenance: 'SANDBOX_ESTIMATE', session: null }], sessions: [] };

function boardTree(sandbox, draft = null, platform = async () => { throw new Error('Unexpected request'); }, qr = null, transition = null, residence = false) {
  let index = 0;
  const hooks = { ...React,
    useState(initial) { const current = index++; return [current === 11 ? sandbox : current === 14 ? draft : current === 16 ? transition : current === 18 ? qr :
      typeof initial === 'function' ? initial() : initial, () => {}]; },
    useEffect() {}, useRef(value) { return { current: value }; } };
  const { ChargerVisualBoard } = load('components/chargers/ChargerVisualBoard.tsx', {
    react: hooks, 'next/image': props => React.createElement('img', { src: props.src, alt: props.alt }),
    'qrcode.react': { QRCodeSVG: props => React.createElement('span', { 'data-qr-payload': props.value }, props.value) },
    '@/services/emps-api': { api: { platform }, isDemoMode: false },
    './ChargeLifecyclePanel': { ChargeLifecyclePanel: () => null },
  });
  return ChargerVisualBoard({ chargers: [residence ? {...charger, estacaoId:'47',carregadorId:'78',potenciaMaximaKw:7} : charger], sandboxStationId: residence ? '47' : '46' });
}
function boardHtml(sandbox, draft, qr, transition) {
  return renderToStaticMarkup(boardTree(sandbox, draft, undefined, qr, transition));
}
function findElement(root, predicate) {
  if (!root || typeof root !== 'object') return null;
  if (Array.isArray(root)) return root.map(item => findElement(item, predicate)).find(Boolean) ?? null;
  if (predicate(root)) return root;
  return findElement(root.props?.children, predicate);
}

test('Posto charger never exposes physical restart or maintenance while sandbox is unavailable', () => {
  const html = boardHtml(null);
  assert.match(html, /Sem conexão/);
  assert.match(html, /Aguardando estado SANDBOX válido/);
  assert.doesNotMatch(html, />Reiniciar<|>Manutencao<|>Caixa</);
});

test('Posto charger keeps existing card layout and labels simulated availability separately', () => {
  const html = boardHtml(status);
  assert.match(html, /charger-bay/);
  assert.match(html, /Disponível · SANDBOX/);
  assert.match(html, /SANDBOX · físico OFFLINE/);
  assert.match(html, /Iniciar recarga e pagamento fictícios/);
  assert.match(html, /Mostrar QR SANDBOX/);
  assert.doesNotMatch(html, />Reiniciar<|>Manutencao<|>Caixa</);
});

test('sandbox QR opens the same authenticated Web Charge binding without making the station public', () => {
  const html = boardHtml(status, null, { chargerId: '76', code: 'LAB46-EV1-TESTE', publicToken: 'stable-token-76' });
  assert.match(html, /data-qr-payload="\/charge\/stable-token-76"/);
  assert.match(html, /App ou Web Charge autenticado/);
  assert.match(html, /Abrir Web Charge autenticado/);
  assert.match(html, /Código LAB46-EV1-TESTE/);
  assert.doesNotMatch(html, /Web Charge público indisponível/);
});

test('charger card shows in-flight start and stop states without claiming physical availability', () => {
  const starting = boardHtml(status, null, null, { chargerId: '76', status: 'STARTING' });
  assert.match(starting, /Iniciando · SANDBOX/);
  assert.match(starting, /SANDBOX · físico OFFLINE/);
  assert.doesNotMatch(starting, /Finalizando · SANDBOX/);

  const active = { id: '22222222-2222-4222-8222-222222222222', stationId: 46, chargerId: 76,
    evse: 'EV1', status: 'charging', energyKwh: 0, totalCost: 0,
    paymentMethod: 'pix', paymentStatus: 'authorized', startedAt: '2026-10-18T12:00:00Z',
    endedAt: null, provenance: 'SANDBOX_ESTIMATE' };
  const charging = { ...status, chargers: [{ ...status.chargers[0], sandboxStatus: 'CHARGING',
    simulatedPowerKw: 18, estimatedEnergyKwh: 0.5, estimatedCost: 0.75, session: active }],
    sessions: [active] };
  const finishing = boardHtml(charging, null, null, { chargerId: '76', status: 'FINISHING' });
  assert.match(finishing, /Finalizando · SANDBOX/);
  assert.match(finishing, /SANDBOX · físico OFFLINE/);
  assert.doesNotMatch(finishing, /Iniciando · SANDBOX/);
});

test('card starts and stops only through the station-scoped sandbox API with idempotency keys', async () => {
  const calls = [];
  const active = { id: '22222222-2222-4222-8222-222222222222', stationId: 46, chargerId: 76,
    evse: 'EV1', status: 'charging', energyKwh: 0, totalCost: 0,
    paymentMethod: 'cash', paymentStatus: 'received', cashier: true, amountReceived: 20,
    consumedAmount: 0, remainingCredit: 20, estimatedKwhAtStart: 13.33, pricePerKwh: 1.5,
    autoStopAt: '2026-10-18T13:00:00Z', returnStatus: 'NONE', receiptSource: 'OPERATOR_CONFIRMED',
    startedAt: '2026-10-18T12:00:00Z', endedAt: null, provenance: 'SANDBOX_ESTIMATE' };
  const platform = async (url, init) => { calls.push({ url, init }); return url.endsWith('/start') ? active :
    { ...active, status: 'completed', endedAt: '2026-10-18T12:15:00Z', energyKwh: 4,
      totalCost: 6, consumedAmount: 6, remainingCredit: 14, returnStatus: 'PENDING' }; };
  const draft = { chargerId: '76', method: 'cash', amountReceived: '20,00',
    operatorConfirmed: true, idempotencyKey: 'start-key-123' };
  const startTree = boardTree(status, draft, platform);
  const form = findElement(startTree, element => element.type === 'form' &&
    element.props?.className === 'manual-release-panel');
  assert.ok(form);
  const startHtml = boardHtml(status, draft);
  assert.match(startHtml, /Dinheiro no caixa|Maquininha no caixa/);
  assert.match(startHtml, /Recebi R\$\s?20,00 antes de iniciar/);
  assert.doesNotMatch(startHtml, />Pix<|>Carteira<|>Cartão</);
  const unconfirmed = boardTree(status, { ...draft, operatorConfirmed: false }, platform);
  const unconfirmedForm = findElement(unconfirmed, element => element.type === 'form' &&
    element.props?.className === 'manual-release-panel');
  const unconfirmedSubmit = findElement(unconfirmedForm, element => element.type === 'button' &&
    element.props?.type === 'submit');
  assert.equal(unconfirmedSubmit.props.disabled, true);
  unconfirmedForm.props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 0);
  form.props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].url, '/v2/stations/46/charging-sandbox/chargers/76/cashier-start');
  assert.deepEqual(JSON.parse(calls[0].init.body),
    { method: 'cash', amountReceived: 20, operatorConfirmed: true, idempotencyKey: 'start-key-123' });

  const charging = { ...status, chargers: [{ ...status.chargers[0], sandboxStatus: 'CHARGING',
    simulatedPowerKw: 18, estimatedEnergyKwh: 0.5, estimatedCost: 0.75, session: active }],
    sessions: [active] };
  const stopTree = boardTree(charging, null, platform);
  const stop = findElement(stopTree, element => element.type === 'button' &&
    element.props?.title === 'Encerrar a sessão SANDBOX deste carregador');
  assert.ok(stop);
  stop.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[1].url, `/v2/stations/46/charging-sandbox/sessions/${active.id}/stop`);
  assert.match(JSON.parse(calls[1].init.body).idempotencyKey,
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
  assert.equal(calls.some(call => /\/chargers\/76\/commands|\/lab-device\/commands/.test(call.url)), false);
});

test('external card machine is a cashier method and never calls an online payment route', async () => {
  const calls = [];
  const active = { id: '33333333-3333-4333-8333-333333333333', stationId: 46, chargerId: 76,
    evse: 'EV1', status: 'charging', energyKwh: 0, totalCost: 0, paymentMethod: 'pos',
    paymentStatus: 'received', cashier: true, amountReceived: 30, consumedAmount: 0,
    remainingCredit: 30, estimatedKwhAtStart: 20, pricePerKwh: 1.5,
    autoStopAt: '2026-10-18T13:00:00Z', returnStatus: 'NONE', receiptSource: 'OPERATOR_CONFIRMED',
    startedAt: '2026-10-18T12:00:00Z', endedAt: null, provenance: 'SANDBOX_ESTIMATE' };
  const platform = async (url, init) => { calls.push({ url, init }); return active; };
  const draft = { chargerId: '76', method: 'pos', amountReceived: '30,00',
    operatorConfirmed: true, idempotencyKey: 'pos-start-key' };
  const tree = boardTree(status, draft, platform);
  const form = findElement(tree, element => element.type === 'form' &&
    element.props?.className === 'manual-release-panel');
  form.props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/v2/stations/46/charging-sandbox/chargers/76/cashier-start');
  assert.deepEqual(JSON.parse(calls[0].init.body),
    { method: 'pos', amountReceived: 30, operatorConfirmed: true, idempotencyKey: 'pos-start-key' });
  assert.doesNotMatch(calls[0].url, /payments|payment-intents|web-charge/);
});

test('Residencia exposes the protected sandbox start on its single 7 kW charger',()=>{const home={...status,stationId:47,chargers:[{...status.chargers[0],chargerId:78}]};const html=renderToStaticMarkup(boardTree(home,null,undefined,null,null,true));assert.match(html,/Disponível · SANDBOX/);assert.match(html,/Iniciar recarga e pagamento fictícios/);assert.doesNotMatch(html,/>Reiniciar<|>Manutencao</);});
