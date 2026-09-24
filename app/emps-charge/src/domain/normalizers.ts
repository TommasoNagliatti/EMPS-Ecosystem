import type { ChargingSession, PaymentMethod, SessionStatus } from '@/domain/models';

const paymentMethods = new Set<PaymentMethod>(['pix', 'card', 'wallet']);
const sessionStatuses = new Set<SessionStatus>([
  'starting',
  'charging',
  'stopping',
  'completed',
  'payment_pending',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeChargingSession(value: unknown): ChargingSession | null {
  if (!isRecord(value)) return null;
  if (
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.stationId) ||
    !nonEmptyString(value.chargerId) ||
    !nonEmptyString(value.startedAt) ||
    Number.isNaN(Date.parse(value.startedAt)) ||
    !sessionStatuses.has(value.status as SessionStatus) ||
    !paymentMethods.has(value.paymentMethod as PaymentMethod)
  ) {
    return null;
  }

  const endedAt =
    nonEmptyString(value.endedAt) && !Number.isNaN(Date.parse(value.endedAt))
      ? value.endedAt
      : undefined;
  const transactionId = nonEmptyString(value.transactionId)
    ? value.transactionId
    : undefined;
  const spendingLimit =
    value.spendingLimit === null || value.spendingLimit === undefined
      ? null
      : Math.max(0, finiteNumber(value.spendingLimit));

  return {
    id: value.id,
    ...(isRecord(value.receipt) && nonEmptyString(value.receipt.paymentId) && value.receipt.status === 'approved' ? {receipt:value.receipt as ChargingSession['receipt']} : {}),
    stationId: value.stationId,
    chargerId: value.chargerId,
    startedAt: value.startedAt,
    ...(endedAt ? { endedAt } : {}),
    status: value.status as SessionStatus,
    paymentMethod: value.paymentMethod as PaymentMethod,
    spendingLimit,
    energyKwh: Math.max(0, finiteNumber(value.energyKwh)),
    totalCost: Math.max(0, finiteNumber(value.totalCost)),
    powerKw: Math.max(0, finiteNumber(value.powerKw)),
    ...(value.requestedPowerKw !== undefined ? {requestedPowerKw:Math.max(0,finiteNumber(value.requestedPowerKw))}:{}),
    ...(typeof value.managedPower === 'boolean'?{managedPower:value.managedPower}:{}),
    ...(typeof value.telemetrySource === 'string'?{telemetrySource:value.telemetrySource}:{}),
    ...(typeof value.tariffVersion === 'string'?{tariffVersion:value.tariffVersion,billing:value.billing as ChargingSession['billing'],billingFrozen:value.billingFrozen===true,disconnectedAt:typeof value.disconnectedAt==='string'?value.disconnectedAt:undefined}:{}),
    durationSeconds: Math.max(0, Math.floor(finiteNumber(value.durationSeconds))),
    simulatedSecondsOffset: Math.max(
      0,
      Math.floor(finiteNumber(value.simulatedSecondsOffset)),
    ),
    ...(transactionId ? { transactionId } : {}),
  };
}

export function normalizeChargingSessions(value: unknown): ChargingSession[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const session = normalizeChargingSession(item);
    return session ? [session] : [];
  });
}
