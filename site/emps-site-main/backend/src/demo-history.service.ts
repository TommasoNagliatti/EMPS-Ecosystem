import {BadRequestException, ForbiddenException, Injectable} from '@nestjs/common';
import {DemoPaymentChannel, DemoPaymentMethod, Prisma} from '@prisma/client';
import type {AuthUser} from './auth';
import {PlatformAccessService} from './platform-access.service';
import {PrismaService} from './prisma.service';
import {intId} from './persistence';

type Filters={from?:string;to?:string;channel?:string;method?:string;stationId?:string};
type ValidatedFilters={from?:Date;toExclusive?:Date;channel?:DemoPaymentChannel;method?:DemoPaymentMethod;stationId?:number};
const CHANNELS=new Set<string>(Object.values(DemoPaymentChannel));
const METHODS=new Set<string>(Object.values(DemoPaymentMethod));
const decimal=(value:Prisma.Decimal|null|undefined)=>value?.toNumber()??null;
const sum=(a:number|null,b:number)=>(a??0)+b;
const money2=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

function localDay(date:Date){
  return new Date(date.getTime()-3*3_600_000).toISOString().slice(0,10);
}

function parseDay(value:string|undefined,label:string){
  if(value===undefined)return undefined;
  const parsed=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(`${value}T00:00:00Z`):null;
  if(!parsed||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value){
    throw new BadRequestException(`${label} deve usar YYYY-MM-DD`);
  }
  return value;
}

export function validateDemoHistoryFilters(input:Filters):ValidatedFilters{
  const from=parseDay(input.from,'from'),to=parseDay(input.to,'to');
  if(from&&to&&from>to)throw new BadRequestException('from deve ser anterior ou igual a to');
  if(input.channel&&!CHANNELS.has(input.channel))throw new BadRequestException('Canal demonstrativo inválido');
  if(input.method&&!METHODS.has(input.method))throw new BadRequestException('Método demonstrativo inválido');
  let stationId:number|undefined;
  if(input.stationId!==undefined){
    if(typeof input.stationId!=='string'||!/^\d+$/.test(input.stationId))throw new BadRequestException('stationId inválido');
    stationId=Number(input.stationId);
    if(!Number.isSafeInteger(stationId)||stationId<1)throw new BadRequestException('stationId inválido');
  }
  const toExclusive=to?new Date(new Date(`${to}T00:00:00-03:00`).getTime()+86_400_000):undefined;
  return {from:from?new Date(`${from}T00:00:00-03:00`):undefined,toExclusive,
    channel:input.channel as DemoPaymentChannel|undefined,method:input.method as DemoPaymentMethod|undefined,stationId};
}

function dateScope(from?:Date,toExclusive?:Date){
  return from||toExclusive?{gte:from,lt:toExclusive}:undefined;
}

// Source manifests end at the next interval boundary; the final month belongs to the preceding instant.
function coveredMonths(batchStart:Date|null,batchEndExclusive:Date|null,filters:ValidatedFilters){
  if(!batchStart||!batchEndExclusive||batchEndExclusive<=batchStart)return [];
  const from=filters.from&&filters.from>batchStart?filters.from:batchStart;
  const endLimit=filters.toExclusive?new Date(filters.toExclusive.getTime()-1):null;
  const sourceEndInclusive=new Date(batchEndExclusive.getTime()-1);
  const to=endLimit&&endLimit<sourceEndInclusive?endLimit:sourceEndInclusive;
  if(to<from)return [];
  const first=localDay(from).slice(0,7),last=localDay(to).slice(0,7);
  const months:string[]=[];
  for(let year=Number(first.slice(0,4)),month=Number(first.slice(5,7));
    year<Number(last.slice(0,4))||(year===Number(last.slice(0,4))&&month<=Number(last.slice(5,7)));
    month++){if(month>12){year++;month=1;}months.push(`${year}-${String(month).padStart(2,'0')}`);}
  return months;
}

@Injectable()
export class DemoHistoryService{
  constructor(private readonly db:PrismaService,private readonly access:PlatformAccessService){}

