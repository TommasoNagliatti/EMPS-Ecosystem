/**
 * Current-time preview, separate from the trained GIE and its historical replay.
 * No weather measurement is assumed: a conservative, deterministic daylight
 * envelope and an explicit hypothetical building load are used.
 * Batteries remain idle; no synthetic SoC overwrites individual GIE states.
 */
export function sandboxEnergyScenario(at: Date, config: {
  timezone: string; solarKwp: number; inverterKw: number; gridImportKw: number; gridExportKw: number;
}, evPowerKw: number) {
  const limits = [config.solarKwp, config.inverterKw, config.gridImportKw, config.gridExportKw, evPowerKw];
  if (limits.some(n => !Number.isFinite(n) || n < 0) || !Number.isFinite(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone,
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const part = (name: string) => Number(parts.find(p => p.type === name)?.value ?? 0);
  const hour = part('hour') + part('minute') / 60 + part('second') / 3600;
  // Hypothesis v1: 06:00–18:00 daylight, 65% peak yield, 4–6 kW building.
  const daylight = hour > 6 && hour < 18 ? Math.sin(Math.PI * (hour - 6) / 12) : 0;
  const buildingPowerKw = 4 + 2 * daylight;
  const unconstrainedSolar = Math.min(config.inverterKw, config.solarKwp * 0.65 * daylight);
  const demand = buildingPowerKw + evPowerKw;
  const solarPowerKw = Math.min(unconstrainedSolar, demand + config.gridExportKw);
  const gridPowerKw = demand - solarPowerKw;
  // Never fabricate energy or silently throttle a separately billed session.
  if (gridPowerKw > config.gridImportKw + 1e-9) return null;
  return {
    version: 'POSTO_CLOCK_ENVELOPE_V1', provenance: 'SIMULATED' as const, at: at.toISOString(),
    timezone: config.timezone, weatherSource: 'UNAVAILABLE' as const,
    assumption: 'Solar hipotética 06–18h, pico 65%; prédio hipotético 4–6 kW; baterias ociosas. Sem medição física.',
    solarPowerKw, buildingPowerKw, gridPowerKw, chargerPowerKw: evPowerKw,
    batteryPowerKw: 0, curtailedSolarKw: unconstrainedSolar - solarPowerKw,
    balanceResidualKw: solarPowerKw + gridPowerKw - buildingPowerKw - evPowerKw,
  };
}
