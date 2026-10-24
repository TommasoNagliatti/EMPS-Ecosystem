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

test('sandbox projects EV1 and EV2 independently without changing physical charger records', () => {
  const physical = chargers.slice(0, 2).map((charger, index) => ({ ...charger,
    nome: `EVSE_0${index + 1}`, status: 'offline', potenciaAtualKw: 0 }));
  const telemetry = { batteryMode: 'discharging', batteryPowerKw: 8, batterySocPercent: 70,
    chargerPowerKw: 40, chargerSources: ['battery'], gridPowerKw: 0,
    solarChargingBattery: false, solarPowerKw: 0, updatedAt: null,
    gieVisual: { valid: true, evse_1_active: true, evse_2_active: true } };
  const ev1 = sandbox.sandboxEnergyFlow(physical, telemetry, state);
  assert.deepEqual(ev1.activeEvses, ['EV1']);
  assert.equal(ev1.telemetry.chargerPowerKw, 7);
  assert.equal(ev1.telemetry.gieVisual.evse_1_active, true);
  assert.equal(ev1.telemetry.gieVisual.evse_2_active, false);
  assert.equal(ev1.chargers[0].status, 'em_uso');
  assert.equal(ev1.chargers[1].status, 'offline');
  assert.equal(physical[0].status, 'offline');

  const ev2Session = { ...session, id: 'lab-2', chargerId: 102, evse: 'EV2' };
  const both = sandbox.sandboxEnergyFlow(physical, telemetry, { ...state,
    chargers: [...state.chargers.slice(0, 1), { ...state.chargers[1], sandboxStatus: 'CHARGING',
      simulatedPowerKw: 11, session: ev2Session }], sessions: [session, ev2Session] });
  assert.deepEqual(both.activeEvses, ['EV1', 'EV2']);
  assert.equal(both.telemetry.chargerPowerKw, 18);
  assert.equal(both.telemetry.gieVisual.evse_1_active, true);
  assert.equal(both.telemetry.gieVisual.evse_2_active, true);

  const idle = sandbox.sandboxEnergyFlow(physical, telemetry, { ...state,
    chargers: state.chargers.map(row => ({ ...row, sandboxStatus: 'AVAILABLE', session: null,
      simulatedPowerKw: null })), sessions: [] });
  assert.equal(idle.telemetry.chargerPowerKw, 0);
  assert.equal(idle.telemetry.gieVisual.evse_1_active, false);
  assert.equal(idle.telemetry.gieVisual.evse_2_active, false);
});

test('stopping EV1 leaves only EV2 active even when records are reordered', () => {
  const ev2 = { ...state.chargers[1], sandboxStatus: 'CHARGING', simulatedPowerKw: 11,
    session: { ...session, chargerId: 102, evse: 'EV2' } };
  const stopped = { ...state.chargers[0], sandboxStatus: 'FINISHING',
    session: { ...session, status: 'stopping' } };
  const flow = sandbox.sandboxEnergyFlow([...chargers].reverse(), {}, {
    ...state, chargers: [ev2, stopped],
  });
  assert.equal(flow.telemetry.chargerPowerKw, 11);
  assert.equal(flow.telemetry.gieVisual.evse_1_active, false);
  assert.equal(flow.telemetry.gieVisual.evse_2_active, true);
  assert.equal(flow.chargers.find(c => c.carregadorId === '102').potenciaAtualKw, 11);
});

test('invalid power and duplicate EVSE bindings are rejected', () => {
  for (const simulatedPowerKw of [NaN, Infinity, -1, '7']) {
    assert.throws(() => sandbox.validateChargingSandbox({ ...state,
      chargers: [{ ...state.chargers[0], simulatedPowerKw }] }, '46', chargers));
  }
  assert.throws(() => sandbox.validateChargingSandbox({ ...state, chargers: [
    state.chargers[0], { ...state.chargers[1], evse: 'EV1' },
  ] }, '46', chargers));
});

test('current scenario must reconcile, be fresh, and never inherit historical GIE SoC', () => {
  const normalScenario = { version: 'POSTO_CLOCK_ENVELOPE_V1', provenance: 'SIMULATED',
    at: new Date().toISOString(), solarPowerKw: 0, gridPowerKw: 11, buildingPowerKw: 4,
    chargerPowerKw: 7, batteryPowerKw: 0, balanceResidualKw: 0 };
  const historic = { batterySocPercent: 90, gridPowerKw: 100 };
  const flow = sandbox.sandboxEnergyFlow(chargers, historic, { ...state, normalScenario });
  assert.equal(flow.telemetry.batterySocPercent, null);
  assert.equal(flow.telemetry.gridPowerKw, 11);
  for (const invalid of [
    { ...normalScenario, at: new Date(Date.now() - 60_000).toISOString() },
    { ...normalScenario, chargerPowerKw: 10 }, { ...normalScenario, gridPowerKw: 12 },
  ]) {
    assert.equal(sandbox.sandboxEnergyFlow(chargers, historic,
      { ...state, normalScenario: invalid }).telemetry.gridPowerKw, null);
  }
});

test('building EV3 trace is scoped and clears when session finishes', () => {
  const c = [{carregadorId:'51',estacaoId:'13',status:'disponivel'}];
  const s = {...session, stationId:13,chargerId:51,evse:'EV3'};
  const value={mode:'SANDBOX',stationId:13,chargers:[{...state.chargers[0],chargerId:51,evse:'EV3',session:s}],sessions:[s]};
  sandbox.validateChargingSandbox(value,'13',c);
  const active=sandbox.sandboxEnergyFlow(c,{},value);
  assert.equal(active.telemetry.gieVisual.evse_3_active,true);
  assert.equal(active.telemetry.gieVisual.evse_1_active,false);
  assert.equal(c[0].status,'disponivel');
  assert.throws(()=>sandbox.validateChargingSandbox(value,'46',c));
  value.chargers[0]={...value.chargers[0],sandboxStatus:'FINISHED',session:{...s,status:'completed'}};
  assert.equal(sandbox.sandboxEnergyFlow(c,{},value).telemetry.gieVisual.evse_3_active,false);
});

test('charger demonstration maps legacy EV3 to physical display EV1 without changing sessions',()=>{
 const c=[{carregadorId:'51',estacaoId:'13',status:'disponivel'}];
 const row={...state.chargers[0],chargerId:51,evse:'EV3',session:{...session,stationId:13,chargerId:51,evse:'EV3'}};
 const snapshot={mode:'SANDBOX',stationId:13,chargers:[row],sessions:[row.session],normalScenario:{version:'CHARGER_DEMO_ILLUSTRATION_V1',displayMapping:{EV1:51,EV2:49},provenance:'SIMULATED',at:new Date().toISOString(),solarPowerKw:10,gridPowerKw:2,buildingPowerKw:5,chargerPowerKw:7,batteryPowerKw:0,balanceResidualKw:0}};
 const f=sandbox.sandboxEnergyFlow(c,{},snapshot);
 assert.deepEqual(f.activeEvses,['EV1']);assert.equal(f.telemetry.gieVisual.evse_1_active,true);
 assert.equal(f.telemetry.gieVisual.solar_active,true);assert.equal(row.session.evse,'EV3');
});
