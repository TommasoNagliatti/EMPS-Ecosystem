const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../domain/energy-flow.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const energyModule = new Module(filename, module);
energyModule._compile(compiled, filename);
const { batteryLevel, getEnergyFlowState, simulateEnergyFlow } = energyModule.exports;

const settings = { period: "night", batterySocPercent: 68, solarPowerKw: 12 };
function charger(status = "disponivel", power = 0) {
  return { status, potenciaAtualKw: power, potenciaMaximaKw: 22, tarifaKwh: 3 };
}
function simulate(chargers, overrides = {}) {
  const telemetry = simulateEnergyFlow(chargers, { ...settings, ...overrides });
  return { telemetry, flow: getEnergyFlowState(chargers, telemetry) };
}

test("available, offline and failed chargers receive no energy", () => {
  const { telemetry, flow } = simulate([
    charger(), charger("offline", 20), charger("erro", 22), charger("manutencao", 15),
  ]);
  assert.equal(telemetry.chargerPowerKw, 0);
  assert.deepEqual(telemetry.chargerSources, []);
  assert.equal(flow.leftActive || flow.rightActive || flow.gridSuppliesCars, false);
});

test("one occupied charger activates the corresponding illustrative outlet", () => {
  const left = simulate([charger("em_uso", 8.4), charger()]).flow;
  const right = simulate([charger(), charger("em_uso", 8.4)]).flow;
  assert.equal(left.leftActive && !left.rightActive, true);
  assert.equal(!right.leftActive && right.rightActive, true);
});

test("any two or more occupied chargers activate both outlets", () => {
  for (const statuses of [
    ["em_uso", "em_uso"],
    ["em_uso", "disponivel", "em_uso"],
    ["disponivel", "em_uso", "disponivel", "em_uso"],
    ["em_uso", "em_uso", "em_uso", "em_uso"],
  ]) {
    const { flow } = simulate(statuses.map((status) => charger(status, 8.4)));
    assert.equal(flow.leftActive && flow.rightActive, true);
  }
});

test("stored energy supplies the entire occupied load before the grid", () => {
  const { telemetry, flow } = simulate([charger("em_uso", 8.4), charger("em_uso", 15.8)]);
  assert.deepEqual(telemetry.chargerSources, ["battery"]);
  assert.ok(Math.abs(telemetry.chargerPowerKw - 24.2) < 0.0001);
  assert.equal(telemetry.gridPowerKw, 0);
  assert.equal(telemetry.batteryMode, "discharging");
  assert.equal(flow.batterySuppliesCars && !flow.gridSuppliesCars, true);
});

test("an empty battery switches occupied chargers to grid without charging the battery", () => {
  const { telemetry, flow } = simulate([charger("em_uso", 8.4)], { batterySocPercent: 0 });
  assert.deepEqual(telemetry.chargerSources, ["grid"]);
  assert.equal(telemetry.gridPowerKw, 8.4);
  assert.equal(telemetry.batteryPowerKw, 0);
  assert.equal(flow.solarChargesBattery || flow.batterySuppliesCars, false);
});

test("grid returns to idle when the last charging session stops", () => {
  const occupied = simulate([charger("em_uso", 8.4)], { batterySocPercent: 0 });
  const stopped = simulate([charger("disponivel", 8.4)], { batterySocPercent: 0 });
  assert.equal(occupied.flow.gridSuppliesCars, true);
  assert.equal(stopped.telemetry.gridPowerKw, 0);
  assert.equal(stopped.flow.supplyingCars, false);
});

test("daytime solar charges only the battery, even when the grid supplies cars", () => {
  const { telemetry, flow } = simulate([charger("em_uso", 8.4)], { period: "day", batterySocPercent: 0 });
  assert.deepEqual(telemetry.chargerSources, ["grid"]);
  assert.equal(telemetry.solarPowerKw, 12);
  assert.equal(telemetry.batteryPowerKw, 12);
  assert.equal(telemetry.batteryMode, "charging");
  assert.equal(flow.solarChargesBattery && flow.gridSuppliesCars, true);
});

