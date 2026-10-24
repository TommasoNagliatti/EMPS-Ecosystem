import { Prisma } from '@prisma/client';
import {ConflictException} from '@nestjs/common';

export const CHARGE_POLICY_VERSION = 'PREPAID_LIMIT_V2';
export const REMOVAL_GRACE_SECONDS = 600;
export const BUDGET_RESERVE_SECONDS = 40;
export function chargeLifecycleStationIds(env:NodeJS.ProcessEnv=process.env){
  const raw=env.PREPAID_LIFECYCLE_STATION_IDS?.trim();
  if(!raw)return [];
  const values=raw.split(',').map(value=>value.trim());
  if(values.some(value=>! /^[1-9]\d*$/.test(value)||Number(value)>4294967295))
    throw new Error('PREPAID_LIFECYCLE_STATION_IDS requires valid MySQL station IDs');
  return [...new Set(values.map(Number))];
}
export function chargeLifecycleEnabled(stationId:number,env:NodeJS.ProcessEnv=process.env){
  return chargeLifecycleStationIds(env).includes(stationId);
}
export function assertChargePolicySelection(stationId:number,version?:string){
  const enabled=chargeLifecycleEnabled(stationId);
  if((enabled&&version!==CHARGE_POLICY_VERSION)||(!enabled&&version!==undefined))
    throw new ConflictException('A regra da recarga mudou. Atualize o carregador e autorize novamente antes de iniciar');
  return enabled;
}
export async function assertNoPendingRemoval(tx:Prisma.TransactionClient,chargerId:number){
  if(await tx.chargingSession.findFirst({where:{chargerId,status:{in:['FINISHED','WAITING_PAYMENT']},endTime:{not:null},disconnectedAt:null,billingSnapshot:{path:'$.chargeLifecycle.version',equals:CHARGE_POLICY_VERSION}},select:{id:true}}))
    throw new ConflictException('O conector da recarga anterior ainda nao foi retirado');
}

export type ChargeLifecycle = {
  version: typeof CHARGE_POLICY_VERSION;
  graceSeconds: number;
  startedAt?:string;
  stoppedAt?: string;
  disconnectedAt?: string;
  disconnectionSource?: 'OPERATOR_CONFIRMED_SANDBOX' | 'CUSTOMER_CONFIRMED_SANDBOX' | 'GATEWAY_CONFIRMED';
  energyAmount?: string;
  rawEnergyAmount?:string;
  absorbedOverrunAmount?:string;
  cashRefund?: { dueAmount: string; returnedAmount: string; confirmedAt?: string; confirmedBy?: string };
};

