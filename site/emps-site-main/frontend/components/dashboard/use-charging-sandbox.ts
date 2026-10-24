'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Charger } from '@/domain/emps';
import { validateChargingSandbox, type ChargingSandbox } from '@/domain/charging-sandbox';
import { api, isDemoMode, isOfficialTestBridge, isReadOnlyMode } from '@/services/emps-api';

export function useChargingSandbox(stationId: string, chargers: Charger[]) {
  const enabled = !isDemoMode && !isReadOnlyMode && !isOfficialTestBridge && ['13', '46', '47'].includes(stationId);
  const chargerIds = useMemo(() => chargers.filter(charger => charger.estacaoId === stationId)
    .map(charger => charger.carregadorId).sort().join(','), [chargers, stationId]);
  const [snapshot, setSnapshot] = useState<{ key: string; data: ChargingSandbox | null; error: string; at: number } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => { setRevision(value => value + 1); }, []);
  const key = `${stationId}:${chargerIds}`;

  useEffect(() => {
    if (!enabled || !chargerIds) {
      setSnapshot(null);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    const isHidden = () => document.visibilityState === 'hidden';
    async function poll() {
      if (!active) return;
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(() => void poll(), 3_000);
        return;
      }
      let nextPollMs = 3_000;
      const current = new AbortController();
      controller = current;
      const timeout = setTimeout(() => current.abort(), 8_000);
      try {
        const next = await api.platform<ChargingSandbox>(`/v2/stations/${stationId}/charging-sandbox`,
          { signal: current.signal }, { force: true });
        if (!active || controller !== current || isHidden()) return;
        setSnapshot({ key, data: validateChargingSandbox(next, stationId,
          chargerIds.split(',').map(id => ({ carregadorId: id, estacaoId: stationId } as Charger))), error: '', at: Date.now() });
      } catch (cause) {
        if (cause && typeof cause === 'object' && 'status' in cause && cause.status === 429) nextPollMs = 60_000;
        if (!active || controller !== current || isHidden()) return;
        setSnapshot({ key, data: null, error: cause instanceof Error ? cause.message : 'Operação sandbox indisponível.', at: Date.now() });
      } finally {
        clearTimeout(timeout);
        if (active && controller === current) timer = setTimeout(() => void poll(), nextPollMs);
      }
    }
    void poll();
    function visibility() {
      if (document.visibilityState === 'hidden') {
        controller?.abort(); controller = null; clearTimeout(timer); setSnapshot(null); return;
      }
      clearTimeout(timer);
      controller?.abort();
      void poll();
    }
    document.addEventListener('visibilitychange', visibility);
    return () => { active = false; controller?.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [enabled, stationId, chargerIds, key, revision]);

  const current = enabled && snapshot?.key === key ? snapshot : null;
  return { data: current?.data ?? null, error: current?.error ?? '', enabled, refresh };
}
