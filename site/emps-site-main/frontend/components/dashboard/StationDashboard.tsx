'use client';

import { NavigationLink as Link } from '@/components/shell/NavigationLink';
import { useCallback, useEffect, useMemo, useState, type ReactNode, type SetStateAction } from 'react';
import { ArrowLeft, BatteryCharging, Bell, Box, Cable, ChevronRight, CircleDollarSign, Droplets, House, Info, Network, RefreshCw, Search, Settings2, Sun, UtilityPole, Zap } from 'lucide-react';
import { EnergyFlowStation } from '@/components/energy/EnergyFlowStation';
import { ChargerVisualBoard } from '@/components/chargers/ChargerVisualBoard';
import { MaqueteLabControls } from '@/components/chargers/MaqueteLabControls';
import { StatusBadge } from '@/components/status/StatusBadge';
import type { Alert, Charger, DashboardData, EnergyFlowTelemetry } from '@/domain/emps';
import { energyFromGie, gieBatteriesById, simulatedFlowGie, type GieState } from '@/domain/gie';
import { dateWindow, isNonSimulatedReading, localDay, normalizeReadings, numeric, previousMonitoringWindow, safeTimezone, shiftDay, sourceKey, summarize, type MonitoringPeriod } from '@/domain/station-monitoring';
import { demoEnergyBuckets, demoEnergyTotals, demoPowerPoints } from '@/domain/demo-monitoring';
import { demoChargerCardHistory, sourceLocalDay } from '@/domain/demo-history';
import type { DemoStationHistory } from '@/domain/demo-history';
import { api, isDemoMode, isOfficialTestBridge, isReadOnlyMode, selectedStation } from '@/services/emps-api';
import { formatCurrency, formatKwh, formatMinutes } from '@/utils/formatters';
import { EnergyDiagram } from './EnergyDiagram';
import { MonitoringChart, type ChartView } from './MonitoringChart';
import { useStationHistory } from './use-station-history';
import { useDemoStationAnalytics, useDemoStationHistory } from './use-demo-station-data';
import { useStationWeather } from './use-station-weather';
import { WeatherPopover } from './WeatherPopover';
import { DateControl } from './DateControl';
import { StationNotices } from './StationNotices';
import { StationFinancialSummary } from './StationFinancialSummary';
import { DemoHistoryStation } from '@/components/demo-history/DemoHistoryViews';
import styles from './station-dashboard.module.css';

