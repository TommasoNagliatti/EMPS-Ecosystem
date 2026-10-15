'use client';

import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { NavigationLink as Link } from '@/components/shell/NavigationLink';
import {
  demoChannels, demoMethods, type DemoHistoryFilters, type DemoHistorySummary,
  type DemoStationHistory,
} from '@/domain/demo-history';
import { api } from '@/services/emps-api';
import styles from './demo-history.module.css';

const integer = (value: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
const decimal = (value: number, digits = 2) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const date = (value: string | null) => {
  if (!value) return 'Data não informada';
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short', year: 'numeric' }).format(parsed) : value;
};
const dateTime = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const month = (value: string) => /^\d{4}-\d{2}$/.test(value)
  ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(new Date(`${value}-01T12:00:00Z`)) : value;

export function DemoHistoryFilters({ value, onChange, onApply, onClear, disabled = false, prefix = 'Histórico demonstrativo' }: {
  value: DemoHistoryFilters; onChange: (value: DemoHistoryFilters) => void; onApply: () => void;
  onClear: () => void; disabled?: boolean; prefix?: string;
}) {
  const valid = !value.from || !value.to || value.from <= value.to;
  return <form className={styles.filters} aria-label={`Filtros de ${prefix}`} onSubmit={event => { event.preventDefault(); if (valid) onApply(); }}>
    <label>De<input type="date" value={value.from ?? ''} max={value.to || undefined} onChange={event => onChange({ ...value, from: event.target.value || undefined })} /></label>
    <label>Até<input type="date" value={value.to ?? ''} min={value.from || undefined} onChange={event => onChange({ ...value, to: event.target.value || undefined })} /></label>
    <label>Canal<select value={value.channel ?? ''} onChange={event => onChange({ ...value, channel: event.target.value as DemoHistoryFilters['channel'] || undefined })}>
      <option value="">Todos os canais</option>{demoChannels.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
    <label>Método<select value={value.method ?? ''} onChange={event => onChange({ ...value, method: event.target.value as DemoHistoryFilters['method'] || undefined })}>
      <option value="">Todos os métodos</option>{demoMethods.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
    <div className={styles.filterActions}><button type="submit" disabled={disabled || !valid}>Aplicar</button><button type="button" disabled={disabled} onClick={onClear}>Limpar</button></div>
    {!valid && <p role="alert">A data final deve ser igual ou posterior à inicial.</p>}
  </form>;
}

export function DemoSummaryCards({ summary }: { summary: DemoHistorySummary }) {
  const items = [
    ['Tentativas', integer(summary.attempts)],
    ['Recargas atendidas', integer(summary.sessions)],
    ['Energia entregue', `${decimal(summary.deliveredKwh)} kWh`],
    ['Receita simulada', money(summary.revenueSimulated)],
    ['Ticket médio simulado', money(summary.avgTicket)],
    ['Média por recarga', `${decimal(summary.avgEnergy)} kWh`],
  ];
  return <div className={styles.metrics}>{items.map(([label, value]) =>
    <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>;
}

export function DemoBarRows<T>({ title, rows, valueLabel, value, label, empty = 'Sem registros no período.' }: {
  title: string; rows: T[]; valueLabel: string; value: (row: T) => number;
  label: (row: T) => string; empty?: string;
}) {
  const maximum = Math.max(1, ...rows.map(value));
  return <section className={styles.panel} aria-label={title}><h3>{title}</h3>
    {rows.length ? <div className={styles.bars}>{rows.map((row, index) => <div className={styles.barRow} key={`${label(row)}-${index}`}>
      <span>{label(row)}</span><div className={styles.barTrack}><div style={{ width: `${Math.max(0, Math.min(100, value(row) / maximum * 100))}%` }} /></div>
      <strong>{valueLabel === 'R$' ? money(value(row)) : `${integer(value(row))}${valueLabel ? ` ${valueLabel}` : ''}`}</strong>
    </div>)}</div> : <p className={styles.empty}>{empty}</p>}
  </section>;
}

export function DemoMonthly({ rows }: { rows: DemoStationHistory['monthly'] }) {
  const maximum = Math.max(1, ...rows.map(row => row.deliveredKwh));
  return <section className={styles.panel} aria-label="Evolução mensal demonstrativa"><h3>Evolução mensal</h3>
    {rows.length ? <div className={styles.monthly} role="list">{rows.map(row => <div key={row.month} className={styles.monthCard} role="listitem">
      <span>{month(row.month)}</span><div className={styles.monthTrack}><div style={{ height: `${Math.max(3, row.deliveredKwh / maximum * 100)}%` }} /></div>
      <strong>{decimal(row.deliveredKwh)} kWh</strong><small>{integer(row.sessions)} recargas · {money(row.revenueSimulated)} simulados</small>
    </div>)}</div> : <p className={styles.empty}>Sem sessões atendidas no período selecionado.</p>}
  </section>;
}

export function DemoEnergyChart({ readings }: { readings: DemoStationHistory['readings'] }) {
  const ordered = useMemo(() => [...readings].sort((a, b) => a.intervalStart.localeCompare(b.intervalStart)), [readings]);
  const points = useMemo(() => ordered.map(row => ({
    day: row.intervalStart.slice(0, 10), prédio: row.buildingKw, solar: row.solarKw,
    rede: row.gridKw, recarga: row.evDeliveredKw,
  })), [ordered]);
  const totals = useMemo(() => {
    const sum = (key: 'buildingKwh' | 'solarKwh' | 'gridKwh' | 'evDeliveredKwh') => {
      const known = ordered.map(row => row[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      return known.length ? known.reduce((total, value) => total + value, 0) : null;
    };
    return { building: sum('buildingKwh'), solar: sum('solarKwh'), grid: sum('gridKwh'), ev: sum('evDeliveredKwh') };
  }, [ordered]);
  return <section className={styles.panel} aria-label="Histórico energético GIE"><h3>Histórico energético do GIE</h3>
    <p className={styles.caption}>Médias diárias em kW, agregadas dos intervalos do dataset. Fonte SIMULATED; não são medições físicas recentes. Filtros de canal e método afetam sessões e valores, mas não estas leituras gerais do GIE.</p>
    {points.length ? <><div className={styles.lineChart}><ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: -20 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#77777744" /><XAxis dataKey="day" minTickGap={32} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} unit=" kW" />
      <Tooltip formatter={(value, name) => [value == null ? 'Sem leitura' : `${decimal(Number(value))} kW`, name]} /><Legend />
      <Line dataKey="prédio" stroke="#b587e2" dot={false} connectNulls={false} isAnimationActive={false} />
      <Line dataKey="solar" stroke="#d6a725" dot={false} connectNulls={false} isAnimationActive={false} />
      <Line dataKey="rede" stroke="#5ca7d5" dot={false} connectNulls={false} isAnimationActive={false} />
      <Line dataKey="recarga" stroke="#ef875a" dot={false} connectNulls={false} isAnimationActive={false} />
    </LineChart></ResponsiveContainer></div><p className={styles.caption}>{integer(points.length)} dias retornados · {date(ordered[0].intervalStart)} a {date(ordered[ordered.length - 1].intervalStart)}.</p>
      <p className={styles.caption}>Somas dos dias disponíveis no GIE: prédio {totals.building === null ? 'indisponível' : `${decimal(totals.building)} kWh`} · solar {totals.solar === null ? 'indisponível' : `${decimal(totals.solar)} kWh`} · rede {totals.grid === null ? 'indisponível' : `${decimal(totals.grid)} kWh`} · EV {totals.ev === null ? 'indisponível' : `${decimal(totals.ev)} kWh`}.</p></>
      : <p className={styles.empty}>Sem intervalos energéticos neste recorte.</p>}
  </section>;
}

function DemoSessions({ rows }: { rows: DemoStationHistory['sessions'] }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [rows]);
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const visible = rows.slice((page - 1) * 20, page * 20);
  return <section className={styles.panel} aria-label="Sessões históricas demonstrativas"><div className={styles.panelHeading}><h3>Sessões históricas</h3><span>{integer(rows.length)} eventos originais</span></div>
    {rows.length ? <><div className={styles.tableScroll}><table><thead><tr><th>ID original</th><th>Carregador</th><th>Início</th><th>Fim</th><th>kWh entregue</th><th>Valor simulado</th><th>Canal</th><th>Método</th><th>Resultado</th></tr></thead>
      <tbody>{visible.map(row => <tr key={row.sourceSessionId}><td>{row.sourceSessionId}</td><td>{row.sourceChargerId ?? '—'}</td><td>{dateTime(row.startTime)}</td><td>{dateTime(row.endTime)}</td><td>{decimal(row.deliveredKwh)}</td><td>{money(row.amount)}</td><td>{demoChannels.find(item => item.value === row.channel)?.label ?? '—'}</td><td>{demoMethods.find(item => item.value === row.method)?.label ?? '—'}</td><td>{row.status === 'COMPLETED' ? 'Atendida' : 'Não atendida'}</td></tr>)}</tbody></table></div>
      <div className={styles.pagination}><span>Página {page} de {pages}</span><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</button></div></>
      : <p className={styles.empty}>Nenhuma sessão demonstrativa neste recorte.</p>}
  </section>;
}

export function DemoStationDetail({ data }: { data: DemoStationHistory }) {
  return <div className={styles.content}>
    <div className={styles.sourceNote}><strong>Histórico demonstrativo · SIMULATED</strong><span>Valores financeiros fictícios calculados; nenhum pagamento ou recebimento real.</span>
      {data.batch ? <span>Dataset {data.batch.datasetKey} · {date(data.batch.periodStart)} a {date(data.batch.periodEnd)} · cenário {data.batch.scenarioVersion}</span> : <span>Nenhum lote importado para esta instalação.</span>}
      <span>GIE {data.station.gieStationId ?? 'sem identidade informada'} · perfil {data.station.gieProfile ?? 'não informado'}</span></div>
    <DemoSummaryCards summary={data.summary} />
    <div className={styles.twoColumns}>
      <DemoMonthly rows={data.monthly} />
      <DemoBarRows title="Uso por carregador" rows={data.chargers} label={row => row.sourceChargerId ?? (row.chargerId === null ? 'Carregador não identificado' : `Carregador ${row.chargerId}`)} value={row => row.sessions} valueLabel="recargas" />
      <DemoBarRows title="Horários de maior movimento" rows={data.hours} label={row => `${String(row.hour).padStart(2, '0')}h`} value={row => row.sessions} valueLabel="recargas" />
      <DemoBarRows title="Receita simulada por canal" rows={data.channels} label={row => demoChannels.find(item => item.value === row.channel)?.label ?? row.channel} value={row => row.revenueSimulated} valueLabel="R$" />
      <DemoBarRows title="Receita simulada por método" rows={data.methods} label={row => demoMethods.find(item => item.value === row.method)?.label ?? row.method} value={row => row.revenueSimulated} valueLabel="R$" />
    </div>
    <DemoEnergyChart readings={data.readings} />
    <DemoSessions rows={data.sessions} />
    <p className={styles.caption}>Esta visualização não permite iniciar recarga, faturar, quitar ou emitir comprovantes. <Link href="/stations/overview">Comparar instalações</Link></p>
  </div>;
}

export function DemoHistoryStation({ stationId }: { stationId: string }) {
  const [draft, setDraft] = useState<DemoHistoryFilters>({});
  const [filters, setFilters] = useState<DemoHistoryFilters>({});
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<DemoStationHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void api.demoHistoryStation(stationId, filters, revision > 0).then(result => {
      if (active) setData(result);
    }).catch(reason => {
      if (active) { setData(null); setError(reason instanceof Error ? reason.message : 'Não foi possível consultar o histórico demonstrativo.'); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [stationId, filters, revision]);
  return <div className={styles.root}>
    <DemoHistoryFilters value={draft} onChange={setDraft} onApply={() => setFilters({ ...draft })} onClear={() => { setDraft({}); setFilters({}); }} disabled={loading} />
    <div className={styles.refreshLine}><span>Somente histórico SIMULATED importado para esta instalação.</span><button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Atualizar</button></div>
    {loading ? <p className={styles.state} role="status">Carregando histórico demonstrativo...</p> : error ? <p className={styles.state} role="alert">{error}</p> : data ? <DemoStationDetail data={data} /> : null}
  </div>;
}