  async station(user:Pick<AuthUser,'sub'>,stationId:string|number,raw:Filters={}){
    const filters=validateDemoHistoryFilters(raw);
    const station=await this.access.require(user,stationId,'OWNER');
    if(station.adminId!==intId(user.sub))throw new ForbiddenException('Histórico demonstrativo restrito à conta proprietária');
    const batch=await this.db.demoImportBatch.findFirst({where:{stationId:station.id,status:'ACTIVE',origin:'SIMULATED'},
      orderBy:[{completedAt:'desc'},{createdAt:'desc'}]});
    const stationInfo={id:station.id,name:station.name,gieProfile:batch?.gieProfile??null,
      gieStationId:batch?.gieStationId??null};
    if(!batch)return {context:'SIMULATED' as const,station:stationInfo,batch:null,
      summary:{attempts:0,sessions:0,deliveredKwh:0,revenueSimulated:0,avgTicket:0,avgEnergy:0,activeMonths:0,
        sessionsPerMonth:0,deliveredKwhPerMonth:0,revenueSimulatedPerMonth:0},
      chargers:[],monthly:[],hours:[],channels:[],methods:[],readings:[],sessions:[]};

    const sessionWhere:Prisma.DemoChargingSessionWhereInput={batchId:batch.id,stationId:station.id,
      startedAt:dateScope(filters.from,filters.toExclusive),
      ...(filters.channel||filters.method?{payment:{is:{...(filters.channel?{channel:filters.channel}:{}),
        ...(filters.method?{method:filters.method}:{})}}}:{})};
    const readingWhere:Prisma.DemoEnergyReadingWhereInput={batchId:batch.id,stationId:station.id,
      intervalStart:dateScope(filters.from,filters.toExclusive)};
    const [sessionRows,readingRows]=await Promise.all([
      this.db.demoChargingSession.findMany({where:sessionWhere,include:{payment:true},orderBy:[{startedAt:'asc'},{id:'asc'}]}),
      this.db.demoEnergyReading.findMany({where:readingWhere,select:{intervalStart:true,buildingPowerKw:true,solarPowerKw:true,
        gridPowerKw:true,evDeliveredPowerKw:true,buildingEnergyKwh:true,solarEnergyKwh:true,gridEnergyKwh:true,
        evDeliveredEnergyKwh:true,batteryStates:true},orderBy:{intervalStart:'asc'}}),
    ]);

    const monthMap=new Map<string,{month:string;sessions:number;deliveredKwh:number;revenueSimulated:number}>();
    const hourMap=new Map<number,{hour:number;sessions:number}>();
    const chargerMap=new Map<string,{sourceChargerId:string;chargerId:number|null;sessions:number;deliveredKwh:number;revenueSimulated:number}>();
    const channelMap=new Map<string,{channel:string;sessions:number;revenueSimulated:number}>();
    const methodMap=new Map<string,{method:string;sessions:number;revenueSimulated:number}>();
    let sessions=0,deliveredKwh=0,revenueSimulated=0;
    const sessionItems=sessionRows.map(row=>{
      const energy=decimal(row.deliveredEnergyKwh)??0;
      const payment=row.payment;
      const amount=payment?decimal(payment.amount)??0:0;
      if(row.status==='COMPLETED'){
        sessions++;deliveredKwh+=energy;revenueSimulated+=amount;
        const day=localDay(row.startedAt),month=day.slice(0,7),hour=Number(new Date(row.startedAt.getTime()-3*3_600_000).toISOString().slice(11,13));
        const m=monthMap.get(month)??{month,sessions:0,deliveredKwh:0,revenueSimulated:0};
        m.sessions++;m.deliveredKwh+=energy;m.revenueSimulated+=amount;monthMap.set(month,m);
        const h=hourMap.get(hour)??{hour,sessions:0};h.sessions++;hourMap.set(hour,h);
        const key=row.sourceChargerId??'UNASSIGNED';
        const c=chargerMap.get(key)??{sourceChargerId:key,chargerId:row.chargerId,sessions:0,deliveredKwh:0,revenueSimulated:0};
        c.sessions++;c.deliveredKwh+=energy;c.revenueSimulated+=amount;chargerMap.set(key,c);
        if(payment){
          const ch=channelMap.get(payment.channel)??{channel:payment.channel,sessions:0,revenueSimulated:0};
          ch.sessions++;ch.revenueSimulated+=amount;channelMap.set(payment.channel,ch);
          const me=methodMap.get(payment.method)??{method:payment.method,sessions:0,revenueSimulated:0};
          me.sessions++;me.revenueSimulated+=amount;methodMap.set(payment.method,me);
        }
      }
      return {sourceSessionId:row.sourceSessionId,sourceChargerId:row.sourceChargerId,startTime:row.startedAt.toISOString(),
        endTime:row.endedAt?.toISOString()??null,deliveredKwh:energy,amount,channel:payment?.channel??null,
        method:payment?.method??null,status:row.status};
    });

    // Each source row is a 15-minute observation. Keep unavailable dimensions null rather than fabricating history.
    type ReadingDay={intervalStart:string;count:number;buildingCount:number;solarCount:number;gridCount:number;evCount:number;
      buildingKw:number;solarKw:number;gridKw:number;evDeliveredKw:number;
      buildingKwh:number|null;solarKwh:number|null;gridKwh:number|null;evDeliveredKwh:number|null;batteryState:Prisma.JsonValue|null};
    const dailyMap=new Map<string,ReadingDay>();
    for(const row of readingRows){
      const day=localDay(row.intervalStart);
      const d=dailyMap.get(day)??{intervalStart:day,count:0,buildingCount:0,solarCount:0,gridCount:0,evCount:0,
        buildingKw:0,solarKw:0,gridKw:0,evDeliveredKw:0,buildingKwh:null,solarKwh:null,gridKwh:null,
        evDeliveredKwh:null,batteryState:null};
      d.count++;
      const power:[keyof Pick<ReadingDay,'buildingKw'|'solarKw'|'gridKw'|'evDeliveredKw'>,keyof Pick<ReadingDay,'buildingCount'|'solarCount'|'gridCount'|'evCount'>,Prisma.Decimal|null][]=[
        ['buildingKw','buildingCount',row.buildingPowerKw],['solarKw','solarCount',row.solarPowerKw],
        ['gridKw','gridCount',row.gridPowerKw],['evDeliveredKw','evCount',row.evDeliveredPowerKw]];
      for(const [valueKey,countKey,value] of power)if(value!==null){d[valueKey]+=value.toNumber();d[countKey]++;}
      const energy:[keyof Pick<ReadingDay,'buildingKwh'|'solarKwh'|'gridKwh'|'evDeliveredKwh'>,Prisma.Decimal|null][]=[
        ['buildingKwh',row.buildingEnergyKwh],['solarKwh',row.solarEnergyKwh],['gridKwh',row.gridEnergyKwh],
        ['evDeliveredKwh',row.evDeliveredEnergyKwh]];
      for(const [key,value] of energy)if(value!==null)d[key]=sum(d[key],value.toNumber());
      if(row.batteryStates!==null)d.batteryState=row.batteryStates;
      dailyMap.set(day,d);
    }
    const readings=[...dailyMap.values()].map(d=>({intervalStart:d.intervalStart,
      buildingKw:d.buildingCount?d.buildingKw/d.buildingCount:null,solarKw:d.solarCount?d.solarKw/d.solarCount:null,
      gridKw:d.gridCount?d.gridKw/d.gridCount:null,evDeliveredKw:d.evCount?d.evDeliveredKw/d.evCount:null,
      buildingKwh:d.buildingKwh,solarKwh:d.solarKwh,gridKwh:d.gridKwh,evDeliveredKwh:d.evDeliveredKwh,
      batteryState:d.batteryState}));
    const months=coveredMonths(batch.sourceStartedAt,batch.sourceEndedAt,filters);
    const monthly=months.map(month=>monthMap.get(month)??{month,sessions:0,deliveredKwh:0,revenueSimulated:0});
    for(const item of monthly)item.revenueSimulated=money2(item.revenueSimulated);
    for(const item of chargerMap.values())item.revenueSimulated=money2(item.revenueSimulated);
    for(const item of channelMap.values())item.revenueSimulated=money2(item.revenueSimulated);
    for(const item of methodMap.values())item.revenueSimulated=money2(item.revenueSimulated);
    const activeMonths=months.length;
    revenueSimulated=money2(revenueSimulated);
    return {context:'SIMULATED' as const,station:stationInfo,
      batch:{id:batch.id,datasetKey:batch.datasetKey,periodStart:batch.sourceStartedAt?.toISOString()??null,
        periodEnd:batch.sourceEndedAt?new Date(batch.sourceEndedAt.getTime()-1).toISOString():null,scenarioVersion:batch.scenarioVersion,
        datasetSha256:batch.datasetSha256,origin:batch.origin},
      summary:{attempts:sessionRows.length,sessions,deliveredKwh,revenueSimulated,
        avgTicket:sessions?revenueSimulated/sessions:0,avgEnergy:sessions?deliveredKwh/sessions:0,activeMonths,
        sessionsPerMonth:activeMonths?sessions/activeMonths:0,deliveredKwhPerMonth:activeMonths?deliveredKwh/activeMonths:0,
        revenueSimulatedPerMonth:activeMonths?revenueSimulated/activeMonths:0},
      chargers:[...chargerMap.values()].sort((a,b)=>b.sessions-a.sessions),monthly,
      hours:[...hourMap.values()].sort((a,b)=>a.hour-b.hour),channels:[...channelMap.values()],methods:[...methodMap.values()],
      readings,sessions:sessionItems};
  }

