export type MonitoringPeriod = 'day' | 'week' | 'month' | 'year';
export type Reading = {
  id?: string; measuredAt: string; sourceId?: string; provenance?: string;
  source?: { id: string; label: string; kind: string; verifiedPhysical?: boolean } | null;
  measurementQuality?: string; readingSource?: string;
  solarPowerKw?: unknown; gridPowerKw?: unknown; batteryPowerKw?: unknown;
  batteryChargePowerKw?: unknown; batteryDischargePowerKw?: unknown;
  chargerPowerKw?: unknown; buildingPowerKw?: unknown; batteryStateOfChargePercent?: unknown;
  outsideTemperatureC?: unknown; relativeHumidityPercent?: unknown;
};
export type MonitorPoint = {
  at: number; x: number; day: string; label: string; hour: number;
  solar: number | null; grid: number | null; battery: number | null;
  charger: number | null; load: number | null; soc: number | null;
  importTariff: number | null; exportTariff: number | null;
  sourceLabel?: string; provenance?: string; quality?: string;
};

export function isNonSimulatedReading(row: Reading) {
  return row.provenance !== 'SIMULATED' && row.source?.kind !== 'SIMULATED' && row.readingSource !== 'SIMULATOR';
}
export const series = [
  { key: 'solar', label: 'Potência solar', color: '#d3ab32' },
  { key: 'load', label: 'Consumo do prédio', color: '#9e73d0' },
  { key: 'battery', label: 'Potência da bateria', color: '#69b75e' },
  { key: 'grid', label: 'Potência da rede', color: '#4395c8' },
  { key: 'charger', label: 'Carregadores', color: '#ef8e5b' },
] as const;
export type PowerKey = typeof series[number]['key'];

