'use client';

import { NavigationLink as Link } from '@/components/shell/NavigationLink';
import { useCallback, useEffect, useMemo, useState, type ReactNode, type SetStateAction } from 'react';
import { ArrowLeft, BatteryCharging, Bell, Box, Cable, ChevronRight, CircleDollarSign, Droplets, House, Info, Network, RefreshCw, Search, Settings2, Sun, UtilityPole, Zap } from 'lucide-react';
import { EnergyFlowStation } from '@/components/energy/EnergyFlowStation';
import { ChargerVisualBoard } from '@/components/chargers/ChargerVisualBoard';
import { StatusBadge } from '@/components/status/StatusBadge';
import type { Charger, DashboardData, EnergyFlowTelemetry } from '@/domain/emps';
import type { GieState } from '@/domain/gie';
import { dateWindow, isNonSimulatedReading, localDay, normalizeReadings, numeric, previousMonitoringWindow, safeTimezone, sourceKey, summarize, type MonitoringPeriod } from '@/domain/station-monitoring';
import { api, selectedStation } from '@/services/emps-api';
import { formatCurrency, formatKwh, formatMinutes } from '@/utils/formatters';
import { EnergyDiagram } from './EnergyDiagram';
import { MonitoringChart, type ChartView } from './MonitoringChart';
import { useStationHistory } from './use-station-history';
import { useStationWeather } from './use-station-weather';
import { WeatherPopover } from './WeatherPopover';
import { DateControl } from './DateControl';
import { StationNotices } from './StationNotices';
import { StationFinancialSummary } from './StationFinancialSummary';
import styles from './station-dashboard.module.css';

export type StationInfo = { id: string | number; name: string; timezone?: string; status?: string; visibility?: string; city?: string; state?: string; latitude?: unknown; longitude?: unknown };
type Tab = 'dashboard' | 'devices' | 'alarms' | 'intelligence';
const tabs: { id: Tab; label: string }[] = [{ id: 'dashboard', label: 'Dashboard' }, { id: 'devices', label: 'Dispositivos' }, { id: 'alarms', label: 'Alarmes' }, { id: 'intelligence', label: 'Inteligência' }];
const number = (value: number | null | undefined, digits = 2) => value == null ? '--' : value.toLocaleString('pt-BR', { maximumFractionDigits: digits });
const provenanceName = (value?: string) => ({ MEASURED: 'Medido', IMPORTED: 'Importado', SIMULATED: 'Simulado', CALCULATED: 'Calculado', FORECAST: 'Previsão', UNKNOWN: 'Origem não informada' })[value ?? 'UNKNOWN'] ?? value;

