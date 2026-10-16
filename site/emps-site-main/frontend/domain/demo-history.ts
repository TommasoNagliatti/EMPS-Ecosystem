import type { Charger } from './emps';

export type DemoChannel = 'APP_EMPS' | 'WEB_CHARGE' | 'CAIXA';
export type DemoMethod = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'CASH';

export type DemoHistoryFilters = {
  from?: string;
  to?: string;
  channel?: DemoChannel;
  method?: DemoMethod;
};

export type DemoHistorySummary = {
  attempts: number;
  sessions: number;
  deliveredKwh: number;
  revenueSimulated: number;
  avgTicket: number;
  avgEnergy: number;
  activeMonths?: number;
  sessionsPerMonth?: number;
  deliveredKwhPerMonth?: number;
  revenueSimulatedPerMonth?: number;
  paidSessions?: number;
  estimatedEnergyCost?: number | null;
  estimatedContributionMargin?: number | null;
  ownerSessions?: number;
  visitorSessions?: number;
  ownerEnergyKwh?: number;
  visitorEnergyKwh?: number;
  ownerEstimatedCost?: number | null;
  visitorEstimatedCost?: number | null;
  resultAfterOwnerEnergy?: number | null;
  netProfit?: number | null;
};

export type DemoStationHistory = {
  context: 'SIMULATED';
  station: { id: number | string; name: string; gieProfile: string | null; gieStationId?: string | null };
  batch: { id: number | string; datasetKey: string; periodStart: string | null; periodEnd: string | null; scenarioVersion: string } | null;
  summary: DemoHistorySummary;
  chargers: { sourceChargerId: string | null; chargerId: number | null; sessions: number; deliveredKwh: number; revenueSimulated: number }[];
  monthly: { month: string; sessions: number; deliveredKwh: number; revenueSimulated: number }[];
  hours: { hour: number; sessions: number }[];
  channels: { channel: DemoChannel; sessions: number; revenueSimulated: number }[];
  methods: { method: DemoMethod; sessions: number; revenueSimulated: number }[];
  readings: { intervalStart: string; buildingKw: number | null; solarKw: number | null; gridKw: number | null; evDeliveredKw: number | null;
    buildingKwh: number | null; solarKwh: number | null; gridKwh: number | null; evDeliveredKwh: number | null; batteryState?: unknown }[];
  sessions: { sourceSessionId: string; sourceChargerId: string | null; chargerId?: number | null;
    startTime: string; endTime: string | null; durationSeconds?: number | null;
    deliveredKwh: number; amount: number; channel: DemoChannel | null; method: DemoMethod | null;
    status: 'COMPLETED' | 'UNSERVED';
    driver?: { id: string; name: string; kind?: string } | null;
    usageKind?: 'OWNER' | 'VISITOR' | null;
    credentialKind?: 'HYPOTHETICAL_RFID' | null;
    estimatedCost?: number | null;
  }[];
};

export type DemoNetworkHistory = {
  context: 'SIMULATED';
  stations: DemoStationHistory[];
  summary: DemoHistorySummary;
  monthly: { month: string; sessions: number; deliveredKwh: number; revenueSimulated: number }[];
};

export type DemoChargerCardHistory = {
  sessions: number;
  deliveredKwh: number;
  revenueSimulated: number;
  utilizationPct: number | null;
};

export function demoChargerCardHistory(
  chargers: ReadonlyArray<Pick<Charger, 'carregadorId' | 'nome' | 'serialNumber'>>,
  rows: DemoStationHistory['chargers'] | undefined,
  utilization: Array<{ sourceChargerId: string; utilizationPct: number | null }> | undefined,
): Record<string, DemoChargerCardHistory> {
  const result: Record<string, DemoChargerCardHistory> = {};
  for (const row of rows ?? []) {
    let cardId: string | undefined;
    if (row.chargerId !== null) {
      cardId = chargers.find(charger => charger.carregadorId === String(row.chargerId))?.carregadorId;
    } else if (row.sourceChargerId && /^AC_0[1-4]$/.test(row.sourceChargerId)) {
      // Local preview cards are explicitly marked and are never physical charger mappings.
      const sourceId = row.sourceChargerId;
      const matches = chargers.filter(charger =>
        charger.serialNumber === `LOCAL_ONLY_SHOPPING_${sourceId}` &&
        charger.nome === `${sourceId} · referência local`);
      if (matches.length === 1) cardId = matches[0].carregadorId;
    }
    if (!cardId) continue;
    result[cardId] = { sessions: row.sessions, deliveredKwh: row.deliveredKwh,
      revenueSimulated: row.revenueSimulated,
      utilizationPct: utilization?.find(item => item.sourceChargerId === row.sourceChargerId)?.utilizationPct ?? null };
  }
  return result;
}

export const demoChannels: { value: DemoChannel; label: string }[] = [
  { value: 'APP_EMPS', label: 'App EMPS' },
  { value: 'WEB_CHARGE', label: 'Web Charge' },
  { value: 'CAIXA', label: 'Caixa presencial' },
];

export const demoMethods: { value: DemoMethod; label: string }[] = [
  { value: 'PIX', label: 'Pix' },
  { value: 'CREDIT_CARD', label: 'Cartão de crédito' },
  { value: 'DEBIT_CARD', label: 'Cartão de débito' },
  { value: 'CASH', label: 'Dinheiro' },
];

export function demoQuery(filters: DemoHistoryFilters = {}) {
  const query = new URLSearchParams();
  for (const key of ['from', 'to', 'channel', 'method'] as const) {
    if (filters[key]) query.set(key, filters[key]);
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

export function monthlyMean(summary: DemoHistorySummary, months: number) {
  return months > 0 ? {
    sessions: summary.sessions / months,
    deliveredKwh: summary.deliveredKwh / months,
    revenueSimulated: summary.revenueSimulated / months,
  } : { sessions: 0, deliveredKwh: 0, revenueSimulated: 0 };
}

export function monthlyCoverage(start: string, end: string) {
  const first = start.slice(0, 7), last = end.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(first) || !/^\d{4}-\d{2}$/.test(last)) return 0;
  const months = (Number(last.slice(0, 4)) - Number(first.slice(0, 4))) * 12 +
    Number(last.slice(5, 7)) - Number(first.slice(5, 7)) + 1;
  return Math.max(0, months);
}

export function sourceLocalDay(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(parsed);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
