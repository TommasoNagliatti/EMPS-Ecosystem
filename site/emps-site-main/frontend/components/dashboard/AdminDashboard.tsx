"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { startTransition, useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { GieControls } from "@/components/energy/GieControls";
import { AppShell } from "@/components/shell/AppShell";
import { useRealtime } from "@/components/realtime/RealtimeProvider";
import { energyFromGie, type GieState } from "@/domain/gie";
import type { Charger, DashboardData } from "@/domain/emps";
import { api, isDemoMode, isAccessDenied } from "@/services/emps-api";
import { StationDashboard, type StationInfo } from "./StationDashboard";

export function AdminDashboard({ stationId, station }: { stationId: string; station?: StationInfo }) {
  const [gie, setGie] = useState<GieState | null>(null);
  const [data, setData] = useState<DashboardData | null>(() => api.cachedDashboard(stationId)?.value ?? null);
  const [loading, setLoading] = useState(() => !api.cachedDashboard(stationId));
  const [error, setError] = useState("");
  const loadGenerationRef = useRef(0);
  const visibleLoadGenerationRef = useRef(0);
  const handledConnectionRef = useRef(0);
  const handledChangeRevisionRef = useRef(0);
  const initialLoadStartedRef = useRef(false);
  const loadingRequestRef = useRef(false);
  const { changeRevision, connectionVersion, status: realtimeStatus } = useRealtime();

  const load = useCallback(async (silent = false) => {
    if (loadingRequestRef.current) return;
    loadingRequestRef.current = true;
    const generation = ++loadGenerationRef.current;
    if (!silent) {
      visibleLoadGenerationRef.current = generation;
      setLoading(!api.cachedDashboard(stationId));
      setError("");
    }
    try {
      const nextData = await api.dashboard(stationId, silent);
      if (generation !== loadGenerationRef.current) return;
      if (silent) startTransition(() => setData(nextData));
      else setData(nextData);
      setError("");
    } catch (loadError) {
      if ((!silent || isAccessDenied(loadError)) && generation === loadGenerationRef.current) {
        setData(null);
        setError(loadError instanceof Error ? loadError.message : "Nao foi possivel carregar o painel EMPS.");
      }
    } finally {
      loadingRequestRef.current = false;
      if (!silent && generation === visibleLoadGenerationRef.current) setLoading(false);
    }
  }, [stationId]);

  useEffect(() => {
    if (initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    handledConnectionRef.current = connectionVersion;
    handledChangeRevisionRef.current = changeRevision;
    void load();
  }, [changeRevision, connectionVersion, load]);

  useEffect(() => {
    if (loading) {
      // The initial read is already fresh; connecting a socket does not require a duplicate read.
      handledConnectionRef.current = connectionVersion;
      return;
    }
    let shouldRefresh = false;
    if (connectionVersion > handledConnectionRef.current) {
      handledConnectionRef.current = connectionVersion;
      shouldRefresh = true;
    }
    if (changeRevision > handledChangeRevisionRef.current) {
      handledChangeRevisionRef.current = changeRevision;
      shouldRefresh = true;
    }
    if (!shouldRefresh) return;
    const refreshTimer = window.setTimeout(() => { void load(true); }, 180);
    return () => window.clearTimeout(refreshTimer);
  }, [changeRevision, connectionVersion, load, loading]);

  useEffect(() => {
    if (realtimeStatus === "disabled") return;
    const fallbackTimer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, realtimeStatus === "connected" ? 60_000 : 15_000);
    return () => window.clearInterval(fallbackTimer);
  }, [load, realtimeStatus]);

  const updateChargers = useCallback((update: SetStateAction<Charger[]>) => {
    setData(current => {
      if (!current) return current;
      return { ...current, carregadores: typeof update === "function" ? update(current.carregadores) : update };
    });
  }, []);
  const receiveGie = useCallback((state: GieState) => {
    setGie(String(state.station_id) === stationId ? state : null);
  }, [stationId]);
  const refresh = useCallback(() => { void load(true); }, [load]);
  const scopedGie = gie && String(gie.station_id) === stationId && !gie.isolated ? gie : null;
  // A bound GIE that goes offline must not fall back to unrelated illustrative power values.
  const operationalGie = scopedGie?.online ? scopedGie : null;
  const gieTelemetry = scopedGie && (scopedGie.gie_station_id || scopedGie.online) ? energyFromGie(scopedGie) : data?.energyFlow;

  return <AppShell eyebrow="Minhas instalacoes" showEmpsHeaderLogo title="Painel do Eletroposto">
    {loading ? <div className="loading-panel"><RefreshCw className="spin" size={20} aria-hidden="true" />Carregando painel EMPS</div>
      : error || !data ? <div className="loading-panel" role="alert"><AlertTriangle size={20} aria-hidden="true" /><span>{error || "A API nao devolveu os dados do painel."}</span><button className="table-action" onClick={() => void load()} type="button"><RefreshCw size={14} aria-hidden="true" />Tentar novamente</button></div>
      : <StationDashboard stationId={stationId} initialStation={station} data={data} telemetry={gieTelemetry ?? data.energyFlow} gieState={scopedGie} gieMode={operationalGie?.mode} onChargersChange={updateChargers} onRefresh={refresh} gieControls={!isDemoMode ? <GieControls initialStationId={stationId} onState={receiveGie} /> : null} />}
  </AppShell>;
}

