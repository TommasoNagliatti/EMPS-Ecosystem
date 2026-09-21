import type { Coordinate } from '@/domain/models';

function finiteOrZero(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export const formatCurrency = (value: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    finiteOrZero(value),
  );

export const formatEnergy = (value: number | null | undefined) =>
  `${finiteOrZero(value).toFixed(2).replace('.', ',')} kWh`;

export const formatPower = (value: number | null | undefined) =>
  `${finiteOrZero(value).toFixed(1).replace('.', ',')} kW`;

export function formatDuration(totalSeconds: number | null | undefined) {
  const safeSeconds = Math.max(0, Math.floor(finiteOrZero(totalSeconds)));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}min`;
  }

  if (minutes > 0) return `${minutes}min ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export function formatTimer(totalSeconds: number | null | undefined) {
  const safeSeconds = Math.max(0, Math.floor(finiteOrZero(totalSeconds)));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

export function distanceInKm(from: Coordinate, to: Coordinate) {
  const radiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return radiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export const formatDistance = (distanceKm: number | null | undefined) => {
  const safeDistance = Math.max(0, finiteOrZero(distanceKm));
  return safeDistance < 1
    ? `${Math.round(safeDistance * 1000)} m`
    : `${safeDistance.toFixed(1).replace('.', ',')} km`;
};
