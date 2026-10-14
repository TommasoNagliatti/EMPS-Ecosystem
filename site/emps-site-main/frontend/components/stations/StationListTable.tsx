'use client';

import { NavigationLink as Link } from '@/components/shell/NavigationLink';
import { ChevronLeft, ChevronRight, ChevronsUpDown, Inbox, MoreHorizontal, Star, Zap } from 'lucide-react';
import { StationPhoto } from './StationPhoto';
import { StationListColumns } from './StationListControls';
import { StationListPopover } from './StationListPopover';
import { stationAddress, stationKind, stationMetric, stationStatus, type MetricColumn, type StationListEntry, type StationLocale } from './station-list-model';
import type { StationListCopy } from './station-list-copy';
import styles from './station-list.module.css';

export type StationListSort = { column: 'solarCapacity' | 'kind'; direction: 'asc' | 'desc' } | null;

export function StationListTable({ rows, columns, favorites, copy, locale, loading, error, onRetry, onColumnsChange, onFavorite, sort, onSort, total, page, pageSize, onPageChange, onPageSizeChange }: {
  rows: StationListEntry[]; columns: MetricColumn[]; favorites: string[]; copy: StationListCopy; locale: StationLocale;
  loading: boolean; error: string; onRetry: () => void; onColumnsChange: (value: MetricColumn[]) => void; onFavorite: (id: string) => void;
  sort: StationListSort; onSort: (column: 'solarCapacity' | 'kind') => void; total: number; page: number; pageSize: number;
  onPageChange: (value: number) => void; onPageSizeChange: (value: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pageNumbers = [...new Set([1, page - 1, page, page + 1, pages])].filter(value => value >= 1 && value <= pages).sort((a, b) => a - b);
  return <>
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={copy.info} aria-busy={loading}>
      <table className={styles.table}>
        <thead><tr><th className={styles.infoColumn} scope="col">{copy.info}</th>
          {columns.map(column => <th scope="col" key={column} className={styles.metricColumn} aria-sort={sort?.column === column ? sort.direction === 'asc' ? 'ascending' : 'descending' : undefined}>
            {column === 'solarCapacity' || column === 'kind' ? <button type="button" className={styles.sortButton} onClick={() => onSort(column)} title={`${copy.sort} ${copy.columns[column]}`}>{copy.columns[column]}<ChevronsUpDown size={14} aria-hidden="true" /></button> : copy.columns[column]}
          </th>)}
          <th className={styles.operationColumn} scope="col"><div>{copy.operation}<StationListColumns columns={columns} copy={copy} onChange={onColumnsChange} /></div></th>
        </tr></thead>
        <tbody>
          {!loading && !error && rows.map(station => {
            const favorite = favorites.includes(station.id);
            const status = stationStatus(station);
            const detailHref = `/stations/${station.id}/dashboard`;
            return <tr key={station.id}>
              <td className={styles.infoColumn}><Link className={styles.stationInfo} href={detailHref}>
                <div className={styles.thumbnail}><StationPhoto id={station.photos[0]?.id} alt={station.name} /></div>
                <div className={styles.stationCopy}><div className={styles.stationName}><strong title={station.name}>{station.name}</strong>
                  <span className={styles.visibilityTag}>{station.membershipRole !== 'OWNER' ? copy.shared : station.visibility === 'PUBLIC' ? copy.public : copy.private}</span>
                </div><span className={styles.address} title={stationAddress(station)}>{stationAddress(station) || copy.noAddress}</span>
                  <span className={styles.ratedPower}><Zap size={13} aria-hidden="true" />{station.powerLimitKw == null ? '--' : number.format(Number(station.powerLimitKw))} kW</span>
                </div></Link></td>
              {columns.map(column => <td className={styles.metricColumn} key={column}>
                {column === 'kind' ? copy.kinds[stationKind(station)] : column === 'status' ? <span className={`${styles.statusText} ${styles[status]}`} title={copy.statuses[status]}><i />{copy.tabs[status]}</span> : (() => {
                  const value = stationMetric(station, column);
                  return value === null ? <span className={styles.missing} title={copy.noMetric}>--</span> : <span title={station.listSummary?.telemetry ? new Date(station.listSummary.telemetry.measuredAt).toLocaleString(locale) : undefined}>{column === 'batterySoc' ? Math.round(value) : number.format(value)}</span>;
                })()}
              </td>)}
              <td className={styles.operationColumn}><div className={styles.rowActions}>
                <button type="button" className={`${styles.favoriteButton} ${favorite ? styles.starred : ''}`} title={favorite ? copy.unfavorite : copy.favorite} aria-label={`${favorite ? copy.unfavorite : copy.favorite}: ${station.name}`} aria-pressed={favorite} onClick={() => onFavorite(station.id)}><Star size={18} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" /></button>
                <StationListPopover label={`${copy.more}: ${station.name}`} buttonClassName={styles.moreButton} className={styles.operationPopover} trigger={<MoreHorizontal size={20} aria-hidden="true" />}>
                  {close => <div className={styles.menu}>
                    <Link href={detailHref} onClick={close}>{copy.dashboard}</Link>
                    {station.reviewState === 'DRAFT' || station.reviewState === 'CHANGES_REQUESTED' || station.reviewState === 'REJECTED' ? <Link href={`/stations/${station.id}`} onClick={close}>{copy.continueDraft}</Link> : null}
                    <Link href={`/stations/${station.id}`} onClick={close}>{copy.settings}</Link>
                    <Link href={`/stations/${station.id}/telemetry`} onClick={close}>{copy.telemetry}</Link>
                  </div>}
                </StationListPopover>
              </div></td>
            </tr>;
          })}
          {(loading || error || !rows.length) && <tr><td colSpan={columns.length + 2} className={styles.emptyCell}>
            <div className={styles.emptyState} role={error ? 'alert' : 'status'}><Inbox size={43} strokeWidth={1.2} aria-hidden="true" /><span>{loading ? copy.loading : error ? copy.failed : copy.noData}</span>
              {error && <button type="button" className={styles.textButton} onClick={onRetry}>{copy.retry}</button>}
            </div>
          </td></tr>}
        </tbody>
      </table>
    </div>
    <footer className={styles.tableFooter}><span className={styles.resultCount}>{total} {copy.results}</span>
      <nav className={styles.pagination} aria-label={copy.page}>
        <button type="button" className={styles.pageButton} disabled={page <= 1 || loading} aria-label={copy.previous} title={copy.previous} onClick={() => onPageChange(page - 1)}><ChevronLeft size={17} aria-hidden="true" /></button>
        {pageNumbers.map((value, index) => <span className={styles.pageNumberGroup} key={value}>{index > 0 && value - pageNumbers[index - 1] > 1 && <span className={styles.pageGap}>...</span>}
          <button className={`${styles.pageButton} ${value === page ? styles.currentPage : ''}`} type="button" aria-current={value === page ? 'page' : undefined} aria-label={`${copy.page} ${value}`} onClick={() => onPageChange(value)}>{value}</button></span>)}
        <button type="button" className={styles.pageButton} disabled={page >= pages || loading} aria-label={copy.next} title={copy.next} onClick={() => onPageChange(page + 1)}><ChevronRight size={17} aria-hidden="true" /></button>
        <select className={styles.pageSize} value={pageSize} aria-label={copy.perPage} onChange={event => onPageSizeChange(Number(event.target.value))}>{[15, 30, 50].map(size => <option key={size} value={size}>{size} {copy.perPage}</option>)}</select>
      </nav>
    </footer>
  </>;
}
