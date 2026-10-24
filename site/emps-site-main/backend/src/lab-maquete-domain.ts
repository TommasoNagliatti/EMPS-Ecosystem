import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { localLegacyIntegrationActive } from './local-legacy-integration';
import type { GieV3Envelope } from './gie-v3.service';
import { energySnapshot } from './lab-energy-contract';

export const LAB_HEARTBEAT_TIMEOUT_MS = 12_000;
export const LAB_COMMAND_TTL_MS = 10_000;
export type LabEvse = 'EV1' | 'EV2';
export type LabCommandStatus = 'PENDING' | 'DELIVERED' | 'ACKED' | 'EXPIRED' | 'FAILED';
export type LabConfig = { stationId: number; deviceId: string; token: string; energyStationId?: number };
type JsonObject = Record<string, unknown>;
const record = (value: unknown): JsonObject | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const percent = (value: unknown): number | null => { const n = finite(value); return n !== null && n >= 0 && n <= 1 ? Math.round(n * 1000) / 10 : null; };

/** Every lab exception is pinned to the audited, disposable 3308 clone. */
export function labConfig(env: NodeJS.ProcessEnv = process.env): LabConfig | null {
  if (env.EMPS_MAQUETE_LAB_ENABLED !== 'true') return null;
  if (!localLegacyIntegrationActive(env)) throw new Error('Maquete de laboratório exige exclusivamente a cópia local 3308');
  const stationId = Number(env.EMPS_MAQUETE_STATION_ID);
  const deviceId = env.EMPS_MAQUETE_DEVICE_ID ?? 'maquete-01';
  const token = env.EMPS_MAQUETE_DEVICE_TOKEN ?? '';
  if (!Number.isSafeInteger(stationId) || stationId <= 0 || !/^[A-Za-z0-9_-]{1,64}$/.test(deviceId) ||
      token.length < 32 || /REPLACE|GENERATE|CHANGE_ME|EXAMPLE/i.test(token))
    throw new Error('Vínculo, identidade ou token local da maquete inválido');
  const energyStationId = Number(env.EMPS_MAQUETE_GIE_STATION_ID ?? stationId);
  if (![13,46].includes(energyStationId)) throw new Error('Fonte GIE da maquete não suportada');
  return { stationId, deviceId, token, energyStationId };
}

export function deviceTokenMatches(expected: string, supplied: unknown): boolean {
  if (typeof supplied !== 'string' || !supplied) return false;
  const left = createHash('sha256').update(expected).digest();
  const right = createHash('sha256').update(supplied).digest();
  return timingSafeEqual(left, right);
}

export function uidHash(uid: string, key: string): string {
  return createHmac('sha256', key).update(uid.toUpperCase()).digest('hex');
}

export function parseUid(body: unknown): string {
  const value = record(body)?.uid;
  if (typeof value !== 'string' || !/^(?:[A-Fa-f0-9]{8}|[A-Fa-f0-9]{14}|[A-Fa-f0-9]{20})$/.test(value))
    throw new Error('UID RFID inválido');
  return value.toUpperCase();
}

export type LabGieSnapshot = {
  valid: boolean; scenarioAt: string | null; gridKw: number | null; solarKw: number | null;
  bat01Soc: number | null; bat02Soc: number | null; batteryInstalled: boolean;
  poleLight: boolean; buildingLight: boolean;
};
export const unavailableGie: LabGieSnapshot = {
  valid: false, scenarioAt: null, gridKw: null, solarKw: null,
  bat01Soc: null, bat02Soc: null, batteryInstalled: false, poleLight: false, buildingLight: false,
};

/** Display-only GIE data; simulated EV setpoints can never authorize a USB relay. */
export function labGieSnapshot(gie: GieV3Envelope | null, expectedStationId: number): LabGieSnapshot {
  if (expectedStationId === 13) {
    const energy = energySnapshot(gie, expectedStationId);
    if (!energy.valid) return { ...unavailableGie };
    return { valid:true, scenarioAt:energy.scenarioAt, gridKw:energy.grid.importKw, solarKw:energy.solar.generatedKw,
      bat01Soc:null, bat02Soc:null, batteryInstalled:true, poleLight:(energy.grid.importKw ?? 0)>0, buildingLight:true };
  }
  if (!gie?.online || gie.station_id !== String(expectedStationId) || gie.source !== 'SIMULATED' ||
      gie.physical_dispatch !== false || gie.hardware_commands_sent !== false) return { ...unavailableGie };
  const worker = record(gie.state);
  const decision = record(worker?.state) ?? worker;
  const visual = record(decision?.visual_state);
  const numeric = record(decision?.numeric_state);
  const origin = record(decision?.provenance)?.origin;
  if (!decision || decision.execution_allowed !== true || visual?.valid !== true || !numeric || origin !== 'SIMULATED')
    return { ...unavailableGie };
  const extension = record(decision.station_extension);
  if (extension?.station_id !== gie.gie_station_id) return { ...unavailableGie };
  const batteries = record(extension.equipment)?.batteries;
  const decisions = record(extension.battery_decisions);
  const batteryIds = Array.isArray(batteries) ? batteries.map(b => record(b)?.id) : [];
  const soc = (id: string) => batteryIds.includes(id) ? percent(record(decisions?.[id])?.soc_after) : null;
  const scenarioAt = typeof decision.timestamp === 'string' && Number.isFinite(Date.parse(decision.timestamp)) ? decision.timestamp : null;
  // Decorative lights visualize native GIE flags only; they do not imply physical meter readings.
  return { valid: true, scenarioAt, gridKw: finite(numeric.grid_import_kw), solarKw: finite(numeric.solar_kw),
    bat01Soc: soc('BAT_01'), bat02Soc: soc('BAT_02'), batteryInstalled: batteryIds.length > 0,
    poleLight: visual.grid_importing === true, buildingLight: visual.building_active === true };
}

export function heartbeatText(stationId: number, stationName: string, gie: LabGieSnapshot, ev1Authorized: boolean, ev2Authorized: boolean): string {
  const cleanName = stationName.replace(/[\r\n=|]/g, ' ').slice(0, 32).toUpperCase();
  const rows = [`stationId=${stationId}`, `stationName=${cleanName}`, `gieValid=${gie.valid ? 1 : 0}`];
  if (gie.valid) {
    rows.push('gieSource=SIMULATED');
    if (gie.scenarioAt !== null) rows.push(`gieScenarioAt=${gie.scenarioAt}`);
    if (gie.gridKw !== null) rows.push(`gridKw=${gie.gridKw}`);
    if (gie.solarKw !== null) rows.push(`solarKw=${gie.solarKw}`);
    if (gie.bat01Soc !== null) rows.push(`bat01Soc=${gie.bat01Soc}`);
    if (gie.bat02Soc !== null) rows.push(`bat02Soc=${gie.bat02Soc}`);
  }
  rows.push(`batteryInstalled=${gie.valid && gie.batteryInstalled ? 1 : 0}`,
    `poleLight=${gie.valid && gie.poleLight ? 1 : 0}`, `buildingLight=${gie.valid && gie.buildingLight ? 1 : 0}`,
    `ev1Authorized=${ev1Authorized ? 1 : 0}`, `ev2Authorized=${ev2Authorized ? 1 : 0}`);
  return rows.join('\n') + '\n';
}
