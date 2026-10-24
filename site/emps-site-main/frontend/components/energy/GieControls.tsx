"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ChevronDown, Link2, Radio, Settings2 } from 'lucide-react';
import { api, frontSession, selectedStation } from '@/services/emps-api';
import { gieBatteries, gieCapabilities, gieDecision, gieEvses, gieFixtureCycleAvailable, gieForecasts, gieOrigin, gieWorker, type GieState } from '@/domain/gie';
import styles from './GieControls.module.css';

const modes = { NORMAL: 'Normal demonstrativo', SIMULATION: 'Simulação', PRESENTATION: 'Apresentação · cenas', MANUAL_DEMO: 'Demonstração manual', CHARGER_DEMO: 'Demonstração de carregadores' };
const commercialManualEvents = { EV_PEAK: 'Pico EV', BUILDING_PEAK: 'Pico do prédio', SOLAR_DROP: 'Redução solar', SOLAR_STRONG: 'Solar forte',
  FAULT_EVSE1: 'Falha EVSE 1', FAULT_EVSE2: 'Falha EVSE 2', FAULT_EVSE3: 'Falha EVSE 3', FAULT_EVSE4: 'Falha EVSE 4',
  RECOVER_EVSES: 'Recuperar EVSEs', SOC_HIGH: 'SOC alto demonstrativo', SOC_LOW: 'SOC baixo demonstrativo' };
