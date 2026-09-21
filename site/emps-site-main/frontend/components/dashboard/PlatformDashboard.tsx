"use client";

import {
  BadgeCheck,
  Ban,
  Building2,
  Cable,
  LoaderCircle,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import type {
  ChargerProvisioning,
  ChargerProvisioningStationOption,
} from "@/domain/emps";
import { api } from "@/services/emps-api";

const statusLabels: Record<ChargerProvisioning["status"], string> = {
  PENDING_CONNECTION: "Aguardando instalação",
  PENDING_APPROVAL: "Aguardando aprovação",
  ENABLED: "Liberada",
  REJECTED: "Rejeitada",
  CANCELED: "Cancelada",
  EXPIRED: "Expirada",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function PlatformDashboard() {
  const [stations, setStations] = useState<ChargerProvisioningStationOption[]>([]);
  const [provisionings, setProvisionings] = useState<ChargerProvisioning[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextStations, nextProvisionings] = await Promise.all([
        api.provisioningStations(),
        api.listProvisionings(),
      ]);
      setStations(nextStations);
      setProvisionings(nextProvisionings);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar a visão GoodWe / SEMS+."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () => ({
      approval: provisionings.filter((item) => item.status === "PENDING_APPROVAL")
        .length,
      enabled: provisionings.filter((item) => item.status === "ENABLED").length,
      installation: provisionings.filter(
        (item) => item.status === "PENDING_CONNECTION"
      ).length,
      inactive: provisionings.filter((item) =>
        ["REJECTED", "CANCELED", "EXPIRED"].includes(item.status)
      ).length,
    }),
    [provisionings]
  );

  return (
    <AppShell
      eyebrow="SEMS+ / GoodWe"
      title="Administração de eletropostos"
      description="Visão GoodWe para acompanhar implantações e aprovar equipamentos conectados."
    >
      <section className="platform-dashboard-hero panel">
        <div>
          <span><ShieldCheck size={16} aria-hidden="true" /> Conta de infraestrutura</span>
          <h2>Acompanhe os eletropostos e aprove os equipamentos físicos.</h2>
          <p>
            Esta conta administra os cadastros da rede, confere a conexão OCPP e
            libera o QR oficial depois da validação física.
          </p>
        </div>
        <div className="platform-dashboard-actions">
          <button className="provisioning-button provisioning-button--ghost" onClick={() => void load()} type="button">
            <RefreshCw size={16} aria-hidden="true" /> Atualizar
          </button>
          <Link className="provisioning-button" href="/chargers">
            <PlugZap size={16} aria-hidden="true" /> Revisar aprovações
          </Link>
        </div>
      </section>

      {loading ? (
        <div className="loading-panel panel" role="status">
          <LoaderCircle className="spin" size={20} aria-hidden="true" />
          Carregando infraestrutura
        </div>
      ) : error ? (
        <div className="provisioning-error" role="alert">
          <Ban size={17} aria-hidden="true" /> {error}
        </div>
      ) : (
        <>
          <section className="platform-metric-grid" aria-label="Resumo de cadastros">
            <article><Building2 size={19} /><span><strong>{stations.length}</strong><small>Eletropostos disponíveis</small></span></article>
            <article><Unplug size={19} /><span><strong>{counts.installation}</strong><small>Aguardando instalação</small></span></article>
            <article><Cable size={19} /><span><strong>{counts.approval}</strong><small>Aguardando aprovação</small></span></article>
            <article><BadgeCheck size={19} /><span><strong>{counts.enabled}</strong><small>Equipamentos liberados</small></span></article>
          </section>

          <div className="platform-dashboard-grid">
            <section className="panel platform-dashboard-panel">
              <div className="platform-panel-heading">
                <div><Building2 size={18} /><span><strong>Eletropostos</strong><small>Locais aptos a receber equipamentos</small></span></div>
                <small>{stations.length} cadastrado(s)</small>
              </div>
              <div className="platform-station-list">
                {stations.map((station) => (
                  <article key={station.id}>
                    <span><strong>{station.name}</strong><small>{station.code} · {station.city}/{station.state}</small></span>
                    <span><strong>{station._count.chargers}</strong><small>liberado(s)</small></span>
                    <span><strong>{station._count.provisionings}</strong><small>solicitação(ões)</small></span>
                  </article>
                ))}
                {stations.length === 0 && <p className="muted-text">Nenhum eletroposto disponível.</p>}
              </div>
            </section>

            <section className="panel platform-dashboard-panel">
              <div className="platform-panel-heading">
                <div><PlugZap size={18} /><span><strong>Cadastros recentes</strong><small>Andamento da implantação física</small></span></div>
                <small>{counts.inactive} encerrado(s)</small>
              </div>
              <div className="platform-provisioning-list">
                {provisionings.slice(0, 6).map((item) => (
                  <article key={item.id}>
                    <span><strong>{item.name}</strong><small>{item.station.name} · {item.manufacturer} {item.model}</small></span>
                    <span className={`status-badge status-badge--${item.status === "ENABLED" ? "success" : item.status === "PENDING_APPROVAL" ? "warning" : item.status === "PENDING_CONNECTION" ? "info" : "danger"}`}>
                      <i />{statusLabels[item.status]}
                    </span>
                    <time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time>
                  </article>
                ))}
                {provisionings.length === 0 && <p className="muted-text">Nenhum equipamento solicitado.</p>}
              </div>
            </section>
          </div>
        </>
      )}
    </AppShell>
  );
}
