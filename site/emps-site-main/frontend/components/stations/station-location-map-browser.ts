import * as library from 'maplibre-gl';

export function loadMapLibrary() {
  library.setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString());
  return library;
}
