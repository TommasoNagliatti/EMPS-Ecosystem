import type { Charger, ChargerStatus } from '@/domain/emps';

export type SandboxCashierMethod = 'cash' | 'pos';
export type SandboxPaymentMethod = SandboxCashierMethod | 'pix' | 'card' | 'wallet';
export type SandboxChargerStatus = 'AVAILABLE' | 'STARTING' | 'CHARGING' | 'FINISHING' | 'FINISHED';

export type SandboxSession = {
  id: string;
  stationId: number;
  chargerId: number;
  evse: 'EV1' | 'EV2';
  status: 'starting' | 'charging' | 'stopping' | 'completed';
  energyKwh: number;
  totalCost: number;
  paymentMethod: SandboxPaymentMethod;
  paymentStatus: 'authorized' | 'approved' | 'received';
  cashier: boolean;
  amountReceived: number | null;
  consumedAmount: number | null;
  remainingCredit: number | null;
  estimatedKwhAtStart: number | null;
  pricePerKwh: number | null;
  autoStopAt: string | null;
  returnStatus: 'NONE' | 'PENDING' | null;
  receiptSource: 'OPERATOR_CONFIRMED' | null;
  startedAt: string;
  endedAt: string | null;
  provenance: 'SANDBOX_ESTIMATE';
};

export type SandboxCharger = {
  chargerId: number;
  evse: 'EV1' | 'EV2';
  physicalStatus: string;
  sandboxStatus: SandboxChargerStatus;
  simulatedPowerKw: number | null;
  pricePerKwh: number | null;
  fixedFee: number | null;
  estimatedEnergyKwh: number | null;
  estimatedCost: number | null;
  provenance: 'SANDBOX_ESTIMATE';
  session: SandboxSession | null;
};

export type ChargingSandbox = {
  mode: 'SANDBOX';
  stationId: number;
  chargers: SandboxCharger[];
  sessions: SandboxSession[];
};

export function validateChargingSandbox(value: ChargingSandbox, stationId: string, chargers: Charger[]) {
  if (stationId !== '46' || value?.mode !== 'SANDBOX' || String(value.stationId) !== stationId ||
      !Array.isArray(value.chargers) || !Array.isArray(value.sessions)) {
    throw new Error('Resposta sandbox não corresponde à instalação solicitada.');
  }
  const allowed = new Set(chargers.filter(charger => charger.estacaoId === stationId).map(charger => charger.carregadorId));
  const seen = new Set<string>();
  const evseByCharger = new Map<string, SandboxCharger['evse']>();
  for (const row of value.chargers) {
    const id = String(row.chargerId);
    if (!allowed.has(id) || seen.has(id) || row.provenance !== 'SANDBOX_ESTIMATE' ||
        !['EV1', 'EV2'].includes(row.evse) || !['AVAILABLE', 'STARTING', 'CHARGING', 'FINISHING', 'FINISHED'].includes(row.sandboxStatus) ||
        (row.session && (!sandboxSessionMatches(row.session, value.stationId, row.chargerId) || row.session.evse !== row.evse))) {
      throw new Error('Estado sandbox contém carregador ou sessão fora desta instalação.');
    }
    seen.add(id);
    evseByCharger.set(id, row.evse);
  }
  if (value.sessions.some(session => !allowed.has(String(session.chargerId)) ||
      evseByCharger.get(String(session.chargerId)) !== session.evse ||
      !sandboxSessionMatches(session, value.stationId, session.chargerId))) {
    throw new Error('Histórico sandbox contém sessão fora desta instalação.');
  }
  return value;
}

export function sandboxSessionMatches(session: SandboxSession, stationId: number, chargerId: number) {
  return String(session.stationId) === String(stationId) && String(session.chargerId) === String(chargerId) &&
    ['EV1', 'EV2'].includes(session.evse) && session.provenance === 'SANDBOX_ESTIMATE';
}

export function sandboxCashierCredit(session: SandboxSession | null) {
  if (!session?.cashier || !['cash', 'pos'].includes(session.paymentMethod) ||
      session.paymentStatus !== 'received' || session.receiptSource !== 'OPERATOR_CONFIRMED' ||
      ![session.amountReceived, session.consumedAmount, session.remainingCredit,
        session.estimatedKwhAtStart, session.pricePerKwh].every(value =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0)) return null;
  return {
    amountReceived: session.amountReceived as number,
    consumedAmount: session.consumedAmount as number,
    remainingCredit: session.remainingCredit as number,
    estimatedKwhAtStart: session.estimatedKwhAtStart as number,
    pricePerKwh: session.pricePerKwh as number,
    returnStatus: session.returnStatus,
  };
}

export function sandboxStatusLabel(status: SandboxChargerStatus) {
  return ({ AVAILABLE: 'Disponível', STARTING: 'Iniciando', CHARGING: 'Carregando',
    FINISHING: 'Finalizando', FINISHED: 'Finalizado' } as const)[status];
}

export function sandboxVisualStatus(status: SandboxChargerStatus): ChargerStatus {
  return status === 'AVAILABLE' || status === 'FINISHED' ? 'disponivel' : 'em_uso';
}

export function sandboxCanStart(row: SandboxCharger) {
  return row.sandboxStatus === 'AVAILABLE' || row.sandboxStatus === 'FINISHED';
}

export function sandboxCanStop(row: SandboxCharger) {
  return row.sandboxStatus === 'STARTING' || row.sandboxStatus === 'CHARGING';
}
