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
const { energyFromGie, gieBatteries, gieDecision, gieEvses, gieForecasts } = sourceModule.exports;

function envelope(workerId, result, generation = 'g-1') {
  return { station_id: '42', gie_station_id: workerId, generation, mode: 'NORMAL', observed_at: '2026-10-14T12:00:00-03:00', online: true,
    source: 'SIMULATED', state: { station_id: workerId, generation, capabilities: { presentation: false }, state: result } };
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
  const batteries = [{ id: 'BAT_01', nominal_kwh: 61.4 }, { id: 'BAT_02', nominal_kwh: 61.4 }];
  const station = envelope('DEMO_POSTO_24H_001', decision('DEMO_POSTO_24H_001', 2, batteries));
  assert.deepEqual(gieBatteries(station).map(b => [b.id, b.socPercent, b.chargeKw]), [['BAT_01', 40, 2], ['BAT_02', 40, 2]]);
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
