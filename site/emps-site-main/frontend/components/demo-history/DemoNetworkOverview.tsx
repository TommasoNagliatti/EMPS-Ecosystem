'use client';

import { useEffect, useMemo, useState } from 'react';
import { NavigationLink as Link } from '@/components/shell/NavigationLink';
import { AppShell } from '@/components/shell/AppShell';
import {
  demoChannels, demoMethods, monthlyCoverage, monthlyMean, sourceLocalDay,
  type DemoHistoryFilters, type DemoNetworkHistory, type DemoStationHistory,
} from '@/domain/demo-history';
import { api } from '@/services/emps-api';
import { DemoBarRows, DemoHistoryFilters as DemoFilters, DemoMonthly, DemoSummaryCards } from './DemoHistoryViews';
import styles from './demo-history.module.css';

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const number = (value: number, digits = 2) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(value);
const date = (value: string | null) => {
  if (!value) return 'Data não informada';
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short', year: 'numeric' }).format(parsed) : value;
};

function coveredMonths(station: DemoStationHistory, filters: DemoHistoryFilters) {
  if (!station.batch?.periodStart || !station.batch.periodEnd) return 0;
  const batchStart = sourceLocalDay(station.batch.periodStart);
  const batchEnd = sourceLocalDay(station.batch.periodEnd);
  const start = filters.from && filters.from > batchStart ? filters.from : batchStart;
  const end = filters.to && filters.to < batchEnd ? filters.to : batchEnd;
  return start <= end ? monthlyCoverage(start, end) : 0;
}

function distribution(stations: DemoStationHistory[], kind: 'channels' | 'methods') {
  const result = new Map<string, { label: string; sessions: number; revenueSimulated: number }>();
  for (const station of stations) for (const row of station[kind]) {
    const key = kind === 'channels' ? (row as DemoStationHistory['channels'][number]).channel : (row as DemoStationHistory['methods'][number]).method;
    const current = result.get(key) ?? {
      label: kind === 'channels' ? demoChannels.find(item => item.value === key)?.label ?? key : demoMethods.find(item => item.value === key)?.label ?? key,
      sessions: 0, revenueSimulated: 0,
    };
    current.sessions += row.sessions;
    current.revenueSimulated += row.revenueSimulated;
    result.set(key, current);
  }
  return [...result.values()].sort((a, b) => b.revenueSimulated - a.revenueSimulated);
}