  async network(user:Pick<AuthUser,'sub'>,raw:Filters={}){
    const filters=validateDemoHistoryFilters(raw);
    const ownerId=Number(user.sub);
    if(!Number.isSafeInteger(ownerId)||ownerId<1)throw new BadRequestException('Conta inválida');
    const stations=await this.db.station.findMany({where:{adminId:ownerId,
      ...(filters.stationId?{id:filters.stationId}:{}),demoImportBatches:{some:{status:'ACTIVE',origin:'SIMULATED'}}},
      select:{id:true},orderBy:{id:'asc'}});
    // The same OWNER check used by the individual route guards each station, including stationId filters.
    if(filters.stationId&&!stations.length)await this.access.require(user,filters.stationId,'OWNER');
    const items=await Promise.all(stations.map(station=>this.station(user,station.id,raw)));
    const summary={stations:items.length,attempts:0,sessions:0,deliveredKwh:0,revenueSimulated:0,avgTicket:0,avgEnergy:0};
    const monthMap=new Map<string,{month:string;sessions:number;deliveredKwh:number;revenueSimulated:number}>();
    for(const item of items){
      summary.attempts+=item.summary.attempts;summary.sessions+=item.summary.sessions;
      summary.deliveredKwh+=item.summary.deliveredKwh;summary.revenueSimulated+=item.summary.revenueSimulated;
      for(const m of item.monthly){
        const current=monthMap.get(m.month)??{month:m.month,sessions:0,deliveredKwh:0,revenueSimulated:0};
        current.sessions+=m.sessions;current.deliveredKwh+=m.deliveredKwh;current.revenueSimulated+=m.revenueSimulated;
        monthMap.set(m.month,current);
      }
    }
    summary.revenueSimulated=money2(summary.revenueSimulated);
    summary.avgTicket=summary.sessions?summary.revenueSimulated/summary.sessions:0;
    summary.avgEnergy=summary.sessions?summary.deliveredKwh/summary.sessions:0;
    const monthly=[...monthMap.values()].sort((a,b)=>a.month.localeCompare(b.month));
    for(const item of monthly)item.revenueSimulated=money2(item.revenueSimulated);
    return {context:'SIMULATED' as const,stations:items,summary,monthly};
  }
}
