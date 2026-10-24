import {BadRequestException, ForbiddenException, Injectable} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import type {AuthUser} from './auth';
import {PlatformAccessService} from './platform-access.service';
import {PrismaService} from './prisma.service';
import {intId} from './persistence';
import {RESIDENTIAL_SCENARIO_VERSION} from './demo-history-residential-scenario';
import {demoManagerAccess} from './official-demo-runtime';

export type DemoAnalyticsGrain='day'|'week'|'month'|'year';
export type DemoAnalyticsFilters={from?:string;to?:string;grain?:string};
type Value=Prisma.Decimal|number|bigint|null;
type AggregateRow={
  localKey:string;intervalCount:bigint;
  buildingKw:Value;solarKw:Value;evDeliveredKw:Value;evRequestedKw:Value;gridKw:Value;
  peakBuildingKw:Value;peakEvDeliveredKw:Value;peakEvRequestedKw:Value;
  buildingKwh:Value;solarKwh:Value;evDeliveredKwh:Value;gridImportKwh:Value;
  evRequestedKwhDerived:Value;gridImportProxyKwh:Value;solarSurplusProxyKwh:Value;
  buildingCount:bigint;solarCount:bigint;evDeliveredCount:bigint;gridCount:bigint;
  evRequestedCount:bigint;proxyCount:bigint;
  utilizationPercentSum:Value;utilizationCount:bigint;queueCount:bigint;queueObservedCount:bigint;
  evse1OccupiedSum:Value;evse1OccupiedCount:bigint;evse2OccupiedSum:Value;evse2OccupiedCount:bigint;
};

const SOURCE_TIMEZONE='America/Sao_Paulo';
const UTC_OFFSET='-03:00';
const GRAINS=new Set<DemoAnalyticsGrain>(['day','week','month','year']);
const ZERO=new Prisma.Decimal(0);
const decimal=(value:Value)=>value===null?null:new Prisma.Decimal(value.toString());
const numeric=(value:Value)=>value===null?null:Number(value.toString());
const count=(value:bigint)=>Number(value);