export function DemoNetworkOverview() {
  const [draft, setDraft] = useState<DemoHistoryFilters>({});
  const [filters, setFilters] = useState<DemoHistoryFilters>({});
  const [stationId, setStationId] = useState('');
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<DemoNetworkHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void api.ensureSession().then(() => api.demoHistoryNetwork(filters, revision > 0)).then(result => {
      if (active) setData(result);
    }).catch(reason => {
      if (active) { setData(null); setError(reason instanceof Error ? reason.message : 'Não foi possível consultar a rede demonstrativa.'); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, revision]);

  const visibleStations = useMemo(() => data?.stations.filter(station => !stationId || String(station.station.id) === stationId) ?? [], [data, stationId]);
  const summary = stationId ? visibleStations[0]?.summary : data?.summary;
  const monthly = stationId ? visibleStations[0]?.monthly ?? [] : data?.monthly ?? [];
  const channelRows = useMemo(() => distribution(visibleStations, 'channels'), [visibleStations]);
  const methodRows = useMemo(() => distribution(visibleStations, 'methods'), [visibleStations]);
  const chargerRows = useMemo(() => visibleStations.flatMap(station => station.chargers.map(charger => ({
    label: `${station.station.name} · ${charger.sourceChargerId ?? (charger.chargerId === null ? 'Carregador não identificado' : `Carregador ${charger.chargerId}`)}`, sessions: charger.sessions,
  }))).sort((a, b) => b.sessions - a.sessions), [visibleStations]);

  return <AppShell eyebrow="Minhas instalações" title="Visão da rede demonstrativa" description="Compare os históricos sintéticos das instalações desta conta.">
    <div className={styles.root}>
      <nav className={styles.breadcrumb} aria-label="Navegação"><Link href="/stations">Minhas instalações</Link><span>›</span><span>Visão da rede</span></nav>
      <div className={styles.sourceNote}><strong>SIMULATED · histórico financeiro fictício</strong><span>Os valores abaixo são calculados a partir de sessões históricas sintéticas; não são receita recebida ou pagamentos reais.</span></div>
      <div className={styles.networkControls}>
        <label>Instalação<select value={stationId} onChange={event => setStationId(event.target.value)}>
          <option value="">Todas as minhas instalações</option>
          {data?.stations.map(station => <option key={station.station.id} value={String(station.station.id)}>{station.station.name}</option>)}
        </select></label>
        <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Atualizar</button>
      </div>
      <DemoFilters value={draft} onChange={setDraft} onApply={() => setFilters({ ...draft })} onClear={() => { setDraft({}); setFilters({}); }} disabled={loading} prefix="histórico da rede" />
      {loading ? <p className={styles.state} role="status">Carregando comparação das instalações...</p>
        : error ? <p className={styles.state} role="alert">{error} <button type="button" onClick={() => setRevision(value => value + 1)}>Tentar novamente</button></p>
          : !data || !visibleStations.length ? <p className={styles.state}>Nenhum histórico demonstrativo disponível para esta conta ou filtro.</p>
            : <div className={styles.content}>
              {summary && <DemoSummaryCards summary={summary} />}
              <section className={styles.panel} aria-label="Comparação entre instalações"><h3>Comparação por eletroposto</h3>
                <p className={styles.caption}>Datas de origem preservadas. A média mensal divide cada resultado pelos meses cobertos pelo respectivo dataset ou filtro.</p>
                <div className={styles.tableScroll}><table className={styles.comparison}><thead><tr><th>Instalação</th><th>Período do dataset</th><th>Meses cobertos</th><th>Recargas</th><th>kWh</th><th>Receita simulada</th><th>Ticket médio</th><th>Recargas / mês</th><th>kWh / mês</th><th>Receita simulada / mês</th></tr></thead>
                  <tbody>{visibleStations.map(station => {
                    const months = station.summary.activeMonths ?? coveredMonths(station, filters);
                    const fallback = monthlyMean(station.summary, months);
                    const mean = { sessions: station.summary.sessionsPerMonth ?? fallback.sessions,
                      deliveredKwh: station.summary.deliveredKwhPerMonth ?? fallback.deliveredKwh,
                      revenueSimulated: station.summary.revenueSimulatedPerMonth ?? fallback.revenueSimulated };
                    return <tr key={station.station.id}><td><Link href={`/stations/${station.station.id}/dashboard`}>{station.station.name}</Link><small>{station.station.gieStationId ?? 'GIE não informado'} · {station.station.gieProfile ?? 'perfil não informado'}</small></td>
                      <td>{station.batch ? `${date(station.batch.periodStart)} – ${date(station.batch.periodEnd)}` : 'Sem lote'}</td><td>{number(months, 0)}</td><td>{number(station.summary.sessions, 0)}</td><td>{number(station.summary.deliveredKwh)}</td>
                      <td>{money(station.summary.revenueSimulated)}</td><td>{money(station.summary.avgTicket)}</td><td>{number(mean.sessions, 1)}</td><td>{number(mean.deliveredKwh, 1)}</td><td>{money(mean.revenueSimulated)}</td></tr>;
                  })}</tbody></table></div>
              </section>
              <div className={styles.twoColumns}>
                <DemoMonthly rows={monthly} />
                <DemoBarRows title="Utilização por carregador" rows={chargerRows} label={row => row.label} value={row => row.sessions} valueLabel="recargas" />
                <DemoBarRows title="Canais de pagamento simulados" rows={channelRows} label={row => row.label} value={row => row.revenueSimulated} valueLabel="R$" />
                <DemoBarRows title="Métodos de pagamento simulados" rows={methodRows} label={row => row.label} value={row => row.revenueSimulated} valueLabel="R$" />
              </div>
              <p className={styles.caption}>A comparação inclui somente instalações autorizadas para o proprietário autenticado. Recargas e pagamentos operacionais são consultados nas áreas próprias do EMPS.</p>
            </div>}
    </div>
  </AppShell>;
}
