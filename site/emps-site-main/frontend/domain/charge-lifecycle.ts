export type ChargeLifecycleView = {
  version: 'PREPAID_LIMIT_V2';
  removalConfirmationMode?:'customer'|'gateway';
  serverTime: string;
  stoppedAt: string | null;
  disconnectedAt: string | null;
  removalDeadline: string | null;
  graceSeconds: number;
  remainingGraceSeconds: number | null;
  occupancyState: string;
  overstaySeconds: number;
  overstayAmount: null;
  overstayTariffStatus: 'NOT_CONFIGURED';
  energyAmount: string | null;
  absorbedOverrunAmount?:string;
  refund: { dueAmount: string; returnedAmount: string; status: string } | null;
};
export type CashSessionRow = {
  id: string; chargerId: string; startTime: string; pricePerKwhSnapshot: string;
  status: string; billingMode: string; sessionOrigin: string;
  lifecycle?: ChargeLifecycleView | null;
};
export function removalClock(lifecycle: ChargeLifecycleView, elapsedSinceReadMs: number) {
  if (lifecycle.disconnectedAt) return { state: 'REMOVED', seconds: lifecycle.overstaySeconds };
  if (!lifecycle.stoppedAt || !lifecycle.removalDeadline) return { state: 'CHARGING', seconds: 0 };
  const observed = Date.parse(lifecycle.serverTime) + Math.max(0, elapsedSinceReadMs);
  const remaining = Date.parse(lifecycle.removalDeadline) - observed;
  return remaining >= 0 ? { state: 'GRACE', seconds: Math.ceil(remaining / 1000) }
    : { state: 'OVERSTAY', seconds: Math.floor(-remaining / 1000) };
}
export function durationLabel(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
export function requiresConnectorRemoval(lifecycle:Pick<ChargeLifecycleView,'stoppedAt'|'disconnectedAt'>|null|undefined){
  return !!lifecycle?.stoppedAt&&!lifecycle.disconnectedAt;
}
export function canConfirmConnectorRemoval(lifecycle:Pick<ChargeLifecycleView,'stoppedAt'|'disconnectedAt'|'removalConfirmationMode'>|null|undefined){
  return requiresConnectorRemoval(lifecycle)&&lifecycle?.removalConfirmationMode!=='gateway';
}
