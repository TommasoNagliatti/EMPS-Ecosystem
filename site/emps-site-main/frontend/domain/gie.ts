import type { EnergyFlowTelemetry } from './emps';

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const string = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;

export type GieState = {
  online: boolean;
  station_id: string; // EMPS MySQL identity, as a string.
  gie_station_id?: string;
  generation?: string | null;
  mode: string;
  observed_at: string;
  source?: string;
  hardware_confirmed?: boolean;
  physical_dispatch?: boolean;
  hardware_commands_sent?: boolean;
  error?: string;
  event_feed_error?: string;
  isolated?: boolean;
  health?: unknown;
  capabilities?: unknown;
  state: unknown; // V3 worker envelope contains its own `state` decision.
  history?: Array<{station_id: string; issue_time: string; origin: 'SIMULATED'; status: string}>;
  presentation?: { scene_number: number; name: string; playing: boolean };
  manual_events?: Record<string, string>;
  context?: { demands: Array<{ charger_id: string; evse_slot: number; connected: boolean }> };
};

const fixtureStations = new Set(['Commercial_HighAutonomy_V2', 'DEMO_POSTO_24H_001', 'DEMO_CASA_001']);
export function gieFixtureCycleAvailable(gie: GieState | null | undefined): boolean {
  return !!gie?.online && !gie.isolated && fixtureStations.has(gie.gie_station_id ?? '');
}

export function gieWorker(gie: GieState | null | undefined): JsonRecord | null {
  if (!gie?.online || gie.isolated) return null;
  const worker = record(gie.state);
  if (!worker) return null;
  if (gie.gie_station_id && string(worker.station_id) && worker.station_id !== gie.gie_station_id) return null;
  const extension = record(worker.station_extension);
  if (gie.gie_station_id && string(extension?.station_id) && extension?.station_id !== gie.gie_station_id) return null;
  if (gie.generation && string(worker.generation) && worker.generation !== gie.generation) return null;
  return worker;
}

export function gieDecision(gie: GieState | null | undefined): JsonRecord | null {
  const worker = gieWorker(gie);
  if (!worker) return null;
  const decision = record(worker.state) ?? worker;
  return record(decision.numeric_state) ? decision : null;
}

export function gieCapabilities(gie: GieState | null | undefined) {
  const raw = record(gie?.capabilities) ?? record(gieWorker(gie)?.capabilities);
  return { presentation: raw?.presentation === true, manualDemo: raw?.manual_demo === true };
}

export type GieEvse = { id: string; maxKw: number | null; requestedKw: number | null; connected: boolean | null; setpointKw: number | null };
export function gieEvses(gie: GieState | null | undefined): GieEvse[] {
  const decision = gieDecision(gie);
  if (!decision) return [];
  const numeric = record(decision.numeric_state);
  const extension = record(decision.station_extension);
  const equipment = record(extension?.equipment);
  const configured = Array.isArray(equipment?.evse) ? equipment.evse : [];
  const current = record(numeric?.evses);
  const demands = Array.isArray(extension?.evses) ? extension.evses : [];
  const allocation = record(record(decision.load_balancer)?.setpoints_kw);
  const setpoints = Array.isArray(numeric?.evse_setpoints_kw) ? numeric.evse_setpoints_kw : [];
  const names = configured.length
    ? configured.map(row => string(record(row)?.id)).filter((id): id is string => id !== null)
    : current ? Object.keys(current) : demands.map(row => string(record(row)?.evse_id)).filter((id): id is string => id !== null);
  if (!names.length && setpoints.length) names.push(...setpoints.map((_, index) => `EVSE ${index + 1}`));
  return names.map((id, index) => {
    const device = configured.find(row => record(row)?.id === id);
    const demand = record(current?.[id]) ?? record(demands.find(row => record(row)?.evse_id === id));
    const connected = typeof demand?.connected === 'boolean' ? demand.connected : null;
    return { id, maxKw: finite(record(device)?.max_kw), requestedKw: finite(demand?.requested_kw), connected,
      setpointKw: finite(allocation?.[id]) ?? finite(setpoints[index]) };
  });
}

