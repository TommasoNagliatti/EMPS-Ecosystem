import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sandboxEnergyScenario } from '../src/sandbox-energy-scenario';

const config = { timezone: 'America/Sao_Paulo', solarKwp: 50, inverterKw: 60,
  gridImportKw: 90, gridExportKw: 60 };
test('normal preview balances every minute with no nocturnal solar or fictitious battery power', () => {
  for (let minute = 0; minute < 24 * 60; minute++) {
    const at = new Date(Date.UTC(2026, 9, 20, 3, minute));
    for (const evKw of [0, 18.04, 36.08]) {
      const s = sandboxEnergyScenario(at, config, evKw)!;
      assert.ok(s);
      assert.ok(Math.abs(s.balanceResidualKw) < 1e-9);
      assert.ok(s.gridPowerKw <= 90 && s.gridPowerKw >= -60);
      assert.ok(s.solarPowerKw >= 0 && s.solarPowerKw <= 50);
      assert.equal(s.batteryPowerKw, 0);
      assert.equal(s.chargerPowerKw, evKw);
      if (minute <= 360 || minute >= 1080) assert.equal(s.solarPowerKw, 0);
      assert.deepEqual(sandboxEnergyScenario(at, config, evKw), s);
    }
  }
});
test('limits cause explicit unavailability or solar curtailment, never unbalanced output', () => {
  const noon = new Date('2026-10-20T15:00:00Z');
  const curtailed = sandboxEnergyScenario(noon, { ...config, gridExportKw: 0 }, 0)!;
  assert.equal(curtailed.gridPowerKw, 0);
  assert.ok(curtailed.curtailedSolarKw > 0);
  assert.equal(sandboxEnergyScenario(noon, { ...config, gridImportKw: 0 }, 36.08), null);
  assert.equal(sandboxEnergyScenario(noon, config, NaN), null);
});
