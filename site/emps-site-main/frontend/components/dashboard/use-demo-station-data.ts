'use client';

import { useEffect, useState } from 'react';
import type { DemoAnalyticsGrain, DemoStationAnalytics } from '@/domain/demo-analytics';
import type { DemoHistoryFilters, DemoStationHistory } from '@/domain/demo-history';
import { api } from '@/services/emps-api';

type AsyncState<T> = { key: string; data: T | null; loading: boolean; error: string };

export function useDemoStationAnalytics(stationId: string, from: string, to: string, grain: DemoAnalyticsGrain, revision: number) {
  const key = `${stationId}:${from}:${to}:${grain}:${revision}`;
  const [state, setState] = useState<AsyncState<DemoStationAnalytics>>({ key: '', data: null, loading: true, error: '' });
  useEffect(() => {
    if (!stationId || !from || !to) return;
    let active = true;
    setState({ key, data: null, loading: true, error: '' });
    void api.demoHistoryAnalytics(stationId, { from, to, grain }, revision > 0)
      .then(data => { if (active) setState({ key, data, loading: false, error: '' }); })
      .catch(error => { if (active) setState({ key, data: null, loading: false, error: error instanceof Error ? error.message : 'Não foi possível consultar a energia demonstrativa.' }); });
    return () => { active = false; };
  }, [stationId, from, to, grain, revision, key]);
  return !stationId ? { data: null, loading: false, error: '' } : state.key === key ? state : { data: null, loading: true, error: '' };
}

export function useDemoStationHistory(stationId: string, filters: DemoHistoryFilters, revision: number) {
  const { from = '', to = '', channel = '', method = '' } = filters;
  const key = `${stationId}:${from}:${to}:${channel}:${method}:${revision}`;
  const [state, setState] = useState<AsyncState<DemoStationHistory>>({ key: '', data: null, loading: true, error: '' });
  useEffect(() => {
    if (!stationId || !from || !to) return;
    let active = true;
    setState({ key, data: null, loading: true, error: '' });
    void api.demoHistoryStation(stationId, { from, to, channel: channel || undefined, method: method || undefined }, revision > 0)
      .then(data => { if (active) setState({ key, data, loading: false, error: '' }); })
      .catch(error => { if (active) setState({ key, data: null, loading: false, error: error instanceof Error ? error.message : 'Não foi possível consultar as sessões demonstrativas.' }); });
    return () => { active = false; };
  }, [stationId, from, to, channel, method, revision, key]);
  return !stationId ? { data: null, loading: false, error: '' } : state.key === key ? state : { data: null, loading: true, error: '' };
}