export type StationInfo = { id: string | number; name: string; timezone?: string; status?: string; visibility?: string; city?: string; state?: string; latitude?: unknown; longitude?: unknown; membershipRole?: string;
  batteries?: { status?: string }[]; gieBinding?: { profile?: string } | null };
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
  const [context, setContext] = useState<'operational' | 'demo'>('operational');
  const [scene, setScene] = useState(true);
  const [operationalChartView, setOperationalChartView] = useState<ChartView>('power');
  const [demoChartView, setDemoChartView] = useState<ChartView>('energy');
  const [operationalDay, setOperationalDay] = useState(() => localDay(new Date(), 'America/Sao_Paulo'));
  const [demoDay, setDemoDay] = useState('');
  const [operationalPeriod, setOperationalPeriod] = useState<MonitoringPeriod>('day');
  const [demoPeriod, setDemoPeriod] = useState<MonitoringPeriod>('month');
  const [demoSeedError, setDemoSeedError] = useState('');
  const [source, setSource] = useState('');
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const timezone = safeTimezone(station?.timezone);
  const isDemo = context === 'demo';
  const day = isDemo ? demoDay || operationalDay : operationalDay;
  const period = isDemo ? demoPeriod : operationalPeriod;
  const chartView = isDemo ? demoChartView : operationalChartView;
  const setDay = isDemo ? setDemoDay : setOperationalDay;
  const setPeriod = isDemo ? setDemoPeriod : setOperationalPeriod;
  const forecast = useStationWeather(station?.latitude, station?.longitude, timezone);
  const weather = forecast.weather;
  const window = useMemo(() => dateWindow(day, period, timezone), [day, period, timezone]);
  const demoFrom = window.first, demoTo = shiftDay(window.end, -1);
  const demoStationId = isDemo && demoDay ? stationId : '';
  const demoAnalytics = useDemoStationAnalytics(demoStationId, demoFrom, demoTo, period, revision);
  const demoHistory = useDemoStationHistory(demoStationId, { from: demoFrom, to: demoTo }, revision);
  const history = useStationHistory(isDemo ? '' : stationId, window.from, window.to, revision);
  const previousWindow = useMemo(() => previousMonitoringWindow(day, period, timezone), [day, period, timezone]);
  const previousHistory = useStationHistory(!isDemo && chartView === 'generation' ? stationId : '', previousWindow.from, previousWindow.to, revision);
  const previousAnalytics = useDemoStationAnalytics(isDemo && chartView === 'generation' && demoDay ? stationId : '', previousWindow.first, shiftDay(previousWindow.end, -1), period, revision);
  const historyRows = useMemo(() => history.rows.filter(isNonSimulatedReading), [history.rows]);
  const previousRows = useMemo(() => previousHistory.rows.filter(isNonSimulatedReading), [previousHistory.rows]);
  useEffect(() => {
    if (initialStation && String(initialStation.id) === stationId) {
      setStation(initialStation); setOperationalDay(localDay(new Date(), safeTimezone(initialStation.timezone))); setDemoDay('');
      return;
    }
    const abort = new AbortController();
    void api.platform<StationInfo>(`/v2/stations/${encodeURIComponent(stationId)}`, { signal: abort.signal }).then(info => {
      if (abort.signal.aborted) return;
      setStation(info); setOperationalDay(localDay(new Date(), safeTimezone(info.timezone))); setDemoDay('');
    }).catch(error => { if (!abort.signal.aborted) setStationError(error instanceof Error ? error.message : 'Instalação indisponível.'); });
    return () => abort.abort();
  }, [stationId, initialStation]);
  useEffect(() => {
    if (!isDemo || !stationId || demoDay) return;
    let active = true;
    setDemoSeedError('');
    const today = localDay(new Date(), timezone);
    void api.demoHistoryStation(stationId, { from: today, to: today }).then(result => {
      if (!active) return;
      const last = result.batch?.periodEnd ? sourceLocalDay(result.batch.periodEnd) : today;
      setDemoDay(last || today);
    }).catch(error => { if (active) { setDemoSeedError(error instanceof Error ? error.message : 'Não foi possível localizar o período demonstrativo.'); setDemoDay(today); } });
    return () => { active = false; };
  }, [isDemo, stationId, demoDay, timezone]);
  const operationalSources = useMemo(() => [...new Map([...historyRows, ...previousRows].map(row => [sourceKey(row), { key: sourceKey(row), label: `${row.source?.label ?? 'Histórico'} · ${provenanceName(row.provenance)}`, measured: row.provenance === 'MEASURED' }])).values()].sort((a, b) => Number(b.measured) - Number(a.measured)), [historyRows, previousRows]);
  const demoSource = demoAnalytics.data?.source;
  const sources = isDemo ? demoSource ? [{ key: `demo:${demoSource.batchId}`, label: `${demoSource.datasetKey} · SIMULATED`, measured: false }] : [] : operationalSources;
  const currentSource = isDemo ? sources[0]?.key : sources.some(item => item.key === source) ? source : sources[0]?.key;
  const sourceTimezone = isDemo ? safeTimezone(demoSource?.timezone ?? timezone) : timezone;
  const points = useMemo(() => isDemo ? demoPowerPoints(demoAnalytics.data, window.from, sourceTimezone)
    : normalizeReadings(historyRows.filter(row => sourceKey(row) === currentSource), timezone, window.from), [isDemo, demoAnalytics.data, sourceTimezone, timezone, historyRows, currentSource, window.from]);
  const previousPoints = useMemo(() => isDemo ? demoPowerPoints(previousAnalytics.data, previousWindow.from, sourceTimezone)
    : normalizeReadings(previousRows.filter(row => sourceKey(row) === currentSource), timezone, previousWindow.from), [isDemo, previousAnalytics.data, sourceTimezone, timezone, previousRows, currentSource, previousWindow.from]);
  const totals = useMemo(() => isDemo ? demoEnergyTotals(demoAnalytics.data) : summarize(points), [isDemo, demoAnalytics.data, points]);
  const demoBuckets = useMemo(() => demoEnergyBuckets(demoAnalytics.data, sourceTimezone), [demoAnalytics.data, sourceTimezone]);
  const demoPreviousBuckets = useMemo(() => demoEnergyBuckets(previousAnalytics.data, sourceTimezone), [previousAnalytics.data, sourceTimezone]);
  const latestReading = useMemo(() => historyRows.reduce<typeof historyRows[number] | undefined>((latest, row) =>
    sourceKey(row) === currentSource && row.measurementQuality === 'GOOD' && (!latest || Date.parse(row.measuredAt) > Date.parse(latest.measuredAt)) ? row : latest, undefined), [historyRows, currentSource]);
  const liveWeather = latestReading && Date.now() - Date.parse(latestReading.measuredAt) < 3_600_000 && Date.now() >= Date.parse(latestReading.measuredAt) ? latestReading : null;
  const changeView = useCallback((view: ChartView) => { (isDemo ? setDemoChartView : setOperationalChartView)(view); if (view === 'power' || view === 'ev') setPeriod('day'); else if (view === 'generation') setPeriod('year'); else if (view === 'heatmap') setPeriod('month'); else if (view === 'energy') setPeriod('week'); }, [isDemo, setPeriod]);
  const refresh = () => { setRevision(value => value + 1); onRefresh(); };
  const controlNodes = useMemo(() => Object.fromEntries(['Visão geral', 'Histórico'].map(label =>
    [label, <DateControl key={label} day={day} period={period} timezone={timezone} onDay={setDay} onPeriod={setPeriod} label={label} />])), [day, period, timezone, isDemo]);
  const dateControls = (label: string) => controlNodes[label];
  const active = data.carregadores.filter(charger => charger.status === 'em_uso').length;
  const available = data.carregadores.filter(charger => charger.status === 'disponivel').length;
  const demoSummary = demoHistory.data?.summary;
  const demoUtilization = demoAnalytics.data?.totals.utilizationPct ?? null;
  const simulatedGie = simulatedFlowGie(gieState, stationId);
  const flowTelemetry = isDemo ? energyFromGie(simulatedGie) : telemetry;
  const scenarioAt = isDemo && flowTelemetry.updatedAt && Number.isFinite(Date.parse(flowTelemetry.updatedAt))
    ? new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(flowTelemetry.updatedAt)) : null;
  const gieFlowAvailable = simulatedGie !== null && flowTelemetry.gieVisual?.valid === true;
  const stationProfile = String(station?.id) === stationId ? station?.gieBinding?.profile : null;
  const historyProfile = String(demoHistory.data?.station.id) === stationId ? demoHistory.data?.station.gieProfile : null;
  const gieProfile = stationProfile ?? historyProfile ?? (simulatedGie?.gie_station_id === 'DEMO_POSTO_24H_001' ? 'POSTO'
    : simulatedGie?.gie_station_id === 'DEMO_CASA_001' ? 'CASA' : null);
  // The residential profile has no battery. Shopping retains its legacy scene.
  const hasNoBattery = gieProfile === 'CASA';
  const isPostoDemo = gieProfile === 'POSTO';
  const postoBatteries = isDemo && isPostoDemo ? gieBatteriesById(simulatedGie, ['BAT_01', 'BAT_02']) : null;
  const postoSoc = postoBatteries
    ? `${number(postoBatteries[0].socPercent, 1)}% / ${number(postoBatteries[1].socPercent, 1)}%` : 'Indisponível';
  const demoChargerHistory = useMemo(() => demoChargerCardHistory(data.carregadores,
    demoHistory.data?.chargers, demoAnalytics.data?.totals.chargerUtilization),
    [data.carregadores, demoHistory.data?.chargers, demoAnalytics.data?.totals.chargerUtilization]);
  const telemetryAt = Date.parse(telemetry?.updatedAt ?? '');
  const soc = numeric(telemetry.batterySocPercent);
  const currentSoc = !isDemo && Number.isFinite(telemetryAt) && now >= telemetryAt && now - telemetryAt < 300_000 && soc !== null && soc >= 0 && soc <= 100 ? soc : null;
  const powerTotal = flowTelemetry?.chargerPowerKw;
  const demoLoading = isDemo && (!demoDay || demoAnalytics.loading || demoHistory.loading);
  const demoError = demoSeedError || demoAnalytics.error || demoHistory.error;
  const demoGridProxy = demoAnalytics.data?.estimates?.gridImportProxyKwh ?? null;
  const importedValue = isDemo && totals.imported === null ? demoGridProxy : totals.imported;
  const demoCoverage = demoHistory.data?.batch;
  const overviewNote = isDemo ? demoHistory.data && !demoCoverage ? 'Nenhum histórico SIMULATED importado para esta instalação.'
    : demoAnalytics.data && demoAnalytics.data.totals.intervalCount === 0 && demoCoverage ? `Sem leituras neste período. Use o calendário para navegar entre ${sourceLocalDay(demoCoverage.periodStart ?? '')} e ${sourceLocalDay(demoCoverage.periodEnd ?? '')}.`
    : `${demoSource?.datasetKey ?? 'Histórico demonstrativo'} · SIMULATED · kWh somados dos intervalos originais de 15 minutos${demoGridProxy !== null ? '; rede: estimativa hipotética prédio + EV − solar, sem baterias e perdas' : '; importação da rede indisponível'}.`
    : `${sources.find(item => item.key === currentSource)?.label ?? 'Histórico indisponível'} · kWh estimados no período por integração de leituras válidas.`;
  const demoFinance = isDemo ? { summary: demoSummary ?? null, from: demoFrom, to: demoTo, sourceLabel: demoSource?.datasetKey ?? 'Dataset GIE' } : null;

  return <div className={styles.root}>
    <nav className={styles.breadcrumb} aria-label="Navegação da instalação"><Link href="/stations">Minhas instalações</Link><ChevronRight size={12} aria-hidden="true" /><span>Painel da instalação</span></nav>
    <div className={styles.stationHeader}><Link href="/stations" aria-label="Voltar para minhas instalações" title="Voltar para minhas instalações"><ArrowLeft size={23} /></Link><span className={styles.privateBadge}>{station?.visibility === 'PUBLIC' ? 'Pública' : 'Privada'}</span><h1>{station?.name ?? 'Instalação EMPS'}</h1><span className={styles.statusBadge} data-active={station?.status === 'ACTIVE'}>{({ ACTIVE: 'Em operação', DRAFT: 'Rascunho', PENDING: 'Aguardando', SUSPENDED: 'Suspensa', REJECTED: 'Rejeitada', ARCHIVED: 'Arquivada' } as Record<string, string>)[station?.status ?? ''] ?? station?.status ?? 'Carregando'}</span><span className={styles.networkBadge}><Cable size={12} /> GIE</span></div>
    <div className={styles.stationActions}><Link href={`/stations/${stationId}`} title="Cadastro e configurações da instalação"><Settings2 size={15} aria-hidden="true" />Configurações da instalação</Link></div>
    {stationError && <p role="alert">{stationError}</p>}
    <div className={styles.contextSwitch} role="group" aria-label="Contexto dos dados da instalação">
      <button type="button" aria-pressed={context === 'operational'} onClick={() => setContext('operational')}>Operação real</button>
      <button type="button" aria-pressed={context === 'demo'} onClick={() => setContext('demo')}>Histórico demonstrativo · SIMULATED</button>
      <Link href="/stations/overview">Comparar rede</Link>
    </div>
    <div className={styles.mainTabs} role="tablist" aria-label="Monitoramento da instalação">{tabs.map(item => <button key={item.id} id={`monitor-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`monitor-panel-${item.id}`} onClick={() => setTab(item.id)}>{item.label}{item.id === 'alarms' && data.alertas.some(alert => alert.status !== 'resolvido') && <span className={styles.alertCount}>{data.alertas.filter(alert => alert.status !== 'resolvido').length}</span>}</button>)}</div>
    {tab === 'dashboard' && <div id="monitor-panel-dashboard" role="tabpanel" aria-labelledby="monitor-tab-dashboard">
      <div className={styles.weatherLine}><div><WeatherPopover forecast={forecast} timezone={timezone} city={`${station?.city ?? ''}${station?.state ? `, ${station.state}` : ''}`} measuredTemperature={numeric(liveWeather?.outsideTemperatureC)} measuredHumidity={numeric(liveWeather?.relativeHumidityPercent)} /><span><Droplets size={13} /> {number(numeric(liveWeather?.relativeHumidityPercent) ?? weather?.humidity, 0)}%</span>{weather && <span>Vento {number(weather.wind, 0)} km/h</span>}<span>{station?.city}{station?.state ? `, ${station.state}` : ''}</span>{isDemo ? <span>Clima atual · fora do dataset</span> : liveWeather ? <span>Clima medido</span> : !weather && <span>Clima indisponível</span>}</div><div><span>{isDemo ? gieFlowAvailable ? `Cenário GIE · SIMULATED: ${scenarioAt ?? 'horário indisponível'}` : 'GIE SIMULATED · decisão indisponível' : `Atualização: ${telemetry?.updatedAt ? new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit' }).format(new Date(telemetry.updatedAt)) : '--'}`}</span><button className={styles.iconButton} type="button" aria-label="Atualizar painel" title="Atualizar painel" onClick={refresh}><RefreshCw size={17} /></button></div></div>
      <div className={styles.topGrid}>
        <section className={styles.flowSection} aria-label="Fluxo de energia">
          <div className={styles.flowToolbar}><span>Fluxo de energia do eletroposto</span><div className={styles.segments} role="group" aria-label="Visualização do fluxo"><button type="button" title="Cena do eletroposto" aria-label="Cena do eletroposto" aria-pressed={scene} onClick={() => setScene(true)}><Box size={18} /></button><button type="button" title="Diagrama de energia" aria-label="Diagrama de energia" aria-pressed={!scene} onClick={() => setScene(false)}><Network size={18} /></button></div></div>
          <div className={styles.flowCanvas}>{scene ? <EnergyFlowStation chargers={data.carregadores} telemetry={flowTelemetry} simulation={false} activityLabel={isDemo ? gieFlowAvailable ? hasNoBattery ? 'GIE SIMULATED · sem bateria instalada' : 'GIE SIMULATED · decisão atual' : 'GIE SIMULATED · sem decisão disponível' : hasNoBattery ? 'Sem bateria instalada' : undefined} noBattery={hasNoBattery} /> : <EnergyDiagram telemetry={flowTelemetry} noBattery={hasNoBattery} />}</div>
          <div className={styles.flowFoot}><span><Zap size={14} /> {number(powerTotal)} kW {isDemo ? 'alocados pelo GIE · SIMULATED' : 'nos carregadores'}</span>{isDemo ? <span title="Potências calculadas no cenário GIE; não são medição física, comando confirmado ou energia histórica acumulada.">Cenário GIE · {gieFlowAvailable ? scenarioAt ?? 'horário indisponível' : 'indisponível'}</span> : gieMode && <span title="Saída calculada pelo motor GIE separada da medição física mostrada no fluxo.">GIE · inteligência separada</span>}<span>{isDemo ? `${number(demoUtilization, 1)}% de utilização histórica` : `${active} / ${data.carregadores.length} em uso`}</span></div>
        </section>
        <div className={styles.overviewColumn}>
          <section className={`${styles.panel} ${styles.overviewPanel}`} aria-label="Visão geral" aria-busy={isDemo ? demoLoading : history.loading}><div className={styles.overviewHeader}><h2><House size={18} />Visão geral <Info size={14}><title>{isDemo ? 'Energia somada dos intervalos originais de 15 minutos do dataset SIMULATED; lacunas permanecem indisponíveis.' : 'Energia estimada pela integração das leituras disponíveis, sem preencher lacunas.'}</title></Info></h2>{dateControls('Visão geral')}</div>
            <div className={styles.overviewMetrics}>{([
              ['Geração solar', totals.solar, 'kWh', Sun, '#6fba66'], ['Energia nos carregadores', totals.charger, 'kWh', Zap, '#e7aa54'],
              [isDemo && demoGridProxy !== null ? 'Rede · estimativa hipotética' : 'Importação da rede', importedValue, 'kWh', UtilityPole, '#e2955b'], [hasNoBattery ? 'Bateria' : isDemo && isPostoDemo ? 'BAT_01 / BAT_02 · SoC do cenário GIE atual' : isDemo ? 'SoC histórico da bateria' : 'SoC da bateria · atual', hasNoBattery ? 'Sem bateria instalada' : isDemo && isPostoDemo ? postoSoc : isDemo ? 'Sem SoC no dataset' : currentSoc, hasNoBattery || isDemo ? '' : '%', BatteryCharging, '#6fba66'],
              ['Consumo do prédio', totals.load, 'kWh', House, '#c58be1'], [isDemo ? 'Utilização histórica dos carregadores' : 'Disponíveis / em uso · atual', isDemo ? demoUtilization : `${available} / ${active}`, isDemo ? '%' : '', Cable, '#5ba4d0'],
            ] as const).map(([label, val, unit, Icon, color]) => <div key={label}><Icon size={20} style={{ color }} /><div><strong data-unknown={val === null}>{val === null ? 'Sem dados' : typeof val === 'string' ? val : number(val)} {val !== null && <small>{unit}</small>}</strong><span>{label}</span></div></div>)}</div>
            <p className={styles.insightNote}>{demoError && isDemo ? `Histórico demonstrativo indisponível: ${demoError}` : overviewNote}</p>
          </section>
          <StationNotices alerts={data.alertas} stationId={stationId} timezone={timezone} now={Date.now()} gie={gieState} onAll={() => setTab('alarms')} />
        </div>
      </div>
      <div className={styles.historySource}><label>Fonte <select aria-label="Fonte do histórico" value={currentSource ?? ''} onChange={event => setSource(event.target.value)}><option value="">Dados da instalação</option>{sources.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>{!isDemo && history.truncated && <span role="status">Período parcial: reduza o intervalo para consultar todas as leituras.</span>}<span>{sourceTimezone}</span></div>
      <div className={styles.bottomGrid}>
        <MonitoringChart points={points} previousPoints={previousPoints} previousRange={previousWindow} comparisonLoading={isDemo ? previousAnalytics.loading : previousHistory.loading} comparisonError={isDemo ? previousAnalytics.error : previousHistory.error} comparisonTruncated={isDemo ? false : previousHistory.truncated} period={period} view={chartView} onView={changeView} controls={dateControls('Histórico')} loading={isDemo ? demoLoading : history.loading} error={isDemo ? demoError : history.error} periodLabel={sources.find(item => item.key === currentSource)?.label ?? 'Histórico da instalação'} range={window} timezone={sourceTimezone} energyBucketsOverride={isDemo ? demoBuckets : undefined} previousEnergyBucketsOverride={isDemo ? demoPreviousBuckets : undefined} totalsOverride={isDemo ? totals : undefined} energyMethodLabel={isDemo ? 'Soma dos intervalos originais de 15 minutos · SIMULATED' : undefined} />
        <StationFinancialSummary records={isDemo ? undefined : data.financeRecords} timezone={sourceTimezone} now={now} updatedAt={isDemo ? undefined : data.updatedAt} demo={demoFinance} />
      </div>
      <div className={styles.operationalStrip}>{(isDemo ? [[BatteryCharging, 'Recargas atendidas · SIMULATED', demoSummary ? String(demoSummary.sessions) : '--'], [BatteryCharging, 'Utilização histórica', demoUtilization === null ? '--' : `${number(demoUtilization, 1)}%`], [Zap, 'Tentativas não atendidas', demoSummary ? String(demoSummary.attempts - demoSummary.sessions) : '--'], [CircleDollarSign, 'Ticket simulado · pagas', demoSummary ? formatCurrency(demoSummary.avgTicket) : '--']] : [[BatteryCharging, 'Sessões ativas', String(data.resumo.sessoesAtivas)], [BatteryCharging, 'Ocupação atual', `${data.carregadores.length ? number(active / data.carregadores.length * 100, 0) : '0'}%`], [Zap, 'Disponíveis', String(available)], [CircleDollarSign, 'Ticket · sessões encerradas', formatCurrency(data.resumo.ticketMedio)]]).map(([Icon, label, val]) => { const Symbol = Icon as typeof Zap; return <div key={String(label)}><Symbol size={20} /><span>{String(label)}</span><strong>{String(val)}</strong></div>; })}</div>
    </div>}
    {tab === 'devices' && <section id="monitor-panel-devices" role="tabpanel" aria-labelledby="monitor-tab-devices" className={styles.panel}><div className={styles.panelHeading}><h2>Carregadores da instalação</h2><span>{data.carregadores.length} dispositivos</span></div>{!isDemo && !isDemoMode && !isReadOnlyMode && !isOfficialTestBridge && stationId && <MaqueteLabControls key={stationId} stationId={stationId} />}<ChargerVisualBoard key={stationId} chargers={data.carregadores} onChargersChange={onChargersChange} scrollAfter={6} readOnly={isDemo} historical={isDemo ? demoChargerHistory : undefined} sandboxStationId={!isDemo && !isDemoMode && !isReadOnlyMode && !isOfficialTestBridge && stationId === '46' ? stationId : undefined} /><SessionTable data={data} demoMode={isDemo} demo={demoHistory.data} loading={isDemo && (!demoDay || demoHistory.loading)} error={demoSeedError || demoHistory.error} timezone={sourceTimezone} /></section>}
    {tab === 'alarms' && <section id="monitor-panel-alarms" role="tabpanel" aria-labelledby="monitor-tab-alarms" className={styles.panel}><AlarmTable data={data} stationId={stationId} timezone={timezone} onRefresh={refresh} readOnly={isDemo} /></section>}
    <section id="monitor-panel-intelligence" role="tabpanel" aria-labelledby="monitor-tab-intelligence" hidden={tab !== 'intelligence'} className={styles.panel}><div className={styles.panelHeading}><h2>{isDemo ? 'Histórico demonstrativo · SIMULATED' : 'Distribuição inteligente'}</h2></div>{gieControls}{isDemo && tab === 'intelligence' && demoDay ? <DemoHistoryStation stationId={stationId} initialFrom={demoFrom} initialTo={demoTo} /> : null}</section>
  </div>;
}

function SessionTable({ data, demoMode, demo, loading, error, timezone }: { data: DashboardData; demoMode: boolean; demo?: DemoStationHistory | null; loading: boolean; error: string; timezone: string }) {
  const [query, setQuery] = useState('');
  const normalized = query.toLocaleLowerCase();
  const filtered = demoMode ? (demo?.sessions ?? []).filter(session => `${session.sourceSessionId} ${session.driver?.name ?? ''} ${session.sourceChargerId ?? ''} ${session.channel ?? ''} ${session.method ?? ''}`.toLocaleLowerCase().includes(normalized))
    : data.sessoes.filter(session => `${session.sessaoId} ${session.usuarioNome} ${session.carregadorNome}`.toLocaleLowerCase().includes(normalized));
  const demoRows = demoMode ? [...filtered as DemoStationHistory['sessions']].reverse().slice(0, 100) : [];
  const dateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  return <><div className={styles.panelHeading}><h2>{demoMode ? 'Sessões simuladas · período selecionado' : 'Sessões recentes'}</h2><label className={styles.search}><Search size={16} /><input type="search" aria-label="Buscar sessões" placeholder="ID, cliente ou carregador" value={query} onChange={event => setQuery(event.target.value)} /></label></div><div className={styles.tableScroll}><table><thead><tr>{['Sessão', 'Cliente', 'Carregador', 'Duração', 'Energia', 'Valor', 'Status'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{demoMode ? demoRows.map(session => <tr key={session.sourceSessionId}><td title={dateTime(session.startTime)}>{session.sourceSessionId}<br /><small>{dateTime(session.startTime)}</small></td><td title={session.driver?.id}>{session.driver?.name ?? 'Motorista demonstrativo'}{session.usageKind === 'OWNER' ? ' · uso próprio / RFID hipotético' : ''}</td><td>{session.sourceChargerId ?? 'Não atribuído'}</td><td>{session.durationSeconds == null ? session.endTime ? formatMinutes(Math.max(0, (Date.parse(session.endTime) - Date.parse(session.startTime)) / 60_000)) : '—' : formatMinutes(session.durationSeconds / 60)}</td><td>{formatKwh(session.deliveredKwh)}</td><td title="Valor SIMULATED; nenhum pagamento real">{formatCurrency(session.amount)}</td><td><StatusBadge status={session.status === 'COMPLETED' ? 'finalizada' : 'cancelada'} /></td></tr>)
    : (filtered as DashboardData['sessoes']).map(session => <tr key={session.sessaoId}><td>{session.sessaoId}</td><td>{session.usuarioNome}</td><td>{session.carregadorNome}</td><td>{formatMinutes(session.duracaoMinutos)}</td><td>{formatKwh(session.energiaKwh)}</td><td>{formatCurrency(session.valorTotal)}</td><td><StatusBadge status={session.status} /></td></tr>)}</tbody></table>{demoMode && error ? <p className={styles.empty} role="alert">Histórico demonstrativo indisponível: {error}</p> : demoMode && loading ? <p className={styles.empty} role="status">Carregando sessões simuladas...</p> : !filtered.length && <p className={styles.empty}>Nenhuma sessão encontrada.</p>}{demoMode && filtered.length > demoRows.length && <p className={styles.empty}>Exibindo as 100 mais recentes deste recorte. O histórico completo está em Inteligência.</p>}</div></>;
}

function AlarmTable({ data, stationId, timezone, onRefresh, readOnly = false }: { data: DashboardData; stationId: string; timezone: string; onRefresh: () => void; readOnly?: boolean }) {
  const formatDateTime = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'Data indisponível';
  const [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [severity, setSeverity] = useState('all');
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [busyAlert, setBusyAlert] = useState<string | null>(null), [actionError, setActionError] = useState('');
  async function updateAlert(alert: Alert, status: 'CHECKING' | 'RESOLVED') {
    setBusyAlert(alert.alertaId); setActionError('');
    try {
      if (alert.origem === 'GIE') {
        if (status !== 'CHECKING' || !alert.gieAlertId) throw new Error('Ação indisponível para este aviso do GIE.');
        await api.acknowledgeGieAlert(stationId, alert.gieAlertId);
      } else if (status === 'CHECKING') await api.acknowledgeAlert(alert.alertaId);
      else await api.resolveAlert(alert.alertaId);
      onRefresh();
    }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o aviso.'); }
    finally { setBusyAlert(null); }
  }
  const matching = data.alertas.filter(alert => `${alert.titulo} ${alert.carregadorNome ?? ''} ${alert.origem}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (severity === 'all' || severity === alert.severidade) && (!from || (Number.isFinite(Date.parse(alert.dataCriacao)) && localDay(new Date(alert.dataCriacao), timezone) >= from)) && (!to || (Number.isFinite(Date.parse(alert.dataCriacao)) && localDay(new Date(alert.dataCriacao), timezone) <= to)));
  const filtered = matching.filter(alert => filter === 'all' || (filter === 'open' ? alert.status !== 'resolvido' : alert.status === 'resolvido'));
  return <>
    <div className={styles.alarmFilters}>
      <label className={styles.search}><Search size={16} /><input type="search" aria-label="Buscar alarmes" placeholder="Alarme ou dispositivo" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select aria-label="Severidade" value={severity} onChange={event => setSeverity(event.target.value)}><option value="all">Todas as severidades</option>{['baixa', 'media', 'alta', 'critica'].map(value => <option key={value}>{value}</option>)}</select>
      <input type="date" aria-label="Alarmes: data inicial" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} />
      <input type="date" aria-label="Alarmes: data final" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} />
      <button className={styles.iconButton} title="Limpar filtros" aria-label="Limpar filtros de alarmes" type="button" onClick={() => { setFilter('all'); setQuery(''); setSeverity('all'); setFrom(''); setTo(''); }}><RefreshCw size={16} /></button>
    </div>
    <div className={styles.alarmTabs}>{[['all', 'Todos', matching.length], ['open', 'Em ocorrência', matching.filter(alert => alert.status !== 'resolvido').length], ['resolved', 'Resolvidos', matching.filter(alert => alert.status === 'resolvido').length]].map(([id, label, count]) => <button type="button" aria-pressed={filter === id} onClick={() => setFilter(String(id))} key={id}>{label} ({count})</button>)}</div>
    {actionError && <p role="alert" className={styles.footnote}>{actionError}</p>}
    <div className={styles.tableScroll}>
      <table>
        <thead><tr>{['Nome do alarme', 'Dispositivo', 'Status', 'Severidade', 'Data de ocorrência', 'Origem', 'Descrição', 'Ações'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{filtered.map(alert => <tr key={alert.alertaId}>
          <td>{alert.titulo}</td><td>{alert.carregadorNome ?? '--'}</td>
          <td><StatusBadge status={alert.status} /></td><td><StatusBadge status={alert.severidade} /></td>
          <td>{formatDateTime(alert.dataCriacao)}</td>
          <td>{alert.origem}{alert.modo === 'simulado' ? ' · simulado' : ''}</td>
          <td>{alert.descricao}</td>
          <td>{!readOnly && alert.status !== 'resolvido' && (alert.origem !== 'GIE' || Boolean(alert.gieAlertId)) && <div className={styles.alarmActions}>
            {alert.status === 'aberto' && <button type="button" disabled={busyAlert !== null} onClick={() => void updateAlert(alert, 'CHECKING')}>Reconhecer</button>}
            {alert.origem !== 'GIE' && <button type="button" disabled={busyAlert !== null} onClick={() => void updateAlert(alert, 'RESOLVED')}>Resolver</button>}
          </div>}</td>
        </tr>)}</tbody>
      </table>
      {!filtered.length && <div className={styles.empty}><Bell size={30} /><span>Nenhum alarme encontrado.</span></div>}
    </div>
    <p className={styles.footnote}>{readOnly ? 'Ocorrências atuais da operação/GIE, separadas do histórico SIMULATED; ações indisponíveis neste contexto.' : 'Alarmes retornados pelo painel operacional da instalação. Avisos do GIE são resolvidos automaticamente quando a condição termina.'}</p>
  </>;
}
