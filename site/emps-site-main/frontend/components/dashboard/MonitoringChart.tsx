'use client';

import { memo, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ChartNoAxesCombined, Download, Grid2X2, Maximize, Minimize, Table2, X } from 'lucide-react';
import { compareGeneration, energyBuckets, energySeries, series, summarize, withGaps, type EnergyBucket, type MonitoringPeriod, type MonitorPoint, type PowerKey } from '@/domain/station-monitoring';
import styles from './station-dashboard.module.css';

export type ChartView = 'power' | 'energy' | 'generation' | 'ev' | 'heatmap';
export const chartViews: { id: ChartView; label: string }[] = [
  { id: 'power', label: 'Curva de potência' }, { id: 'energy', label: 'Monitoramento de energia' },
  { id: 'generation', label: 'Comparação de geração' }, { id: 'ev', label: 'Carregadores' }, { id: 'heatmap', label: 'Mapa de calor' },
];
const decimals = (value: number | null) => value === null ? '--' : value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const initiallyHiddenSeries = ['battery', 'grid', 'energy-imported', 'energy-exported', 'energy-charge', 'energy-discharge'];
const qualityName = (value?: string) => ({ GOOD: 'Válida', BAD: 'Inválida', MISSING: 'Lacuna', UNKNOWN: 'Não informada' } as Record<string, string>)[value ?? 'UNKNOWN'] ?? value;

export function csvCell(cell: string | number | null) {
  const value = typeof cell === 'string' && /^[\s]*[=+\-@]/.test(cell) ? "'" + cell : String(cell ?? '');
  return `"${value.replaceAll('"', '""')}"`;
}

function exportReadings(headers: string[], data: (string | number | null)[][], view: ChartView) {
  const rows = [['Origem', ...headers], ...data.map(row => ['Historico selecionado', ...row])];
  const blob = new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `emps-${view}-historico.csv`; link.click(); URL.revokeObjectURL(url);
}

