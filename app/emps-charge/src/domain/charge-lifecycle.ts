import type {ChargeLifecycle,ChargingSession} from './models';

export function normalizeChargeLifecycle(value:unknown):ChargeLifecycle|undefined {
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const row=value as Record<string,unknown>;
  const date=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
  if(row.version!=='PREPAID_LIMIT_V2'||!date(row.serverTime)||row.graceSeconds!==600||
    !['CHARGING','GRACE','OVERSTAY','REMOVED'].includes(String(row.occupancyState))||
    !Number.isFinite(row.overstaySeconds)||Number(row.overstaySeconds)<0)return undefined;
  for(const key of ['stoppedAt','disconnectedAt','removalDeadline'])if(row[key]!==null&&!date(row[key]))return undefined;
  if(row.remainingGraceSeconds!==null&&(!Number.isFinite(row.remainingGraceSeconds)||Number(row.remainingGraceSeconds)<0))return undefined;
  if(row.removalConfirmationMode!==undefined&&!['customer','gateway'].includes(String(row.removalConfirmationMode)))return undefined;
  return {version:'PREPAID_LIMIT_V2',serverTime:row.serverTime as string,stoppedAt:row.stoppedAt as string|null,
    disconnectedAt:row.disconnectedAt as string|null,removalDeadline:row.removalDeadline as string|null,
    graceSeconds:600,remainingGraceSeconds:row.remainingGraceSeconds as number|null,
    occupancyState:row.occupancyState as ChargeLifecycle['occupancyState'],overstaySeconds:Number(row.overstaySeconds),
    ...(row.removalConfirmationMode?{removalConfirmationMode:row.removalConfirmationMode as 'customer'|'gateway'}:{})};
}

export function requiresConnectorRemoval(session:Pick<ChargingSession,'lifecycle'>|null|undefined){
  return !!session?.lifecycle?.stoppedAt&&!session.lifecycle.disconnectedAt;
}

export function canConfirmConnectorRemoval(session:Pick<ChargingSession,'lifecycle'>|null|undefined){
  return requiresConnectorRemoval(session)&&session?.lifecycle?.removalConfirmationMode!=='gateway';
}
