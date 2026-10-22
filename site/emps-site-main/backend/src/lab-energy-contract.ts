import type { GieV3Envelope } from './gie-v3.service';

export const ENERGY_TTL_MS = 4000;
export const GIE_MAX_AGE_MS = 6000;
const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const soc = (v: unknown) => num(v) !== null && Number(v) <= 1 ? Number(v) * 100 : null;

/** AC bus balance, not battery stored-energy efficiency. No missing measurement becomes zero. */
export function energySnapshot(gie: GieV3Envelope | null, stationId: number, now = Date.now()) {
  const d = obj(gie?.state), n = obj(d.numeric_state), v = obj(d.visual_state), x = obj(d.station_extension);
  const errors: string[] = [];
  const age = now - Date.parse(gie?.observed_at ?? '');
  if (!gie?.online || gie.station_id !== String(stationId) || gie.gie_station_id !== 'DEMO_POSTO_24H_001' ||
      gie.source !== 'SIMULATED' || gie.physical_dispatch !== false || gie.hardware_commands_sent !== false ||
      !gie.generation || !Number.isSafeInteger(gie.revision) || Number(gie.revision) < 1 ||
      !Number.isFinite(age) || age < 0 || age > GIE_MAX_AGE_MS || d.execution_allowed !== true || v.valid !== true ||
      obj(d.provenance).origin !== 'SIMULATED' || obj(d.provenance).station_id !== gie.gie_station_id ||
      x.station_id !== gie.gie_station_id || x.physical_dispatch !== false ||
      typeof d.timestamp !== 'string' || !Number.isFinite(Date.parse(d.timestamp))) errors.push('INVALID_OR_STALE_GIE');
  const solar = num(n.solar_kw), used = num(x.solar_used_kw), curtailed = num(x.solar_curtailed_kw);
  const gridIn = num(n.grid_import_kw), gridOut = num(n.grid_export_kw), building = num(n.building_kw);
  const charge = num(n.battery_charge_kw), discharge = num(n.battery_discharge_kw);
  const points = obj(obj(d.load_balancer).setpoints_kw);
  // Explicit fixture identity mapping; never positional array mapping.
  const powers = { EV1: num(points.EVSE_01), EV2: num(points.EVSE_02) };
  const batteries = obj(x.battery_decisions);
  const bat01 = soc(obj(batteries.BAT_01).soc_after), bat02 = soc(obj(batteries.BAT_02).soc_after);
  const losses = n.losses_kw === undefined ? null : num(n.losses_kw);
  if ([solar, used, curtailed, gridIn, gridOut, building, charge, discharge, powers.EV1, powers.EV2].includes(null) ||
      (n.losses_kw !== undefined && losses === null)) errors.push('MISSING_POWER');
  const tolerance = 0.0001 + 0.000001 * Math.max(1, solar ?? 0, gridIn ?? 0, discharge ?? 0);
  const supply = used === null || gridIn === null || discharge === null ? null : used + gridIn + discharge;
  const demand = [building,powers.EV1,powers.EV2,charge,gridOut].includes(null) ? null :
    building! + powers.EV1! + powers.EV2! + charge! + gridOut! + (losses ?? 0);
  const residual = supply === null || demand === null ? null : supply - demand;
  if (residual !== null && Math.abs(residual) > tolerance) errors.push('UNBALANCED');
  if (solar !== null && used !== null && curtailed !== null && Math.abs(solar - used - curtailed) > tolerance) errors.push('SOLAR_MISMATCH');
  if (num(n.ev_served_kw) === null || powers.EV1 === null || powers.EV2 === null ||
      Math.abs(powers.EV1 + powers.EV2 - n.ev_served_kw) > tolerance) errors.push('EV_TOTAL_MISMATCH');
  if (gridIn !== null && gridOut !== null && Math.min(gridIn,gridOut) > tolerance) errors.push('GRID_CONFLICT');
  if (charge !== null && discharge !== null && Math.min(charge,discharge) > tolerance) errors.push('BATTERY_CONFLICT');
  const valid = errors.length === 0;
  return { schemaVersion: 'emps.energy.v1', stationId: String(stationId), gieStationId: gie?.gie_station_id ?? null,
    generation: gie?.generation ?? null, revision: gie?.revision ?? null, source: 'SIMULATED',
    scenarioAt: typeof d.timestamp === 'string' ? d.timestamp : null, observedAt: gie?.observed_at ?? null,
    emittedAt: new Date(now).toISOString(), expiresAt: new Date(now + ENERGY_TTL_MS).toISOString(), valid, errors,
    evses: { EV1: { gieAuthorized: valid && powers.EV1! > tolerance, allocatedKw: powers.EV1 },
      EV2: { gieAuthorized: valid && powers.EV2! > tolerance, allocatedKw: powers.EV2 } },
    battery: { socMeanPct: bat01 === null || bat02 === null ? null : (bat01 + bat02) / 2,
      BAT_01: { socPct: bat01, chargeKw: num(obj(batteries.BAT_01).charge_kw), dischargeKw: num(obj(batteries.BAT_01).discharge_kw) },
      BAT_02: { socPct: bat02, chargeKw: num(obj(batteries.BAT_02).charge_kw), dischargeKw: num(obj(batteries.BAT_02).discharge_kw) }, chargeKw: charge, dischargeKw: discharge },
    solar: { generatedKw: solar, usedKw: used, curtailedKw: curtailed, active: typeof v.solar_active === 'boolean' ? v.solar_active : null, ledGpio: null },
    grid: { importKw: gridIn, exportKw: gridOut }, building: { consumptionKw: building, lightOn: true },
    balance: { supplyKw: supply, consumptionKw: demand, residualKw: residual, toleranceKw: tolerance,
      modeledLossesKw: losses, lossesModeled: n.losses_kw !== undefined, basis: 'AC_BUS_KW_SOLAR_USED' },
    physicalMeasurement: false, provenance: obj(d.provenance) };
}

export function effectiveRelay(input: { valid: boolean; gieAuthorized: boolean; sessionAuthorized: boolean;
  operationalAuthorized: boolean; connected: boolean; electricalSafe: boolean; hardwareApproved: boolean }) {
  return Object.values(input).every(v => v === true);
}

export class EnergyOrderGuard {
  private generation: string | null = null;
  private revision = -1;
  private retired = new Set<string>();
  accept(generation: string, revision: number) {
    if (!generation || !Number.isSafeInteger(revision) || revision < 1 || this.retired.has(generation)) return false;
    if (generation !== this.generation) {
      if (this.generation) this.retired.add(this.generation);
      this.generation = generation; this.revision = -1;
    }
    if (revision < this.revision) return false;
    this.revision = revision; return true;
  }
}