export const MonitoringChart = memo(function MonitoringChart({ points, previousPoints, previousRange, comparisonLoading, comparisonError, comparisonTruncated, period, view, onView, controls, loading, error, periodLabel, range, timezone, energyBucketsOverride, previousEnergyBucketsOverride, totalsOverride, energyMethodLabel }: {
  points: MonitorPoint[]; view: ChartView; onView: (view: ChartView) => void; controls: React.ReactNode;
  loading: boolean; error: string; periodLabel: string;
  range: { from: number; to: number }; timezone: string;
  period: MonitoringPeriod; previousPoints: MonitorPoint[]; previousRange: { from: number; to: number };
  comparisonLoading: boolean; comparisonError: string; comparisonTruncated: boolean;
  energyBucketsOverride?: EnergyBucket[]; previousEnergyBucketsOverride?: EnergyBucket[];
  totalsOverride?: ReturnType<typeof summarize>; energyMethodLabel?: string;
}) {
  const [hidden, setHidden] = useState<string[]>(initiallyHiddenSeries);
  const [expanded, setExpanded] = useState(false);
  const [table, setTable] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const wrapper = useRef<HTMLElement>(null);
  const toggle = (key: string) => setHidden(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  const chartPoints = useMemo(() => withGaps(points), [points]);
  const energy = useMemo(() => energyBucketsOverride ?? energyBuckets(points, range, period, timezone), [energyBucketsOverride, points, range, period, timezone]);
  const previousEnergy = useMemo(() => view === 'generation' ? previousEnergyBucketsOverride ?? energyBuckets(previousPoints, previousRange, period, timezone) : [], [previousEnergyBucketsOverride, previousPoints, previousRange, period, timezone, view]);
  const comparison = useMemo(() => compareGeneration(energy, previousEnergy), [energy, previousEnergy]);
  const calendar = useMemo(() => view === 'heatmap' ? period === 'month' && energyBucketsOverride ? energyBucketsOverride : energyBuckets(points, range, 'month', timezone) : [], [energyBucketsOverride, points, range, period, timezone, view]);
  const totals = useMemo(() => totalsOverride ?? summarize(points), [totalsOverride, points]);
  const visible = (key: string) => !hidden.includes(key);
  const peak = (key: PowerKey, minimum = false) => {
    const values = points.map(point => point[key]).filter((n): n is number => n !== null);
    return values.length ? (minimum ? Math.min(...values) : Math.max(...values)) : null;
  };
  const minutes = (range.to - range.from) / 60_000;
  const hasDay = minutes <= 1500;
  const tick = (x: number) => new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, ...(hasDay ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit' }) }).format(range.from + x * 60_000);
  const domain: [number, number] = [0, minutes];
  const grid = <CartesianGrid vertical={false} stroke="var(--monitor-grid)" />;
  const axis = { axisLine: false, tickLine: false, tick: { fill: 'var(--monitor-muted)', fontSize: 11 }, width: 46 };
  const legend = (items: { key: string; label: string; color: string }[]) => <div className={styles.legend}>{items.map(item => <button type="button" aria-pressed={visible(item.key)} key={item.key} onClick={() => toggle(item.key)} style={{ opacity: visible(item.key) ? 1 : .4 }}><i style={{ background: item.color }} />{item.label}</button>)}</div>;
  const chartTooltip = <Tooltip content={({ active, payload }) => active && payload?.length ? <div className={styles.energyTooltip}><strong>{payload[0].payload.label}</strong>{payload.filter(item => item.value != null).map(item => <div key={String(item.dataKey)}><i style={{ background: item.color }} /><span>{item.name}</span><b>{decimals(Number(item.value))} <small>kW</small></b></div>)}<p>Fonte: {payload[0].payload.sourceLabel ?? periodLabel}</p><p>Qualidade: {qualityName(payload[0].payload.quality)} · {timezone}</p></div> : null} />;
  const hasData = view === 'generation' ? comparison.some(row => row.current !== null || row.previous !== null)
    : view === 'heatmap' ? calendar.some(row => row.charger !== null)
    : view === 'energy' || (view === 'ev' && period !== 'day') ? energy.some(row => (view === 'ev' ? row.charger !== null : energySeries.some(item => row[item.key] !== null)))
    : points.some(point => view === 'ev' ? point.charger !== null : series.some(item => point[item.key] !== null));
  const energyView = view === 'energy' || view === 'generation' || view === 'heatmap' || (view === 'ev' && period !== 'day');
  const periodName = (at: number) => new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, year: 'numeric', ...(period !== 'year' ? { month: '2-digit' } : {}), ...(period === 'day' || period === 'week' ? { day: '2-digit' } : {}) }).format(at);
  const generationSeries = [{ key: 'previous', label: periodName(previousRange.from), color: '#c4a01c' }, { key: 'current', label: periodName(range.from), color: '#8350b5' }];
  const tableHeaders = view === 'generation' ? ['Posição no período', ...generationSeries.map(item => `${item.label} (kWh)`), 'Fonte', 'Qualidade'] : energyView ? ['Data', ...energySeries.map(item => `${item.label} (kWh)`), 'Fonte', 'Qualidade'] : ['Data', ...series.map(item => `${item.label} (kW)`), 'SOC (%)', 'Fonte', 'Qualidade'];
  const dataSource = periodLabel;
  const integratedQuality = energyMethodLabel ?? 'Estimado por integração de intervalos válidos';
  const tableRows = useMemo<(string | number | null)[][]>(() => view === 'generation' ? comparison.map(row => [row.label, row.previous, row.current, dataSource, integratedQuality]) : energyView ? (view === 'heatmap' ? calendar : energy).map(row => [row.fullLabel, ...energySeries.map(item => row[item.key]), dataSource, integratedQuality]) : points.map(point => [new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(point.at), ...series.map(item => point[item.key]), point.soc, point.sourceLabel ?? dataSource, qualityName(point.quality)]), [view, comparison, energyView, calendar, energy, points, timezone, dataSource, integratedQuality]);
  const busy = loading || (view === 'generation' && comparisonLoading);
  const failure = error || (view === 'generation' && comparisonError);

  return <section ref={wrapper} tabIndex={-1} className={`${styles.panel} ${styles.chartPanel} ${expanded ? styles.expanded : ''}`} aria-label="Histórico de energia" onKeyDown={event => { if (event.key === 'Escape' && !dialog.current?.open) setExpanded(false); }}>
    <div className={styles.chartToolbar}>
      <div className={styles.segments} role="group" aria-label="Visualização do histórico">{chartViews.map(item => <button type="button" key={item.id} aria-pressed={view === item.id} onClick={() => onView(item.id)}>{view === item.id && (item.id === 'heatmap' ? <Grid2X2 size={14} /> : item.id === 'power' || item.id === 'ev' ? <Activity size={14} /> : <ChartNoAxesCombined size={14} />)}{item.label}</button>)}</div>
      <div className={styles.actions}>
        <button className={styles.iconButton} title="Tabela de dados" aria-label="Tabela de dados" type="button" onClick={() => { setTable(true); dialog.current?.showModal(); }}><Table2 size={17} /></button>
        <button className={styles.iconButton} title="Exportar dados CSV" aria-label="Exportar dados CSV" disabled={!hasData || busy || Boolean(failure)} type="button" onClick={() => exportReadings(tableHeaders, tableRows, view)}><Download size={17} /></button>
        <button className={styles.iconButton} title={expanded ? 'Recolher gráfico' : 'Ampliar gráfico'} aria-label={expanded ? 'Recolher gráfico' : 'Ampliar gráfico'} aria-pressed={expanded} type="button" onClick={() => { setExpanded(!expanded); wrapper.current?.focus(); }}>{expanded ? <Minimize size={18} /> : <Maximize size={18} />}</button>
      </div>
    </div>
    <div className={styles.chartControls}><span className={styles.provenance}>{periodLabel}</span>{controls}</div>
    {view === 'power' && <div className={styles.peakStrip}>
      {series.filter(item => visible(item.key)).map(item => <div key={item.key}><strong>{decimals(peak(item.key))} <small>kW</small></strong><span>{item.label}</span></div>)}
    </div>}
    {view === 'energy' && <div className={styles.peakStrip}>{energySeries.filter(item => visible(`energy-${item.key}`)).map(item => <div key={item.key}><strong>{decimals(totals[item.key])} <small>kWh</small></strong><span>{item.label}</span></div>)}</div>}
    {view === 'generation' && comparisonTruncated && <p className={styles.footnote} role="status">Comparação parcial: reduza o período para consultar todas as leituras.</p>}
    {busy ? <div className={styles.empty} role="status">Carregando histórico...</div> : failure ? <div className={styles.empty} role="alert">{failure}</div> : !hasData ? <div className={styles.empty}><Table2 size={30} /><strong>Sem leituras neste período</strong><span>Histórico de energia indisponível para a fonte selecionada.</span></div> : <>
      {view === 'power' && <>
        <div className={styles.axisCaption}><span>Potência · kW</span><span title="Rede: importação positiva, exportação negativa. Bateria: descarga positiva, carga negativa.">Rede: importação (+) · bateria: descarga (+)</span></div>
        <div className={styles.largeChart}><ResponsiveContainer width="100%" height="100%"><LineChart data={chartPoints} margin={{ left: 4, right: 16, top: 14, bottom: 8 }}>
          {grid}<XAxis {...axis} dataKey="x" type="number" domain={domain} ticks={hasDay ? [0, 240, 480, 720, 960, 1200, 1440] : undefined} tickFormatter={value => value === 1440 && hasDay ? '24:00' : tick(value)} minTickGap={30} /><YAxis {...axis} domain={['auto', 'auto']} /><ReferenceLine y={0} stroke="var(--monitor-border)" />{chartTooltip}
          {series.map(item => <Line key={item.key} hide={!visible(item.key)} dataKey={item.key} name={item.label} stroke={item.color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />)}
        </LineChart></ResponsiveContainer></div>
        {legend([...series])}
      </>}
      {(view === 'energy' || view === 'generation' || (view === 'ev' && period !== 'day')) && <>
        <div className={styles.axisCaption}><span>kWh</span></div>
        <div className={styles.barScroll} tabIndex={0} aria-label="Gráfico de energia por período"><div className={styles.largeChart} style={{ minWidth: (view === 'energy' ? energy.length * 48 : energy.length * 24) + 60 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={view === 'generation' ? comparison : energy} barGap={1} barCategoryGap="15%" maxBarSize={8} margin={{ left: 8, right: 16, top: 14, bottom: 8 }}>
          {grid}<XAxis {...axis} dataKey="label" minTickGap={24} height={30} /><YAxis {...axis} domain={[0, 'auto']} tickCount={6} tickFormatter={value => decimals(Number(value))} />
          <Tooltip cursor={{ fill: 'var(--monitor-grid)' }} content={({ active, payload }) => active && payload?.length ? <div className={styles.energyTooltip}><strong>{view === 'generation' ? 'Geração solar' : payload[0].payload.fullLabel}</strong>{payload.filter(item => item.value != null).map(item => <div key={String(item.dataKey)}><i style={{ background: item.color }} /><span>{view === 'generation' ? item.payload[item.dataKey === 'current' ? 'currentDate' : 'previousDate'] ?? item.name : item.name}</span><b>{decimals(Number(item.value))} <small>kWh</small></b></div>)}<p>Fonte: {dataSource}</p><p>{integratedQuality} · {timezone}</p></div> : null} />
          {(view === 'generation' ? generationSeries : view === 'ev' ? energySeries.filter(item => item.key === 'charger') : energySeries).map(item => <Bar key={item.key} hide={!visible(`energy-${item.key}`)} dataKey={item.key} name={item.label} fill={item.color} maxBarSize={8} radius={[3, 3, 0, 0]} isAnimationActive={false} />)}
        </BarChart></ResponsiveContainer></div></div>
        {legend((view === 'generation' ? generationSeries : view === 'ev' ? energySeries.filter(item => item.key === 'charger') : energySeries).map(item => ({ ...item, key: `energy-${item.key}` })))}
      </>}
      {view === 'ev' && period === 'day' && <><div className={styles.axisCaption}><span>Potência total dos carregadores · kW</span></div><div className={styles.largeChart}><ResponsiveContainer width="100%" height="100%"><LineChart data={chartPoints} margin={{ left: 8, right: 16, top: 14, bottom: 8 }}>{grid}<XAxis {...axis} dataKey="x" type="number" domain={domain} ticks={hasDay ? [0, 240, 480, 720, 960, 1200, 1440] : undefined} tickFormatter={value => value === 1440 && hasDay ? '24:00' : tick(value)} minTickGap={24} /><YAxis {...axis} domain={[0, 'auto']} />{chartTooltip}<Line hide={!visible('ev-charger')} dataKey="charger" name="Potência dos carregadores" stroke="#ef8e5b" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>{legend([{ key: 'ev-charger', label: 'Carregadores', color: '#ef8e5b' }])}</>}
      {view === 'heatmap' && <Heatmap days={calendar} />}
    </>}
    {view === 'ev' && <p className={styles.insightNote}>Alocação por carregador indisponível. Setpoints do GIE não são potência medida.</p>}
    {view === 'power' && hasData && !series.some(item => visible(item.key) && points.some(point => point[item.key] !== null)) && <p className={styles.insightNote}>Sem leituras nas curvas selecionadas.</p>}
    <dialog ref={dialog} className={styles.dialog} aria-label="Tabela de leituras" onClose={() => setTable(false)}>
      <div className={styles.panelHeading}><h2>Leituras · fonte selecionada</h2><button type="button" className={styles.iconButton} aria-label="Fechar tabela" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      {table && <div className={styles.tableScroll}><table><thead><tr>{tableHeaders.map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{tableRows.slice(0, 500).map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{typeof value === 'string' ? value : decimals(value)}</td>)}</tr>)}</tbody></table>{!hasData && <p className={styles.empty}>Sem leituras.</p>}{tableRows.length > 500 && <p>Exibindo 500 leituras. O CSV contém todas as leituras carregadas.</p>}</div>}
    </dialog>
  </section>;
});

function Heatmap({ days }: { days: EnergyBucket[] }) {
  const values = days.flatMap(day => day.charger === null ? [] : [day.charger]);
  const min = values.length ? Math.min(...values) : null, max = values.length ? Math.max(...values) : null;
  const offset = days.length ? (new Date(`${days[0].day}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;
  return <div className={styles.heatmap}>
    <div className={styles.heatScale}><span>Energia dos carregadores · kWh</span><span>Mín. {decimals(min)}</span><i /><span>{decimals(max)} Máx.</span></div>
    <div className={styles.calendarGrid}>{['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(label => <span className={styles.calendarHeading} key={label}>{label}</span>)}
      {Array.from({ length: offset }, (_, i) => <span key={`offset-${i}`} />)}
      {days.map(day => <div className={styles.calendarCell} key={day.day} data-empty={day.charger === null} title={`${day.fullLabel}: ${day.charger === null ? 'sem leitura' : decimals(day.charger) + ' kWh estimados'}`}><span>{day.label}</span>{day.charger !== null && <div style={{ background: `hsl(110 48% ${max === min || min === null || max === null ? 44 : 22 + (day.charger - min) / (max - min) * 30}%)` }}><span>{decimals(day.charger)}</span></div>}</div>)}
    </div>
  </div>;
}
