'use client';

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { isCalendarDay, localDay, moveMonitoringDay, type MonitoringPeriod } from '@/domain/station-monitoring';
import { Popover } from '@/components/ui/Popover';
import styles from './station-dashboard.module.css';

const periods: { id: MonitoringPeriod; label: string }[] = [
  { id: 'day', label: 'Dia' }, { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mês' }, { id: 'year', label: 'Ano' },
];

export function DateControl({ day, period, timezone, onDay, onPeriod, label }: {
  day: string; period: MonitoringPeriod; timezone: string;
  onDay: (day: string) => void; onPeriod: (period: MonitoringPeriod) => void; label: string;
}) {
  const today = localDay(new Date(), timezone);
  const previous = moveMonitoringDay(day, period, -1, today);
  const next = moveMonitoringDay(day, period, 1, today);
  const changeDay = (value: string) => { if (isCalendarDay(value) && value <= today) onDay(value); };
  return <div className={styles.dateControl}>
    <div className={styles.dateStepper}>
      <button type="button" title="Período anterior" aria-label={`${label}: período anterior`} disabled={!previous} onClick={() => previous && onDay(previous)}><ChevronLeft size={14} /></button>
      <input type="date" value={day} min="1000-01-01" max={today} aria-label={`${label}: data`} onInput={event => changeDay(event.currentTarget.value)} onChange={event => changeDay(event.target.value)} />
      <button type="button" title="Próximo período" aria-label={`${label}: próximo período`} disabled={!next} onClick={() => next && onDay(next)}><ChevronRight size={14} /></button>
    </div>
    <Popover label={`${label}: período`} buttonClassName={styles.periodTrigger} className={styles.periodMenu} trigger={<><span>{periods.find(item => item.id === period)?.label}</span><ChevronDown size={13} /></>}>
      {close => <div role="menu" aria-label={`${label}: escolher período`} onKeyDown={event => {
        const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }}>{periods.map(item => <button key={item.id} type="button" role="menuitemradio" aria-checked={period === item.id} onClick={() => { onPeriod(item.id); close(); }}>{item.label}</button>)}</div>}
    </Popover>
  </div>;
}
