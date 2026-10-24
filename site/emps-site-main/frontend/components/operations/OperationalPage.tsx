'use client';

import { AlertCircle, CalendarDays, CheckCircle2, Info, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import type { ApiResource, ChargingSession, ResourceRow } from '@/domain/emps';
import { api, isReadOnlyMode, isAccessDenied } from '@/services/emps-api';
import { useRealtime } from '@/components/realtime/RealtimeProvider';
import { resourceRealtimeRevision } from '@/services/emps-realtime';
import { getActionLabel, getRowKey, operationColumns, operationConfigs } from './operation-config';
import { displayReference, matchesDate, matchesSearch, matchesStatus, pageSlice, periodRange, resourceSummary, sortRows, type Period, type SortOrder } from './operational-model';
import { OperationsDialog, OperationsEmpty, OperationsHeader, OperationsPagination, OperationsSummary } from './OperationsUI';
import styles from './operations.module.css';

export function OperationalPage({ resource }: { resource: ApiResource }) {
  const config = operationConfigs[resource];
  const financial = resource === 'sessoes' || resource === 'pagamentos';
  const [rows, setRows] = useState<ResourceRow[]>(() => api.cachedList(resource)?.value ?? []);
  const [query, setQuery] = useState('');
  const [serverQuery, setServerQuery] = useState('');
  const [filter, setFilter] = useState('todos');
  const [period, setPeriod] = useState<Period>('all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [sort, setSort] = useState<SortOrder>(resource === 'alertas' ? 'priority' : resource === 'clientes' ? 'name' : 'recent');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(() => !api.cachedList(resource));
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(() => { const cached = api.cachedList(resource); return cached ? new Date(cached.updatedAt) : null; });
  const [selected, setSelected] = useState<ResourceRow | null>(null);
  const [actionRow, setActionRow] = useState<ResourceRow | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const handledConnection = useRef(0);
  const handledRevision = useRef(0);
  const { connectionVersion, status: realtimeStatus, topicRevisions } = useRealtime();
  const revision = resourceRealtimeRevision(resource, topicRevisions);
  const searchPending = financial && query.trim() !== serverQuery;

  useEffect(() => {
    if (!financial) return;
    const timer = window.setTimeout(() => { setServerQuery(query.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [financial, query]);

  const load = useCallback(async (silent = false) => {
    if (silent && inFlight.current) return;
    const current = ++generation.current;
    inFlight.current = true;
    if (silent || api.cachedList(resource, financial ? serverQuery : '')) setRefreshing(true);
    else setLoading(true);
    try {
      const next = await api.list(resource, financial ? serverQuery : '', silent);
      if (current !== generation.current) return;
      setRows(next);
      setLoadedAt(new Date(api.cachedList(resource, financial ? serverQuery : '')?.updatedAt ?? Date.now()));
      setLoadError('');
    } catch (error) {
      if (current === generation.current) {
        if (!silent || isAccessDenied(error)) { setRows([]); setLoadedAt(null); }
        setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar os dados.');
      }
    } finally {
      if (current === generation.current) { inFlight.current = false; setLoading(false); setRefreshing(false); }
    }
  }, [resource, financial, serverQuery]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; inFlight.current = false; };
  }, [load]);

  useEffect(() => {
    if (loading) return;
    if (connectionVersion <= handledConnection.current && revision <= handledRevision.current) return;
    handledConnection.current = connectionVersion;
    handledRevision.current = revision;
    const timer = window.setTimeout(() => { if (document.visibilityState === 'visible') void load(true); }, 180);
    return () => window.clearTimeout(timer);
  }, [connectionVersion, revision, load, loading]);

  useEffect(() => {
    if (realtimeStatus === 'disabled') return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, realtimeStatus === 'connected' ? 60_000 : 15_000);
    return () => window.clearInterval(timer);
  }, [load, realtimeStatus]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const range = useMemo(() => periodRange(period, custom), [period, custom, loadedAt]);
  const scoped = useMemo(() => rows.filter(row => matchesDate(row, range) && (financial || matchesSearch(row, query))), [rows, range, financial, query]);
  const filtered = useMemo(() => sortRows(scoped.filter(row => matchesStatus(resource, row, filter)), sort), [scoped, resource, filter, sort]);
  const pagination = pageSlice(filtered, page);
  const hasFilters = Boolean(query || filter !== 'todos' || period !== 'all');
  const pending = loading || searchPending;
  const invalidRange = Boolean(range.from && range.to && range.from > range.to);
  const detailRow = selected ? rows.find(row => getRowKey(resource, row) === getRowKey(resource, selected)) ?? selected : null;
  const cashSession = actionRow && resource === 'sessoes' && (actionRow as ChargingSession).status === 'aguardando_pagamento' ? actionRow as ChargingSession : null;

  function resetFilters() { setQuery(''); setFilter('todos'); setPeriod('all'); setCustom({ from: '', to: '' }); setPage(1); }
  async function confirmAction() {
    if (!actionRow || isReadOnlyMode || actionBusy) return;
    setActionBusy(true);
    try {
      const key = getRowKey(resource, actionRow);
      if (cashSession) await api.settleSmallCash(key, cashSession.valorTotal, cashSession.energiaKwh);
      else if (resource === 'carregadores') await api.requestChargerStatus(key);
      else if (resource === 'sessoes') await api.finishSession(key);
      else if (resource === 'pagamentos') await api.registerPayment(key);
      else if (resource === 'alertas') await api.resolveAlert(key);
      setActionRow(null);
      setNotice({ message: 'Operação concluída.', error: false });
      await load(true);
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : 'Não foi possível concluir a operação.', error: true });
    } finally { setActionBusy(false); }
  }

  return <AppShell eyebrow={config.eyebrow} title={config.title} showEmpsHeaderLogo>
    <div className={styles.page}>
      <OperationsHeader title={config.title} subtitle={config.description} refreshing={pending || refreshing} onRefresh={() => void load(true)} readOnly={isReadOnlyMode} />
      <OperationsSummary metrics={resourceSummary(resource, scoped)} loading={pending || (!loadedAt && Boolean(loadError))} />
      {notice && <div className={styles.banner} role={notice.error ? 'alert' : 'status'}>{notice.error ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<p>{notice.message}</p><button className={styles.iconButton} type="button" aria-label="Fechar mensagem" onClick={() => setNotice(null)}><X size={15} /></button></div>}
      {loadError && rows.length > 0 && <div className={styles.banner} role="alert"><AlertCircle size={17} /><p>Não foi possível atualizar. Exibindo a última consulta: {loadError}</p><button className={styles.button} type="button" onClick={() => void load(true)}>Tentar novamente</button></div>}
      <section aria-label={`Filtros de ${config.title}`}>
        <div className={styles.toolbar}>
          <label className={styles.search}><Search size={17} /><input aria-label={`Buscar ${config.title.toLowerCase()}`} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder={config.searchPlaceholder} />
            {query && <button type="button" title="Limpar busca" aria-label="Limpar busca" onClick={() => { setQuery(''); setPage(1); }}><X size={15} /></button>}
          </label>
          {financial && <label className={styles.period}><CalendarDays size={16} /><select aria-label="Período" className={styles.select} value={period} onChange={event => { setPeriod(event.target.value as Period); setPage(1); }}>
            <option value="all">Todos</option><option value="day">Hoje</option><option value="week">Semana</option><option value="month">Mês</option><option value="custom">Intervalo</option>
          </select></label>}
          <select aria-label="Ordenar resultados" className={styles.select} value={sort} onChange={event => { setSort(event.target.value as SortOrder); setPage(1); }}>
            <option value="recent">Recentes</option><option value="oldest">Antigos</option><option value="name">Nome A–Z</option>
            {financial && <option value="amount">Maior valor</option>}{resource === 'alertas' && <option value="priority">Prioridade</option>}
          </select>
          {hasFilters && <button type="button" className={styles.iconButton} title="Limpar filtros" aria-label="Limpar filtros" onClick={resetFilters}><X size={16} /></button>}
          {financial && period === 'custom' && <div className={styles.dates}><label>De<input aria-label="Data inicial" type="date" value={custom.from} max={custom.to || undefined} onChange={event => { setCustom(current => ({ ...current, from: event.target.value })); setPage(1); }} /></label><label>Até<input aria-label="Data final" type="date" value={custom.to} min={custom.from || undefined} onChange={event => { setCustom(current => ({ ...current, to: event.target.value })); setPage(1); }} /></label></div>}
        </div>
        {invalidRange && <p className={styles.banner} role="alert">A data final deve ser igual ou posterior à data inicial.</p>}
        <div className={styles.statusTabs} aria-label="Situação dos registros">{config.filters.map(item => <button type="button" key={item.value} aria-pressed={filter === item.value} onClick={() => { setFilter(item.value); setPage(1); }}>{item.label}<span>{pending ? '—' : scoped.filter(row => matchesStatus(resource, row, item.value)).length}</span></button>)}</div>
      </section>
      <section className={styles.tableSection} aria-label={`Lista de ${config.title.toLowerCase()}`} aria-busy={pending}>
        <div className={styles.tableMeta}><strong>{pending ? 'Consultando registros' : `${filtered.length} ${filtered.length === 1 ? 'resultado' : 'resultados'}`}</strong><span>{financial && period !== 'all' ? 'Resumo do período selecionado' : 'Resumo da consulta'}{loadedAt && <> · <time dateTime={loadedAt.toISOString()}>Atualizado às {loadedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time></>}</span></div>
        {pending ? <OperationsEmpty loading /> : loadError && !rows.length ? <OperationsEmpty error={loadError} onRetry={() => void load()} /> : !filtered.length ? <OperationsEmpty filtered={hasFilters} onReset={resetFilters} noun={config.title.toLowerCase()} /> :
          <div className={styles.tableScroll} role="region" aria-label="Tabela de resultados" tabIndex={0}><table className={styles.table}>
            <thead><tr>{operationColumns[resource].map(column => <th key={column.label} scope="col" className={column.className === 'operation-numeric' ? styles.numeric : undefined}>{column.label}</th>)}<th scope="col">Ações</th></tr></thead>
            <tbody>{pagination.rows.map(row => {
              const key = getRowKey(resource, row), action = getActionLabel(resource, row);
              return <tr key={key}>{operationColumns[resource].map(column => <td key={column.label} className={column.className === 'operation-numeric' ? styles.numeric : undefined}>{column.render(row)}</td>)}
                <td><div className={styles.cellActions}><button type="button" className={styles.iconButton} title={`Ver detalhes · ${key}`} aria-label={`Ver detalhes · ${key}`} onClick={() => setSelected(row)}><Info size={16} /></button>
                  {action && <button type="button" className={styles.button} title={isReadOnlyMode ? 'Indisponível neste acesso somente leitura' : action} disabled={isReadOnlyMode || actionBusy} onClick={() => setActionRow(row)}>{action}</button>}</div></td></tr>;
            })}</tbody>
          </table></div>}
      </section>
      {!pending && !loadError && <OperationsPagination page={pagination.currentPage} pages={pagination.pageCount} first={pagination.first} last={pagination.last} total={filtered.length} onPage={setPage} />}
      {detailRow && <OperationsDialog title={`${resource === 'clientes' ? 'Cliente' : resource === 'sessoes' ? 'Sessão' : resource === 'pagamentos' ? 'Pagamento' : 'Alerta'} · ${getRowKey(resource, detailRow)}`} onClose={() => setSelected(null)}>
        <dl className={styles.details}>{operationColumns[resource].map(column => <div key={column.label}><dt>{column.label}</dt><dd>{column.render(detailRow)}</dd></div>)}
          {'usuarioId' in detailRow && <div><dt>ID do cliente</dt><dd>{displayReference(detailRow.usuarioId)}</dd></div>}
          {'carregadorId' in detailRow && <div><dt>ID do carregador</dt><dd>{detailRow.carregadorId || 'Geral'}</dd></div>}
          {'dataFim' in detailRow && <div><dt>Encerramento</dt><dd>{detailRow.dataFim ? new Date(detailRow.dataFim).toLocaleString('pt-BR') : 'Não encerrada'}</dd></div>}
          {'transactionId' in detailRow && <div><dt>ID da transação</dt><dd>{detailRow.transactionId || 'Não informado'}</dd></div>}
          {'telefone' in detailRow && <div><dt>Telefone</dt><dd>{detailRow.telefone || 'Não informado'}</dd></div>}
        </dl>
      </OperationsDialog>}
      {actionRow && <OperationsDialog title={cashSession ? `Acerto da sessão ${cashSession.sessaoId}` : `${getActionLabel(resource, actionRow)} · ${getRowKey(resource, actionRow)}`} onClose={() => { if (!actionBusy) setActionRow(null); }}>
        <p>{cashSession ? `Confirme somente após receber ${cashSession.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em dinheiro. O valor congelado não será alterado.` : 'Confirme a operação neste registro antes de continuar.'}</p>
        {notice?.error && <p className={styles.banner} role="alert">{notice.message}</p>}
        <div className={styles.dialogActions}><button type="button" className={styles.button} disabled={actionBusy} onClick={() => setActionRow(null)}>Cancelar</button><button type="button" className={`${styles.button} ${styles.primary}`} disabled={actionBusy || isReadOnlyMode} onClick={() => void confirmAction()}>{actionBusy ? 'Processando…' : cashSession ? 'Confirmar dinheiro recebido' : 'Confirmar operação'}</button></div>
      </OperationsDialog>}
    </div>
  </AppShell>;
}
