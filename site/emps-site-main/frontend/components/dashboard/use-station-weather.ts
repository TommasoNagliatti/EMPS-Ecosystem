'use client';

import { useCallback, useEffect, useState } from 'react';
import { parseWeather, weatherLocationKey, weatherQuery, type StationWeather } from '@/domain/station-weather';

const cache = new Map<string, { expires: number; value: StationWeather }>();
type State = { key: string; weather: StationWeather | null; loading: boolean; error: string };
export function useStationWeather(latitude: unknown, longitude: unknown, timezone: string) {
  const key = weatherLocationKey(latitude, longitude, timezone);
  const [state, setState] = useState<State>({ key: '', weather: null, loading: false, error: '' });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!key) return;
    let disposed = false;
    let active: AbortController | undefined;
    async function load(force = false) {
      const cached = cache.get(key);
      if (!force && cached && cached.expires > Date.now()) { setState({ key, weather: cached.value, loading: false, error: '' }); return; }
      active?.abort(); active = new AbortController();
      const request = active;
      const timeout = setTimeout(() => request.abort(), 8000);
      setState(previous => ({ key, weather: previous.key === key ? previous.weather : null, loading: true, error: '' }));
      try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${weatherQuery(key)}`, { signal: request.signal, credentials: 'omit' });
        if (!response.ok) throw new Error('Weather unavailable');
        const value = parseWeather(await response.json(), timezone);
        if (!disposed && active === request) { cache.set(key, { value, expires: Date.now() + 900_000 }); setState({ key, weather: value, loading: false, error: '' }); }
      } catch { if (!disposed && active === request) setState({ key, weather: null, loading: false, error: 'Previsão indisponível no momento.' }); }
      finally { clearTimeout(timeout); }
    }
    void load(revision > 0);
    const interval = setInterval(() => void load(), 900_000);
    return () => { disposed = true; active?.abort(); clearInterval(interval); };
  }, [key, revision, timezone]);
  const current = state.key === key && key ? state : { weather: null, loading: Boolean(key), error: key ? '' : 'Localização da instalação indisponível.' };
  return { weather: current.weather, loading: current.loading, error: current.error, refresh };
}
