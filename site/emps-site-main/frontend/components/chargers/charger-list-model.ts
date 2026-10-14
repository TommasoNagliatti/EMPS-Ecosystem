import { searchText } from '../operations/operational-model';

export type ListedCharger = {
  id: number; name: string; stationId: number; location?: string | null;
  ocppIdentity: string; powerKw: string | number | null; connectorType: string | null;
  administrativeStatus: string; serialNumber?: string | null; manufacturer?: string | null; model?: string | null;
  station: { id: number; name: string; reviewState: string | null };
  liveStatus?: { operationalStatus: string; currentPowerKw: string | number | null; lastSeenAt: string | null } | null;
  qrBindings: { id: string | number; publicToken: string }[];
};

export function chargerState(charger: ListedCharger, now = Date.now()) {
  if (charger.administrativeStatus === 'DISABLED') return { key: 'disabled', label: 'Desabilitado', tone: 'red' };
  if (charger.administrativeStatus === 'MAINTENANCE') return { key: 'maintenance', label: 'Manutenção', tone: 'amber' };
  if (charger.administrativeStatus !== 'ENABLED') return { key: 'pending', label: 'Pendente', tone: 'amber' };
  const seen = charger.liveStatus?.lastSeenAt ? new Date(charger.liveStatus.lastSeenAt).getTime() : NaN;
  if (!Number.isFinite(seen) || seen > now + 5000 || now - seen > 15 * 60_000) return { key: 'unknown', label: 'Sem dados recentes', tone: '' };
  const status = charger.liveStatus?.operationalStatus;
  if (status === 'AVAILABLE') return { key: 'available', label: 'Disponível', tone: 'green' };
  if (['CHARGING', 'PREPARING', 'SUSPENDED', 'FINISHING', 'RESERVED'].includes(status || '')) return { key: 'charging', label: status === 'CHARGING' ? 'Em recarga' : status === 'RESERVED' ? 'Reservado' : status === 'PREPARING' ? 'Preparando' : status === 'FINISHING' ? 'Finalizando' : 'Suspenso', tone: 'blue' };
  if (status === 'FAULTED') return { key: 'unavailable', label: 'Falha', tone: 'red' };
  if (status === 'OFFLINE') return { key: 'unknown', label: 'Offline', tone: '' };
  if (status === 'UNAVAILABLE') return { key: 'unavailable', label: 'Indisponível', tone: 'amber' };
  return { key: 'unknown', label: 'Sem telemetria', tone: '' };
}

export function matchesCharger(charger: ListedCharger, query: string, station: string, filter: string, now = Date.now()) {
  return (!station || String(charger.stationId) === station) &&
    (!query.trim() || searchText([charger.id, charger.name, charger.station.name, charger.ocppIdentity, charger.serialNumber, charger.location].join(' ')).includes(searchText(query))) &&
    (filter === 'all' || chargerState(charger, now).key === filter);
}

export function chargerPower(charger: ListedCharger, now = Date.now()) {
  if (['unknown', 'disabled', 'pending', 'maintenance'].includes(chargerState(charger, now).key)) return null;
  const raw = charger.liveStatus?.currentPowerKw;
  return raw != null && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null;
}

export function chargerNominalPower(charger: ListedCharger) {
  const raw = charger.powerKw;
  return raw != null && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : null;
}
