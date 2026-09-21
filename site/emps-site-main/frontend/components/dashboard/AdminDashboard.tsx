"use client";
import { GieControls } from "@/components/energy/GieControls";
import { energyFromGie, type GieState } from "@/domain/gie";

import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  CircleDollarSign,
  RefreshCw,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/shell/AppShell";
import { ChargerVisualBoard } from "@/components/chargers/ChargerVisualBoard";
import { EnergyFlowStation } from "@/components/energy/EnergyFlowStation";
import { StatusBadge } from "@/components/status/StatusBadge";
import {
  getDashboardMetrics,
  type DashboardMetric,
} from "@/components/dashboard/dashboard-metrics";
import type { Charger, DashboardData } from "@/domain/emps";
import type { SetStateAction } from "react";
import {
  formatCurrency,
  formatDateTime,
  formatKwh,
  formatMinutes,
} from "@/utils/formatters";
import { api, isDemoMode } from "@/services/emps-api";
import { useRealtime } from "@/components/realtime/RealtimeProvider";

function Metric({
  bars,
  label,
  progress,
  sideLabel,
  sideValue,
  value,
  detail,
  tone,
  icon: Icon,
}: DashboardMetric) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__head">
        <span className={`metric-icon metric-icon--${tone}`}>
          <Icon size={18} aria-hidden="true" />
        </span>
        <small>{label}</small>
      </div>

      <div className="metric-card__body">
        <div className="metric-card__main">
          <strong>{value}</strong>
          <em>{detail}</em>
        </div>

        <div className="metric-card__insight">
          <span>{sideValue}</span>
          <small>{sideLabel}</small>
          <div className="metric-card__bars" aria-hidden="true">
            {bars.map((bar, index) => (
              <i
                key={`${label}-${index}`}
                style={{ height: `${bar}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="metric-card__progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
    </article>
  );
}

function SectionHeading({
  eyebrow,
  icon: Icon,
  title,
  tone,
}: {
  eyebrow: string;
  icon: LucideIcon;
  title: string;
  tone: "infra" | "monitor" | "alert" | "money" | "energy";
}) {
  return (
    <div className={`section-heading section-heading--${tone}`}>
      <span className="section-heading__marker">
        <Icon size={15} aria-hidden="true" />
      </span>
      <div className="section-heading__copy">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="loading-panel">
      <RefreshCw className="spin" size={20} aria-hidden="true" />
      Carregando painel EMPS
    </div>
  );
}

export function AdminDashboard() {
  const [gie, setGie] = useState<GieState | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadGenerationRef = useRef(0);
  const visibleLoadGenerationRef = useRef(0);
  const handledConnectionRef = useRef(0);
  const handledChangeRevisionRef = useRef(0);
  const initialLoadStartedRef = useRef(false);
  const {
    changeRevision,
    connectionVersion,
    status: realtimeStatus,
  } = useRealtime();

  const load = useCallback(async (silent = false) => {
    const generation = ++loadGenerationRef.current;
    if (!silent) {
      visibleLoadGenerationRef.current = generation;
      setLoading(true);
      setError("");
    }

    try {
      const nextData = await api.dashboard();
      if (generation !== loadGenerationRef.current) return;
      setData(nextData);
      setError("");
    } catch (loadError) {
      if (!silent && generation === loadGenerationRef.current) {
        setData(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Nao foi possivel carregar o painel EMPS."
        );
      }
    } finally {
      if (!silent && generation === visibleLoadGenerationRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    handledConnectionRef.current = connectionVersion;
    handledChangeRevisionRef.current = changeRevision;
    void load();
  }, [changeRevision, connectionVersion, load]);

  useEffect(() => {
    if (loading) return;

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

    const refreshTimer = window.setTimeout(() => {
      void load(true);
    }, 180);

    return () => window.clearTimeout(refreshTimer);
  }, [changeRevision, connectionVersion, load, loading]);

  useEffect(() => {
    if (realtimeStatus === "disabled") return;

    const fallbackTimer = window.setInterval(() => {
      void load(true);
    }, realtimeStatus === "connected" ? 60_000 : 15_000);

    return () => window.clearInterval(fallbackTimer);
  }, [load, realtimeStatus]);

  const metrics = useMemo<DashboardMetric[]>(() => {
    if (!data) return [];
    return getDashboardMetrics(data);
  }, [data]);

  const updateChargers = useCallback((update: SetStateAction<Charger[]>) => {
    setData((current) => {
      if (!current) return current;
      const carregadores = typeof update === "function" ? update(current.carregadores) : update;
      return { ...current, carregadores };
    });
  }, []);

  return (
    <AppShell
      eyebrow="EMPS / Operacao"
      showEmpsHeaderLogo
      title="Painel do Eletroposto"
    >
      {loading ? (
        <DashboardSkeleton />
      ) : error || !data ? (
        <div className="loading-panel" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <span>{error || "A API nao devolveu os dados do painel."}</span>
          <button className="table-action" onClick={() => void load()} type="button">
            <RefreshCw size={14} aria-hidden="true" />
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          {!isDemoMode && <GieControls onState={setGie} />}
          <div className="dashboard-overview">
            <div className="dashboard-energy-flow">
              <EnergyFlowStation
                chargers={data.carregadores}
                simulation={isDemoMode}
                telemetry={gie ? energyFromGie(gie) : data.energyFlow}
              />
            </div>
            <div className="dashboard-chargers-slot">
              <section className="panel dashboard-chargers-panel">
                <SectionHeading
                  eyebrow="Infraestrutura"
                  icon={BatteryCharging}
                  title="Status dos carregadores"
                  tone="infra"
                />
                <ChargerVisualBoard
                  chargers={data.carregadores}
                  onChargersChange={updateChargers}
                  scrollAfter={6}
                />
              </section>
            </div>
          </div>

          <div className="dashboard-grid dashboard-grid--wide">
            <section className="panel table-panel dashboard-monitoring-panel">
              <SectionHeading
                eyebrow="Monitoramento"
                icon={Activity}
                title="Sessoes recentes"
                tone="monitor"
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Sessao</th>
                      <th>Cliente</th>
                      <th>Carregador</th>
                      <th>Duracao</th>
                      <th>Energia</th>
                      <th>Valor</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessoes.map((session) => (
                      <tr key={session.sessaoId}>
                        <td>{session.sessaoId}</td>
                        <td>{session.usuarioNome}</td>
                        <td>{session.carregadorNome}</td>
                        <td>{formatMinutes(session.duracaoMinutos)}</td>
                        <td>{formatKwh(session.energiaKwh)}</td>
                        <td>{formatCurrency(session.valorTotal)}</td>
                        <td>
                          <StatusBadge status={session.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel side-stack dashboard-alerts-panel">
              <SectionHeading
                eyebrow="Atencao"
                icon={AlertTriangle}
                title="Alertas abertos"
                tone="alert"
              />
              <div className="dashboard-alert-list">
                {data.alertas.map((alert) => (
                  <article className="alert-row" key={alert.alertaId}>
                    <AlertTriangle size={17} aria-hidden="true" />
                    <div>
                      <strong>{alert.titulo}</strong>
                      <small>
                        {alert.carregadorNome ?? alert.origem} · {formatDateTime(alert.dataCriacao)}
                      </small>
                    </div>
                    <StatusBadge status={alert.severidade} />
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section className="metric-grid" aria-label="Indicadores principais">
            {metrics.map((metric) => (
              <Metric key={metric.label} {...metric} />
            ))}
          </section>

          <div className="dashboard-grid dashboard-grid--charts">
            <section className="chart-panel">
              <SectionHeading
                eyebrow="Financeiro"
                icon={CircleDollarSign}
                title="Receita por hora"
                tone="money"
              />
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.receitaPorHora} margin={{ top: 12, right: 16, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ff5c66" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#ff5c66" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
                    <XAxis dataKey="hora" axisLine={false} tickLine={false} tick={{ fill: "#87919c", fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#87919c", fontSize: 12 }} />
                    <Tooltip contentStyle={{ background: "#111820", border: "1px solid #26323d", color: "#fff" }} />
                    <Area type="monotone" dataKey="receita" stroke="#ff5c66" fill="url(#revenueFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="chart-panel">
              <SectionHeading
                eyebrow="Energia"
                icon={Zap}
                title="kWh comercializados"
                tone="energy"
              />
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.energiaPorHora} margin={{ top: 12, right: 16, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
                    <XAxis dataKey="hora" axisLine={false} tickLine={false} tick={{ fill: "#87919c", fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#87919c", fontSize: 12 }} />
                    <Tooltip contentStyle={{ background: "#111820", border: "1px solid #26323d", color: "#fff" }} />
                    <Bar dataKey="energiaKwh" fill="#55d6e8" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
        </>
      )}
    </AppShell>
  );
}

