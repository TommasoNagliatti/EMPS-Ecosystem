'use client';

import { useEffect, useState } from 'react';
import { api } from '@/services/emps-api';
import type { Reading } from '@/domain/station-monitoring';

const emptyHistory = { rows: [] as Reading[], loading: false, error: '', truncated: false };

export function useStationHistory(stationId: string, from: number, to: number, revision: number) {
  const key = `${stationId}:${from}:${to}:${revision}`;
  const [state, setState] = useState<{ key: string; rows: Reading[]; loading: boolean; error: string; truncated: boolean }>({ key: '', rows: [], loading: true, error: '', truncated: false });
  useEffect(() => {
    if (!stationId) return;
    const controller = new AbortController();
    setState({ key, rows: [], loading: true, error: '', truncated: false });
    let requests = 0, truncated = false;
    async function read(start: number, end: number): Promise<Reading[]> {
      requests++;
      const query = new URLSearchParams({ from: new Date(start).toISOString(), to: new Date(end).toISOString() });
      const rows = await api.platform<Reading[]>(`/v2/stations/${encodeURIComponent(stationId)}/telemetry/history?${query}`, { signal: controller.signal }, { force: revision > 0 });
      if (rows.length < 1000) return rows;
      if (requests >= 24 || end - start < 60_000) { truncated = true; return rows; }
      // The endpoint caps each response at 1,000 rows. Split instead of silently dropping older samples.
      const middle = Math.floor((start + end) / 2);
      const older = await read(start, middle);
      const newer = requests < 24 ? await read(middle, end) : (truncated = true, rows.filter(row => Date.parse(row.measuredAt) >= middle));
      return [...older, ...newer];
    }
    void read(from, to).then(rows => { if (!controller.signal.aborted) setState({ key, rows, loading: false, error: '', truncated }); })
      .catch(error => { if (!controller.signal.aborted) setState({ key, rows: [], loading: false, truncated: false, error: error instanceof Error ? error.message : 'Não foi possível carregar o histórico.' }); });
    return () => controller.abort();
  }, [stationId, from, to, revision, key]);
  return !stationId ? emptyHistory : state.key === key ? state : { rows: [], loading: true, error: '', truncated: false };
}
