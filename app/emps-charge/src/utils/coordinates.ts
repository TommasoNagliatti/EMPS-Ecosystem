import type { Charger, Coordinate, Station } from '@/domain/models';

export function validCoordinate(value: unknown): value is Coordinate {
  if (!value || typeof value !== 'object') return false;
  const { latitude, longitude } = value as Partial<Coordinate>;
  return typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}

export function stationHasCoordinates(station: Station): station is Station & { coordinates: Coordinate } {
  return station.coordinatesUnavailable !== true && validCoordinate(station.coordinates);
}

// An unlocated station remains accessible in the list and QR flow, never as a
// fabricated marker at (0, 0) or at the user's position.
export function stationMapPoints(stations: Station[], chargers: Charger[], selectedStationId?: string) {
  return stations.filter(stationHasCoordinates).map(station => ({
    id: station.id,
    name: station.name,
    latitude: station.coordinates.latitude,
    longitude: station.coordinates.longitude,
    available: chargers.filter(charger => charger.stationId === station.id && charger.status === 'available').length,
    selected: station.id === selectedStationId,
  }));
}
