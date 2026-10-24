import type { EnergyFlowTelemetry } from './emps';

export function selectScenarioSource(demo: boolean, mode: string | undefined, sandboxEnabled: boolean, activeSandboxEvses: number) {
  const sandbox = sandboxEnabled && (mode === 'CHARGER_DEMO' || activeSandboxEvses > 0 || (!demo && (!mode || mode === 'NORMAL')));
  return { sandbox, gie: !sandbox && (demo || (mode !== undefined && mode !== 'NORMAL')) };
}

/** Use the exact flow snapshot; never substitute historical kWh for scenario kW. */
export function scenarioOverview(telemetry: EnergyFlowTelemetry) {
  const value = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? n : null;
  const grid = value(telemetry.gridPowerKw), soc = value(telemetry.batterySocPercent);
  return {
    solar: value(telemetry.solarPowerKw), chargers: value(telemetry.chargerPowerKw),
    building: value(telemetry.buildingPowerKw),
    grid: grid === null ? null : Math.abs(grid),
    gridLabel: grid !== null && grid < 0 ? 'Exportação para a rede · atual' : 'Importação da rede · atual',
    soc: soc !== null && soc >= 0 && soc <= 100 ? soc : null,
  };
}
