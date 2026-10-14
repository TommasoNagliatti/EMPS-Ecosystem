'use client';

import { ChevronDown, LoaderCircle, MapPin, Moon, RefreshCw, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme } from '@/components/theme/ThemeProvider';
import { createStationLocationMap, mapPosition, type MapPosition, type MapStatus } from './station-location-map';
import styles from './station-location-map.module.css';

export function StationLocationMap({ latitude, longitude, disabled = false, onPosition }: {
  latitude: unknown; longitude: unknown; disabled?: boolean; onPosition: (position: MapPosition) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const { theme, setTheme } = useTheme();
  const controller = useRef<ReturnType<typeof createStationLocationMap> | null>(null);
  const position = mapPosition(latitude, longitude);
  const latest = useRef({ position, disabled, onPosition, theme });
  const [status, setStatus] = useState<MapStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    latest.current = { position: mapPosition(latitude, longitude), disabled, onPosition, theme };
    controller.current?.update(latest.current.position, disabled);
    controller.current?.setTheme(theme);
  }, [latitude, longitude, disabled, onPosition, theme]);

  useEffect(() => {
    let alive = true;
    let observer: ResizeObserver | undefined;
    let timeout: number;
    const startTimeout = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => { if (alive) setStatus('error'); }, 20_000);
    };
    startTimeout();
    void import('./station-location-map-browser').then(({ loadMapLibrary }) => {
      if (!alive || !host.current) return;
      const library = loadMapLibrary();
      const instance = createStationLocationMap(library, host.current, {
        position: latest.current.position, disabled: latest.current.disabled, theme: latest.current.theme,
        onPosition: next => { if (alive && !latest.current.disabled) latest.current.onPosition(next); },
        onStatus: next => {
          if (!alive) return;
          if (next === 'loading') startTimeout();
          else window.clearTimeout(timeout);
          setStatus(next);
        },
      });
      controller.current = instance;
      observer = new ResizeObserver(() => instance.resize());
      observer.observe(host.current);
    }).catch(() => { if (alive) { window.clearTimeout(timeout); setStatus('error'); } });
    return () => {
      alive = false;
      window.clearTimeout(timeout);
      observer?.disconnect();
      controller.current?.destroy(); controller.current = null;
    };
  }, [attempt]);

  function retry() { setStatus('loading'); setAttempt(current => current + 1); }

  return <section className={styles.panel} data-map-theme={theme} aria-label="Mapa da instalação">
    <header className={styles.header}><MapPin size={17} aria-hidden="true" /><h2>Localização do eletroposto</h2><button type="button" className={styles.themeButton} title={theme === 'dark' ? 'Ativar tema claro do site e mapa' : 'Ativar tema escuro do site e mapa'} aria-label={theme === 'dark' ? 'Ativar tema claro do site e mapa' : 'Ativar tema escuro do site e mapa'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button></header>
    <div className={styles.viewport}>
      <div ref={host} className={styles.map} aria-label="Mapa interativo do eletroposto" />
      {(status === 'ready' || status === 'partial') && <>
        <span className={styles.centerReference} aria-hidden="true"><ChevronDown size={24} strokeWidth={2.5} /></span>
        <button type="button" className={styles.centerButton} title="Definir posição indicada pela seta central" aria-label="Definir posição no centro do mapa" disabled={disabled} onClick={() => controller.current?.selectCenter()}><MapPin size={18} aria-hidden="true" /></button>
      </>}
      {status === 'loading' && <div className={styles.overlay} role="status"><LoaderCircle size={24} className={styles.spinner} aria-hidden="true" /><span>Carregando mapa…</span></div>}
      {status === 'error' && <div className={styles.overlay} role="alert"><MapPin size={25} aria-hidden="true" /><span>Mapa temporariamente indisponível</span><button type="button" className={styles.retry} onClick={retry}><RefreshCw size={15} aria-hidden="true" />Tentar novamente</button></div>}
    </div>
    <div className={styles.position} aria-live="polite">
      {position ? <><span>Latitude <strong>{position.latitude.toFixed(6)}</strong></span><span>Longitude <strong>{position.longitude.toFixed(6)}</strong></span></> : <span>Posição não definida</span>}
      {status === 'partial' && <span role="status">Mapa parcialmente indisponível</span>}
    </div>
  </section>;
}
