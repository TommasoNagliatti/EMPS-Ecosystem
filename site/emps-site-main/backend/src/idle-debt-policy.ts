import { Prisma } from '@prisma/client';

/** Snapshot on new authorizations only; never reinterpret an existing tariff. */
export const IDLE_DEBT_POLICY = Object.freeze({
  version: 'IDLE_DEBT_V1', graceSeconds: 600, ratePerMinute: '2.50',
  cap: null, rounding: 'PROPORTIONAL_SECONDS_HALF_UP',
} as const);

export function idleDebtAmount(stoppedAt: Date, disconnectedAt: Date) {
  const elapsed = disconnectedAt.getTime() - stoppedAt.getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Invalid confirmed occupancy interval');
  // Charge elapsed time proportionally, rounded to cents, never an invented full minute.
  const seconds = Math.max(0, Math.floor(elapsed / 1000) - IDLE_DEBT_POLICY.graceSeconds);
  const amount = new Prisma.Decimal(seconds).mul(IDLE_DEBT_POLICY.ratePerMinute)
    .div(60).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { policyVersion: IDLE_DEBT_POLICY.version, billableSeconds: seconds, amount: amount.toFixed(2) };
}

export function chargingDebtQuote(energyBudget: string, outstanding: string) {
  const energy = new Prisma.Decimal(energyBudget), debt = new Prisma.Decimal(outstanding);
  if (![energy, debt].every(value => value.isFinite() && !value.isNegative() && value.decimalPlaces() <= 2) || energy.isZero())
    throw new Error('Invalid charging quote');
  return { energyBudget: energy.toFixed(2), outstandingDebt: debt.toFixed(2), total: energy.add(debt).toFixed(2) };
}
