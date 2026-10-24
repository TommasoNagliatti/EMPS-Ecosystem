import type { Charger, ChargerStatus, EnergyFlowTelemetry } from '@/domain/emps';

export type SandboxCashierMethod = 'cash' | 'pos';
export type SandboxPaymentMethod = SandboxCashierMethod | 'pix' | 'card' | 'wallet';
export type SandboxChargerStatus = 'AVAILABLE' | 'STARTING' | 'CHARGING' | 'FINISHING' | 'FINISHED';

export type SandboxSession = {
  id: string;
  stationId: number;
  chargerId: number;
  evse: 'EV1' | 'EV2' | 'EV3';
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
  evse: 'EV1' | 'EV2' | 'EV3';
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
  normalScenario?: {
    displayMapping?: Record<string, number | string | null>;
    version: string; provenance: 'SIMULATED'; at: string; assumption: string;
    solarPowerKw: number; gridPowerKw: number; buildingPowerKw: number;
    chargerPowerKw: number; batteryPowerKw: number; balanceResidualKw: number;
  } | null;
};

export function validateChargingSandbox(value: ChargingSandbox, stationId: string, chargers: Charger[]) {
  if (!['13', '46', '47'].includes(stationId) || value?.mode !== 'SANDBOX' || String(value.stationId) !== stationId ||
      !Array.isArray(value.chargers) || !Array.isArray(value.sessions)) {
    throw new Error('Resposta sandbox não corresponde à instalação solicitada.');
  }
  const allowed = new Set(chargers.filter(charger => charger.estacaoId === stationId).map(charger => charger.carregadorId));
  const seen = new Set<string>();
  const seenEvses = new Set<string>();
  const evseByCharger = new Map<string, SandboxCharger['evse']>();
  for (const row of value.chargers) {
    const id = String(row.chargerId);
    if (!allowed.has(id) || seen.has(id) || seenEvses.has(row.evse) || row.provenance !== 'SANDBOX_ESTIMATE' ||
        (row.simulatedPowerKw !== null && (typeof row.simulatedPowerKw !== 'number' ||
          !Number.isFinite(row.simulatedPowerKw) || row.simulatedPowerKw < 0)) ||
        !['EV1', 'EV2', 'EV3'].includes(row.evse) || !['AVAILABLE', 'STARTING', 'CHARGING', 'FINISHING', 'FINISHED'].includes(row.sandboxStatus) ||
        (row.session && (!sandboxSessionMatches(row.session, value.stationId, row.chargerId) || row.session.evse !== row.evse))) {
      throw new Error('Estado sandbox contém carregador ou sessão fora desta instalação.');
    }
    seen.add(id);
    seenEvses.add(row.evse);
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
    ['EV1', 'EV2', 'EV3'].includes(session.evse) && session.provenance === 'SANDBOX_ESTIMATE';
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

function sandboxRowIsActive(row: SandboxCharger) {
  return row.sandboxStatus === 'CHARGING' && row.session?.status === 'charging' &&
    typeof row.simulatedPowerKw === 'number' && Number.isFinite(row.simulatedPowerKw) && row.simulatedPowerKw > 0;
}

/**
 * Projects the current, station-scoped SANDBOX sessions onto the existing energy
 * scene. It never changes physical charger status and never treats the estimate
 * as metered energy.
 */
export function sandboxEnergyFlow(
  chargers: Charger[],
  telemetry: EnergyFlowTelemetry,
  sandbox: ChargingSandbox | null,
) {
  if (!sandbox) return { chargers, telemetry, activeEvses: [] as SandboxCharger['evse'][] };

  const rows = new Map(sandbox.chargers.map(row => [String(row.chargerId), row]));
  const activeRows = sandbox.chargers.filter(sandboxRowIsActive);
  const mapping = sandbox.normalScenario?.version === 'CHARGER_DEMO_ILLUSTRATION_V1' ? sandbox.normalScenario.displayMapping : null;
  const activeEvses = activeRows.map(row => mapping ? Object.entries(mapping).find(([,id])=>id!=null && String(id)===String(row.chargerId))?.[0] ?? row.evse : row.evse);
  const chargerPowerKw = activeRows.reduce((total, row) =>
    total + (typeof row.simulatedPowerKw === 'number' && Number.isFinite(row.simulatedPowerKw)
      ? Math.max(0, row.simulatedPowerKw) : 0), 0);
  const projectedChargers = chargers.map(charger => {
    const row = rows.get(charger.carregadorId);
    const active = row ? sandboxRowIsActive(row) : false;
    return { ...charger, status: active ? 'em_uso' as const : charger.status,
      potenciaAtualKw: active && typeof row?.simulatedPowerKw === 'number'
        ? Math.max(0, row.simulatedPowerKw) : 0 };
  });
  const candidate = sandbox.normalScenario;
  const age = Date.now() - Date.parse(candidate?.at ?? '');
  const scenario = candidate?.provenance === 'SIMULATED' && age >= -5_000 && age < 30_000 &&
    [candidate.solarPowerKw, candidate.gridPowerKw, candidate.buildingPowerKw,
      candidate.chargerPowerKw, candidate.batteryPowerKw, candidate.balanceResidualKw].every(Number.isFinite) &&
    candidate.solarPowerKw >= 0 && candidate.buildingPowerKw >= 0 && candidate.batteryPowerKw === 0 &&
    Math.abs(candidate.chargerPowerKw - chargerPowerKw) < 0.001 &&
    Math.abs(candidate.solarPowerKw + candidate.gridPowerKw - candidate.buildingPowerKw - chargerPowerKw) < 0.001
    ? candidate : null;
  const chargerSources: EnergyFlowTelemetry['chargerSources'] = chargerPowerKw > 0 && scenario
    ? [...(scenario.solarPowerKw > scenario.buildingPowerKw ? ['solar' as const] : []),
      ...(scenario.gridPowerKw > 0 ? ['grid' as const] : [])] : [];

  return {
    chargers: projectedChargers,
    activeEvses,
    telemetry: {
      batteryMode: scenario ? 'idle' as const : 'unknown' as const,
      batteryPowerKw: scenario?.batteryPowerKw ?? null, batterySocPercent: null,
      solarPowerKw: scenario?.solarPowerKw ?? null, gridPowerKw: scenario?.gridPowerKw ?? null,
      buildingPowerKw: scenario?.buildingPowerKw ?? null,
      solarChargingBattery: false, chargerSources,
      updatedAt: scenario?.at ?? null,
      chargerPowerKw,
      gieVisual: {
        valid: true,
        evse_1_active: activeEvses.includes('EV1'),
        evse_2_active: activeEvses.includes('EV2'),
        evse_3_active: activeEvses.includes('EV3'),
        evse_4_active: false,
        provenance: 'SANDBOX_ESTIMATE',
        grid_importing: (scenario?.gridPowerKw ?? 0) > 0,
        grid_exporting: (scenario?.gridPowerKw ?? 0) < 0,
        solar_active: (scenario?.solarPowerKw ?? 0) > 0,
        solar_to_bus: (scenario?.solarPowerKw ?? 0) > 0,
      },
    },
  };
}
