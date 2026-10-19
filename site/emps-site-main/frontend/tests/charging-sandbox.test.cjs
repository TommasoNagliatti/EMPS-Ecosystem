const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../domain/charging-sandbox.ts');
const sandboxModule = new Module(filename, module);
sandboxModule.paths = Module._nodeModulePaths(path.dirname(filename));
sandboxModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const sandbox = sandboxModule.exports;

const chargers = [
  { carregadorId: '101', estacaoId: '46' },
  { carregadorId: '102', estacaoId: '46' },
  { carregadorId: '103', estacaoId: '39' },
];
const session = { id: 'lab-1', stationId: 46, chargerId: 101, evse: 'EV1',
  status: 'charging', energyKwh: 0.8, totalCost: 1.2, paymentMethod: 'pix',
  paymentStatus: 'authorized', startedAt: '2026-10-18T12:00:00Z', endedAt: null,
  provenance: 'SANDBOX_ESTIMATE' };
const state = { mode: 'SANDBOX', stationId: 46, chargers: [
  { chargerId: 101, evse: 'EV1', physicalStatus: 'OFFLINE', sandboxStatus: 'CHARGING',
    simulatedPowerKw: 7, estimatedEnergyKwh: 0.8, estimatedCost: 1.2,
    provenance: 'SANDBOX_ESTIMATE', session },
  { chargerId: 102, evse: 'EV2', physicalStatus: 'OFFLINE', sandboxStatus: 'AVAILABLE',
    simulatedPowerKw: null, estimatedEnergyKwh: null, estimatedCost: null,
    provenance: 'SANDBOX_ESTIMATE', session: null },
], sessions: [session] };

test('sandbox status is accepted only for matching local station and registered chargers', () => {
  assert.equal(sandbox.validateChargingSandbox(state, '46', chargers), state);
  assert.throws(() => sandbox.validateChargingSandbox(state, '39', chargers), /instalação/);
  assert.throws(() => sandbox.validateChargingSandbox({ ...state, stationId: 39 }, '46', chargers), /instalação/);
  assert.throws(() => sandbox.validateChargingSandbox({ ...state, chargers: [
    { ...state.chargers[0], chargerId: 103 },
  ] }, '46', chargers), /fora desta instalação/);
  assert.throws(() => sandbox.validateChargingSandbox({ ...state, sessions: [
    { ...session, stationId: 39 },
  ] }, '46', chargers), /fora desta instalação/);
  assert.throws(() => sandbox.validateChargingSandbox({ ...state, chargers: [
    { ...state.chargers[0], provenance: 'MEASURED' },
  ] }, '46', chargers), /fora desta instalação/);
});

test('sandbox labels and actions follow the session lifecycle without claiming physical availability', () => {
  for (const [status, label, canStart, canStop] of [
    ['AVAILABLE', 'Disponível', true, false], ['STARTING', 'Iniciando', false, true],
    ['CHARGING', 'Carregando', false, true], ['FINISHING', 'Finalizando', false, false],
    ['FINISHED', 'Finalizado', true, false],
  ]) {
    const row = { ...state.chargers[0], sandboxStatus: status };
    assert.equal(sandbox.sandboxStatusLabel(status), label);
    assert.equal(sandbox.sandboxCanStart(row), canStart);
    assert.equal(sandbox.sandboxCanStop(row), canStop);
  }
  assert.equal(sandbox.sandboxVisualStatus('AVAILABLE'), 'disponivel');
  assert.equal(sandbox.sandboxVisualStatus('CHARGING'), 'em_uso');
  assert.equal(state.chargers[0].physicalStatus, 'OFFLINE');
});

test('cashier credit requires operator-confirmed receipt and keeps a pending return explicit', () => {
  const cashier = { ...session, paymentMethod: 'cash', paymentStatus: 'received', cashier: true,
    receiptSource: 'OPERATOR_CONFIRMED', amountReceived: 20, consumedAmount: 6,
    remainingCredit: 14, estimatedKwhAtStart: 13.33, pricePerKwh: 1.5,
    returnStatus: 'PENDING' };
  assert.deepEqual(sandbox.sandboxCashierCredit(cashier), {
    amountReceived: 20, consumedAmount: 6, remainingCredit: 14,
    estimatedKwhAtStart: 13.33, pricePerKwh: 1.5, returnStatus: 'PENDING',
  });
  assert.equal(sandbox.sandboxCashierCredit({ ...cashier, receiptSource: null }), null);
  assert.equal(sandbox.sandboxCashierCredit({ ...cashier, remainingCredit: -1 }), null);
  assert.equal(sandbox.sandboxCashierCredit(session), null);
});
