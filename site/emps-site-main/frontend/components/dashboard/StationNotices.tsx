'use client';

import { useMemo, useRef, useState } from 'react';
import { Bell, ChevronRight, Clock3, Radio, X } from 'lucide-react';
import type { Alert } from '@/domain/emps';
import type { GieState } from '@/domain/gie';
import { gieHealth, stationNotices } from '@/domain/station-insights';
import styles from './station-dashboard.module.css';

export function StationNotices({ alerts, stationId, timezone, now, gie, onAll }: {
  alerts: Alert[]; stationId: string; timezone: string; now: number;
  gie?: GieState | null; onAll: () => void;
}) {
  const notices = useMemo(() => stationNotices(alerts, stationId, now), [alerts, stationId, now]);
  const health = gieHealth(gie, stationId, now);
  const [selected, setSelected] = useState<Alert | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const timestamp = (value: string) => new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
  const selectedNotice = selected && stationNotices(alerts, stationId, now, Infinity).find(item => item.alertaId === selected.alertaId);

  return <section className={`${styles.panel} ${styles.noticesPanel}`} aria-label="Avisos e ações do GIE">
    <div className={styles.panelHeading}><h2><Bell size={16} />Avisos e ações do GIE</h2><button className={styles.textAction} type="button" onClick={onAll}>Ver todos<ChevronRight size={14} /></button></div>
    <p className={styles.gieHealth} data-state={health.state} role="status"><Radio size={12} />{health.label}</p>
    <ul className={styles.noticeList}>{notices.map(notice => <li key={notice.alertaId}>
      <button type="button" className={styles.noticeRow} data-severity={notice.severidade} onClick={() => { setSelected(notice); dialog.current?.showModal(); }} aria-label={`Detalhes: ${notice.titulo}`}>
        <span className={styles.noticeMeta}><time dateTime={notice.dataCriacao}>{timestamp(notice.dataCriacao)}</time><span>{notice.origem}{notice.modo === 'simulado' ? ' · simulado' : ''}</span></span>
        <strong>{notice.titulo}</strong><span className={styles.noticeDescription}>{notice.descricao}</span>
        <span className={styles.noticeMeta}><span>{notice.severidade}</span><span>{notice.fase ?? notice.status}</span></span>
      </button>
    </li>)}</ul>
    {!notices.length && <div className={styles.noticeEmpty}><Bell size={22} /><span>Sem avisos registrados para esta instalação.</span></div>}
    {!notices.some(item => item.origem === 'GIE') && <p className={styles.insightNote}>Histórico de ações do GIE indisponível.</p>}
    <dialog ref={dialog} className={styles.dialog} aria-label="Detalhes do aviso" onClose={() => setSelected(null)}>
      <div className={styles.panelHeading}><h2>Detalhes do aviso</h2><button className={styles.iconButton} type="button" aria-label="Fechar aviso" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      {selectedNotice ? <><h3>{selectedNotice.titulo}</h3><p className={styles.noticeDetail}>{selectedNotice.descricao}</p><dl className={styles.detailList}>
        <div><dt>Origem</dt><dd>{selectedNotice.origem}{selectedNotice.modo === 'simulado' ? ' · simulado' : ''}</dd></div>
        <div><dt>Ocorrência</dt><dd><Clock3 size={13} />{timestamp(selectedNotice.dataCriacao)} · {timezone}</dd></div>
        <div><dt>Dispositivo</dt><dd>{selectedNotice.carregadorNome ?? 'Instalação'}</dd></div>
        <div><dt>Severidade</dt><dd>{selectedNotice.severidade}</dd></div>
        <div><dt>{selectedNotice.fase ? 'Fase da ação' : 'Status do alerta'}</dt><dd>{selectedNotice.fase ?? selectedNotice.status}</dd></div>
      </dl></> : <p>Este aviso não está mais disponível.</p>}
    </dialog>
  </section>;
}