function object(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid billing snapshot');
  return value as Record<string, unknown>;
}
const money = (value: Prisma.Decimal.Value) => {
  const amount = new Prisma.Decimal(value);
  if (!amount.isFinite() || amount.isNegative()) throw new Error('Invalid lifecycle amount');
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};
function instant(value: string) {
  if (!/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error('Invalid lifecycle timestamp');
  return Date.parse(value);
}
export function lifecycleOf(snapshot: unknown): ChargeLifecycle | null {
  const raw = object(snapshot).chargeLifecycle;
  if (raw === undefined) return null;
  const state = object(raw) as unknown as ChargeLifecycle;
  if (state.version !== CHARGE_POLICY_VERSION || state.graceSeconds !== REMOVAL_GRACE_SECONDS)
    throw new Error('Unsupported charge lifecycle');
  if (state.stoppedAt) instant(state.stoppedAt);
  if(state.startedAt)instant(state.startedAt);
  if (state.disconnectedAt && (!state.stoppedAt || instant(state.disconnectedAt) < instant(state.stoppedAt)))
    throw new Error('Disconnection precedes confirmed stop');
  if (state.energyAmount !== undefined) money(state.energyAmount);
  if(state.rawEnergyAmount!==undefined)money(state.rawEnergyAmount);
  if(state.absorbedOverrunAmount!==undefined)money(state.absorbedOverrunAmount);
  if (state.cashRefund) {
    if (!state.stoppedAt) throw new Error('Refund requires confirmed stop');
    const due = money(state.cashRefund.dueAmount), returned = money(state.cashRefund.returnedAmount);
    if (returned.gt(due)) throw new Error('Refund exceeds unused deposit');
    if (returned.gt(0) && (!state.cashRefund.confirmedAt || !state.cashRefund.confirmedBy))
      throw new Error('Refund requires operator confirmation');
    if (state.cashRefund.confirmedAt) instant(state.cashRefund.confirmedAt);
  }
  return structuredClone(state);
}
export function newLifecycleSnapshot(snapshot: unknown = null): Prisma.InputJsonValue {
  return { ...object(snapshot), chargeLifecycle: { version: CHARGE_POLICY_VERSION, graceSeconds: REMOVAL_GRACE_SECONDS } };
}
export function budgetPrice(raw:Prisma.Decimal.Value,limit?:Prisma.Decimal.Value|null){
  const measured=money(raw),charged=limit==null?measured:Prisma.Decimal.min(measured,money(limit));
  return {chargedAmount:charged.toFixed(2),rawAmount:measured.toFixed(2),absorbedAmount:measured.sub(charged).toFixed(2)};
}
function store(snapshot: unknown, lifecycle: ChargeLifecycle): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify({ ...object(snapshot), chargeLifecycle: lifecycle }));
}
export function stopLifecycle(snapshot: unknown, at: Date, consumed: Prisma.Decimal.Value, cashDeposit?: Prisma.Decimal.Value,limit?:Prisma.Decimal.Value|null) {
  const state = lifecycleOf(snapshot);
  if (!state) throw new Error('Session does not use the new charge policy');
  if (state.stoppedAt) return store(snapshot, state);
  state.stoppedAt = at.toISOString();
  const price=budgetPrice(consumed,limit);
  state.energyAmount = price.chargedAmount;
  state.rawEnergyAmount=price.rawAmount;
  state.absorbedOverrunAmount=price.absorbedAmount;
  if (cashDeposit !== undefined) state.cashRefund = {
    dueAmount: Prisma.Decimal.max(0, money(cashDeposit).sub(state.energyAmount)).toFixed(2),
    returnedAmount: '0.00',
  };
  return store(snapshot, state);
}
export function disconnectLifecycle(snapshot: unknown, at: Date, source: ChargeLifecycle['disconnectionSource']) {
  const state = lifecycleOf(snapshot);
  if (!state?.stoppedAt) throw new Error('Confirm energy stop before removal');
  if (state.disconnectedAt) return store(snapshot, state);
  if (at.getTime() < instant(state.stoppedAt)) throw new Error('Disconnection precedes confirmed stop');
  state.disconnectedAt = at.toISOString();
  state.disconnectionSource = source;
  return store(snapshot, state);
}
export function confirmCashRefund(snapshot: unknown, amount: Prisma.Decimal.Value, actorId: string, at: Date) {
  const state = lifecycleOf(snapshot), value = money(amount);
  if (!state?.cashRefund || value.lte(0) || !value.equals(state.cashRefund.dueAmount))
    throw new Error('Confirm the exact unused cash amount');
  if (!/^[1-9]\d*$/.test(actorId)) throw new Error('Operator identity required');
  if (money(state.cashRefund.returnedAmount).equals(value)) return store(snapshot, state);
  state.cashRefund.returnedAmount = value.toFixed(2);
  state.cashRefund.confirmedAt = at.toISOString();
  state.cashRefund.confirmedBy = actorId;
  return store(snapshot, state);
}
export function presentLifecycle(snapshot: unknown, now = new Date()) {
  const state = lifecycleOf(snapshot);
  if (!state) return null;
  const stopped = state.stoppedAt ? instant(state.stoppedAt) : null;
  const removed = state.disconnectedAt ? instant(state.disconnectedAt) : null;
  const deadline = stopped === null ? null : stopped + state.graceSeconds * 1000;
  const observed = removed ?? now.getTime();
  const billableSeconds = deadline === null ? 0 : Math.max(0, Math.floor((observed - deadline) / 1000));
  const due = state.cashRefund ? money(state.cashRefund.dueAmount).sub(state.cashRefund.returnedAmount).toFixed(2) : null;
  return {
    version: state.version, serverTime: now.toISOString(), stoppedAt: state.stoppedAt ?? null,
    removalConfirmationMode:state.startedAt||process.env.OCPP_GATEWAY_URL?'gateway' as const:'customer' as const,
    disconnectedAt: state.disconnectedAt ?? null,
    removalDeadline: deadline === null ? null : new Date(deadline).toISOString(),
    graceSeconds: state.graceSeconds,
    remainingGraceSeconds: deadline === null || removed !== null ? null : Math.max(0, Math.ceil((deadline - now.getTime()) / 1000)),
    occupancyState: stopped === null ? 'CHARGING' : removed !== null ? 'REMOVED' : observed <= deadline! ? 'GRACE' : 'OVERSTAY',
    overstaySeconds: billableSeconds,
    // The future occupancy tariff is deliberately not inferred from the old V1 tariff.
    overstayAmount: null, overstayTariffStatus: 'NOT_CONFIGURED', energyAmount: state.energyAmount ?? null,
    rawEnergyAmount:state.rawEnergyAmount??null,absorbedOverrunAmount:state.absorbedOverrunAmount??'0.00',
    refund: state.cashRefund ? {
      dueAmount: due, returnedAmount: state.cashRefund.returnedAmount,
      status: money(due!).gt(0) ? 'PENDING_CASH_RETURN' : money(state.cashRefund.returnedAmount).gt(0) ? 'CONFIRMED_CASH_RETURN' : 'NOT_REQUIRED',
    } : null,
  };
}

export function cashReturnFields(payment:{sessionId:bigint;idempotencyKey:string|null;status:string;method:string;provider:string|null},snapshot:unknown){
  if(payment.status!=='APPROVED'||payment.method!=='CASH'||payment.provider!=='CASH_REGISTER'||payment.idempotencyKey!==`cash-settle-${payment.sessionId}`)return {};
  const refund=lifecycleOf(snapshot)?.cashRefund;
  return refund?{cashReturnedAmount:refund.returnedAmount,cashReturnedAt:refund.confirmedAt??null}:{};
}
