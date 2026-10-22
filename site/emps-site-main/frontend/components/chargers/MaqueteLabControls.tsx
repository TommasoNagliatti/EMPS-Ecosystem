'use client';

import { useEffect, useState } from 'react';
import { Cable, ChevronDown, Radio } from 'lucide-react';
import { api } from '@/services/emps-api';
import { labEvsePresentation, type LabDeviceStatus } from '@/domain/maquete-lab';
import styles from '@/components/energy/GieControls.module.css';

const labPath = (stationId: string) => `/v2/stations/${encodeURIComponent(stationId)}/lab-device`;
const localTime = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : 'indisponível';

export function MaqueteLabControls({ stationId }: { stationId: string }) {
  const [device, setDevice] = useState<LabDeviceStatus | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    setDevice(null); setReadAt(0); setError('');
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

  if (!device?.available || !device.bound || !device.deviceId || String(device.stationId) !== stationId) return null;
  const fresh = now - readAt <= 15_000;
  const connected = device.connected && fresh;
  const ev1 = labEvsePresentation(device, 'EV1', fresh);
  const ev2 = labEvsePresentation(device, 'EV2', fresh);
  const sourceLabel = device.connectionSource === 'SIMULATOR' ? 'Simulador local'
    : device.connectionSource === 'FIRMWARE' ? 'Firmware ESP32' : 'Cliente não identificado';

  return <details className={styles.panel}>
    <summary className={styles.summary}><span className={styles.icon}><Cable size={18} /></span><span className={styles.heading}><strong>Maquete USB · diagnóstico local</strong><small>{device.deviceId} · vinculada à instalação {device.stationId}</small></span><span className={`${styles.badge} ${connected ? styles.online : ''}`}><Radio size={12} />{connected ? sourceLabel : 'Sem conexão'}</span><ChevronDown className={styles.chevron} size={16} /></summary>
    <div className={styles.body}>
      <p className={styles.hint}>{device.energyStream?.connected
        ? `GIE → WebSocket · SIMULATED · relés bloqueados. ${device.energyStream.lastAck ? `ACK lógico #${device.energyStream.lastAck.sequence} às ${localTime(device.energyStream.lastAck.at)}; não é medição física.` : 'Aguardando ACK do dispositivo.'}`
        : 'Diagnóstico do dispositivo. A recarga de teste é iniciada e encerrada nos cartões dos carregadores.'}</p>
      <div className={styles.slots}>
        {([['EV1', ev1], ['EV2', ev2]] as const).map(([id, presentation]) => <div key={id}><strong>{id} · estado lógico</strong><span>{presentation.label}</span><small>{presentation.relay}</small></div>)}
        <div><strong>Último contato</strong><span>{connected ? localTime(device.lastHeartbeatAt) : 'Sem conexão recente'}</span><small>{connected ? `Estado recebido de: ${sourceLabel}` : 'Sem confirmação atual da placa'}</small></div>
        <div><strong>Firmware</strong><span>{device.firmwareVersion || 'Versão não informada'}</span><small>{connected ? sourceLabel : 'Sem confirmação recente'}</small></div>
      </div>
      {(error || device.error) && <p className={styles.error} role="alert">{error || device.error}</p>}
    </div>
  </details>;
}
