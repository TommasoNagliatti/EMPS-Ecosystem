import type { Map as MapInstance, Marker as MapMarker } from 'maplibre-gl';
import { hasPosition } from './station-wizard-model';
import type { Theme } from '@/components/theme/theme-store';

export type MapPosition = { latitude: number; longitude: number };
export type MapStatus = 'loading' | 'ready' | 'partial' | 'error';
type MapLibrary = Pick<typeof import('maplibre-gl'), 'Map' | 'Marker' | 'NavigationControl' | 'AttributionControl'>;

export const stationMapStyle = 'https://tiles.openfreemap.org/styles/liberty';
export const stationMapStyles: Record<Theme, string> = { light: stationMapStyle, dark: 'https://tiles.openfreemap.org/styles/dark' };
export const defaultMapCenter: [number, number] = [-51.9, -14.2];

export function mapPosition(latitude: unknown, longitude: unknown): MapPosition | null {
  return hasPosition({ latitude, longitude }) ? { latitude: latitude as number, longitude: longitude as number } : null;
}

export function pickedPosition(lng: number, lat: number): MapPosition | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const longitude = ((lng + 180) % 360 + 360) % 360 - 180;
  return mapPosition(Number(lat.toFixed(6)), Number(longitude.toFixed(6)));
}

export function createStationLocationMap(library: MapLibrary, host: HTMLElement, {
  position, disabled, onPosition, onStatus, theme = 'dark',
}: { position: MapPosition | null; disabled: boolean; onPosition: (position: MapPosition) => void; onStatus: (status: MapStatus) => void; theme?: Theme }) {
  const map: MapInstance = new library.Map({
    container: host, style: stationMapStyles[theme],
    center: position ? [position.longitude, position.latitude] : defaultMapCenter,
    zoom: position ? 15 : 3.5, attributionControl: false, renderWorldCopies: false,
    dragRotate: false, touchPitch: false, scrollZoom: true, cooperativeGestures: false,
    locale: { 'NavigationControl.ZoomIn': 'Aproximar mapa', 'NavigationControl.ZoomOut': 'Afastar mapa', 'AttributionControl.ToggleAttribution': 'Créditos do mapa' },
  });
  let marker: MapMarker | null = null;
  let blocked = disabled;
  let loaded = false;
  let disposed = false;
  let currentTheme = theme;
  map.touchZoomRotate.disableRotation();
  map.addControl(new library.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new library.AttributionControl({ compact: true }), 'bottom-right');

  function select(lng: number, lat: number) {
    if (blocked || disposed) return;
    const next = pickedPosition(lng, lat);
    if (!next) return;
    updateMarker(next);
    onPosition(next);
  }

  function updateMarker(next: MapPosition | null) {
    if (!next) { marker?.remove(); marker = null; return; }
    if (!marker) {
      marker = new library.Marker({ color: '#ff323a', draggable: !blocked });
      marker.getElement().setAttribute('aria-label', 'Posição do eletroposto');
      marker.on('dragend', () => {
        const point = marker?.getLngLat();
        if (point) select(point.lng, point.lat);
      });
      marker.setLngLat([next.longitude, next.latitude]).addTo(map);
    } else marker.setLngLat([next.longitude, next.latitude]);
  }

  updateMarker(position);
  map.on('click', event => select(event.lngLat.lng, event.lngLat.lat));
  map.on('load', () => { if (!disposed) { loaded = true; onStatus('ready'); } });
  map.on('style.load', () => { if (!disposed) { loaded = true; onStatus('ready'); } });
  map.on('error', () => { if (!disposed) onStatus(loaded ? 'partial' : 'error'); });

  return {
    setTheme(next: Theme) {
      if (disposed || next === currentTheme) return;
      currentTheme = next;
      loaded = false;
      onStatus('loading');
      try { map.setStyle(stationMapStyles[next]); } catch { onStatus('error'); }
    },
    update(next: MapPosition | null, readOnly: boolean) {
      if (disposed) return;
      blocked = readOnly;
      marker?.setDraggable(!blocked);
      const current = marker?.getLngLat();
      const changed = next && (!current || current.lng !== next.longitude || current.lat !== next.latitude);
      updateMarker(next);
      if (changed && next) map.jumpTo({ center: [next.longitude, next.latitude], zoom: Math.max(map.getZoom(), 15) });
    },
    selectCenter() { const point = map.getCenter(); select(point.lng, point.lat); },
    resize() { if (!disposed) map.resize(); },
    destroy() {
      if (disposed) return;
      disposed = true;
      marker?.remove(); marker = null;
      map.remove();
    },
  };
}
