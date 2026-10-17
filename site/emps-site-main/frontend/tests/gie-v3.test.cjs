const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../domain/gie.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sourceModule = new Module(filename, module);
sourceModule._compile(compiled, filename);
const { energyFromGie, gieBatteries, gieBatteriesById, gieDecision, gieEvses, gieForecasts, simulatedFlowGie } = sourceModule.exports;
const flowFile = path.resolve(__dirname, '../domain/energy-flow.ts');
const flowModule = new Module(flowFile, module);
flowModule._compile(ts.transpileModule(fs.readFileSync(flowFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, flowFile);
const { getEnergyFlowState } = flowModule.exports;

function envelope(workerId, result, generation = 'g-1') {
  return { station_id: '42', gie_station_id: workerId, generation, mode: 'NORMAL', observed_at: '2026-10-14T12:00:00-03:00', online: true,
    source: 'SIMULATED', physical_dispatch: false, hardware_commands_sent: false,
    state: { station_id: workerId, generation, capabilities: { presentation: false }, state: result } };
}
function decision(id, evseCount, batteries) {
  const evse = Array.from({ length: evseCount }, (_, index) => ({ id: `EVSE_${String(index + 1).padStart(2, '0')}`, max_kw: 22 }));
  return { timestamp: '2025-10-01T12:00:00-03:00', execution_allowed: true,
    numeric_state: { building_kw: 10, solar_kw: 5, grid_import_kw: null, grid_export_kw: null, evse_setpoints_kw: evse.map((_, index) => index + 1) },
    visual_state: { valid: true, battery_flow: batteries.length ? 'idle' : 'unknown' },
    station_extension: { station_id: id, equipment: { evse, batteries }, battery_decisions: Object.fromEntries(batteries.map(b => [b.id, { soc_after: 0.4, charge_kw: 2, discharge_kw: 0 }])) },
    forecasts: { records: [{ timestamp: '2025-10-01T12:15:00-03:00', building_kw: 11, potencia_solicitada_prevista_kw: 7, solar_previsto_kw: null }] } };
}

test('station profiles show only their own 1, 2, or 4 EVSEs', () => {
  for (const count of [1, 2, 4]) {
    const state = envelope(`STATION_${count}`, decision(`STATION_${count}`, count, []));
    assert.equal(gieEvses(state).length, count);
    assert.equal(gieEvses(state)[count - 1].setpointKw, count);
  }
});

test('two battery decisions remain individual and a battery-free home stays empty', () => {
  const batteries = [{ id: 'BAT_02', nominal_kwh: 61.4, soc_initial: 0.5 }, { id: 'BAT_01', nominal_kwh: 61.4, soc_initial: 0.5 }];
  const station = envelope('DEMO_POSTO_24H_001', decision('DEMO_POSTO_24H_001', 2, batteries));
  station.state.state.station_extension.battery_decisions.BAT_01.soc_after = 0.608;
  station.state.state.station_extension.battery_decisions.BAT_02.soc_after = 0.749;
  assert.deepEqual(gieBatteriesById(simulatedFlowGie(station, '42'), ['BAT_01', 'BAT_02']).map(b => [b.id, b.socPercent]),
    [['BAT_01', 60.8], ['BAT_02', 74.9]]);
  station.state.state.station_extension.battery_decisions.BAT_01.soc_after = 0.639;
  station.state.state.station_extension.battery_decisions.BAT_02.soc_after = 0.733;
  assert.deepEqual(gieBatteriesById(simulatedFlowGie(station, '42'), ['BAT_01', 'BAT_02']).map(b => [b.id, b.socPercent]),
    [['BAT_01', 63.9], ['BAT_02', 73.3]]);
  delete station.state.state.station_extension.battery_decisions.BAT_02.soc_after;
  assert.equal(gieBatteries(station).find(b => b.id === 'BAT_02').socPercent, null);
  assert.equal(gieBatteriesById(simulatedFlowGie(station, '42'), ['BAT_01', 'BAT_02']), null);
  assert.equal(gieBatteriesById(simulatedFlowGie(station, '41'), ['BAT_01', 'BAT_02']), null);
  station.online = false;
  assert.equal(gieBatteriesById(simulatedFlowGie(station, '42'), ['BAT_01', 'BAT_02']), null);
  station.online = true;
  station.state.state.execution_allowed = false;
  assert.equal(gieBatteriesById(simulatedFlowGie(station, '42'), ['BAT_01', 'BAT_02']), null);
  station.state.state.execution_allowed = true;
  station.state.state.visual_state.valid = false;
  assert.equal(gieBatteriesById(simulatedFlowGie(station, '42'), ['BAT_01', 'BAT_02']), null);
  const home = envelope('DEMO_CASA_001', decision('DEMO_CASA_001', 1, []));
  assert.deepEqual(gieBatteries(home), []);
});

test('worker identity, generation, and offline state fail closed', () => {
  const station = envelope('DEMO_CASA_001', decision('DEMO_CASA_001', 1, []));
  station.state.station_id = 'DEMO_POSTO_24H_001';
  assert.equal(gieDecision(station), null);
  station.state.station_id = 'DEMO_CASA_001'; station.state.generation = 'g-0';
  assert.equal(gieDecision(station), null);
  station.state.generation = 'g-1'; station.online = false;
  assert.equal(gieDecision(station), null);
  assert.equal(energyFromGie(station).gridPowerKw, null);
});

test('missing grid values stay unavailable while forecasts retain their source data', () => {
  const station = envelope('DEMO_CASA_001', decision('DEMO_CASA_001', 1, []));
  assert.equal(energyFromGie(station).gridPowerKw, null);
  assert.equal(gieForecasts(station)[0].solarKw, null);
  assert.equal(gieForecasts(station)[0].evKw, 7);
});

test('the simulated GIE flow follows new decisions without using pending chargers or historical energy', () => {
  const first = decision('DEMO_CASA_001', 1, []);
  first.numeric_state.ev_served_kw = 3;
  first.visual_state.evse_1_active = true;
  const station = envelope('DEMO_CASA_001', first);
  const pending = [{ status: 'aguardando', potenciaMaximaKw: 7 }];
  const mapped = energyFromGie(simulatedFlowGie(station, '42'));
  assert.equal(mapped.chargerPowerKw, 3);
  assert.equal(getEnergyFlowState(pending, mapped).leftActive, true);
  const second = { ...first, timestamp: '2025-10-01T12:15:00-03:00',
    numeric_state: { ...first.numeric_state, ev_served_kw: 0 },
    visual_state: { ...first.visual_state, evse_1_active: false } };
  station.state.state = second;
  const next = energyFromGie(simulatedFlowGie(station, '42'));
  assert.equal(next.chargerPowerKw, 0);
  assert.equal(next.updatedAt, second.timestamp);
  assert.equal(getEnergyFlowState(pending, next).leftActive, false);
  assert.equal(pending[0].status, 'aguardando');
});

test('historical flow refuses wrong stations, physical dispatch and offline results', () => {
  const state = envelope('DEMO_POSTO_24H_001', decision('DEMO_POSTO_24H_001', 2, []));
  assert.equal(simulatedFlowGie(state, '41'), null);
  assert.equal(simulatedFlowGie({ ...state, online: false }, '42'), null);
  assert.equal(simulatedFlowGie({ ...state, physical_dispatch: true }, '42'), null);
  assert.equal(simulatedFlowGie({ ...state, hardware_commands_sent: true }, '42'), null);
  const legacy = { station_id: '42', mode: 'PRESENTATION', observed_at: state.observed_at,
    online: true, source: 'GIEControl', hardware_confirmed: false, state: state.state.state };
  assert.equal(simulatedFlowGie(legacy, '42'), legacy);
  assert.equal(simulatedFlowGie({ ...legacy, hardware_confirmed: true }, '42'), null);
  assert.equal(energyFromGie(null).chargerPowerKw, null);
});