export function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
export function safeTimezone(value?: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: value || 'America/Sao_Paulo' }).format(); return value || 'America/Sao_Paulo'; }
  catch { return 'America/Sao_Paulo'; }
}
export function localDay(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: safeTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-');
}
export function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function isCalendarDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1000-01-01') return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function moveMonitoringDay(day: string, period: MonitoringPeriod, direction: -1 | 1, today: string): string | null {
  if (!isCalendarDay(day) || !isCalendarDay(today) || day > today) return null;
  let target: string;
  if (period === 'day' || period === 'week') target = shiftDay(day, direction * (period === 'week' ? 7 : 1));
  else {
    const date = new Date(`${day}T12:00:00Z`), originalDay = date.getUTCDate();
    date.setUTCDate(1);
    if (period === 'month') date.setUTCMonth(date.getUTCMonth() + direction);
    else date.setUTCFullYear(date.getUTCFullYear() + direction);
    const last = new Date(date);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(originalDay, last.getUTCDate()));
    target = date.toISOString().slice(0, 10);
  }
  if (!isCalendarDay(target)) return null;
  if (target <= today) return target;
  return direction === 1 && dateWindow(target, period, 'UTC').first <= today ? today : null;
}
// Convert a calendar date in the station's timezone, not the operator's browser timezone.
export function midnight(day: string, timezone: string) {
  const target = Date.parse(`${day}T00:00:00Z`);
  let time = target;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: safeTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 3; i++) {
    const parts = formatter.formatToParts(new Date(time));
    const get = (key: string) => parts.find(p => p.type === key)?.value;
    const wall = Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);
    time += target - wall;
  }
  return time;
}
export function dateWindow(day: string, period: MonitoringPeriod, timezone: string) {
  let first = day;
  let end = shiftDay(day, 1);
  if (period === 'week') { first = shiftDay(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7)); end = shiftDay(first, 7); }
  if (period === 'month') { first = `${day.slice(0, 7)}-01`; const date = new Date(`${first}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1); end = date.toISOString().slice(0, 10); }
  if (period === 'year') { first = `${day.slice(0, 4)}-01-01`; end = `${Number(day.slice(0, 4)) + 1}-01-01`; }
  return { from: midnight(first, timezone), to: midnight(end, timezone), first, end };
}
export function sourceKey(row: Reading) { return `${row.source?.id ?? row.sourceId ?? 'legacy'}:${row.provenance ?? 'UNKNOWN'}`; }
export function normalizeReadings(rows: Reading[], timezone: string, origin: number): MonitorPoint[] {
  const unique = new Map<number, Reading>();
  for (const row of rows) {
    const at = Date.parse(row.measuredAt);
    if (Number.isFinite(at) && !unique.has(at)) unique.set(at, row);
  }
  return [...unique].sort(([a], [b]) => a - b).map(([at, row]) => {
    const good = !row.measurementQuality || row.measurementQuality === 'GOOD';
    const n = (value: unknown, positive = false) => { const number = good ? numeric(value) : null; return number !== null && positive && number < 0 ? null : number; };
    const charge = n(row.batteryChargePowerKw, true), discharge = n(row.batteryDischargePowerKw, true);
    const soc = n(row.batteryStateOfChargePercent, true);
    return {
      at, x: (at - origin) / 60_000, day: localDay(new Date(at), timezone),
      hour: Number(new Intl.DateTimeFormat('en', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(at)),
      label: new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(at),
      solar: n(row.solarPowerKw, true), grid: n(row.gridPowerKw),
      battery: charge !== null && discharge !== null ? discharge - charge : n(row.batteryPowerKw),
      charger: n(row.chargerPowerKw, true), load: n(row.buildingPowerKw, true),
      soc: soc !== null && soc <= 100 ? soc : null, importTariff: null, exportTariff: null,
      sourceLabel: row.source?.label ?? 'Fonte não informada', provenance: row.provenance ?? 'UNKNOWN', quality: row.measurementQuality ?? 'UNKNOWN',
    };
  });
}
export function withGaps(points: MonitorPoint[]) {
  return points.flatMap((point, index) => index && point.at - points[index - 1].at > 20 * 60_000
    ? [{ ...point, quality: 'MISSING', at: points[index - 1].at + 1, x: points[index - 1].x + .001, solar: null, grid: null, battery: null, charger: null, load: null, soc: null, importTariff: null, exportTariff: null }, point]
    : [point]);
}
export function integrate(points: MonitorPoint[], key: PowerKey, direction: 'all' | 'positive' | 'negative' = 'all') {
  let total = 0, hours = 0;
  const transform = (n: number) => direction === 'positive' ? Math.max(0, n) : direction === 'negative' ? Math.max(0, -n) : n;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], duration = (b.at - a.at) / 3_600_000;
    if (duration <= 0 || duration > 1 / 3 || a[key] === null || b[key] === null) continue;
    total += (transform(a[key]!) + transform(b[key]!)) * .5 * duration;
    hours += duration;
  }
  return { value: hours ? total : null, hours };
}
export function summarize(points: MonitorPoint[]) {
  return { solar: integrate(points, 'solar').value, charger: integrate(points, 'charger').value,
    load: integrate(points, 'load').value, imported: integrate(points, 'grid', 'positive').value,
    exported: integrate(points, 'grid', 'negative').value, charge: integrate(points, 'battery', 'negative').value,
    discharge: integrate(points, 'battery', 'positive').value };
}
export function dailyEnergy(points: MonitorPoint[], timezone = 'America/Sao_Paulo') {
  const bounded: MonitorPoint[] = [];
  for (const point of points) {
    const previous = bounded.at(-1);
    if (previous && previous.day !== point.day && point.at - previous.at <= 20 * 60_000) {
      const at = midnight(point.day, timezone);
      if (at > previous.at && at < point.at) {
        const fraction = (at - previous.at) / (point.at - previous.at);
        const interpolate = (key: PowerKey | 'soc' | 'importTariff' | 'exportTariff') => previous[key] === null || point[key] === null ? null : previous[key]! + (point[key]! - previous[key]!) * fraction;
        bounded.push({ ...point, at, x: previous.x + (point.x - previous.x) * fraction, hour: 0,
          solar: interpolate('solar'), grid: interpolate('grid'), battery: interpolate('battery'),
          charger: interpolate('charger'), load: interpolate('load'), soc: interpolate('soc'),
          importTariff: interpolate('importTariff'), exportTariff: interpolate('exportTariff') });
      }
    }
    bounded.push(point);
  }
  const days = [...new Set(bounded.map(point => point.day))];
  return days.map(day => {
    const selected = bounded.filter(point => point.day === day);
    const last = selected.at(-1);
    const following = last && bounded.find(point => point.at > last.at);
    // Keep the boundary sample so a complete day's final interval is not discarded.
    if (following && following.hour === 0 && following.at - last!.at <= 20 * 60_000) selected.push(following);
    return { day, label: day.slice(8) + '/' + day.slice(5, 7), ...summarize(selected) };
  }).filter(row => Object.entries(row).some(([key, value]) => key !== 'day' && key !== 'label' && value !== null));
}
export const energySeries = [
  { key: 'solar', label: 'Geração solar', color: '#c4a01c' },
  { key: 'load', label: 'Consumo do prédio', color: '#8350b5' },
  { key: 'charge', label: 'Carga da bateria', color: '#ce571b' },
  { key: 'discharge', label: 'Descarga da bateria', color: '#579842' },
  { key: 'exported', label: 'Exportação para a rede', color: '#347eae' },
  { key: 'imported', label: 'Importação da rede', color: '#cb548e' },
  { key: 'charger', label: 'Carregadores', color: '#30a0a3' },
] as const;
export type EnergyKey = typeof energySeries[number]['key'];
export type EnergyBucket = ReturnType<typeof summarize> & { at: number; end: number; day: string; label: string; fullLabel: string };

// Allocate only measured intervals. Empty calendar slots remain null, never fabricated zeros.
export function energyBuckets(points: MonitorPoint[], range: { from: number; to: number }, period: MonitoringPeriod, timezone: string): EnergyBucket[] {
  const buckets: EnergyBucket[] = [];
  for (let at = range.from; at < range.to;) {
    const day = localDay(new Date(at), timezone);
    let end: number;
    if (period === 'day') end = Math.min(at + 3_600_000, range.to);
    else if (period === 'year') end = Math.min(dateWindow(day, 'month', timezone).to, range.to);
    else end = Math.min(midnight(shiftDay(day, 1), timezone), range.to);
    const label = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, ...(period === 'day' ? { hour: '2-digit', minute: '2-digit' } : period === 'year' ? { month: '2-digit' } : { day: '2-digit', month: '2-digit' }) }).format(at);
    const fullLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, year: 'numeric', month: '2-digit', ...(period === 'year' ? {} : { day: '2-digit' }), ...(period === 'day' ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(at);
    buckets.push({ at, end, day, label, fullLabel, solar: null, load: null, charge: null, discharge: null, imported: null, exported: null, charger: null });
    at = end;
  }
  let bucketIndex = 0;
  const ordered = [...points].sort((a, b) => a.at - b.at);
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1], b = ordered[i];
    if (b.at <= a.at || b.at - a.at > 20 * 60_000 || b.at <= range.from || a.at >= range.to) continue;
    while (bucketIndex < buckets.length && buckets[bucketIndex].end <= a.at) bucketIndex++;
    for (let j = bucketIndex; j < buckets.length && buckets[j].at < b.at; j++) {
      const bucket = buckets[j], start = Math.max(a.at, bucket.at), end = Math.min(b.at, bucket.end);
      if (end <= start) continue;
      const interpolate = (at: number): MonitorPoint => {
        const result = { ...a, at };
        for (const item of series) result[item.key] = a[item.key] === null || b[item.key] === null ? null : a[item.key]! + (b[item.key]! - a[item.key]!) * (at - a.at) / (b.at - a.at);
        return result;
      };
      const values = summarize([interpolate(start), interpolate(end)]);
      for (const { key } of energySeries) if (values[key] !== null) bucket[key] = (bucket[key] ?? 0) + values[key]!;
    }
  }
  return buckets;
}

export function previousMonitoringWindow(day: string, period: MonitoringPeriod, timezone: string) {
  return dateWindow(shiftDay(dateWindow(day, period, timezone).first, -1), period, timezone);
}

export function compareGeneration(current: EnergyBucket[], previous: EnergyBucket[]) {
  return Array.from({ length: Math.max(current.length, previous.length) }, (_, index) => ({
    label: current[index]?.label ?? previous[index].label,
    fullLabel: current[index]?.fullLabel ?? previous[index].fullLabel,
    current: current[index]?.solar ?? null, previous: previous[index]?.solar ?? null,
    currentDate: current[index]?.fullLabel, previousDate: previous[index]?.fullLabel,
  }));
}
export function batteryBands(points: MonitorPoint[]) {
  const bands: { start: number; end: number; charging: boolean }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (a.battery === null || Math.abs(a.battery) < .01 || b.at - a.at > 20 * 60_000) continue;
    const charging = a.battery < 0;
    const last = bands.at(-1);
    if (last && last.charging === charging && last.end === a.x) last.end = b.x;
    else bands.push({ start: a.x, end: b.x, charging });
  }
  return bands;
}
// Isolated visual example. Never persisted, sent to the GIE, or used as station telemetry.
export function demoReadings(day: string, timezone: string): MonitorPoint[] {
  const start = midnight(day, timezone);
  return Array.from({ length: 289 }, (_, i) => {
    const hour = i / 12, solar = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI)) * 18;
    const load = 1.4 + (hour > 7 && hour < 22 ? .8 : 0) + Math.sin(i * 1.7) * .2;
    const charger = hour > 8 && hour < 11 ? 11 : hour > 14 && hour < 20 ? 22 : 0;
    const battery = hour > 6 && hour < 12 ? -solar * .8 : hour >= 17 && hour < 22 ? 9 : 0;
    const at = start + i * 300_000;
    return { at, x: i * 5, day: localDay(new Date(at), timezone), hour: Math.floor(hour) % 24, label: new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(at),
      solar: +solar.toFixed(2), load: +load.toFixed(2), charger, battery: +battery.toFixed(2), grid: +(load + charger - solar - battery).toFixed(2),
      soc: hour < 6 ? 45 : hour < 12 ? 45 + (hour - 6) / 6 * 55 : hour < 17 ? 100 : Math.max(45, 100 - (hour - 17) * 11),
      importTariff: hour >= 18 && hour < 21 ? 1.2 : .85, exportTariff: .35 };
  });
}
