import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';
import type { Charger, Coordinate, Station } from '@/domain/models';

type StationMapProps = {
  stations: Station[];
  chargers: Charger[];
  userCoordinate: Coordinate;
  selectedStationId?: string;
  onSelectStation: (stationId: string) => void;
};

type MapMessage = {
  source?: string;
  type?: 'error' | 'ready' | 'station';
  stationId?: string;
};

type MapState = {
  html: string;
  status: 'error' | 'loading' | 'ready';
};

const iframeStyle: CSSProperties = {
  background: '#17191d',
  border: 0,
  display: 'block',
  height: '100%',
  width: '100%',
};

function serializeForInlineScript(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildMapHtml(
  stations: Station[],
  chargers: Charger[],
  user: Coordinate,
  selectedStationId?: string,
) {
  const points = stations.map((station) => ({
    id: station.id,
    name: station.name,
    latitude: station.coordinates.latitude,
    longitude: station.coordinates.longitude,
    available: chargers.filter(
      (charger) => charger.stationId === station.id && charger.status === 'available',
    ).length,
    selected: station.id === selectedStationId,
  }));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link href="https://unpkg.com/maplibre-gl@5.19.0/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    html, body, #map { height: 100%; width: 100%; margin: 0; background: #17191d; }
    body { overflow: hidden; }
    button { appearance: none; }
    .maplibregl-ctrl-top-right { top: 8px; right: 8px; }
    .maplibregl-ctrl-group { overflow: hidden; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; background: rgba(24,26,30,.92); box-shadow: 0 7px 20px rgba(0,0,0,.28); }
    .maplibregl-ctrl-group button { width: 34px; height: 34px; background-color: transparent; }
    .maplibregl-ctrl-icon { filter: invert(1); opacity: .82; }
    .osm-attribution { position: fixed; z-index: 5; right: 7px; bottom: 7px; padding: 3px 6px; border-radius: 4px; background: rgba(12,13,16,.82); color: #b9bec5; font: 8px system-ui, sans-serif; }
    .osm-attribution a { color: #d7dbe0; text-decoration: none; }
    .station-marker { width: 38px; height: 38px; padding: 0; border-radius: 50%; background: #202224; border: 3px solid #ff323a; box-shadow: 0 8px 18px rgba(0,0,0,.38); display: flex; align-items: center; justify-content: center; color: #fff; font: 700 12px system-ui, sans-serif; cursor: pointer; transition: transform .16s ease, background .16s ease; }
    .station-marker:hover { transform: translateY(-2px) scale(1.06); }
    .station-marker.selected { width: 46px; height: 46px; background: #ff323a; border-color: #fff; }
    .station-marker.empty { border-color: #727981; color: #a7adb5; }
    .user-marker { width: 18px; height: 18px; box-sizing: border-box; border-radius: 50%; background: #4d91ff; border: 3px solid white; box-shadow: 0 0 0 7px rgba(77,145,255,.18), 0 4px 14px rgba(77,145,255,.65); }
  </style>
  <script>
    function sendToEmps(type, payload) {
      window.parent.postMessage(Object.assign({ source: 'emps-station-map', type: type }, payload || {}), '*');
    }
  </script>
  <script src="https://unpkg.com/maplibre-gl@5.19.0/dist/maplibre-gl.js" onerror="sendToEmps('error')"></script>
</head>
<body>
  <div id="map"></div>
  <div class="osm-attribution"><a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a></div>
  <script>
    const points = ${serializeForInlineScript(points)};
    const user = ${serializeForInlineScript(user)};

    if (typeof maplibregl === 'undefined') {
      sendToEmps('error');
    } else {
      const map = new maplibregl.Map({
        container: 'map',
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [user.longitude, user.latitude],
        zoom: 11.8,
        attributionControl: false
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      const bounds = new maplibregl.LngLatBounds();

      points.forEach((point) => {
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'station-marker' + (point.selected ? ' selected' : '') + (point.available === 0 ? ' empty' : '');
        marker.textContent = String(point.available);
        marker.title = point.name;
        marker.setAttribute('aria-label', point.name + ', ' + point.available + ' disponíveis');
        marker.onclick = () => sendToEmps('station', { stationId: point.id });
        new maplibregl.Marker({ element: marker }).setLngLat([point.longitude, point.latitude]).addTo(map);
        bounds.extend([point.longitude, point.latitude]);
      });

      const userMarker = document.createElement('div');
      userMarker.className = 'user-marker';
      userMarker.title = 'Sua posição';
      new maplibregl.Marker({ element: userMarker }).setLngLat([user.longitude, user.latitude]).addTo(map);
      bounds.extend([user.longitude, user.latitude]);

      map.on('load', () => {
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 54, maxZoom: 13, duration: 0 });
        sendToEmps('ready');
      });
    }
  </script>
</body>
</html>`;
}

export function StationMap({
  stations,
  chargers,
  userCoordinate,
  selectedStationId,
  onSelectStation,
}: StationMapProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const html = useMemo(
    () => buildMapHtml(stations, chargers, userCoordinate, selectedStationId),
    [chargers, selectedStationId, stations, userCoordinate],
  );
  const [mapState, setMapState] = useState<MapState>(() => ({ html, status: 'loading' }));
  const status = mapState.html === html ? mapState.status : 'loading';

  useEffect(() => {
    function receiveMapMessage(event: MessageEvent<MapMessage>) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.source !== 'emps-station-map') return;

      if (event.data.type === 'ready') setMapState({ html, status: 'ready' });
      if (event.data.type === 'error') setMapState({ html, status: 'error' });
      if (event.data.type === 'station' && event.data.stationId) {
        onSelectStation(event.data.stationId);
      }
    }

    window.addEventListener('message', receiveMapMessage);
    return () => window.removeEventListener('message', receiveMapMessage);
  }, [html, onSelectStation]);

  if (status === 'error') {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Mapa temporariamente indisponível</Text>
        <Text style={styles.fallbackCopy}>A lista de eletropostos continua disponível logo abaixo.</Text>
      </View>
    );
  }

  return (
    <View accessibilityLabel="Mapa dos eletropostos" role="region" style={styles.container}>
      {status !== 'ready' ? (
        <View pointerEvents="none" style={styles.loading}>
          <ActivityIndicator color={Colors.coral} />
          <Text style={styles.loadingText}>Carregando mapa…</Text>
        </View>
      ) : null}
      <iframe
        ref={iframeRef}
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-popups"
        srcDoc={html}
        style={iframeStyle}
        title="Mapa interativo dos eletropostos EMPS"
      />
      <View pointerEvents="none" style={styles.legend}>
        <View style={styles.legendDot} />
        <Text style={styles.legendText}>número de vagas livres</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: Radius.large,
    borderWidth: 1,
    height: 310,
    overflow: 'hidden',
    position: 'relative',
  },
  loading: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    bottom: 0,
    gap: 9,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 2,
  },
  loadingText: { color: Colors.textMuted, fontFamily: Fonts.medium, fontSize: 11 },
  legend: {
    alignItems: 'center',
    backgroundColor: '#111318E8',
    borderRadius: Radius.pill,
    bottom: 12,
    flexDirection: 'row',
    gap: 6,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    position: 'absolute',
  },
  legendDot: { backgroundColor: Colors.coral, borderRadius: 4, height: 7, width: 7 },
  legendText: { color: Colors.textMuted, fontFamily: Fonts.medium, fontSize: 9 },
  fallback: {
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: Radius.large,
    borderWidth: 1,
    gap: 5,
    height: 230,
    justifyContent: 'center',
    padding: 24,
  },
  fallbackTitle: { color: Colors.text, fontFamily: Fonts.semiBold, fontSize: 14 },
  fallbackCopy: {
    color: Colors.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
    textAlign: 'center',
  },
});
