'use client';

import { useState } from 'react';
import { Check, Filter, Globe2, RotateCcw, Settings2 } from 'lucide-react';
import { StationListPopover } from './StationListPopover';
import { defaultColumns, emptyAdvanced, metricColumns, type AdvancedFilters, type MetricColumn, type StationKind, type StationListEntry, type StationLocale } from './station-list-model';
import type { StationListCopy } from './station-list-copy';
import styles from './station-list.module.css';

export function StationListLanguage({ locale, copy, onChange }: { locale: StationLocale; copy: StationListCopy; onChange: (value: StationLocale) => void }) {
  return <StationListPopover label={copy.language} buttonClassName="sems-top-action" className={styles.languagePopover} trigger={<Globe2 size={19} aria-hidden="true" />}>
    {close => <div className={styles.menu} lang={locale}>
      {([{ code: 'pt-BR', label: 'Português', lang: 'pt-BR' }, { code: 'en', label: 'English', lang: 'en' }] as const).map(option =>
        <button type="button" key={option.code} lang={option.lang} aria-pressed={locale === option.code} onClick={() => { onChange(option.code); close(); }}>
          <span>{option.label}</span>{locale === option.code && <Check size={15} aria-hidden="true" />}
        </button>)}
    </div>}
  </StationListPopover>;
}

function AdvancedFilterForm({ value, rows, copy, onApply, close }: {
  value: AdvancedFilters; rows: StationListEntry[]; copy: StationListCopy; onApply: (value: AdvancedFilters) => void; close: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const owners = [...new Map(rows.filter(row => row.listSummary?.contactEmail).map(row => [row.listSummary!.contactEmail, row.listSummary!])).values()];
  const validRange = draft.minPower === '' || draft.maxPower === '' || Number(draft.maxPower) >= Number(draft.minPower);
  const field = <K extends keyof AdvancedFilters>(key: K, value: AdvancedFilters[K]) => setDraft(current => ({ ...current, [key]: value }));
  return <form className={styles.advancedForm} onSubmit={event => { event.preventDefault(); if (validRange) { onApply(draft); close(); } }}>
    <div className={styles.popoverHeading}><strong>{copy.filter}</strong><div>
      <button type="button" className={styles.textButton} onClick={() => setDraft({ ...emptyAdvanced })}>{copy.advanced.reset}</button>
      <button className={styles.confirmButton} type="submit" disabled={!validRange}>{copy.advanced.confirm}</button>
    </div></div>
    <fieldset><legend>{copy.advanced.kind}</legend><div className={styles.kindOptions}>
      {(Object.keys(copy.kinds) as StationKind[]).map(kind => <label key={kind} className={draft.kind === kind ? styles.selectedOption : ''}>
        <input type="radio" name="station-kind" value={kind} checked={draft.kind === kind} onChange={() => field('kind', kind)} /><span>{copy.kinds[kind]}</span>
      </label>)}
    </div></fieldset>
    <label className={styles.formField}>{copy.advanced.owner}<select value={draft.owner} onChange={event => field('owner', event.target.value)}>
      <option value="">{copy.advanced.allOwners}</option>{owners.map(owner => <option key={owner.contactEmail} value={owner.contactEmail}>{owner.ownerName}</option>)}
    </select></label>
    <fieldset><legend>{copy.advanced.power}</legend><div className={styles.powerRange}>
      <label><input type="number" min="0" step="0.1" aria-label={`${copy.advanced.power} ${copy.advanced.min}`} placeholder={copy.advanced.min} value={draft.minPower} onChange={event => field('minPower', event.target.value)} /><span>kW</span></label>
      <span aria-hidden="true">-</span>
      <label><input type="number" min="0" step="0.1" aria-label={`${copy.advanced.power} ${copy.advanced.max}`} placeholder={copy.advanced.max} value={draft.maxPower} onChange={event => field('maxPower', event.target.value)} /><span>kW</span></label>
    </div>{!validRange && <p className={styles.rangeError} role="alert">{copy.advanced.rangeError}</p>}</fieldset>
    <fieldset><legend>{copy.advanced.source}</legend><div className={styles.sourceOptions}>
      {(['managed', 'shared'] as const).map(source => <label key={source}><input type="radio" name="station-source" checked={draft.source === source} onChange={() => field('source', source)} />{copy.advanced[source]}</label>)}
    </div></fieldset>
    <label className={styles.checkbox}><input type="checkbox" checked={draft.starred} onChange={event => field('starred', event.target.checked)} />{copy.advanced.starred}</label>
  </form>;
}

export function StationListFilter({ value, rows, copy, onApply }: { value: AdvancedFilters; rows: StationListEntry[]; copy: StationListCopy; onApply: (value: AdvancedFilters) => void }) {
  const active = Object.entries(value).some(([key, item]) => item !== emptyAdvanced[key as keyof AdvancedFilters]);
  return <StationListPopover label={copy.filter} buttonClassName={styles.filterButton} className={styles.filterPopover} active={active} align="start" trigger={<><Filter size={16} aria-hidden="true" />{copy.filter}{active && <i className={styles.filterDot} />}</>}>
    {close => <AdvancedFilterForm value={value} rows={rows} copy={copy} onApply={onApply} close={close} />}
  </StationListPopover>;
}

export function StationListColumns({ columns, copy, onChange }: { columns: MetricColumn[]; copy: StationListCopy; onChange: (value: MetricColumn[]) => void }) {
  return <StationListPopover label={copy.columnsTitle} buttonClassName={styles.columnButton} className={styles.columnPopover} trigger={<Settings2 size={19} aria-hidden="true" />}>
    {() => <><div className={styles.popoverHeading}><strong>{copy.columnsTitle}</strong><button className={styles.textButton} type="button" title={copy.advanced.reset} onClick={() => onChange([...defaultColumns])}><RotateCcw size={15} /></button></div>
      <div className={styles.columnOptions}>{metricColumns.map(column => <label className={styles.checkbox} key={column}>
        <input type="checkbox" checked={columns.includes(column)} onChange={event => onChange(event.target.checked ? metricColumns.filter(key => key === column || columns.includes(key)) : columns.filter(key => key !== column))} />{copy.columns[column]}
      </label>)}</div></>}
  </StationListPopover>;
}
