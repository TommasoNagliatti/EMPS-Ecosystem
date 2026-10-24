import type { Station } from './station-types';

export type StationStatus = 'running' | 'waiting' | 'offline' | 'fault' | 'constructing';
export type StationTab = 'all' | 'monthly' | StationStatus;
export type StationLocale = 'pt-BR' | 'en';
export type StationKind = 'charging' | 'solar' | 'storage' | 'hybrid';
export type MetricColumn =
  | 'solarPower' | 'equivalentHours' | 'dischargedTotal' | 'chargedTotal'
  | 'solarCapacity' | 'batterySoc' | 'batteryPower' | 'gridPower' | 'irradiance'
  | 'kind' | 'irradiation' | 'dischargedToday' | 'chargedToday'
  | 'storageCapacity' | 'generationTotal' | 'status';

export type StationListEntry = Station & {
  createdAt?: string;
  timezone?: string;
  powerLimitKw?: string | number | null;
  neighborhood?: string;
  postalCode?: string;
  listSummary?: {
    ownerName: string;
    contactEmail: string;
    devices: {
      name: string;
      serialNumber: string | null;
      ocppIdentity: string | null;
      administrativeStatus: string;
      operationalStatus: string;
    }[];
    solarCapacityKwp: number | null;
    storageCapacityKwh: number | null;
    telemetry: {
      measuredAt: string;
      solarPowerKw: number | null;
      batteryPowerKw: number | null;
      gridPowerKw: number | null;
      batterySocPercent: number | null;
    } | null;
  };
};

export type SearchFields = { name: string; address: string; email: string };
export type AdvancedFilters = {
  kind: '' | StationKind;
  owner: string;
  minPower: string;
  maxPower: string;
  source: '' | 'managed' | 'shared';
  starred: boolean;
};

export const stationTabs: StationTab[] = ['all', 'monthly', 'running', 'waiting', 'offline', 'fault', 'constructing'];
export const metricColumns: MetricColumn[] = [
  'solarPower', 'equivalentHours', 'dischargedTotal', 'chargedTotal', 'solarCapacity',
  'batterySoc', 'batteryPower', 'gridPower', 'irradiance', 'kind', 'irradiation',
  'dischargedToday', 'chargedToday', 'storageCapacity', 'generationTotal', 'status',
];
export const defaultColumns: MetricColumn[] = ['solarPower', 'equivalentHours', 'dischargedTotal', 'chargedTotal', 'solarCapacity'];
export const emptySearch: SearchFields = { name: '', address: '', email: '' };
export const emptyAdvanced: AdvancedFilters = { kind: '', owner: '', minPower: '', maxPower: '', source: '', starred: false };

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function stationAddress(station: StationListEntry) {
  return [station.street, station.addressNumber, station.neighborhood, station.city, station.state, station.postalCode].filter(Boolean).join(', ');
}

export function stationStatus(station: StationListEntry): StationStatus {
  if (station.status === 'MAINTENANCE') return 'fault';
  if (station.status === 'INACTIVE' || station.reviewState === 'SUSPENDED') return 'offline';
  if (['DRAFT', 'CHANGES_REQUESTED'].includes(station.reviewState)) return 'constructing';
  if (station.status !== 'ACTIVE' || station.reviewState === 'PENDING_REVIEW') return 'waiting';
  if (station.listSummary?.devices.some(device => device.administrativeStatus === 'MAINTENANCE')) return 'fault';
  const devices = station.listSummary?.devices.filter(device => device.administrativeStatus === 'ENABLED') ?? [];
  if (devices.some(device => device.operationalStatus === 'FAULTED')) return 'fault';
  if (devices.some(device => ['AVAILABLE', 'PREPARING', 'CHARGING', 'SUSPENDED', 'FINISHING', 'RESERVED'].includes(device.operationalStatus))) return 'running';
  if (devices.length && devices.every(device => ['OFFLINE', 'UNAVAILABLE'].includes(device.operationalStatus))) return 'offline';
  return 'waiting';
}

export function stationKind(station: StationListEntry): StationKind {
  const solar = (station.listSummary?.solarCapacityKwp ?? 0) > 0;
  const storage = (station.listSummary?.storageCapacityKwh ?? 0) > 0;
  return solar && storage ? 'hybrid' : solar ? 'solar' : storage ? 'storage' : 'charging';
}

export function createdThisMonth(station: StationListEntry, now = new Date()) {
  if (!station.createdAt) return false;
  const created = new Date(station.createdAt);
  if (!Number.isFinite(created.getTime())) return false;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: station.timezone || 'America/Sao_Paulo', year: 'numeric', month: '2-digit' });
  return formatter.format(created) === formatter.format(now);
}

export function matchesStation(station: StationListEntry, search: SearchFields, filters: AdvancedFilters, favorites: string[]) {
  const summary = station.listSummary;
  const deviceText = summary?.devices.flatMap(device => [device.name, device.serialNumber, device.ocppIdentity]).filter(Boolean).join(' ') ?? '';
  if (!normalize(`${station.name} ${deviceText}`).includes(normalize(search.name))) return false;
  if (!normalize(stationAddress(station)).includes(normalize(search.address))) return false;
  if (!normalize(summary?.contactEmail ?? '').includes(normalize(search.email))) return false;
  if (filters.kind && stationKind(station) !== filters.kind) return false;
  if (filters.owner && summary?.contactEmail !== filters.owner) return false;
  if (filters.source && (station.membershipRole === 'OWNER' ? 'managed' : 'shared') !== filters.source) return false;
  if (filters.starred && !favorites.includes(String(station.id))) return false;
  const power = station.powerLimitKw === null || station.powerLimitKw === undefined ? null : Number(station.powerLimitKw);
  if (filters.minPower !== '' && (power === null || power < Number(filters.minPower))) return false;
  if (filters.maxPower !== '' && (power === null || power > Number(filters.maxPower))) return false;
  return true;
}

export function stationMetric(station: StationListEntry, column: MetricColumn, now = new Date()): number | null {
  const summary = station.listSummary;
  if (column === 'solarCapacity') return summary?.solarCapacityKwp ?? null;
  if (column === 'storageCapacity') return summary?.storageCapacityKwh ?? null;
  // A historical reading is not an instantaneous value. Never substitute nameplate ratings.
  const telemetry = summary?.telemetry;
  const age = telemetry ? now.getTime() - Date.parse(telemetry.measuredAt) : NaN;
  if (!telemetry || !Number.isFinite(age) || age < 0 || age > 15 * 60_000) return null;
  if (column === 'solarPower') return telemetry.solarPowerKw;
  if (column === 'batteryPower') return telemetry.batteryPowerKw;
  if (column === 'gridPower') return telemetry.gridPowerKw;
  if (column === 'batterySoc') return telemetry.batterySocPercent;
  return null;
}
