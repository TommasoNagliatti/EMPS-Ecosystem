import {gieV2Contract} from './gie-v2-contract';
import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {DataProvenance,Prisma} from '@prisma/client';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {PrismaService} from './prisma.service';
import {PlatformAccessService} from './platform-access.service';
import {AuthUser} from './auth';
import {intId} from './persistence';
import {assertChargeRuntimeStation} from './charge-runtime';
import {consumptionColumns,dataWindow,datasetRows,longestRun,physicalSourceWhere,telemetryFields,validateReading,TelemetryInput} from './telemetry-domain';
import {parseHistory} from './telemetry-import';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex'),json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const sourceSelect={id:true,stationId:true,label:true,kind:true,verifiedPhysical:true,verifiedBy:true,enabled:true,createdAt:true} as const;
@Injectable()
export class TelemetryService {
 constructor(private db:PrismaService,private access:PlatformAccessService){}
 private async persistInterval(tx:Prisma.TransactionClient,stationId:number,sourceId:string,kind:DataProvenance,r:ReturnType<typeof validateReading>,readingId?:bigint,batchId?:string){
  if(!r.snapshot)return;
  const old=await tx.gieIntervalSnapshot.findUnique({where:{stationId_intervalStart:{stationId,intervalStart:r.measuredAt}}});
  if(old)throw new ConflictException('Intervalo GIE já existe; não será sobrescrito nem terá origem alterada');
  await tx.gieIntervalSnapshot.create({data:{stationId,intervalStart:r.measuredAt,...r.snapshot,source:'V2_'+kind,provenance:json({kind,source_id:sourceId,reading_id:readingId?String(readingId):null,import_batch_id:batchId??null,interval_minutes:15,timestamp_semantics:'INTERVAL_START'})}});
 }
 async sources(user:AuthUser,id:string){const s=await this.access.require(user,id,'MANAGE');return this.db.telemetrySource.findMany({where:{stationId:s.id},select:sourceSelect})}
 async createSource(user:AuthUser,id:string,label:string,kind:DataProvenance){
  const s=await this.access.require(user,id,'MANAGE');assertChargeRuntimeStation(s.id);const token=randomBytes(32).toString('base64url');
  return this.db.$transaction(async tx=>{const source=await tx.telemetrySource.create({data:{stationId:s.id,label,kind,tokenHash:hash(token)},select:sourceSelect});await tx.stationAuditEvent.create({data:{stationId:s.id,actorId:intId(user.sub),action:'telemetry.source.created',details:{sourceId:source.id,kind}}});return {...source,token,warning:'Token exibido apenas nesta resposta. Fonte física ainda não verificada.'}});
 }
 async revokeSource(user:AuthUser,id:string,sourceId:string){const s=await this.access.require(user,id,'MANAGE');assertChargeRuntimeStation(s.id);return this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM stations WHERE id=${s.id} FOR UPDATE`;const source=await tx.telemetrySource.findFirst({where:{id:sourceId,stationId:s.id}});if(!source)throw new NotFoundException('Fonte não encontrada');await tx.stationAuditEvent.create({data:{stationId:s.id,actorId:intId(user.sub),action:'telemetry.source.revoked',details:{sourceId}}});return tx.telemetrySource.update({where:{id:sourceId},data:{enabled:false},select:sourceSelect})})}
 async verifyPhysical(user:AuthUser,id:string,sourceId:string,evidence:string){
  await this.access.reviewer(user);const stationId=intId(id);assertChargeRuntimeStation(stationId);
  return this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM stations WHERE id=${stationId} FOR UPDATE`;const source=await tx.telemetrySource.findFirst({where:{id:sourceId,stationId,enabled:true,kind:'MEASURED'}});if(!source)throw new NotFoundException('Fonte física candidata não encontrada');await tx.stationAuditEvent.create({data:{stationId,actorId:intId(user.sub),action:'telemetry.physical.verified',details:{sourceId,evidence}}});return tx.telemetrySource.update({where:{id:sourceId},data:{verifiedPhysical:true,verifiedBy:intId(user.sub)},select:sourceSelect})});
 }
 async ingest(id:string,sourceId:string,token:string,provenance:DataProvenance,rows:TelemetryInput[]){
  const stationId=intId(id);assertChargeRuntimeStation(stationId);
  if(!token)throw new UnauthorizedException('Token da fonte obrigatório');
  if(!Array.isArray(rows)||rows.length<1||rows.length>1000)throw new BadRequestException('Envie entre 1 e 1000 leituras');
  if(provenance==='IMPORTED'||provenance==='CALCULATED')throw new BadRequestException('Use o fluxo específico de importação ou cálculo');
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM stations WHERE id=${stationId} FOR UPDATE`;
   const source=await tx.telemetrySource.findFirst({where:{id:sourceId,stationId,enabled:true,tokenHash:hash(token)}});
   if(!source)throw new UnauthorizedException('Fonte ou token inválido');
   if(source.kind!==provenance)throw new ForbiddenException('Proveniência não corresponde à origem cadastrada');
   if(provenance==='MEASURED'&&(!source.verifiedPhysical||!source.verifiedBy))throw new ForbiddenException('Medição exige fonte física verificada');
   const ids:string[]=[];
   for(const row of rows){const r=validateReading(row,provenance);const previous=await tx.stationEnergyReading.findFirst({where:{stationId,sourceId,measuredAt:r.measuredAt}});if(previous){if(Object.values(telemetryFields).some(k=>r.data[k]===undefined?(previous as any)[k]!==null:(previous as any)[k]===null||Number((previous as any)[k])!==r.data[k])||previous.provenance!==provenance)throw new ConflictException('Leitura existente difere do replay');if(r.snapshot){const interval=await tx.gieIntervalSnapshot.findUnique({where:{stationId_intervalStart:{stationId,intervalStart:r.measuredAt}}});if(!interval||(interval.provenance as any)?.source_id!==sourceId||Object.entries(r.snapshot).some(([k,v])=>Number((interval as any)[k])!==v))throw new ConflictException('Snapshot existente difere do replay')}ids.push(String(previous.id));continue}const saved=await tx.stationEnergyReading.create({data:{stationId,sourceId,provenance,measuredAt:r.measuredAt,measurementQuality:'GOOD',readingSource:provenance==='SIMULATED'?'SIMULATOR':'MANUAL',...r.data}});await this.persistInterval(tx,stationId,source.id,provenance,r,saved.id);ids.push(String(saved.id))}
   return {station_id:stationId,provenance,readingIds:ids};
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
 }
 async calculate(user:AuthUser,id:string,sourceId:string,parentIds:string[]){
  const station=await this.access.require(user,id,'MANAGE');assertChargeRuntimeStation(station.id);
  if(!Array.isArray(parentIds)||!parentIds.length||parentIds.length>100||new Set(parentIds).size!==parentIds.length||parentIds.some(v=>!/^\d+$/.test(v)))throw new BadRequestException('Informe entre 1 e 100 leituras físicas distintas');
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM stations WHERE id=${station.id} FOR UPDATE`;
   const source=await tx.telemetrySource.findFirst({where:{id:sourceId,stationId:station.id,kind:'CALCULATED',enabled:true}});if(!source)throw new NotFoundException('Fonte de cálculo não encontrada');
   const parents=await tx.stationEnergyReading.findMany({where:{id:{in:parentIds.map(BigInt)},stationId:station.id,...physicalSourceWhere,measurementQuality:'GOOD'},orderBy:{measuredAt:'asc'}});if(parents.length!==parentIds.length)throw new ForbiddenException('Cálculo exige leituras físicas verificadas da mesma estação');
   const data:Record<string,number>={};for(const k of Object.values(telemetryFields)){if(k==='connectedVehicleCount'||k==='queuedVehicleCount')continue;if(parents.every(p=>(p as any)[k]!==null))data[k]=parents.reduce((sum,p)=>sum+Number((p as any)[k]),0)/parents.length}
   if(!Object.keys(data).length)throw new BadRequestException('Leituras sem grandeza comum para média');
   const reading=await tx.stationEnergyReading.create({data:{stationId:station.id,sourceId,provenance:'CALCULATED',measuredAt:parents.at(-1)!.measuredAt,measurementQuality:'GOOD',readingSource:'MANUAL',...data}});
   await tx.stationAuditEvent.create({data:{stationId:station.id,actorId:intId(user.sub),action:'telemetry.calculated',details:{readingId:String(reading.id),sourceId,parentIds,method:'ARITHMETIC_MEAN',provenance:'CALCULATED'}}});return reading;
  });
 }
 async history(user:AuthUser,id:string,from:string,to:string,provenance?:DataProvenance){const s=await this.access.require(user,id,'READ');if(provenance&&!Object.values(DataProvenance).includes(provenance))throw new BadRequestException('Origem inválida');return this.db.stationEnergyReading.findMany({where:{stationId:s.id,measuredAt:dataWindow(from,to),...(provenance?{provenance}:{})},orderBy:{measuredAt:'desc'},take:1000,include:{source:{select:sourceSelect}}})}
 async importHistory(user:AuthUser,id:string,file:{buffer:Buffer;originalname:string},timezone:string,commit:boolean){
  const s=await this.access.require(user,id,'MANAGE');assertChargeRuntimeStation(s.id);const parsed=await parseHistory(file,timezone);
  if(timezone!==s.timezone)throw new BadRequestException('Timezone deve coincidir com a configuração da estação');
  const summary={station_id:s.id,rows:parsed.rows.length,first:parsed.first,last:parsed.last,provenance:parsed.provenance,intervalMinutes:15,timezone,sha256:parsed.sha256,modelActivated:false};
  if(!commit)return {...summary,preview:parsed.rows.slice(0,5)};
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM stations WHERE id=${s.id} FOR UPDATE`;
   const tokenHash=hash(`import-v1:${s.id}:${parsed.sha256}`),existing=await tx.telemetrySource.findUnique({where:{tokenHash}});if(existing)return {...summary,sourceId:existing.id,replay:true};
   const times=parsed.rows.map(r=>new Date(r.timestamp));
   if(await tx.stationEnergyReading.findFirst({where:{stationId:s.id,provenance:'IMPORTED',measuredAt:{in:times}}}))throw new ConflictException('Importação sobrepõe histórico importado existente');
   const source=await tx.telemetrySource.create({data:{stationId:s.id,label:file.originalname.slice(0,100),kind:'IMPORTED',tokenHash,enabled:false}}),batchId=randomUUID();
   const data=parsed.rows.map(row=>{const r=validateReading(row,'IMPORTED');return {stationId:s.id,sourceId:source.id,importBatchId:batchId,provenance:'IMPORTED' as const,measuredAt:r.measuredAt,measurementQuality:'GOOD' as const,readingSource:'MANUAL' as const,...r.data}});
   for(let i=0;i<data.length;i+=500)await tx.stationEnergyReading.createMany({data:data.slice(i,i+500)});
   for(const row of parsed.rows){const r=validateReading(row,'IMPORTED');if(r.snapshot)await this.persistInterval(tx,s.id,source.id,'IMPORTED',r,undefined,batchId)}
   await tx.stationAuditEvent.create({data:{stationId:s.id,actorId:intId(user.sub),action:'telemetry.imported',details:{...summary,sourceId:source.id,batchId}}});return {...summary,sourceId:source.id,batchId,replay:false};
  },{timeout:60000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
 }
 async dataset(user:AuthUser,id:string,from:string,to:string,origin:string,model='building'){
  const s=await this.access.require(user,id,'MANAGE');if(!['MEASURED','IMPORTED'].includes(origin))throw new BadRequestException('Dataset exige seleção explícita MEASURED ou IMPORTED; previsões e Demo não são alvos');
  if(model==='chargers'){
   const sources=await this.db.telemetrySource.findMany({where:{stationId:s.id,kind:origin,...(origin==='MEASURED'?{verifiedPhysical:true,verifiedBy:{not:null}}:{})},select:{id:true}}),allowed=new Set(sources.map(r=>r.id));
   const records=await this.db.gieIntervalSnapshot.findMany({where:{stationId:s.id,intervalStart:dataWindow(from,to),provenance:{path:'$.kind',equals:origin}},orderBy:{intervalStart:'asc'},take:100001});
   if(records.length>100000)throw new BadRequestException('Reduza o período do dataset');
   const rows=records.filter(r=>allowed.has((r.provenance as any)?.source_id)).map(r=>({station_id:s.id,timestamp:r.intervalStart.toISOString(),available_at:new Date(r.intervalStart.getTime()+900000).toISOString(),potencia_solicitada_kw:Number(r.requestedPowerKw),potencia_entregue_kw:Number(r.deliveredPowerKw),carregadores_ocupados:r.occupiedChargers,carros_conectados:r.connectedCars,carros_chegando:r.arrivingCars,carros_na_fila:r.queuedCars,ocupacao_pct:Number(r.occupancyPercent),energia_entregue_kwh:Number(r.deliveredEnergyKwh),provenance:r.provenance}));
   return {station_id:s.id,timezone:s.timezone,origin,model,interval_minutes:15,rows,gaps:rows.slice(1).filter((r,i)=>Date.parse(r.timestamp)-Date.parse(rows[i].timestamp)!==900000).length,automaticTraining:false,modelActivated:false,baseModelCompatible:rows.length>0&&rows.every(r=>r.potencia_solicitada_kw<=88&&r.carregadores_ocupados<=4&&r.carros_chegando<=6&&r.carros_na_fila<=3&&r.carros_conectados===r.carregadores_ocupados&&Math.abs(r.ocupacao_pct-r.carregadores_ocupados*25)<.001)};
  }
  if(model!=='building')throw new BadRequestException('Modelo deve ser building ou chargers');
  const rows=await this.db.stationEnergyReading.findMany({where:{stationId:s.id,measuredAt:dataWindow(from,to),measurementQuality:'GOOD',...(origin==='MEASURED'?physicalSourceWhere:{provenance:'IMPORTED' as const,source:{is:{kind:'IMPORTED'}}})},orderBy:{measuredAt:'asc'},take:100001});
  if(rows.length>100000)throw new BadRequestException('Reduza o período para exportar até 100000 leituras');
  const data=datasetRows(rows),gaps=data.slice(1).filter((r,i)=>Date.parse(r.timestamp)-Date.parse(data[i].timestamp)!==900000).length;
  return {station_id:s.id,timezone:s.timezone,origin,interval_minutes:15,timestamp_semantics:'INTERVAL_START',available_after_minutes:15,rows:data,excludedRows:rows.length-data.length,gaps,automaticTraining:false,modelActivated:false,legacyAdapterRequired:'GIE atual exige timestamp local sem offset; converter explicitamente, nunca substituir artefatos congelados'};
 }
 async readiness(user:AuthUser,id:string){
  const s=await this.access.require(user,id,'READ'),since=new Date(Date.now()-730*86400000);
  const counts=await this.db.stationEnergyReading.groupBy({by:['provenance'],where:{stationId:s.id,measuredAt:{gte:since}},_count:{_all:true}});
  const trusted=await this.db.stationEnergyReading.findMany({where:{stationId:s.id,measuredAt:{gte:since,lte:new Date()},...physicalSourceWhere},orderBy:{measuredAt:'asc'},take:100001});
  const latestTrusted=await this.db.stationEnergyReading.findFirst({where:{stationId:s.id,measuredAt:{lte:new Date()},...physicalSourceWhere,measurementQuality:'GOOD'},orderBy:{measuredAt:'desc'},select:{measuredAt:true}});
  const truncated=trusted.length>100000,good=trusted.filter(r=>r.measurementQuality==='GOOD'),usable=datasetRows(good),days=new Set(good.map(r=>new Intl.DateTimeFormat('en-CA',{timeZone:s.timezone}).format(r.measuredAt))).size;
  const first=usable[0]?.timestamp,last=usable.at(-1)?.timestamp,expected=first&&last?(Date.parse(last)-Date.parse(first))/900000+1:0;
  const physicalSources=await this.db.telemetrySource.findMany({where:{stationId:s.id,kind:'MEASURED',verifiedPhysical:true,verifiedBy:{not:null}},select:{id:true}}),allowedSources=new Set(physicalSources.map(r=>r.id));
  const snapshots=await this.db.gieIntervalSnapshot.findMany({where:{stationId:s.id,intervalStart:{gte:since,lte:new Date()},provenance:{path:'$.kind',equals:'MEASURED'}},orderBy:{intervalStart:'asc'},take:100001});
  const chargerIntervals=snapshots.filter(r=>allowedSources.has((r.provenance as any)?.source_id));
  const chargerRun=longestRun(chargerIntervals.map(r=>r.intervalStart.getTime())),buildingRun=longestRun(usable.map(r=>Date.parse(r.timestamp)));
  return {station_id:s.id,latestTrustedTelemetryAt:latestTrusted?.measuredAt??null,model:'GIE Base',provisioningStatus:s.gieProvisioning?'CONTRACT_PREPARED':'NOT_PROVISIONED',runtimeActivated:false,personalizationAvailable:false,automaticTraining:false,provenanceCounts:counts.map(r=>({origin:r.provenance??'UNCLASSIFIED_LEGACY',count:r._count._all})),realDataDays:truncated?null:days,qualityPercent:!truncated&&trusted.length?Math.round(good.length/trusted.length*10000)/100:null,usableConsumptionIntervals:usable.length,coveragePercent:expected?Math.round(usable.length/expected*10000)/100:null,analysisTruncated:truncated,requiredConsumptionColumns:consumptionColumns,minimumObservedIntervals:{building:673,chargers:2689},chargerDatasetReady:snapshots.length<=100000&&chargerRun>=2689,chargerObservedIntervals:chargerIntervals.length,longestContinuousIntervals:{building:buildingRun,chargers:chargerRun},buildingDatasetReady:!truncated&&buildingRun>=673,blockers:['Treinamento e ativação automáticos não implementados',...(chargerRun>=2689?[]:['Motor de carregadores exige 2689 intervalos contínuos completos com origem física verificada']),...(good.length?[]:['Nenhuma telemetria física confiável coletada']),...(truncated?['Reduza o período para análise completa']:[])],retention:{months:24,automaticDeletion:false},gieContract:gieV2Contract(s.gieProvisioning,s.availability)};
 }
}
