import type { Alert, StationFinanceRecords } from './emps';
import type { GieState } from './gie';
import { dateWindow, localDay, numeric } from './station-monitoring';

export function financialToday(records: StationFinanceRecords | undefined, timezone: string, now: number) {
  const day = localDay(new Date(now), timezone);
  const range = dateWindow(day, 'day', timezone);
  let received: number | null = records?.complete && records.payments.every(p => p.id) ? 0 : null;
  let outstanding: number | null = records?.complete && records.sessions.every(s => s.id) ? 0 : null;
  const inToday = (at: number) => at >= range.from && at < range.to && at <= now;
  // Amounts and statuses come from Nest. No tariff, cost or profit is estimated here.
  for (const payment of new Map(records?.payments.map(p => [p.id, p]) ?? []).values()) {
    if (!['APPROVED', 'PENDING', 'DECLINED', 'REFUNDED'].includes(payment.status)) { received = null; continue; }
    if (payment.status !== 'APPROVED') continue;
    if(payment.cashReturnedAmount!==undefined&&payment.cashReturnedAmount!==0){
      const returnedAt=payment.cashReturnedAt?Date.parse(payment.cashReturnedAt):NaN;
      if(!Number.isFinite(returnedAt)||payment.cashReturnedAmount===null||payment.cashReturnedAmount<0)received=null;
      else if(inToday(returnedAt)&&received!==null)received-=Math.round(payment.cashReturnedAmount*100);
    }
    const at = payment.paidAt ? Date.parse(payment.paidAt) : NaN;
    if (!Number.isFinite(at)) { received = null; continue; }
    if (!inToday(at)) continue;
    const amount = numeric(payment.amount);
    if (amount === null || amount < 0) received = null;
    else if (received !== null) received += Math.round(amount * 100);
  }
  for (const session of new Map(records?.sessions.map(s => [s.id, s]) ?? []).values()) {
    if (session.status !== 'FINISHED') continue;
    const at = session.endedAt ? Date.parse(session.endedAt) : NaN;
    if (!Number.isFinite(at)) { outstanding = null; continue; }
    if (!inToday(at) || ['APPROVED', 'REFUNDED'].includes(session.paymentStatus)) continue;
    if (!['PENDING', 'DECLINED'].includes(session.paymentStatus)) { outstanding = null; continue; }
    const amount = numeric(session.amount);
    if (amount === null || amount < 0) outstanding = null;
    else if (outstanding !== null) outstanding += Math.round(amount * 100);
  }
  return { day, received: received === null ? null : received / 100,
    outstanding: outstanding === null ? null : outstanding / 100, energyCost: null, operationalMargin: null };
}

export function stationNotices(alerts: Alert[], stationId: string, now: number, limit = 3) {
  return [...new Map(alerts.filter(alert =>
    (!alert.estacaoId || alert.estacaoId === stationId) && alert.status !== 'resolvido' &&
    Number.isFinite(Date.parse(alert.dataCriacao)) && Date.parse(alert.dataCriacao) <= now,
  ).map(alert => [alert.alertaId, alert])).values()]
    .sort((a, b) => Date.parse(b.dataCriacao) - Date.parse(a.dataCriacao))
    .slice(0, limit);
}

export function gieHealth(gie: GieState | null | undefined, stationId: string, now: number) {
  if (!gie || String(gie.station_id) !== stationId) return { label: 'GIE sem atualização', state: 'offline' };
  if (!gie.online) return { label: 'GIE offline', state: 'offline' };
  // The isolated replay clock belongs to its scenario, not physical telemetry.
  if (gie.isolated) return { label: 'GIE · simulação', state: 'simulated' };
  const at = Date.parse(gie.observed_at), age = now - at;
  if (!Number.isFinite(at) || age < -30_000) return { label: 'Horário do GIE indisponível', state: 'stale' };
  if (age > 60_000) return { label: `GIE sem atualização há ${Math.floor(age / 60_000)} min`, state: 'stale' };
  return ['PRESENTATION', 'MANUAL_DEMO', 'NORMAL'].includes(gie.mode)
    ? { label: 'GIE · simulação', state: 'simulated' }
    : { label: 'GIE atualizado', state: 'current' };
}
