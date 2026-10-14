'use client';

import { ArrowLeft, ArrowRight, Inbox, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { formatCurrency, formatKwh } from '@/utils/formatters';
import type { SummaryMetric } from './operational-model';
import styles from './operations.module.css';

export function OperationsHeader({ title, subtitle, refreshing, onRefresh, readOnly }: {
  title: string; subtitle: string; refreshing: boolean; onRefresh: () => void; readOnly: boolean;
}) {
  return <header className={styles.heading}>
    <div><h1>{title}</h1><p>{subtitle}</p></div>
    <div className={styles.headingActions}>
      {readOnly && <span className={styles.readOnly} title="Somente leitura"><ShieldCheck size={14} />Somente leitura</span>}
      <button className={styles.iconButton} type="button" title="Atualizar dados" aria-label="Atualizar dados" disabled={refreshing} onClick={onRefresh}>
        <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
      </button>
    </div>
  </header>;
}

export function OperationsSummary({ metrics, loading }: { metrics: SummaryMetric[]; loading: boolean }) {
  return <dl className={styles.summary} aria-label="Resumo dos resultados" aria-busy={loading}>
    {metrics.map(metric => <div key={metric.label} data-tone={metric.tone}>
      <dt>{metric.label}</dt>
      <dd>{loading ? '—' : metric.format === 'currency' ? formatCurrency(metric.value) : metric.format === 'energy' ? formatKwh(metric.value) : metric.value.toLocaleString('pt-BR')}</dd>
    </div>)}
  </dl>;
}

export function OperationsEmpty({ error, filtered, loading, onReset, onRetry, noun = 'registros' }: {
  error?: string; filtered?: boolean; loading?: boolean; onReset?: () => void; onRetry?: () => void; noun?: string;
}) {
  return <div className={styles.empty} role={error ? 'alert' : 'status'}>
    {loading ? <RefreshCw size={24} className="spin" /> : <Inbox size={28} />}
    <strong>{loading ? 'Carregando dados' : error ? 'Não foi possível carregar os dados' : filtered ? 'Nenhum resultado para estes filtros' : `Nenhum registro de ${noun}`}</strong>
    <p>{error || (loading ? 'Aguarde um instante.' : filtered ? 'Tente outro termo ou remova os filtros.' : 'Os registros aparecerão aqui quando estiverem disponíveis.')}</p>
    {error && onRetry && <button className={styles.button} type="button" onClick={onRetry}><RefreshCw size={15} />Tentar novamente</button>}
    {!error && !loading && filtered && onReset && <button className={styles.button} type="button" onClick={onReset}><X size={15} />Limpar filtros</button>}
  </div>;
}

export function OperationsPagination({ page, pages, first, last, total, onPage }: {
  page: number; pages: number; first: number; last: number; total: number; onPage: (page: number) => void;
}) {
  return <nav className={styles.pagination} aria-label="Páginas dos resultados">
    <span>{total ? `${first}–${last} de ${total.toLocaleString('pt-BR')}` : '0 resultados'}</span>
    <div><button className={styles.iconButton} type="button" title="Página anterior" aria-label="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)}><ArrowLeft size={16} /></button>
      <span>Página {page} de {pages}</span>
      <button className={styles.iconButton} type="button" title="Próxima página" aria-label="Próxima página" disabled={page >= pages} onClick={() => onPage(page + 1)}><ArrowRight size={16} /></button></div>
  </nav>;
}

export function OperationsDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    const previousOverflow = document.body.style.overflow;
    node?.showModal();
    document.body.style.overflow = 'hidden';
    return () => { node?.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <header><h2>{title}</h2><button className={styles.iconButton} type="button" title="Fechar detalhes" aria-label="Fechar detalhes" onClick={onClose}><X size={18} /></button></header>
    <div className={styles.dialogBody}>{children}</div>
  </dialog>;
}
