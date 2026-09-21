"use client";

import { LoaderCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FrontSession } from "@/domain/emps";
import {
  api,
  EMPS_SESSION_CHANGED_EVENT,
  frontSession,
} from "@/services/emps-api";

function DashboardLoading() {
  return (
    <div className="role-dashboard-loading" role="status">
      <LoaderCircle className="spin" size={22} aria-hidden="true" />
      Preparando o painel da sua conta
    </div>
  );
}

const AdminDashboard = dynamic(
  () => import("@/components/dashboard/AdminDashboard").then((mod) => mod.AdminDashboard),
  { loading: DashboardLoading }
);

const PlatformDashboard = dynamic(
  () => import("@/components/dashboard/PlatformDashboard").then((mod) => mod.PlatformDashboard),
  { loading: DashboardLoading }
);

export function RoleDashboard() {
  const router = useRouter();
  const [session, setSession] = useState<FrontSession | null>(null);
  const [restoreError, setRestoreError] = useState("");

  useEffect(() => {
    const synchronizeSession = () => {
      const currentSession = frontSession.get();
      setSession(currentSession);
      if (!currentSession) router.replace("/login");
    };

    let active = true;
    const restoreSession = async () => {
      const currentSession = frontSession.get();
      if (currentSession) {
        setSession(currentSession);
        return;
      }
      try {
        const restoredSession = await api.ensureSession();
        if (active) setSession(restoredSession);
      } catch (error) {
        if (active && window.location.pathname !== "/login") {
          setRestoreError(
            error instanceof Error
              ? error.message
              : "Nao foi possivel restaurar a sessao."
          );
        }
      }
    };

    void restoreSession();
    window.addEventListener(EMPS_SESSION_CHANGED_EVENT, synchronizeSession);
    return () => {
      active = false;
      window.removeEventListener(EMPS_SESSION_CHANGED_EVENT, synchronizeSession);
    };
  }, [router]);

  if (!session) {
    if (restoreError) {
      return (
        <div className="role-dashboard-loading" role="alert">
          {restoreError}
          <button type="button" onClick={() => window.location.reload()}>
            Tentar novamente
          </button>
        </div>
      );
    }
    return <DashboardLoading />;
  }

  if (session.role === "goodwe") return <PlatformDashboard />;

  return <AdminDashboard />;
}