const kw = (value: number | null) => value === null ? 'Indisponível' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kW`;
const pct = (value: number | null) => value === null ? 'Indisponível' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value))
  : 'Indisponível';
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function GieControls({ onState, initialStationId }: { onState: (state: GieState) => void; initialStationId?: string }) {
  const stationId = initialStationId ?? selectedStation.get() ?? '';
  const [state, setState] = useState<GieState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [chargerId, setChargerId] = useState('');
  const [slot, setSlot] = useState('1');
  const [presentationTools, setPresentationTools] = useState(false);
  const generation = useRef(0);
  const pending = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      api.platform<{ presentationTools: boolean }>('/auth/me'),
      stationId ? api.platform<{ membershipRole?: string }>(`/v2/stations/${encodeURIComponent(stationId)}`) : Promise.resolve(null),
    ]).then(([account, station]) => {
      if (active) setPresentationTools(
        (account.status === 'fulfilled' && account.value.presentationTools === true) ||
        (station.status === 'fulfilled' && station.value?.membershipRole === 'OWNER'),
      );
    });
    return () => { active = false; };
  }, [stationId]);

  const load = useCallback(() => {
    if (!stationId) return Promise.resolve(false);
    if (pending.current) return pending.current;
    const currentGeneration = generation.current;
    const request = (async () => {
      try {
        const next = await api.gieState(stationId);
        if (currentGeneration !== generation.current) return false;
        if (String(next.station_id) !== stationId) throw new Error('Resposta GIE associada a outra instalação');
        setState(next); onState(next); setError('');
        return next.online;
      } catch (cause) {
        if (currentGeneration !== generation.current) return false;
        const message = cause instanceof Error ? cause.message : 'GIE indisponível';
        const offline: GieState = { online: false, station_id: stationId, mode: 'UNKNOWN', observed_at: '', state: null, error: message };
        setState(offline); onState(offline); setError(message);
        return false;
      }
    })();
    pending.current = request;
    void request.finally(() => { if (pending.current === request) pending.current = null; });
    return request;
  }, [stationId, onState]);

  useEffect(() => {
    generation.current++; pending.current = null; setState(null);
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let pollRevision = 0;
    async function poll() {
      const revision = ++pollRevision;
      const online = document.visibilityState === 'hidden' ? false : await load();
      if (active && revision === pollRevision) timer = setTimeout(() => void poll(), online ? 5000 : 30000);
    }
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      void poll();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    void poll();
    return () => { active = false; pollRevision++; generation.current++; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [load]);

  async function action(path: string, body: unknown = {}) {
    if (!stationId) return;
    const currentGeneration = generation.current;
    setBusy(true); setError('');
    try {
      const next = await api.gieAction(stationId, path, body);
      if (currentGeneration !== generation.current) return;
      if (String(next.station_id) !== stationId) throw new Error('Resposta GIE associada a outra instalação');
      generation.current++; pending.current = null;
      setState(next); onState(next); setError('');
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Comando não executado'); }
    finally { setBusy(false); }
  }

  const isolated = state?.isolated === true;
  const decision = isolated ? object(state?.state) : gieDecision(state);
  const worker = gieWorker(state);
  const numeric = object(decision?.numeric_state);
  const capabilities = gieCapabilities(state);
  const evses = isolated ? (state?.context?.demands ?? []).map((demand, index) => ({ id: `EVSE ${index + 1}`, maxKw: null, requestedKw: null,
    connected: demand.connected, setpointKw: Array.isArray(numeric?.evse_setpoints_kw) && typeof numeric.evse_setpoints_kw[index] === 'number' ? numeric.evse_setpoints_kw[index] as number : null })) : gieEvses(state);
  const batteries = gieBatteries(state);
  const forecasts = gieForecasts(state);
  const history = Array.isArray(state?.history) ? state.history.filter(row => row.station_id === state?.gie_station_id) : [];
  const origin = isolated || (state?.source === 'GIEControl' && state.hardware_confirmed === false) ? 'SIMULATED' : gieOrigin(state);
  const isCommercial = capabilities.presentation || (!state?.gie_station_id && !!state?.presentation);
  const manualDemoAvailable = capabilities.manualDemo || (!state?.gie_station_id && !!state?.manual_events);
  const enabled = !!stationId && !!state?.online && !isolated && !busy;
  const visual = object(decision?.visual_state);
  const decisionValid = decision?.execution_allowed === true && visual?.valid === true;
  const status = !state?.online ? 'Serviço indisponível' : isolated ? 'Simulação isolada' : !decision ? 'Aguardando estado da estação' : decisionValid ? 'Decisão simulada disponível' : 'Decisão indisponível ou bloqueada';
  const power = (key: string) => kw(typeof numeric?.[key] === 'number' && Number.isFinite(numeric[key]) ? numeric[key] as number : null);
  const presentation = object(worker?.presentation) ?? object(state?.presentation);
  const message = object(decision?.primary_message);
  const manualEvents = object(worker?.manual_events) ?? object(state?.manual_events) ?? (capabilities.manualDemo ? commercialManualEvents : null);
  const model = object(worker?.model_identity);
  const modelName = typeof model?.station_id === 'string' ? model.station_id : state?.gie_station_id;
  const modesAvailable = Object.entries(modes).filter(([mode]) => (mode === 'CHARGER_DEMO' && stationId === '13') || mode === 'NORMAL' || mode === 'SIMULATION' || (mode === 'PRESENTATION' && isCommercial) || (mode === 'MANUAL_DEMO' && manualDemoAvailable));

  return <details className={styles.panel}>
    <summary className={styles.summary}><span className={styles.icon}><Activity size={18} /></span><span className={styles.heading}><strong>{isolated ? 'GIE · Teste local' : 'Controle energético GIE'}</strong><small>Instalação {stationId || 'indisponível'}{modelName ? ` · ${modelName}` : ''}</small></span><span className={`${styles.badge} ${state?.online ? styles.online : ''}`}><Radio size={12} />{state?.online ? 'Conectado' : 'Offline'}</span><ChevronDown className={styles.chevron} size={16} /></summary>
    <div className={styles.body}>
      <div className={styles.state} role="status"><span className={styles.dot} /><strong>{status}</strong><span>{!state?.online ? 'Dados indisponíveis' : origin === 'SIMULATED' ? 'Dados SIMULATED · sem despacho físico' : origin ? `Origem ${origin}` : 'Origem indisponível'}</span></div>
      <p className={styles.hint}>{isolated ? 'Valores simulados do protótipo GIE, com quatro carregadores virtuais. Sem medição física, comandos, cobrança ou gravação no banco oficial.' : 'As potências e decisões do GIE são simuladas. Setpoints são limites calculados, não potência medida ou comando confirmado por equipamento. Valores ausentes permanecem indisponíveis.'}</p>
      {state?.online && <div className={styles.metadata}><span>Consulta: {date(state.observed_at)}</span><span>Intervalo do cenário: {date(decision?.decision_time ?? decision?.timestamp)}</span><span>Geração: {state.generation ?? (typeof worker?.generation === 'string' ? worker.generation : 'indisponível')}</span></div>}
      {presentationTools && gieFixtureCycleAvailable(state) && <div className={styles.actions}><button disabled={!enabled} onClick={() => void action('cycle')}>Avançar 15 minutos simulados</button></div>}
      {presentationTools && <div className={styles.fields}><label>Modo de operação<select value={state?.mode && state.mode in modes ? state.mode : 'NORMAL'} disabled={!enabled} onChange={event => void action('mode', { mode: event.target.value })}>{modesAvailable.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>}
      {state?.mode === 'PRESENTATION' && isCommercial && <div className={styles.presentation}><span>Cena {String(presentation?.scene_number ?? '—')} · {String(presentation?.name ?? 'Indisponível')}</span><small>{presentation?.playing === true ? 'Em reprodução' : 'Pausada'}</small></div>}
      {presentationTools && isCommercial && <div className={styles.actions}>{Object.entries({ start: 'Iniciar apresentação', pause: 'Pausar', resume: 'Retomar', previous: 'Anterior', next: 'Próxima', reset: 'Reiniciar cenas' }).map(([command, label]) => <button key={command} disabled={!enabled || (command !== 'start' && state?.mode !== 'PRESENTATION')} onClick={() => void action(`presentation/${command}`)}>{label}</button>)}<button disabled={!enabled || state?.mode !== 'PRESENTATION' || typeof presentation?.loop !== 'boolean'} aria-pressed={presentation?.loop === true} onClick={() => void action('presentation/loop', { enabled: presentation?.loop !== true })}>Loop: {presentation?.loop === true ? 'ligado' : 'desligado'}</button></div>}
      {presentationTools && manualDemoAvailable && state?.mode === 'MANUAL_DEMO' && <div className={styles.actions}>{Object.entries({ ...manualEvents, RESET: 'Restaurar demo' }).map(([event, label]) => <button disabled={!enabled} key={event} onClick={() => void action('manual-demo/event', { event })}>{String(label)}</button>)}</div>}
      <div className={styles.metrics}>{[['building_kw', 'Prédio'], ['solar_kw', 'Solar'], ['ev_demand_kw', 'EV solicitado'], ['ev_served_kw', 'EV alocado'], ['grid_import_kw', 'Rede importada'], ['grid_export_kw', 'Rede exportada']].map(([key, label]) => <div key={key}><small>{label}</small><strong>{power(key)}</strong></div>)}</div>
      <section className={styles.section} aria-label="Alocação por carregador"><h3>Carregadores · {evses.length || 'indisponível'}</h3>{evses.length ? <div className={styles.slots}>{evses.map(evse => <div key={evse.id}><strong>{evse.id}</strong><span>{isolated ? `Carregador virtual ${evse.id.replace('EVSE ', '')} · ` : ''}{evse.connected === true ? 'Conectado' : evse.connected === false ? 'Desconectado' : 'Conexão indisponível'}{evse.maxKw !== null ? ` · limite ${kw(evse.maxKw)}` : ''}</span><small>Solicitado: {kw(evse.requestedKw)}</small><small>Alocação simulada: {kw(evse.setpointKw)}</small></div>)}</div> : <p className={styles.hint}>Identidades dos carregadores indisponíveis neste estado.</p>}</section>
      <section className={styles.section} aria-label="Baterias da estação"><h3>Baterias</h3>{batteries === null ? <p className={styles.hint}>Estado individual das baterias indisponível.</p> : batteries.length === 0 ? <p className={styles.hint}>Sem bateria cadastrada neste perfil.</p> : <div className={styles.slots}>{batteries.map(battery => <div key={battery.id}><strong>{battery.id}</strong><span>{battery.available === false ? 'Indisponível' : `Capacidade nominal: ${battery.capacityKwh === null ? 'indisponível' : `${battery.capacityKwh.toLocaleString('pt-BR')} kWh`}`}</span><small>SoC simulado: {pct(battery.socPercent)}</small><small>Carga: {kw(battery.chargeKw)} · descarga: {kw(battery.dischargeKw)}</small></div>)}</div>}</section>
      <section className={styles.section} aria-label="Previsões do GIE"><h3>Previsões · {forecasts.length ? `${forecasts.length} intervalos de 15 min` : 'indisponíveis'}</h3>{forecasts.length ? <><p className={styles.hint}>Previsões do cenário SIMULATED; não garantem demanda ou geração futura.</p><div className={styles.tableScroll}><table className={styles.forecastTable}><thead><tr><th>Intervalo</th><th>Prédio</th><th>EV previsto</th><th>Solar previsto</th></tr></thead><tbody>{forecasts.slice(0, 8).map(row => <tr key={row.timestamp}><td>{date(row.timestamp)}</td><td>{kw(row.buildingKw)}</td><td>{kw(row.evKw)}</td><td>{kw(row.solarKw)}</td></tr>)}</tbody></table></div><small className={styles.hint}>Exibindo os primeiros {Math.min(8, forecasts.length)} intervalos.</small></> : <p className={styles.hint}>Ainda não há previsão disponível para esta estação.</p>}</section>
      {state?.gie_station_id && <section className={styles.section} aria-label="Histórico de ciclos do GIE"><h3>Histórico de ciclos simulados</h3>{history.length ? <div className={styles.slots}>{history.slice(-5).reverse().map((row, index) => <div key={`${row.issue_time}-${index}`}><strong>{date(row.issue_time)}</strong><span>{row.status} · SIMULATED</span></div>)}</div> : <p className={styles.hint}>Nenhum ciclo registrado nesta geração do worker.</p>}</section>}
      {state?.event_feed_error && <p className={styles.error} role="status">O estado energético está disponível, mas a atualização dos alertas falhou. Tente novamente em instantes.</p>}
      {message && <p className={styles.message}>{String(message.title ?? message.code ?? 'GIE')}: {String(message.text ?? 'Decisão registrada')}</p>}
      {presentationTools && frontSession.get()?.role === 'admin' && isCommercial && !state?.gie_station_id && <details className={styles.mapping}><summary><Settings2 size={14} /> Associações dos carregadores</summary><div className={styles.fields}><label>ID do carregador<input value={chargerId} inputMode="numeric" onChange={event => setChargerId(event.target.value)} /></label><label>Slot<select value={slot} onChange={event => setSlot(event.target.value)}>{[1, 2, 3, 4].map(n => <option key={n}>{n}</option>)}</select></label><button disabled={!enabled || !/^\d+$/.test(chargerId)} onClick={() => void action('mappings', { chargerId, evseSlot: Number(slot) })}><Link2 size={14} /> Vincular EVSE</button></div></details>}
      {(error || state?.error) && <p className={styles.error} role="alert">{error || state?.error}</p>}
    </div>
  </details>;
}