export type GieBattery = { id: string; capacityKwh: number | null; socPercent: number | null; chargeKw: number | null; dischargeKw: number | null; available: boolean | null };
// null means no individual inventory was supplied; [] means the station explicitly has no batteries.
export function gieBatteries(gie: GieState | null | undefined): GieBattery[] | null {
  const decision = gieDecision(gie);
  if (!decision) return null;
  const extension = record(decision.station_extension);
  const equipment = record(extension?.equipment);
  if (!Array.isArray(equipment?.batteries)) return null;
  const decisions = record(extension?.battery_decisions);
  return equipment.batteries.flatMap(row => {
    const item = record(row);
    const id = string(item?.id);
    if (!id) return [];
    const action = record(decisions?.[id]);
    const fraction = finite(action?.soc_after) ?? finite(item?.soc_initial);
    return [{ id, capacityKwh: finite(item?.nominal_kwh) ?? finite(item?.capacity_kwh),
      socPercent: fraction === null ? null : fraction * 100, chargeKw: finite(action?.charge_kw),
      dischargeKw: finite(action?.discharge_kw), available: typeof item?.available === 'boolean' ? item.available : null }];
  });
}

export type GieForecast = { timestamp: string; buildingKw: number | null; evKw: number | null; solarKw: number | null };
export function gieForecasts(gie: GieState | null | undefined): GieForecast[] {
  const forecasts = record(gieDecision(gie)?.forecasts);
  const rows = Array.isArray(forecasts?.records) ? forecasts.records : [];
  return rows.flatMap(row => {
    const item = record(row);
    const timestamp = string(item?.timestamp);
    return timestamp ? [{ timestamp, buildingKw: finite(item?.building_kw),
      evKw: finite(item?.potencia_solicitada_prevista_kw), solarKw: finite(item?.solar_previsto_kw) }] : [];
  });
}

export function gieOrigin(gie: GieState | null | undefined): string | null {
  const decision = gieDecision(gie);
  return string(record(decision?.provenance)?.origin) ?? string(gieWorker(gie)?.source) ?? string(gie?.source);
}

export function simulatedFlowGie(gie: GieState | null | undefined, stationId: string): GieState | null {
  if (!gie?.online || gie.isolated || String(gie.station_id) !== stationId) return null;
  const v3 = !!gie.gie_station_id && gie.source === 'SIMULATED' &&
    gie.physical_dispatch === false && gie.hardware_commands_sent === false && gieOrigin(gie) === 'SIMULATED';
  const legacy = !gie.gie_station_id && gie.source === 'GIEControl' && gie.hardware_confirmed === false;
  return v3 || legacy ? gie : null;
}

export function energyFromGie(gie: GieState | null | undefined): EnergyFlowTelemetry {
  const decision = gieDecision(gie);
  const valid = decision?.execution_allowed === true && record(decision.visual_state)?.valid === true;
  const n = record(decision?.numeric_state);
  const v = record(decision?.visual_state);
  const f = record(decision?.flows);
  const num = (key: string) => valid ? finite(n?.[key]) : null;
  const batteryCharge = num('battery_charge_kw'), batteryDischarge = num('battery_discharge_kw');
  const gridImport = num('grid_import_kw'), gridExport = num('grid_export_kw');
  return {
    batteryMode: valid && typeof v?.battery_flow === 'string' ? v.battery_flow as EnergyFlowTelemetry['batteryMode'] : 'unknown',
    batteryPowerKw: batteryCharge === null && batteryDischarge === null ? null : (batteryCharge ?? 0) + (batteryDischarge ?? 0),
    buildingPowerKw: num('building_kw'), batterySocPercent: num('battery_soc_pct'), chargerPowerKw: num('ev_served_kw'),
    gridPowerKw: gridImport === null && gridExport === null ? null : (gridImport ?? 0) - (gridExport ?? 0),
    solarPowerKw: num('solar_kw'), solarChargingBattery: valid && (finite(f?.solar_to_battery_kw) ?? 0) > 0,
    chargerSources: valid ? [...((finite(f?.battery_to_ev_kw) ?? 0) > 0 ? ['battery' as const] : []),
      ...((finite(f?.grid_to_ev_kw) ?? 0) > 0 ? ['grid' as const] : []),
      ...((finite(f?.solar_to_ev_kw) ?? 0) > 0 ? ['solar' as const] : [])] : [],
    updatedAt: decision ? string(decision.decision_time) ?? string(decision.timestamp) : null,
    gieVisual: valid && v ? v : { valid: false },
  };
}
