import type { EnergyFlowTelemetry } from './emps';
import type { DemoStationAnalytics } from './demo-analytics';
import { localDay, type EnergyBucket, type MonitorPoint } from './station-monitoring';

const finite = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value : null;

// Power curves show source power (kW). Exact energy (kWh) always comes from the
// API's interval sums, never from interpolating these display points.
export function demoPowerPoints(analytics: DemoStationAnalytics | null, origin: number, timezone: string): MonitorPoint[] {
  if (!analytics) return [];
  return analytics.points.flatMap(row => {
    const at = Date.parse(row.at);
    if (!Number.isFinite(at)) return [];
    return [{
      at, x: (at - origin) / 60_000, day: localDay(new Date(at), timezone),
      hour: Number(new Intl.DateTimeFormat('en', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(at)),
      label: new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(at),
      solar: finite(row.solarKw), grid: finite(row.gridKw), battery: null,
      charger: finite(row.evDeliveredKw), load: finite(row.buildingKw), soc: null,
      importTariff: null, exportTariff: null,
      sourceLabel: `${analytics.source?.datasetKey ?? 'Dataset GIE'} · SIMULATED`, provenance: 'SIMULATED', quality: row.intervalCount > 0 ? 'GOOD' : 'MISSING',
    }];
  });
}

export function demoEnergyBuckets(analytics: DemoStationAnalytics | null, timezone: string): EnergyBucket[] {
  if (!analytics) return [];
  return analytics.buckets.flatMap(row => {
    const at = Date.parse(row.start), end = Date.parse(row.end);
    if (!Number.isFinite(at) || !Number.isFinite(end)) return [];
    const day = localDay(new Date(at), timezone);
    const label = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone,
      ...(analytics.period.grain === 'day' ? { hour: '2-digit', minute: '2-digit' } : analytics.period.grain === 'year' ? { month: '2-digit' } : { day: '2-digit', month: '2-digit' }) }).format(at);
    const fullLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, dateStyle: 'short', ...(analytics.period.grain === 'day' ? { timeStyle: 'short' } : {}) }).format(at);
    return [{ at, end, day, label, fullLabel,
      solar: finite(row.solarKwh), load: finite(row.buildingKwh), charger: finite(row.evDeliveredKwh),
      imported: finite(row.gridImportKwh), exported: null, charge: null, discharge: null }];
  });
}

export function demoEnergyTotals(analytics: DemoStationAnalytics | null) {
  const totals = analytics?.totals;
  return { solar: finite(totals?.solarKwh), load: finite(totals?.buildingKwh),
    charger: finite(totals?.evDeliveredKwh), imported: finite(totals?.gridImportKwh),
    exported: null, charge: null, discharge: null };
}

// This is a source-dated historical power sample. It is never current telemetry
// and never carries a physical dispatch or payment capability.
export function demoHistoricalFlow(analytics: DemoStationAnalytics | null): EnergyFlowTelemetry {
  const point = analytics?.points.at(-1);
  return { buildingPowerKw: finite(point?.buildingKw), solarPowerKw: finite(point?.solarKw),
    gridPowerKw: finite(point?.gridKw), chargerPowerKw: finite(point?.evDeliveredKw),
    batteryMode: 'unknown', batteryPowerKw: null, batterySocPercent: null,
    chargerSources: [], solarChargingBattery: false, updatedAt: point?.at ?? null };
}