export function StationDashboard({ stationId: requestedStationId, initialStation, data, telemetry, gieMode, gieState, gieControls, onChargersChange, onRefresh }: {
  stationId?: string;
  initialStation?: StationInfo;
  data: DashboardData; telemetry: EnergyFlowTelemetry; gieControls: ReactNode;
  gieMode?: string;
  gieState?: GieState | null;
  onChargersChange: (update: SetStateAction<Charger[]>) => void; onRefresh: () => void;
}) {
  const [legacyStationId] = useState(() => selectedStation.get() ?? '');
  const stationId = requestedStationId ?? legacyStationId;
  const [station, setStation] = useState<StationInfo | null>(initialStation ?? null);
  const [stationError, setStationError] = useState('');
  const [tab, setTab] = useState<Tab>('dashboard');
  const [scene, setScene] = useState(true);
  const [chartView, setChartView] = useState<ChartView>('power');
  const [day, setDay] = useState(() => localDay(new Date(), 'America/Sao_Paulo'));
  const [period, setPeriod] = useState<MonitoringPeriod>('day');
  const [source, setSource] = useState('');
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const timezone = safeTimezone(station?.timezone);
  const forecast = useStationWeather(station?.latitude, station?.longitude, timezone);
  const weather = forecast.weather;
  const window = useMemo(() => dateWindow(day, period, timezone), [day, period, timezone]);
  const history = useStationHistory(stationId, window.from, window.to, revision);
  const previousWindow = useMemo(() => previousMonitoringWindow(day, period, timezone), [day, period, timezone]);
  const previousHistory = useStationHistory(chartView === 'generation' ? stationId : '', previousWindow.from, previousWindow.to, revision);
  const historyRows = useMemo(() => history.rows.filter(isNonSimulatedReading), [history.rows]);
  const previousRows = useMemo(() => previousHistory.rows.filter(isNonSimulatedReading), [previousHistory.rows]);
  useEffect(() => {
    if (initialStation && String(initialStation.id) === stationId) {
      setStation(initialStation); setDay(localDay(new Date(), safeTimezone(initialStation.timezone)));
      return;
    }
    const abort = new AbortController();
    void api.platform<StationInfo>(`/v2/stations/${encodeURIComponent(stationId)}`, { signal: abort.signal }).then(info => {
      if (abort.signal.aborted) return;
      setStation(info); setDay(localDay(new Date(), safeTimezone(info.timezone)));
    }).catch(error => { if (!abort.signal.aborted) setStationError(error instanceof Error ? error.message : 'Instalação indisponível.'); });
    return () => abort.abort();
  }, [stationId, initialStation]);
  const sources = useMemo(() => [...new Map([...historyRows, ...previousRows].map(row => [sourceKey(row), { key: sourceKey(row), label: `${row.source?.label ?? 'Histórico'} · ${provenanceName(row.provenance)}`, measured: row.provenance === 'MEASURED' }])).values()].sort((a, b) => Number(b.measured) - Number(a.measured)), [historyRows, previousRows]);
  const currentSource = sources.some(item => item.key === source) ? source : sources[0]?.key;
  const points = useMemo(() => normalizeReadings(historyRows.filter(row => sourceKey(row) === currentSource), timezone, window.from), [timezone, historyRows, currentSource, window.from]);
  const previousPoints = useMemo(() => normalizeReadings(previousRows.filter(row => sourceKey(row) === currentSource), timezone, previousWindow.from), [timezone, previousRows, currentSource, previousWindow.from]);
  const totals = useMemo(() => summarize(points), [points]);
  const latestReading = useMemo(() => historyRows.reduce<typeof historyRows[number] | undefined>((latest, row) =>
    sourceKey(row) === currentSource && row.measurementQuality === 'GOOD' && (!latest || Date.parse(row.measuredAt) > Date.parse(latest.measuredAt)) ? row : latest, undefined), [historyRows, currentSource]);
  const liveWeather = latestReading && Date.now() - Date.parse(latestReading.measuredAt) < 3_600_000 && Date.now() >= Date.parse(latestReading.measuredAt) ? latestReading : null;
  const changeView = useCallback((view: ChartView) => { setChartView(view); if (view === 'power' || view === 'ev') setPeriod('day'); else if (view === 'generation') setPeriod('year'); else if (view === 'heatmap') setPeriod('month'); else if (view === 'energy') setPeriod('week'); }, []);
  const refresh = () => { setRevision(value => value + 1); onRefresh(); };
  const controlNodes = useMemo(() => Object.fromEntries(['Visão geral', 'Histórico'].map(label =>
    [label, <DateControl key={label} day={day} period={period} timezone={timezone} onDay={setDay} onPeriod={setPeriod} label={label} />])), [day, period, timezone]);
  const dateControls = (label: string) => controlNodes[label];
  const active = data.carregadores.filter(charger => charger.status === 'em_uso').length;
  const available = data.carregadores.filter(charger => charger.status === 'disponivel').length;
  const telemetryAt = Date.parse(telemetry?.updatedAt ?? '');
  const soc = numeric(telemetry.batterySocPercent);
  const currentSoc = Number.isFinite(telemetryAt) && now >= telemetryAt && now - telemetryAt < 300_000 && soc !== null && soc >= 0 && soc <= 100 ? soc : null;
  const powerTotal = telemetry?.chargerPowerKw;

  return <div className={styles.root}>
    <nav className={styles.breadcrumb} aria-label="Navegação da instalação"><Link href="/stations">Minhas instalações</Link><ChevronRight size={12} aria-hidden="true" /><span>Painel da instalação</span></nav>
    <div className={styles.stationHeader}><Link href="/stations" aria-label="Voltar para minhas instalações" title="Voltar para minhas instalações"><ArrowLeft size={23} /></Link><span className={styles.privateBadge}>{station?.visibility === 'PUBLIC' ? 'Pública' : 'Privada'}</span><h1>{station?.name ?? 'Instalação EMPS'}</h1><span className={styles.statusBadge} data-active={station?.status === 'ACTIVE'}>{({ ACTIVE: 'Em operação', DRAFT: 'Rascunho', PENDING: 'Aguardando', SUSPENDED: 'Suspensa', REJECTED: 'Rejeitada', ARCHIVED: 'Arquivada' } as Record<string, string>)[station?.status ?? ''] ?? station?.status ?? 'Carregando'}</span><span className={styles.networkBadge}><Cable size={12} /> GIE</span></div>
    <div className={styles.stationActions}><Link href={`/stations/${stationId}`} title="Cadastro e configurações da instalação"><Settings2 size={15} aria-hidden="true" />Configurações da instalação</Link></div>
    {stationError && <p role="alert">{stationError}</p>}
    <div className={styles.mainTabs} role="tablist" aria-label="Monitoramento da instalação">{tabs.map(item => <button key={item.id} id={`monitor-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`monitor-panel-${item.id}`} onClick={() => setTab(item.id)}>{item.label}{item.id === 'alarms' && data.alertas.some(alert => alert.status !== 'resolvido') && <span className={styles.alertCount}>{data.alertas.filter(alert => alert.status !== 'resolvido').length}</span>}</button>)}</div>
    {tab === 'dashboard' && <div id="monitor-panel-dashboard" role="tabpanel" aria-labelledby="monitor-tab-dashboard">
      <div className={styles.weatherLine}><div><WeatherPopover forecast={forecast} timezone={timezone} city={`${station?.city ?? ''}${station?.state ? `, ${station.state}` : ''}`} measuredTemperature={numeric(liveWeather?.outsideTemperatureC)} measuredHumidity={numeric(liveWeather?.relativeHumidityPercent)} /><span><Droplets size={13} /> {number(numeric(liveWeather?.relativeHumidityPercent) ?? weather?.humidity, 0)}%</span>{weather && <span>Vento {number(weather.wind, 0)} km/h</span>}<span>{station?.city}{station?.state ? `, ${station.state}` : ''}</span>{liveWeather ? <span>Clima medido</span> : !weather && <span>Clima indisponível</span>}</div><div><span>Atualização: {telemetry?.updatedAt ? new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(telemetry.updatedAt)) : '--'}</span><button className={styles.iconButton} type="button" aria-label="Atualizar painel" title="Atualizar painel" onClick={refresh}><RefreshCw size={17} /></button></div></div>
      <div className={styles.topGrid}>
        <section className={styles.flowSection} aria-label="Fluxo de energia">
          <div className={styles.flowToolbar}><span>Fluxo de energia do eletroposto</span><div className={styles.segments} role="group" aria-label="Visualização do fluxo"><button type="button" title="Cena do eletroposto" aria-label="Cena do eletroposto" aria-pressed={scene} onClick={() => setScene(true)}><Box size={18} /></button><button type="button" title="Diagrama de energia" aria-label="Diagrama de energia" aria-pressed={!scene} onClick={() => setScene(false)}><Network size={18} /></button></div></div>
          <div className={styles.flowCanvas}>{scene ? <EnergyFlowStation chargers={data.carregadores} telemetry={telemetry} simulation={false} /> : <EnergyDiagram telemetry={telemetry} />}</div>
          <div className={styles.flowFoot}><span><Zap size={14} /> {number(powerTotal)} kW nos carregadores</span>{gieMode && <span title="Saída calculada pelo motor GIE; não representa confirmação de medição física.">GIE · {gieMode === 'NORMAL' ? 'Normal demonstrativo' : gieMode === 'PRESENTATION' ? 'Apresentação' : gieMode === 'MANUAL_DEMO' ? 'Demonstração manual' : 'Simulação'}</span>}<span>{active} / {data.carregadores.length} em uso</span></div>
        </section>
        <div className={styles.overviewColumn}>
          <section className={`${styles.panel} ${styles.overviewPanel}`} aria-label="Visão geral" aria-busy={history.loading}><div className={styles.overviewHeader}><h2><House size={18} />Visão geral <Info size={14}><title>Energia estimada pela integração das leituras disponíveis, sem preencher lacunas.</title></Info></h2>{dateControls('Visão geral')}</div>
            <div className={styles.overviewMetrics}>{([
              ['Geração solar', totals.solar, 'kWh', Sun, '#6fba66'], ['Energia nos carregadores', totals.charger, 'kWh', Zap, '#e7aa54'],
              ['Importação da rede', totals.imported, 'kWh', UtilityPole, '#e2955b'], ['SoC da bateria · atual', currentSoc, '%', BatteryCharging, '#6fba66'],
              ['Consumo do prédio', totals.load, 'kWh', House, '#c58be1'], ['Disponíveis / em uso · atual', `${available} / ${active}`, '', Cable, '#5ba4d0'],
            ] as const).map(([label, val, unit, Icon, color]) => <div key={label}><Icon size={20} style={{ color }} /><div><strong data-unknown={val === null}>{val === null ? 'Sem dados' : typeof val === 'string' ? val : number(val)} {val !== null && <small>{unit}</small>}</strong><span>{label}</span></div></div>)}</div>
            <p className={styles.insightNote}>{sources.find(item => item.key === currentSource)?.label ?? 'Histórico indisponível'} · kWh estimados no período por integração de leituras válidas.</p>
          </section>
          <StationNotices alerts={data.alertas} stationId={stationId} timezone={timezone} now={now} gie={gieState} onAll={() => setTab('alarms')} />
        </div>
      </div>
      <div className={styles.historySource}><label>Fonte <select aria-label="Fonte do histórico" value={currentSource ?? ''} onChange={event => setSource(event.target.value)}><option value="">Dados da instalação</option>{sources.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>{history.truncated && <span role="status">Período parcial: reduza o intervalo para consultar todas as leituras.</span>}<span>{timezone}</span></div>
      <div className={styles.bottomGrid}>
        <MonitoringChart points={points} previousPoints={previousPoints} previousRange={previousWindow} comparisonLoading={previousHistory.loading} comparisonError={previousHistory.error} comparisonTruncated={previousHistory.truncated} period={period} view={chartView} onView={changeView} controls={dateControls('Histórico')} loading={history.loading} error={history.error} periodLabel={sources.find(item => item.key === currentSource)?.label ?? 'Histórico da instalação'} range={window} timezone={timezone} />
        <StationFinancialSummary records={data.financeRecords} timezone={timezone} now={now} updatedAt={data.updatedAt} />
      </div>
      <div className={styles.operationalStrip}>{[[BatteryCharging, 'Sessões ativas', String(data.resumo.sessoesAtivas)], [BatteryCharging, 'Ocupação atual', `${data.carregadores.length ? number(active / data.carregadores.length * 100, 0) : '0'}%`], [Zap, 'Disponíveis', String(available)], [CircleDollarSign, 'Ticket · sessões encerradas', formatCurrency(data.resumo.ticketMedio)]].map(([Icon, label, val]) => { const Symbol = Icon as typeof Zap; return <div key={String(label)}><Symbol size={20} /><span>{String(label)}</span><strong>{String(val)}</strong></div>; })}</div>
    </div>}
    {tab === 'devices' && <section id="monitor-panel-devices" role="tabpanel" aria-labelledby="monitor-tab-devices" className={styles.panel}><div className={styles.panelHeading}><h2>Carregadores da instalação</h2><span>{data.carregadores.length} dispositivos</span></div><ChargerVisualBoard chargers={data.carregadores} onChargersChange={onChargersChange} scrollAfter={6} /><SessionTable data={data} /></section>}
    {tab === 'alarms' && <section id="monitor-panel-alarms" role="tabpanel" aria-labelledby="monitor-tab-alarms" className={styles.panel}><AlarmTable data={data} timezone={timezone} /></section>}
    <section id="monitor-panel-intelligence" role="tabpanel" aria-labelledby="monitor-tab-intelligence" hidden={tab !== 'intelligence'} className={styles.panel}><div className={styles.panelHeading}><h2>Distribuição inteligente</h2></div>{gieControls}</section>
  </div>;
}

function SessionTable({ data }: { data: DashboardData }) {
  const [query, setQuery] = useState('');
  const filtered = data.sessoes.filter(session => `${session.sessaoId} ${session.usuarioNome} ${session.carregadorNome}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <><div className={styles.panelHeading}><h2>Sessões recentes</h2><label className={styles.search}><Search size={16} /><input type="search" aria-label="Buscar sessões" placeholder="ID, cliente ou carregador" value={query} onChange={event => setQuery(event.target.value)} /></label></div><div className={styles.tableScroll}><table><thead><tr>{['Sessão', 'Cliente', 'Carregador', 'Duração', 'Energia', 'Valor', 'Status'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{filtered.map(session => <tr key={session.sessaoId}><td>{session.sessaoId}</td><td>{session.usuarioNome}</td><td>{session.carregadorNome}</td><td>{formatMinutes(session.duracaoMinutos)}</td><td>{formatKwh(session.energiaKwh)}</td><td>{formatCurrency(session.valorTotal)}</td><td><StatusBadge status={session.status} /></td></tr>)}</tbody></table>{!filtered.length && <p className={styles.empty}>Nenhuma sessão encontrada.</p>}</div></>;
}

function AlarmTable({ data, timezone }: { data: DashboardData; timezone: string }) {
  const formatDateTime = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'Data indisponível';
  const [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [severity, setSeverity] = useState('all');
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const matching = data.alertas.filter(alert => `${alert.titulo} ${alert.carregadorNome ?? ''} ${alert.origem}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (severity === 'all' || severity === alert.severidade) && (!from || (Number.isFinite(Date.parse(alert.dataCriacao)) && localDay(new Date(alert.dataCriacao), timezone) >= from)) && (!to || (Number.isFinite(Date.parse(alert.dataCriacao)) && localDay(new Date(alert.dataCriacao), timezone) <= to)));
  const filtered = matching.filter(alert => filter === 'all' || (filter === 'open' ? alert.status !== 'resolvido' : alert.status === 'resolvido'));
  return <><div className={styles.alarmFilters}><label className={styles.search}><Search size={16} /><input type="search" aria-label="Buscar alarmes" placeholder="Alarme ou dispositivo" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Severidade" value={severity} onChange={event => setSeverity(event.target.value)}><option value="all">Todas as severidades</option>{['baixa', 'media', 'alta', 'critica'].map(value => <option key={value}>{value}</option>)}</select><input type="date" aria-label="Alarmes: data inicial" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} /><input type="date" aria-label="Alarmes: data final" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /><button className={styles.iconButton} title="Limpar filtros" aria-label="Limpar filtros de alarmes" type="button" onClick={() => { setFilter('all'); setQuery(''); setSeverity('all'); setFrom(''); setTo(''); }}><RefreshCw size={16} /></button></div><div className={styles.alarmTabs}>{[['all', 'Todos', matching.length], ['open', 'Em ocorrência', matching.filter(alert => alert.status !== 'resolvido').length], ['resolved', 'Resolvidos', matching.filter(alert => alert.status === 'resolvido').length]].map(([id, label, count]) => <button type="button" aria-pressed={filter === id} onClick={() => setFilter(String(id))} key={id}>{label} ({count})</button>)}</div><div className={styles.tableScroll}><table><thead><tr>{['Nome do alarme', 'Dispositivo', 'Status', 'Severidade', 'Data de ocorrência', 'Origem', 'Descrição'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{filtered.map(alert => <tr key={alert.alertaId}><td>{alert.titulo}</td><td>{alert.carregadorNome ?? '--'}</td><td><StatusBadge status={alert.status} /></td><td><StatusBadge status={alert.severidade} /></td><td>{formatDateTime(alert.dataCriacao)}</td><td>{alert.origem}</td><td>{alert.descricao}</td></tr>)}</tbody></table>{!filtered.length && <div className={styles.empty}><Bell size={30} /><span>Nenhum alarme encontrado.</span></div>}</div><p className={styles.footnote}>Alarmes retornados pelo painel operacional da instalação.</p></>;
}