test("night stops solar generation regardless of the configured panel power", () => {
  const { telemetry, flow } = simulate([charger("em_uso", 8.4)], { solarPowerKw: 100 });
  assert.equal(telemetry.solarPowerKw, 0);
  assert.equal(flow.solarChargesBattery, false);
});

test("simultaneous solar input and battery output preserve the energy balance", () => {
  for (const load of [8, 12, 20]) {
    const { telemetry, flow } = simulate([charger("em_uso", load)], { period: "day" });
    assert.equal(flow.solarChargesBattery && flow.batterySuppliesCars, true);
    assert.deepEqual(telemetry.chargerSources, ["battery"]);
    assert.equal(telemetry.batteryPowerKw, Math.abs(12 - load));
    assert.equal(telemetry.batteryMode, load < 12 ? "charging" : load > 12 ? "discharging" : "idle");
  }
});

test("full idle battery stops accepting solar; an occupied battery can receive replenishment", () => {
  const idle = simulate([charger()], { period: "day", batterySocPercent: 100 });
  const busy = simulate([charger("em_uso", 8)], { period: "day", batterySocPercent: 100 });
  assert.equal(idle.telemetry.solarPowerKw, 0);
  assert.equal(busy.flow.solarChargesBattery, true);
  assert.equal(busy.telemetry.solarPowerKw, 8);
  assert.equal(busy.telemetry.batteryMode, "idle");
});

test("unknown telemetry never invents a solar-to-car connection", () => {
  const chargers = [charger("em_uso", 8.4)];
  const telemetry = simulateEnergyFlow(chargers, settings);
  const flow = getEnergyFlowState(chargers, {
    ...telemetry, chargerSources: ["solar"], batterySocPercent: null,
  });
  assert.equal(flow.supplyingCars, false);
  assert.equal(flow.batterySoc, null);
});

test("simulation clamps invalid levels and leaves original chargers and tariffs untouched", () => {
  const chargers = [Object.freeze(charger("em_uso"))];
  const snapshot = JSON.stringify(chargers);
  assert.equal(batteryLevel(NaN), null);
  assert.equal(batteryLevel(Infinity), null);
  assert.equal(batteryLevel(-5), 0);
  assert.equal(batteryLevel(120), 100);
  const { telemetry } = simulate(chargers, { batterySocPercent: NaN });
  assert.deepEqual(telemetry.chargerSources, ["grid"]);
  assert.ok(telemetry.chargerPowerKw > 0);
  assert.equal(JSON.stringify(chargers), snapshot);
});

const gieFilename=path.resolve(__dirname,'../domain/gie.ts');
const gieModule=new Module(gieFilename,module);
gieModule._compile(ts.transpileModule(fs.readFileSync(gieFilename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,gieFilename);
const {energyFromGie}=gieModule.exports;
test('GIE maps its authoritative flows and fixed EVSE slots without allocation in the Site',()=>{
 const visual={valid:true,battery_flow:'discharging',evse_2_active:true,grid_importing:true,solar_active:true};
 const input={online:true,observed_at:'2026-09-17T12:00:00Z',state:{execution_allowed:true,visual_state:visual,numeric_state:{solar_kw:20,ev_served_kw:11,battery_soc_pct:55,battery_charge_kw:0,battery_discharge_kw:6,grid_import_kw:3,grid_export_kw:0},flows:{battery_to_ev_kw:6,grid_to_ev_kw:3,solar_to_ev_kw:2}}};
 const mapped=energyFromGie(input);assert.equal(mapped.chargerPowerKw,11);assert.equal(mapped.gieVisual,visual);assert.deepEqual(mapped.chargerSources,['battery','grid','solar']);
 const flow=getEnergyFlowState([],mapped);assert.equal(flow.rightActive,true);assert.equal(flow.leftActive,false);
 const offline=energyFromGie({...input,online:false});assert.equal(offline.chargerPowerKw,null);assert.deepEqual(offline.chargerSources,[]);assert.equal(getEnergyFlowState([],offline).rightActive,false);
});
