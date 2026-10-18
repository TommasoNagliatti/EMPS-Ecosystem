'use client';

import { useEffect, useRef, useState } from 'react';
import { Cable, ChevronDown, Radio } from 'lucide-react';
import { api } from '@/services/emps-api';
import { labCommandAwaiting, labCommandFeedback, labEvsePresentation, type LabCommand, type LabCommandResponse, type LabDeviceStatus, type LabEvseId } from '@/domain/maquete-lab';
import styles from '@/components/energy/GieControls.module.css';

const labPath = (stationId: string) => `/v2/stations/${encodeURIComponent(stationId)}/lab-device`;
const localTime = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : 'indisponível';
const value = (amount: number | null, suffix: string) => amount !== null && Number.isFinite(amount)
  ? `${amount.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${suffix}` : 'indisponível';

export function MaqueteLabControls({ stationId, canManage }: { stationId: string; canManage: boolean }) {
  const [device, setDevice] = useState<LabDeviceStatus | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [command, setCommand] = useState<LabCommand | null>(null);
  const [busy, setBusy] = useState<LabEvseId | null>(null);
  const [error, setError] = useState('');
  const sending = useRef(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    setDevice(null); setReadAt(0); setCommand(null); setBusy(null); setError('');
    async function poll() {
      if (!active) return;
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(() => void poll(), 3_000);
        return;
      }
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const timeout = setTimeout(() => current.abort(), 8_000);
      try {
        const next = await api.platform<LabDeviceStatus>(labPath(stationId), { signal: current.signal }, { force: true });
        if (!active || controller !== current) return;
        if (String(next.stationId) !== stationId) throw new Error('Estado da maquete pertence a outra instalação.');
        setDevice(next); setReadAt(Date.now()); setNow(Date.now()); setError('');
      } catch (cause) {
        if (!active || controller !== current || current.signal.aborted) return;
        setReadAt(0);
        setDevice(previous => previous?.bound ? { ...previous, connected: false } : null);
        setError(cause instanceof Error ? cause.message : 'Estado da maquete indisponível.');
      } finally {
        clearTimeout(timeout);
        if (active && controller === current) timer = setTimeout(() => void poll(), 3_000);
      }
    }
    function onVisible() { if (document.visibilityState === 'visible') { setNow(Date.now()); clearTimeout(timer); void poll(); } }
    document.addEventListener('visibilitychange', onVisible);
    void poll();
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => { active = false; controller?.abort(); clearTimeout(timer); clearInterval(clock); document.removeEventListener('visibilitychange', onVisible); };
  }, [stationId]);

  async function send(evse: LabEvseId, enabled: boolean) {
    if (!canManage || !device?.available || !device.bound || busy || sending.current ||
        (enabled && (!device.connected || now - readAt > 15_000))) return;
    sending.current = true;
    setBusy(evse); setCommand(null); setError('');
    try {
      const next = await api.platform<LabCommandResponse>(`${labPath(stationId)}/commands`, {
        method: 'POST', body: JSON.stringify({ evse, enabled, requestId: crypto.randomUUID() }),
      });
      if (String(next.stationId) !== stationId || next.command.evse !== evse || next.command.enabled !== enabled) {
        throw new Error('Resposta do comando não corresponde à instalação e ao EVSE solicitados.');
      }
      setDevice(next); setReadAt(Date.now()); setNow(Date.now()); setCommand(next.command);
    } catch (cause) {
      setReadAt(0);
      setError(cause instanceof Error ? cause.message : 'Comando não confirmado. Consulte o estado da maquete.');
    } finally { sending.current = false; setBusy(null); }
  }

  if (!device?.available || !device.bound || !device.deviceId || String(device.stationId) !== stationId) return null;
  const fresh = now - readAt <= 15_000;
  const connected = device.connected && fresh;
  const ev1 = labEvsePresentation(device, 'EV1', fresh);
  const ev2 = labEvsePresentation(device, 'EV2', fresh);
  const ev1Awaiting = labCommandAwaiting(device, command, 'EV1', now);
  const ev2Awaiting = labCommandAwaiting(device, command, 'EV2', now);
  const gieCurrent = fresh && device.gie.valid;
  const sourceLabel = device.connectionSource === 'SIMULATOR' ? 'Simulador local'
    : device.connectionSource === 'FIRMWARE' ? 'Firmware ESP32' : 'Cliente não identificado';

  return <details className={styles.panel}>
    <summary className={styles.summary}><span className={styles.icon}><Cable size={18} /></span><span className={styles.heading}><strong>Maquete USB · teste local</strong><small>{device.deviceId} · vinculada à instalação {device.stationId}</small></span><span className={`${styles.badge} ${connected ? styles.online : ''}`}><Radio size={12} />{connected ? sourceLabel : 'Sem conexão'}</span><ChevronDown className={styles.chevron} size={16} /></summary>
    <div className={styles.body}>
      <p className={styles.hint}>Teste de baixa tensão da maquete. Comandos EV1/EV2 não iniciam sessões operacionais, não cobram pagamentos e não alteram carregadores físicos cadastrados.</p>
      {!canManage && <p className={styles.hint}>Apenas proprietário ou gerente desta instalação pode enviar comandos à maquete.</p>}
      <div className={styles.slots}>
        {([['EV1', ev1], ['EV2', ev2]] as const).map(([id, presentation]) => <div key={id}><strong>{id} · relé {id === 'EV1' ? 'GPIO15' : 'GPIO33'}</strong><span>{presentation.label}</span><small>{presentation.relay}</small></div>)}
        <div><strong>Último contato</strong><span>{connected ? localTime(device.lastHeartbeatAt) : 'Sem conexão recente'}</span><small>{connected ? `Estado recebido de: ${sourceLabel}` : 'Sem confirmação atual da placa'}</small></div>
        <div><strong>GIE · SIMULATED</strong><span>{gieCurrent ? `Cenário ${localTime(device.gie.scenarioAt)}` : 'Dados indisponíveis'}</span><small>{gieCurrent ? `Rede ${value(device.gie.gridKw, 'kW')} · Solar ${value(device.gie.solarKw, 'kW')}` : 'Sem medição física'}</small></div>
      </div>
      <div className={styles.actions}>
        <button type="button" disabled={!canManage || !!busy || ev1Awaiting || !ev1.canStart} onClick={() => void send('EV1', true)}>Iniciar teste de recarga EV1</button>
        <button type="button" disabled={!canManage || !!busy || !ev1.canStop} onClick={() => void send('EV1', false)}>Parar EV1</button>
        <button type="button" disabled={!canManage || !!busy || ev2Awaiting || !ev2.canStart} onClick={() => void send('EV2', true)}>Iniciar teste de recarga EV2</button>
        <button type="button" disabled={!canManage || !!busy || !ev2.canStop} onClick={() => void send('EV2', false)}>Parar EV2</button>
      </div>
      {busy && <p className={styles.message} role="status">Enviando comando {busy}; aguardando resposta do Backend.</p>}
      {command && <p className={styles.message} role="status">{labCommandFeedback(device, command, fresh)}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  </details>;
}