function localDate(date:Date){return new Date(date.getTime()-3*3_600_000).toISOString().slice(0,10);}
function dateInput(value:string|undefined,label:string){
  if(value===undefined)return undefined;
  if(typeof value!=='string'||!/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException(`${label} deve usar YYYY-MM-DD`);
  const check=new Date(`${value}T00:00:00Z`);
  if(!Number.isFinite(check.getTime())||check.toISOString().slice(0,10)!==value)
    throw new BadRequestException(`${label} inválido`);
  return value;
}
export function validateDemoAnalyticsFilters(raw:DemoAnalyticsFilters){
  const from=dateInput(raw.from,'from'),to=dateInput(raw.to,'to');
  if(from&&to&&from>to)throw new BadRequestException('from deve ser anterior ou igual a to');
  const grain=raw.grain??'month';
  if(!GRAINS.has(grain as DemoAnalyticsGrain))throw new BadRequestException('grain inválido');
  return {from,to,grain:grain as DemoAnalyticsGrain};
}

function fromLocalKey(key:string,grain:DemoAnalyticsGrain){
  const local=grain==='day'?`${key}:00`:grain==='week'?`${key}:00:00`:
    grain==='month'?`${key}T00:00:00`:`${key}-01T00:00:00`;
  return new Date(`${local.includes('T')?local:local.replace(' ','T')}${UTC_OFFSET}`).toISOString();
}
function bucketStart(at:string,grain:DemoAnalyticsGrain){
  const local=new Date(new Date(at).getTime()-3*3_600_000).toISOString();
  if(grain==='day')return `${local.slice(0,13)}:00:00${UTC_OFFSET}`;
  if(grain==='year')return `${local.slice(0,7)}-01T00:00:00${UTC_OFFSET}`;
  return `${local.slice(0,10)}T00:00:00${UTC_OFFSET}`;
}
function bucketEnd(start:string,grain:DemoAnalyticsGrain){
  const date=new Date(start);
  if(grain==='day')date.setUTCHours(date.getUTCHours()+1);
  else if(grain==='year')date.setUTCMonth(date.getUTCMonth()+1);
  else date.setUTCDate(date.getUTCDate()+1);
  return date.toISOString();
}
function add(values:Value[]){
  let total=ZERO,seen=false;
  for(const value of values){const item=decimal(value);if(item!==null){total=total.add(item);seen=true;}}
  return seen?total:null;
}
function coveredSum(rows:AggregateRow[],key:'buildingKwh'|'solarKwh'|'evDeliveredKwh'|'gridImportKwh'|'evRequestedKwhDerived'|'gridImportProxyKwh'|'solarSurplusProxyKwh',coverage:'buildingCount'|'solarCount'|'evDeliveredCount'|'gridCount'|'evRequestedCount'|'proxyCount'){
  const total=rows.reduce((sum,row)=>sum+count(row.intervalCount),0);
  const present=rows.reduce((sum,row)=>sum+count(row[coverage]),0);
  return total>0&&present===total?numeric(add(rows.map(row=>row[key]))):null;
}
function combine(rows:AggregateRow[]){
  const intervalCount=rows.reduce((sum,row)=>sum+count(row.intervalCount),0);
  const utilizationCount=rows.reduce((sum,row)=>sum+count(row.utilizationCount),0);
  const queueObservedCount=rows.reduce((sum,row)=>sum+count(row.queueObservedCount),0);
  const evse1Count=rows.reduce((sum,row)=>sum+count(row.evse1OccupiedCount),0);
  const evse2Count=rows.reduce((sum,row)=>sum+count(row.evse2OccupiedCount),0);
  return {
    intervalCount,
    buildingKwh:coveredSum(rows,'buildingKwh','buildingCount'),
    solarKwh:coveredSum(rows,'solarKwh','solarCount'),
    evDeliveredKwh:coveredSum(rows,'evDeliveredKwh','evDeliveredCount'),
    gridImportKwh:coveredSum(rows,'gridImportKwh','gridCount'),
    evRequestedKwhDerived:coveredSum(rows,'evRequestedKwhDerived','evRequestedCount'),
    peakBuildingKw:numeric(rows.reduce<Value>((max,row)=>max===null?row.peakBuildingKw:
      row.peakBuildingKw===null?max:decimal(max)!.greaterThan(row.peakBuildingKw.toString())?max:row.peakBuildingKw,null)),
    peakEvDeliveredKw:numeric(rows.reduce<Value>((max,row)=>max===null?row.peakEvDeliveredKw:
      row.peakEvDeliveredKw===null?max:decimal(max)!.greaterThan(row.peakEvDeliveredKw.toString())?max:row.peakEvDeliveredKw,null)),
    peakEvRequestedKw:numeric(rows.reduce<Value>((max,row)=>max===null?row.peakEvRequestedKw:
      row.peakEvRequestedKw===null?max:decimal(max)!.greaterThan(row.peakEvRequestedKw.toString())?max:row.peakEvRequestedKw,null)),
    utilizationPct:utilizationCount===intervalCount&&intervalCount>0?
      numeric(add(rows.map(row=>row.utilizationPercentSum))?.div(intervalCount)??null):null,
    queueIntervals:queueObservedCount===intervalCount&&intervalCount>0?
      rows.reduce((sum,row)=>sum+count(row.queueCount),0):null,
    chargerUtilization:[
      ...(evse1Count===intervalCount&&intervalCount>0?[{sourceChargerId:'EVSE_01',utilizationPct:
        numeric(add(rows.map(row=>row.evse1OccupiedSum))?.div(intervalCount).mul(100)??null)}]:[]),
      ...(evse2Count===intervalCount&&intervalCount>0?[{sourceChargerId:'EVSE_02',utilizationPct:
        numeric(add(rows.map(row=>row.evse2OccupiedSum))?.div(intervalCount).mul(100)??null)}]:[]),
    ],
  };
}

/** Exact kWh comes from stored 15-minute energy columns. Power series is descriptive, never integrated again. */
export function summarizeDemoAnalyticsRows(rows:AggregateRow[],grain:DemoAnalyticsGrain){
  const totals=combine(rows);
  const bucketMap=new Map<string,AggregateRow[]>();
  const points=rows.map(row=>{
    const at=fromLocalKey(row.localKey,grain),start=bucketStart(at,grain);
    const bucket=bucketMap.get(start)??[];bucket.push(row);bucketMap.set(start,bucket);
    return {at,buildingKw:numeric(row.buildingKw),solarKw:numeric(row.solarKw),
      evDeliveredKw:numeric(row.evDeliveredKw),evRequestedKw:numeric(row.evRequestedKw),
      gridKw:numeric(row.gridKw),intervalCount:count(row.intervalCount)};
  });
  const buckets=[...bucketMap].map(([start,items])=>({start:new Date(start).toISOString(),
    end:bucketEnd(start,grain),...combine(items)}));
  const proxyCoverage=rows.reduce((sum,row)=>sum+count(row.proxyCount),0);
  const estimates={gridImportProxyKwh:coveredSum(rows,'gridImportProxyKwh','proxyCount'),
    solarSurplusProxyKwh:coveredSum(rows,'solarSurplusProxyKwh','proxyCount'),
    intervalCount:proxyCoverage,method:'MAX(prédio_kWh + EV_kWh − solar_kWh, 0) por intervalo de 15 minutos; ignora baterias, perdas e exportação',
    measured:false,kind:'HYPOTHETICAL_PROXY' as const};
  return {totals,points,buckets,estimates};
}

@Injectable()
export class DemoHistoryAnalyticsService{
  constructor(private readonly db:PrismaService,private readonly access:PlatformAccessService){}

  async station(user:Pick<AuthUser,'sub'>,stationId:string|number,raw:DemoAnalyticsFilters={}){
    const filters=validateDemoAnalyticsFilters(raw);
    const clone=demoManagerAccess(stationId);
    const station=await this.access.require(user,stationId,clone?'MANAGE':'OWNER');
    if(station.adminId!==intId(user.sub)&&!clone)
      throw new ForbiddenException('Análise demonstrativa restrita à conta proprietária');
    const batch=await this.db.demoImportBatch.findFirst({where:{stationId:station.id,status:'ACTIVE',origin:'SIMULATED'},
      orderBy:[{completedAt:'desc'},{createdAt:'desc'}]});
    const sourceStart=batch?.sourceStartedAt?localDate(batch.sourceStartedAt):null;
    const sourceEnd=batch?.sourceEndedAt?localDate(new Date(batch.sourceEndedAt.getTime()-1)):null;
    const from=filters.from??sourceStart,to=filters.to??sourceEnd;
    if(from&&to&&from>to)throw new BadRequestException('from deve ser anterior ou igual a to');
    const source=batch?{batchId:batch.id,datasetKey:batch.datasetKey,datasetSha256:batch.datasetSha256,
      scenarioVersion:batch.gieProfile==='CASA'?RESIDENTIAL_SCENARIO_VERSION:batch.scenarioVersion,
      sourceScenarioVersion:batch.scenarioVersion,periodStart:batch.sourceStartedAt?.toISOString()??null,
      periodEnd:batch.sourceEndedAt?new Date(batch.sourceEndedAt.getTime()-1).toISOString():null,
      timezone:SOURCE_TIMEZONE,utcOffset:UTC_OFFSET,origin:'SIMULATED' as const}:null;
    const period={from,to,grain:filters.grain};
    const empty=summarizeDemoAnalyticsRows([],filters.grain);
    const stationInfo={id:station.id,name:station.name,timezone:station.timezone};
    if(!batch||!from||!to)return {context:'SIMULATED' as const,station:stationInfo,source,period,...empty};
    const start=new Date(`${from}T00:00:00${UTC_OFFSET}`);
    const end=new Date(new Date(`${to}T00:00:00${UTC_OFFSET}`).getTime()+86_400_000);
    const local=Prisma.sql`DATE_SUB(interval_start, INTERVAL 3 HOUR)`;
    const grouping=filters.grain==='day'?Prisma.sql`DATE_FORMAT(${local}, '%Y-%m-%d %H:%i')`:
      filters.grain==='week'?Prisma.sql`DATE_FORMAT(${local}, '%Y-%m-%d %H')`:
      filters.grain==='month'?Prisma.sql`DATE_FORMAT(${local}, '%Y-%m-%d')`:
      Prisma.sql`DATE_FORMAT(${local}, '%Y-%m')`;
    // JSON occupancy and queue are historical source observations, not hardware incidents.
    const occupancy=Prisma.sql`JSON_UNQUOTE(JSON_EXTRACT(source_payload, '$.ev.ocupacao_media_pct'))`;
    const queue=Prisma.sql`JSON_UNQUOTE(JSON_EXTRACT(source_payload, '$.ev.carros_na_fila'))`;
    const evse1=Prisma.sql`JSON_UNQUOTE(JSON_EXTRACT(source_payload, '$.ev.evse_01_occupied_fraction'))`;
    const evse2=Prisma.sql`JSON_UNQUOTE(JSON_EXTRACT(source_payload, '$.ev.evse_02_occupied_fraction'))`;
    const numericJson=(expression:Prisma.Sql)=>Prisma.sql`CASE WHEN ${expression} REGEXP '^[0-9]+([.][0-9]+)?$'
      THEN CAST(${expression} AS DECIMAL(18,10)) ELSE NULL END`;
    const occupancyNumber=numericJson(occupancy),queueNumber=numericJson(queue);
    const evse1Number=numericJson(evse1),evse2Number=numericJson(evse2);
    const rows=await this.db.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT ${grouping} AS localKey,COUNT(*) AS intervalCount,
        AVG(building_power_kw) AS buildingKw,AVG(solar_power_kw) AS solarKw,
        AVG(ev_delivered_power_kw) AS evDeliveredKw,AVG(ev_requested_power_kw) AS evRequestedKw,
        AVG(grid_power_kw) AS gridKw,
        MAX(building_power_kw) AS peakBuildingKw,MAX(ev_delivered_power_kw) AS peakEvDeliveredKw,
        MAX(ev_requested_power_kw) AS peakEvRequestedKw,
        SUM(building_energy_kwh) AS buildingKwh,SUM(solar_energy_kwh) AS solarKwh,
        SUM(ev_delivered_energy_kwh) AS evDeliveredKwh,
        SUM(CASE WHEN grid_energy_kwh IS NOT NULL THEN GREATEST(grid_energy_kwh,0) ELSE NULL END) AS gridImportKwh,
        SUM(ev_requested_power_kw*0.25) AS evRequestedKwhDerived,
        SUM(CASE WHEN building_energy_kwh IS NOT NULL AND ev_delivered_energy_kwh IS NOT NULL AND solar_energy_kwh IS NOT NULL
          THEN GREATEST(building_energy_kwh+ev_delivered_energy_kwh-solar_energy_kwh,0) ELSE NULL END) AS gridImportProxyKwh,
        SUM(CASE WHEN building_energy_kwh IS NOT NULL AND ev_delivered_energy_kwh IS NOT NULL AND solar_energy_kwh IS NOT NULL
          THEN GREATEST(solar_energy_kwh-building_energy_kwh-ev_delivered_energy_kwh,0) ELSE NULL END) AS solarSurplusProxyKwh,
        COUNT(building_energy_kwh) AS buildingCount,COUNT(solar_energy_kwh) AS solarCount,
        COUNT(ev_delivered_energy_kwh) AS evDeliveredCount,COUNT(grid_energy_kwh) AS gridCount,
        COUNT(ev_requested_power_kw) AS evRequestedCount,
        COUNT(CASE WHEN building_energy_kwh IS NOT NULL AND ev_delivered_energy_kwh IS NOT NULL AND solar_energy_kwh IS NOT NULL THEN 1 END) AS proxyCount,
        SUM(${occupancyNumber}) AS utilizationPercentSum,COUNT(${occupancyNumber}) AS utilizationCount,
        SUM(CASE WHEN ${queueNumber}>0 THEN 1 ELSE 0 END) AS queueCount,COUNT(${queueNumber}) AS queueObservedCount,
        SUM(${evse1Number}) AS evse1OccupiedSum,COUNT(${evse1Number}) AS evse1OccupiedCount,
        SUM(${evse2Number}) AS evse2OccupiedSum,COUNT(${evse2Number}) AS evse2OccupiedCount
      FROM demo_energy_readings
      WHERE batch_id=${batch.id} AND station_id=${station.id} AND origin='SIMULATED'
        AND interval_start>=${start} AND interval_start<${end}
      GROUP BY localKey ORDER BY localKey`);
    return {context:'SIMULATED' as const,station:stationInfo,source,period,
      ...summarizeDemoAnalyticsRows(rows,filters.grain)};
  }
}
