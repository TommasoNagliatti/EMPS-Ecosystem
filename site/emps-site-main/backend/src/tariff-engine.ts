// Decimal port of the supplied emps_tariff_engine_v1. Commercial constants unchanged.
import { Prisma } from '@prisma/client';
const D=Prisma.Decimal, money=(x:Prisma.Decimal.Value)=>new D(x).toDecimalPlaces(2,D.ROUND_HALF_UP), energy=(x:Prisma.Decimal.Value)=>new D(x).toDecimalPlaces(4,D.ROUND_HALF_UP);
export const TARIFF_VERSION='SP_ENEL_PROTO_V1';
export type Facts={grid_support_for_ev:boolean;high_demand:boolean;source:string;observed_at:string};
export type Interval=Facts & {start_at:string;end_at:string;energy_kwh:string};
export type Ledger={tariff_version:string;phase:'collecting'|'awaiting_disconnect'|'frozen';charge_completed_at?:string;intervals:Interval[];meter_energy_kwh:string;last_at:string;facts:Facts;breakdown?:ReturnType<typeof calculateSession>;disconnection_source?:string};
const instant=(s:string)=>{if(!/(Z|[+-]\d\d:\d\d)$/.test(s)||!Number.isFinite(Date.parse(s)))throw Error('Timestamp must be timezone-aware');return Date.parse(s)};
export const rate=(grid=false,peak=false)=>D.min('2.29',new D('1.99').add(grid?'.20':0).add(peak?'.10':0));
export function tariffQuote(facts?:Facts){return {tariff_version:TARIFF_VERSION,area_code:'SP_ENEL',currency:'BRL',current_tariff_per_kwh:rate(facts?.grid_support_for_ev,facts?.high_demand).toFixed(2),minimum_tariff_per_kwh:'1.99',maximum_tariff_per_kwh:'2.29',grid_surcharge_active:!!facts?.grid_support_for_ev,high_demand_surcharge_active:!!facts?.high_demand,overstay_grace_minutes:15,overstay_fee_per_minute:'0.25',overstay_fee_cap:'20.00'};}
export function calculateSession(sessionId:string,intervals:Interval[],completed?:string|null,disconnected?:string|null){
 if(!sessionId.trim())throw Error('Session id required');
 if(disconnected&&!completed)throw Error('Disconnection requires charge completion');
 if(completed)instant(completed);if(disconnected&&instant(disconnected)<instant(completed!))throw Error('Disconnection precedes completion');
 let kwh=new D(0),amount=new D(0),grid=new D(0),peak=new D(0),last=-Infinity;
 const rows=[...intervals].sort((a,b)=>instant(a.start_at)-instant(b.start_at)).map(i=>{
  const start=instant(i.start_at),end=instant(i.end_at),raw=new D(i.energy_kwh);
  if(start<last||end<=start||!raw.isFinite()||raw.isNegative()||typeof i.grid_support_for_ev!=='boolean'||typeof i.high_demand!=='boolean')throw Error('Invalid or overlapping energy interval');last=end;
  const e=energy(raw),r=rate(i.grid_support_for_ev,i.high_demand),a=money(e.mul(r));kwh=kwh.add(e);amount=amount.add(a);if(i.grid_support_for_ev)grid=grid.add(e);if(i.high_demand)peak=peak.add(e);
  return {...i,energy_kwh:e.toFixed(4),tariff_per_kwh:r.toFixed(2),base_tariff_per_kwh:'1.99',grid_surcharge_per_kwh:i.grid_support_for_ev?'0.20':'0',high_demand_surcharge_per_kwh:i.high_demand?'0.10':'0',amount:a.toFixed(2)};
 });
 const minutes=completed&&disconnected?Math.ceil((instant(disconnected)-instant(completed))/60000):0,billable=Math.max(0,minutes-15),uncapped=money(new D(billable).mul('.25')),fee=D.min(20,uncapped),total=money(amount.add(fee)),owner=money(kwh.mul('.20')),platform=money(kwh.mul('.10'));
 return {schema_version:'1.0',session_id:sessionId,tariff_version:TARIFF_VERSION,area_code:'SP_ENEL',currency:'BRL',customer:{energy_kwh:energy(kwh).toFixed(4),energy_amount:money(amount).toFixed(2),overstay_fee:fee.toFixed(2),total_amount:total.toFixed(2),effective_energy_rate_per_kwh:kwh.gt(0)?money(amount.div(kwh)).toFixed(2):'0.00',grid_supported_energy_kwh:energy(grid).toFixed(4),high_demand_energy_kwh:energy(peak).toFixed(4)},overstay:{charge_completed_at:completed??null,disconnected_at:disconnected??null,grace_minutes:15,overstay_minutes_total:minutes,billable_minutes:billable,fee_per_minute:'0.25',uncapped_fee:uncapped.toFixed(2),applied_fee:fee.toFixed(2),cap:'20.00'},intervals:rows,internal_settlement_reference:{note:'Prototype bookkeeping only; owner/platform shares are carved out of energy revenue.',owner_energy_margin_reference:owner.toFixed(2),owner_overstay_reference:fee.toFixed(2),owner_total_reference:money(owner.add(fee)).toFixed(2),platform_fee_reference:platform.toFixed(2),residual_operating_pool:money(D.max(0,amount.sub(owner).sub(platform))).toFixed(2)}};
}
export const v1Enabled=(stationId:number|string)=>String(process.env.TARIFF_V1_STATION_IDS??'').split(',').includes(String(stationId));
export const unknownFacts=(at=new Date().toISOString()):Facts=>({grid_support_for_ev:false,high_demand:false,source:'unclassified_no_surcharge',observed_at:at});
export function initialBilling(stationId:number|string,at:Date,facts=unknownFacts(at.toISOString())){
 if(!v1Enabled(stationId))return {};
 const ledger:Ledger={tariff_version:TARIFF_VERSION,phase:'collecting',intervals:[],meter_energy_kwh:'0',last_at:at.toISOString(),facts};
 return {tariffVersion:TARIFF_VERSION,billingSnapshot:ledger as unknown as Prisma.InputJsonValue,basePricePerKwhSnapshot:'1.99',pricePerKwhSnapshot:rate(facts.grid_support_for_ev,facts.high_demand),fixedFeeSnapshot:0};
}
export function ledgerOf(s:{tariffVersion?:string|null;billingSnapshot?:unknown}):Ledger|null{
 if(!s.tariffVersion&&!s.billingSnapshot)return null;
 if(s.tariffVersion!==TARIFF_VERSION||!s.billingSnapshot||(s.billingSnapshot as Ledger).tariff_version!==TARIFF_VERSION)throw Error('Unsupported or incomplete billing snapshot');
 return structuredClone(s.billingSnapshot) as Ledger;
}
// Called under a DB session lock. Cumulative meter replay cannot bill twice.
// Continuous facts share a 15-minute billing interval; polling does not round money.
export function recordEnergy(ledger:Ledger,cumulative:Prisma.Decimal.Value,at:Date,nextFacts:Facts):Ledger{
 const l=structuredClone(ledger);if(l.phase!=='collecting')return l;
 const target=new D(cumulative),previous=new D(l.meter_energy_kwh),end=at.getTime(),start=instant(l.last_at);
 if(!target.isFinite()||target.lt(previous)||end<start)throw Error('Meter or timestamp regression');
 if(end===start){if(!target.equals(previous))throw Error('Conflicting meter replay');return l;}
 const delta=target.sub(previous);let cursor=start;
 while(cursor<end){const boundary=Math.min(end,(Math.floor(cursor/900000)+1)*900000),part=delta.mul(boundary-cursor).div(end-start),prev=l.intervals.at(-1);
  const same=prev&&prev.end_at===new Date(cursor).toISOString()&&Math.floor(instant(prev.start_at)/900000)===Math.floor(cursor/900000)&&prev.grid_support_for_ev===l.facts.grid_support_for_ev&&prev.high_demand===l.facts.high_demand&&prev.source===l.facts.source;
  if(part.gt(0)){if(same){prev.energy_kwh=new D(prev.energy_kwh).add(part).toString();prev.end_at=new Date(boundary).toISOString();}else l.intervals.push({...l.facts,start_at:new Date(cursor).toISOString(),end_at:new Date(boundary).toISOString(),energy_kwh:part.toString()});}
  cursor=boundary;
 }
 if(l.intervals.length>10000)throw Error('Billing interval limit reached');
 l.last_at=at.toISOString();l.meter_energy_kwh=target.toString();l.facts=nextFacts;return l;
}
export function invoice(s:{id:bigint|string;tariffVersion?:string|null;billingSnapshot?:unknown;endTime?:Date|null;disconnectedAt?:Date|null}){
 const l=ledgerOf(s);if(!l)return null;if(l.phase==='frozen'&&l.breakdown)return l.breakdown;
 return calculateSession(String(s.id),l.intervals,l.charge_completed_at??s.endTime?.toISOString(),s.disconnectedAt?.toISOString());
}
