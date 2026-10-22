'use client';

import { Info, QrCode, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavigationLink as Link } from '@/components/shell/NavigationLink';
import { QRCodeSVG } from 'qrcode.react';
import { api, isReadOnlyMode, isAccessDenied } from '@/services/emps-api';
import { formatKw } from '@/utils/formatters';
import { OperationsDialog, OperationsEmpty, OperationsHeader, OperationsPagination, OperationsSummary } from '@/components/operations/OperationsUI';
import { pageSlice } from '@/components/operations/operational-model';
import { chargerNominalPower, chargerPower, chargerState, matchesCharger, type ListedCharger } from './charger-list-model';
import { webChargeUrl } from '@/domain/web-charge-url';
import styles from '@/components/operations/operations.module.css';

const filters = [{ key: 'all', label: 'Todos' }, { key: 'available', label: 'Disponíveis' }, { key: 'charging', label: 'Em uso' },
  { key: 'unknown', label: 'Sem comunicação' }, { key: 'maintenance', label: 'Manutenção' }, { key: 'unavailable', label: 'Indisponíveis' },
  { key: 'pending', label: 'Pendentes' }, { key: 'disabled', label: 'Desabilitados' }];

export function CanonicalChargers({ navigation }: { navigation?: ReactNode }) {
  const [stations, setStations] = useState<ListedCharger['station'][]>(() => api.cached<ListedCharger['station'][]>('/v2/stations')?.value ?? []);
  const [rows, setRows] = useState<ListedCharger[]>(() => api.cached<ListedCharger[]>('/v2/chargers')?.value ?? []);
  const [station, setStation] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(() => !api.cached('/v2/chargers'));
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(() => { const cached = api.cached('/v2/chargers'); return cached ? new Date(cached.updatedAt) : null; });
  const [selected, setSelected] = useState<ListedCharger | null>(null);
  const [qrCharger, setQrCharger] = useState<ListedCharger | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (silent && inFlight.current) return;
    const current = ++generation.current;
    inFlight.current = true;
    if (silent || api.cached('/v2/chargers')) setRefreshing(true); else setLoading(true);
    try {
      const [chargers, availableStations] = await Promise.all([api.platform<ListedCharger[]>('/v2/chargers', {}, { force: silent }), api.platform<ListedCharger['station'][]>('/v2/stations', {}, { force: silent })]);
      if (current !== generation.current) return;
      setRows(chargers); setStations(availableStations); setLoadedAt(new Date(api.cached('/v2/chargers')?.updatedAt ?? Date.now())); setError('');
    } catch (cause) {
      if (current === generation.current) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os carregadores.'); if (!silent || isAccessDenied(cause)) { setRows([]); setLoadedAt(null); } }
    } finally { if (current === generation.current) { inFlight.current = false; setLoading(false); setRefreshing(false); } }
  }, []);
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const now = loadedAt?.getTime() ?? Date.now();
  const scoped = useMemo(() => rows.filter(charger => matchesCharger(charger, query, station, 'all', now)), [rows, query, station, now]);
  const visible = useMemo(() => scoped.filter(charger => filter === 'all' || chargerState(charger, now).key === filter), [scoped, filter, now]);
  const pagination = pageSlice(visible, page);
  const hasFilters = Boolean(query || station || filter !== 'all');
  const qrUrl = qrCharger?.qrBindings[0] ? webChargeUrl(qrCharger.qrBindings[0].publicToken,
    typeof window === 'undefined' ? undefined : window.location.origin) : '';
  function reset() { setStation(''); setQuery(''); setFilter('all'); setPage(1); }
  async function qr(charger: ListedCharger) {
    if (busy || charger.administrativeStatus === 'DISABLED') return;
    if (charger.qrBindings[0]) { setQrCharger(charger); return; }
    if (isReadOnlyMode) return;
    setBusy(true);
    try {
      const binding = await api.platform<ListedCharger['qrBindings'][number]>(`/v2/chargers/${charger.id}/qr`, { method: 'POST' });
      const updated = { ...charger, qrBindings: [binding] };
      setRows(current => current.map(row => row.id === charger.id ? updated : row)); setQrCharger(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'QR indisponível.'); }
    finally { setBusy(false); }
  }

  return <div className={styles.page}>
    <OperationsHeader title="Carregadores" subtitle="Equipamentos, comunicação e acesso à recarga." refreshing={loading || refreshing} onRefresh={() => void load(true)} readOnly={isReadOnlyMode} />
    {navigation}
    <OperationsSummary loading={loading || (!loadedAt && Boolean(error))} metrics={[
      { label: 'Equipamentos', value: scoped.length }, { label: 'Habilitados', value: scoped.filter(row => row.administrativeStatus === 'ENABLED').length, tone: 'green' },
      { label: 'Em uso', value: scoped.filter(row => chargerState(row, now).key === 'charging').length, tone: 'blue' },
      { label: 'Sem comunicação recente', value: scoped.filter(row => chargerState(row, now).key === 'unknown').length, tone: 'amber' },
    ]} />
    <div className={styles.toolbar}>
      <label className={styles.search}><Search size={17} /><input aria-label="Buscar carregadores" placeholder="Buscar nome, ID, instalação ou identidade OCPP" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />{query && <button type="button" title="Limpar busca" aria-label="Limpar busca" onClick={() => { setQuery(''); setPage(1); }}><X size={15} /></button>}</label>
      <select className={styles.select} aria-label="Instalação" value={station} onChange={event => { setStation(event.target.value); setPage(1); }}><option value="">Todas as instalações</option>{stations.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      {hasFilters && <button type="button" className={styles.iconButton} title="Limpar filtros" aria-label="Limpar filtros" onClick={reset}><X size={16} /></button>}
    </div>
    <div className={styles.statusTabs} aria-label="Situação dos carregadores">{filters.map(item => <button key={item.key} type="button" aria-pressed={filter === item.key} onClick={() => { setFilter(item.key); setPage(1); }}>{item.label}<span>{loading ? '—' : scoped.filter(row => item.key === 'all' || chargerState(row, now).key === item.key).length}</span></button>)}</div>
    {error && rows.length > 0 && <div className={styles.banner} role="alert"><p>{error}</p><button className={styles.button} type="button" onClick={() => void load(true)}>Tentar novamente</button></div>}
    <section className={styles.tableSection} aria-label="Carregadores cadastrados" aria-busy={loading}>
      <div className={styles.tableMeta}><strong>{loading ? 'Consultando equipamentos' : `${visible.length} ${visible.length === 1 ? 'carregador' : 'carregadores'}`}</strong>{loadedAt && <time dateTime={loadedAt.toISOString()}>Atualizado às {loadedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>}</div>
      {loading ? <OperationsEmpty loading /> : error && !rows.length ? <OperationsEmpty error={error} onRetry={() => void load()} /> : !visible.length ? <OperationsEmpty filtered={hasFilters} onReset={reset} noun="carregadores" /> : <div className={styles.tableScroll} role="region" aria-label="Tabela de carregadores" tabIndex={0}><table className={styles.table}>
        <thead><tr><th scope="col">Equipamento</th><th scope="col">Instalação</th><th scope="col">Conector</th><th scope="col" className={styles.numeric}>Potência nominal</th><th scope="col">Cadastro</th><th scope="col">Operação</th><th scope="col">Ações</th></tr></thead>
        <tbody>{pagination.rows.map(charger => { const state = chargerState(charger, now); return <tr key={charger.id}>
          <td><div className={styles.entity}><strong>{charger.name}</strong><small>#{charger.id}{charger.location ? ` · ${charger.location}` : ''}</small></div></td>
          <td><Link className={styles.truncate} title={charger.station.name} href={`/stations/${charger.stationId}`}>{charger.station.name}</Link></td>
          <td>{charger.connectorType || '—'}</td><td className={styles.numeric}>{chargerNominalPower(charger) == null ? '—' : formatKw(chargerNominalPower(charger)!)}</td>
          <td><span className={styles.status} data-tone={charger.administrativeStatus === 'ENABLED' ? 'green' : 'amber'}>{({ ENABLED: 'Habilitado', DISABLED: 'Desabilitado', MAINTENANCE: 'Manutenção', PENDING: 'Pendente' } as Record<string, string>)[charger.administrativeStatus] || charger.administrativeStatus}</span></td>
          <td><span className={styles.status} data-tone={state.tone}>{state.label}</span></td>
          <td><div className={styles.cellActions}><button className={styles.iconButton} type="button" title={`Ver detalhes · ${charger.name}`} aria-label={`Ver detalhes · ${charger.name}`} onClick={() => setSelected(charger)}><Info size={16} /></button><button className={styles.iconButton} type="button" title={isReadOnlyMode && !charger.qrBindings.length ? 'QR não cadastrado · acesso somente leitura' : `Ver QR · ${charger.name}`} aria-label={`Ver QR · ${charger.name}`} disabled={busy || charger.administrativeStatus === 'DISABLED' || (isReadOnlyMode && !charger.qrBindings.length)} onClick={() => void qr(charger)}><QrCode size={17} /></button></div></td>
        </tr>; })}</tbody>
      </table></div>}
    </section>
    {!loading && !error && <OperationsPagination page={pagination.currentPage} pages={pagination.pageCount} first={pagination.first} last={pagination.last} total={visible.length} onPage={setPage} />}
    {selected && <OperationsDialog title={`${selected.name} · #${selected.id}`} onClose={() => setSelected(null)}>
      <dl className={styles.details}>
        <div><dt>Instalação</dt><dd><Link href={`/stations/${selected.stationId}`}>{selected.station.name}</Link></dd></div><div><dt>Operação</dt><dd>{chargerState(selected, now).label}</dd></div>
        <div><dt>Identidade OCPP</dt><dd>{selected.ocppIdentity}</dd></div><div><dt>Número de série</dt><dd>{selected.serialNumber || 'Não informado'}</dd></div>
        <div><dt>Conector</dt><dd>{selected.connectorType || 'Não informado'}</dd></div><div><dt>Potência atual</dt><dd>{chargerPower(selected, now) == null ? 'Sem leitura recente' : formatKw(chargerPower(selected, now)!)}</dd></div>
        <div><dt>Fabricante / modelo</dt><dd>{[selected.manufacturer, selected.model].filter(Boolean).join(' · ') || 'Não informado'}</dd></div>
        <div><dt>Última comunicação</dt><dd>{selected.liveStatus?.lastSeenAt && Number.isFinite(new Date(selected.liveStatus.lastSeenAt).getTime()) ? new Date(selected.liveStatus.lastSeenAt).toLocaleString('pt-BR') : 'Não registrada'}</dd></div>
      </dl>
    </OperationsDialog>}
    {qrCharger && <OperationsDialog title={`QR de recarga · ${qrCharger.name}`} onClose={() => setQrCharger(null)}>
      <div className={styles.qr}><QRCodeSVG value={qrUrl} size={200} bgColor="#ffffff" fgColor="#000000" marginSize={4} /><Link href={qrUrl} target="_blank" rel="noreferrer">Abrir recarga</Link></div>
    </OperationsDialog>}
  </div>;
}
