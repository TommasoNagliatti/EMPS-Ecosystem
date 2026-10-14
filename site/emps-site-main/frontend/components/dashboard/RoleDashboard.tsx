"use client";

import { LoaderCircle } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FrontSession } from "@/domain/emps";
import type { StationInfo } from './StationDashboard';
import {
  api,
  EMPS_SESSION_CHANGED_EVENT,
  frontSession,
  selectedStation,
} from "@/services/emps-api";

function DashboardLoading() {
  return (
    <div className="role-dashboard-loading" role="status">
      <LoaderCircle className="spin" size={22} aria-hidden="true" />
      Preparando o painel da instalação
    </div>
  );
}

const AdminDashboard = dynamic(
  () => import("@/components/dashboard/AdminDashboard").then((mod) => mod.AdminDashboard),
  { loading: DashboardLoading }
);

export function RoleDashboard({ stationId }: { stationId: string }) {
  const router = useRouter();
  const [access, setAccess] = useState<{ stationId: string; session: FrontSession; station: StationInfo } | null>(() => {
    const session = frontSession.get();
    const cached = api.cached<StationInfo>(`/v2/stations/${encodeURIComponent(stationId)}`, stationId);
    return session && cached ? { stationId, session, station: cached.value } : null;
  });
  const [restoreError, setRestoreError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    const synchronizeSession = () => {
      if (!active) return;
      const currentSession = frontSession.get();
      setAccess(current => current && currentSession && current.session.usuarioId === currentSession.usuarioId && current.session.role === currentSession.role ? { ...current, session: currentSession } : null);
      if (!currentSession) {
        active = false;
        abort.abort();
        router.replace(`/login?next=${encodeURIComponent(`/stations/${stationId}/dashboard`)}`);
      }
    };

    const restoreSession = async () => {
      setRestoreError("");
      setAccess(current => current?.stationId === stationId ? current : null);
      try {
        const restoredSession = await api.ensureSession();
        if (!active) return;
        const station = await api.platform<StationInfo>(`/v2/stations/${encodeURIComponent(stationId)}`, {
          signal: abort.signal,
          headers: { 'X-Station-Id': stationId },
        });
        if (!active) return;
        selectedStation.set(stationId);
        setAccess({ stationId, session: restoredSession, station });
      } catch (error) {
        if (active && window.location.pathname !== "/login") {
          setAccess(null);
          setRestoreError(
            error instanceof Error
              ? error.message
              : "Não foi possível acessar esta instalação."
          );
        }
      }
    };

    void restoreSession();
    window.addEventListener(EMPS_SESSION_CHANGED_EVENT, synchronizeSession);
    return () => {
      active = false;
      abort.abort();
      window.removeEventListener(EMPS_SESSION_CHANGED_EVENT, synchronizeSession);
    };
  }, [router, stationId, retry]);

  if (!access || access.stationId !== stationId) {
    if (restoreError) {
      return (
        <div className="role-dashboard-loading" role="alert">
          {restoreError}
          <button type="button" onClick={() => setRetry(value => value + 1)}>
            Tentar novamente
          </button>
          <Link href="/stations">Minhas instalações</Link>
        </div>
      );
    }
    return <DashboardLoading />;
  }

  return <AdminDashboard key={stationId} stationId={stationId} station={access.station} />;
}
