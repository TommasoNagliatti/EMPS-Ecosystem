'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationLink as Link } from '@/components/shell/NavigationLink';
import { CircleCheck, CircleEllipsis, Clock3, Mail, MapPin, PanelTop, Plus, RotateCw, Search, TriangleAlert, WifiOff } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { api, isAccessDenied } from '@/services/emps-api';
import { StationListFilter, StationListLanguage } from './StationListControls';
import { StationListTable, type StationListSort } from './StationListTable';
import { stationListCopy } from './station-list-copy';
import { createdThisMonth, defaultColumns, emptyAdvanced, emptySearch, matchesStation, metricColumns, stationKind, stationMetric, stationStatus, stationTabs, type AdvancedFilters, type MetricColumn, type SearchFields, type StationListEntry, type StationLocale, type StationTab } from './station-list-model';
import styles from './station-list.module.css';

const statusIcons = { running: CircleCheck, waiting: Clock3, offline: WifiOff, fault: TriangleAlert, constructing: CircleEllipsis };

export function StationList({ fontClassName = '' }: { fontClassName?: string }) {
  const [rows, setRows] = useState<StationListEntry[]>(() => api.cached<StationListEntry[]>('/v2/stations')?.value ?? []);
  const [loading, setLoading] = useState(() => !api.cached('/v2/stations'));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [locale, setLocale] = useState<StationLocale>('pt-BR');
  const [draftSearch, setDraftSearch] = useState<SearchFields>({ ...emptySearch });
  const [search, setSearch] = useState<SearchFields>({ ...emptySearch });
  const [filters, setFilters] = useState<AdvancedFilters>({ ...emptyAdvanced });
  const [tab, setTab] = useState<StationTab>('all');
  const [reviewer, setReviewer] = useState(false);
  const [preferenceKey, setPreferenceKey] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [columns, setColumns] = useState<MetricColumn[]>([...defaultColumns]);
  const [sort, setSort] = useState<StationListSort>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const copy = stationListCopy[locale];

  const load = useCallback(async (signal?: AbortSignal, force = false) => {
    setLoading(!api.cached('/v2/stations')); setRefreshing(true); setError('');
    try {
      const [stations, user] = await Promise.all([
        api.platform<StationListEntry[]>('/v2/stations', { signal }, { force }),
        api.platform<{ id: number; platformReviewer: boolean }>('/auth/me', { signal }),
      ]);
      if (signal?.aborted) return;
      setRows(stations.map(station => ({ ...station, id: String(station.id) })));
      setReviewer(user.platformReviewer);
      const key = `emps.station-list.preferences.${user.id}`;
      setPreferenceKey(key);
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
        if (Array.isArray(saved.favorites)) setFavorites(saved.favorites.filter((id: unknown) => typeof id === 'string'));
        if (Array.isArray(saved.columns)) setColumns(metricColumns.filter(column => saved.columns.includes(column)));
      } catch { /* Invalid local preferences do not block the station list. */ }
    } catch (reason) {
      if (!signal?.aborted) { if (isAccessDenied(reason)) setRows([]); setError(reason instanceof Error ? reason.message : 'Unable to load stations'); }
    } finally { if (!signal?.aborted) { setLoading(false); setRefreshing(false); } }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    try { if (localStorage.getItem('emps.station-list.language') === 'en') setLocale('en'); } catch { /* Storage may be unavailable. */ }
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!preferenceKey) return;
    try { localStorage.setItem(preferenceKey, JSON.stringify({ favorites, columns })); } catch { /* Preferences remain available for this visit. */ }
  }, [preferenceKey, favorites, columns]);

  const searched = useMemo(() => rows.filter(station => matchesStation(station, search, filters, favorites)), [rows, search, filters, favorites]);
  const counts = Object.fromEntries(stationTabs.map(key => [key, searched.filter(station => key === 'all' || key === 'monthly' && createdThisMonth(station) || stationStatus(station) === key).length])) as Record<StationTab, number>;
  const filtered = useMemo(() => {
    const result = searched.filter(station => tab === 'all' || tab === 'monthly' && createdThisMonth(station) || stationStatus(station) === tab);
    if (sort) result.sort((a, b) => {
      const left = sort.column === 'kind' ? stationKind(a) : stationMetric(a, 'solarCapacity');
      const right = sort.column === 'kind' ? stationKind(b) : stationMetric(b, 'solarCapacity');
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      const comparison = typeof left === 'string' && typeof right === 'string' ? copy.kinds[left as keyof typeof copy.kinds].localeCompare(copy.kinds[right as keyof typeof copy.kinds], locale) : Number(left) - Number(right);
      return sort.direction === 'asc' ? comparison : -comparison;
    });
    return result;
  }, [searched, tab, sort, copy, locale]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const reset = () => { setDraftSearch({ ...emptySearch }); setSearch({ ...emptySearch }); setFilters({ ...emptyAdvanced }); setTab('all'); setPage(1); setSort(null); void load(undefined, true); };
  const setLanguage = (value: StationLocale) => {
    setLocale(value);
    try { localStorage.setItem('emps.station-list.language', value); } catch { /* The language still changes without persistent storage. */ }
  };

  return <AppShell eyebrow="EMPS" title={copy.title} hideEyebrow showRealtimeStatus={false} className={`${styles.shell} ${fontClassName}`} languageControl={<StationListLanguage locale={locale} copy={copy} onChange={setLanguage} />}>
    <section className={styles.page} lang={locale} aria-label={copy.title}>
      <form className={styles.toolbar} onSubmit={event => { event.preventDefault(); setSearch({ ...draftSearch }); setPage(1); }}>
        <StationListFilter value={filters} rows={rows} copy={copy} onApply={value => { setFilters(value); setPage(1); }} />
        {([{ key: 'name', icon: PanelTop, label: copy.name }, { key: 'address', icon: MapPin, label: copy.address }, { key: 'email', icon: Mail, label: copy.email }] as const).map(field => <label className={styles.searchField} key={field.key}>
          <field.icon size={17} aria-hidden="true" /><input type="search" value={draftSearch[field.key]} aria-label={field.label} placeholder={field.label} onChange={event => setDraftSearch(current => ({ ...current, [field.key]: event.target.value }))} />
        </label>)}
        <button className={styles.searchButton} type="submit" title={copy.search} aria-label={copy.search}><Search size={19} aria-hidden="true" /></button>
        <button className={styles.searchButton} type="button" disabled={loading || refreshing} onClick={reset} title={copy.reset} aria-label={copy.reset}><RotateCw size={19} aria-hidden="true" className={loading || refreshing ? styles.spinning : ''} /></button>
        <Link className={styles.newStation} href="/stations/new"><Plus size={18} aria-hidden="true" />{copy.newStation}</Link>
      </form>
      <nav className={styles.tabs} aria-label={copy.filter}>
        {stationTabs.map(key => {
          const Icon = key === 'all' || key === 'monthly' ? null : statusIcons[key];
          return <button type="button" key={key} className={`${styles.tab} ${styles[key]} ${tab === key ? styles.activeTab : ''}`} aria-pressed={tab === key} title={key === 'all' || key === 'monthly' ? copy.tabs[key] : copy.statuses[key]} onClick={() => { setTab(key); setPage(1); }}>
            {Icon && <Icon size={16} aria-hidden="true" />}<span>{copy.tabs[key]}</span><span className={styles.tabCount}>({counts[key]})</span>
          </button>;
        })}
      </nav>
      <StationListTable rows={filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)} columns={columns} favorites={favorites} copy={copy} locale={locale} loading={loading} error={error} onRetry={() => void load()}
        onColumnsChange={setColumns} onFavorite={id => setFavorites(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])}
        sort={sort} onSort={column => setSort(current => ({ column, direction: current?.column === column && current.direction === 'asc' ? 'desc' : 'asc' }))}
        total={filtered.length} page={currentPage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={value => { setPageSize(value); setPage(1); }} />
      {reviewer && <Link className={styles.reviewLink} href="/reviews">{copy.reviews}</Link>}
    </section>
  </AppShell>;
}
