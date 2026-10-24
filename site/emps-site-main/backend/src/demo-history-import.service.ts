import {BadRequestException, ConflictException, Injectable, NotFoundException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import type {AuthUser} from './auth';
import {COMMERCIAL_SHARED_ENERGY_SHA256,COMMERCIAL_SHARED_SOURCE_GROUP,loadDemoDataset,
  type DemoDataset, type DemoDatasetKind} from './demo-history-datasets';
import {DEFAULT_DEMO_SCENARIO, demoFinancials, type DemoFinancialScenario} from './demo-history-finance';
import {PREDIO_FINANCIAL_SCENARIO,PREDIO_SUPPLIED_PACKAGE,predioPaymentAttributions} from './demo-history-predio';
import {RESIDENTIAL_SCENARIO_VERSION,residentialScenarioFor} from './demo-history-residential-scenario';
import {PlatformAccessService} from './platform-access.service';
import {intId} from './persistence';
import {PrismaService} from './prisma.service';
import {remoteDevelopment} from './remote-development';

const KINDS=['SHOPPING','POSTO','CASA'] as const;
const CHUNK_SIZE=250;
const TRANSACTION_TIMEOUT_MS=300_000;

export type DemoStationIds=Record<(typeof KINDS)[number],string|number>;
export type DemoImportOptions={
  dataRoot:string;
  sourceRevision?:string;
  scenarios?:Partial<Record<DemoDatasetKind,DemoFinancialScenario>>;
  /** Explicit, owner-verified link from historical AC IDs to existing commercial chargers. */
  commercialChargerMap?:Record<string,string|number>;
};
export type DemoImportResult={
  kind:DemoDatasetKind;
  stationId:number;
  batchId:string;
  created:boolean;
  sessionCount:number;
  paymentCount:number;
  readingCount:number;
  deliveredEnergyKwh:string;
  /** Revenue of the immutable source batch's original financial scenario. */
  simulatedRevenue:string;
  baseScenarioVersion:string;
  activeFinancialScenario?:{
    version:string;
    ownerSessions:number;
    visitorSessions:number;
    ownerDeliveredEnergyKwh:string;
    visitorDeliveredEnergyKwh:string;
    simulatedRevenue:string;
    estimatedEnergyCost:string;
  };
  sourceStartedAt:Date;
  sourceEndedAt:Date;
};

type Prepared={
  kind:DemoDatasetKind;
  stationId:number;
  dataset:DemoDataset;
  scenario:DemoFinancialScenario;
  sessions:Array<{source:DemoDataset['sessions'][number];finance:ReturnType<typeof demoFinancials>}>;
  paymentCount:number;
  deliveredEnergyKwh:Prisma.Decimal;
  simulatedRevenue:Prisma.Decimal;
  commercialChargerMap:Record<string,number>|null;
};

function decimalSum(values:Iterable<string>):Prisma.Decimal{
  let sum=new Prisma.Decimal(0);
  for(const value of values)sum=sum.add(value);
  return sum;
}

function json(value:unknown):Prisma.InputJsonValue{
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function canonical(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function scenarioFor(options:DemoImportOptions,kind:DemoDatasetKind){
  if(kind==='PREDIO'&&options.scenarios?.PREDIO)
    throw new BadRequestException('O cenário financeiro do Prédio deve preservar a versão auditada');
  const scenario=kind==='PREDIO'?PREDIO_FINANCIAL_SCENARIO:
    options.scenarios?.[kind]??DEFAULT_DEMO_SCENARIO;
  if(!scenario.version||scenario.version.length>40||!Number.isSafeInteger(scenario.seed)||scenario.seed<0||scenario.seed>0xffffffff)
    throw new BadRequestException(`Cenário demonstrativo ${kind} inválido`);
  return scenario;
}

function prepareOne(options:DemoImportOptions,kind:DemoDatasetKind,stationId:number):Prepared{
  if(!options.dataRoot)throw new BadRequestException('Diretório dos datasets GIE obrigatório');
  if(options.sourceRevision&&options.sourceRevision.length>64)throw new BadRequestException('Revisão da fonte inválida');
  const dataset=loadDemoDataset(kind,options.dataRoot);
  const scenario=scenarioFor(options,kind);
  const attributions=kind==='PREDIO'?predioPaymentAttributions(dataset.sessions
    .filter(source=>source.status==='COMPLETED').map(source=>source.sourceSessionId)):null;
  const sessions=dataset.sessions.map(source=>{
    const finance=demoFinancials(source,scenario);
    if(!attributions||!finance.payment)return {source,finance};
    const attributed=attributions.get(source.sourceSessionId);
    if(!attributed)throw new ConflictException('Atribuição fictícia de pagamento do Prédio ausente');
    return {source,finance:{...finance,payment:{...finance.payment,...attributed}}};
  });
  let commercialChargerMap:Record<string,number>|null=null;
  if(kind==='PREDIO'&&options.commercialChargerMap!==undefined)
    throw new BadRequestException('O Prédio não tem mapeamento comprovado de quatro EVSEs para três carregadores');
  if(kind==='SHOPPING'&&options.commercialChargerMap!==undefined){
    const supplied=options.commercialChargerMap;
    if(!supplied||typeof supplied!=='object'||Array.isArray(supplied))
      throw new BadRequestException('Mapa dos carregadores comerciais inválido');
    const sourceIds=[...new Set(dataset.sessions.map(item=>item.sourceChargerId).filter((id):id is string=>!!id))].sort();
    if(canonical(Object.keys(supplied).sort())!==canonical(sourceIds))
      throw new BadRequestException('Mapa comercial deve conter exatamente todos os carregadores históricos');
    commercialChargerMap=Object.fromEntries(sourceIds.map(id=>[id,intId(supplied[id])]));
    if(new Set(Object.values(commercialChargerMap)).size!==sourceIds.length)
      throw new BadRequestException('Cada carregador histórico deve corresponder a um carregador comercial distinto');
  }
  const deliveredEnergyKwh=decimalSum(dataset.sessions.map(item=>item.deliveredEnergyKwh));
  const simulatedRevenue=decimalSum(sessions.map(item=>item.finance.amount));
  if(kind==='PREDIO'&&(!deliveredEnergyKwh.equals(PREDIO_SUPPLIED_PACKAGE.sourceEnergyKwh)||
    !simulatedRevenue.equals(PREDIO_SUPPLIED_PACKAGE.sourceRevenueBrl)||
    !decimalSum(sessions.map(item=>item.finance.costAmount)).equals(PREDIO_SUPPLIED_PACKAGE.sourceEstimatedCostBrl)))
    throw new ConflictException('Totais de energia e cenário financeiro original do Prédio divergiram da auditoria');
  return {kind,stationId,dataset,scenario,sessions,
    paymentCount:sessions.filter(item=>item.finance.payment!==null).length,
    deliveredEnergyKwh,simulatedRevenue,commercialChargerMap};
}

function prepare(options:DemoImportOptions,stationIds:DemoStationIds):Prepared[]{
  const stationNumbers=KINDS.map(kind=>intId(stationIds[kind]));
  if(new Set(stationNumbers).size!==KINDS.length)throw new BadRequestException('As três estações devem ser distintas');
  return KINDS.map((kind,index)=>prepareOne(options,kind,stationNumbers[index]));
}

async function chunks<T>(items:T[],fn:(items:T[])=>Promise<unknown>){
  for(let i=0;i<items.length;i+=CHUNK_SIZE)await fn(items.slice(i,i+CHUNK_SIZE));
}

@Injectable()
export class DemoHistoryImportService {
  constructor(private readonly db:PrismaService,private readonly access:PlatformAccessService){}

  private async validateStation(user:AuthUser,kind:DemoDatasetKind,stationId:number,
    tx:Prisma.TransactionClient=this.db){
    const station=await this.access.require(user,stationId,'OWNER',tx);
    if(station.adminId!==intId(user.sub))throw new ConflictException('A conta proprietária deve ser a mesma das três instalações');
    const binding=await tx.gieStationBinding.findUnique({where:{stationId}});
    if(kind==='SHOPPING'){
      const pinned=process.env.GIE_COMMERCIAL_STATION_ID;
      if(!pinned||intId(pinned)!==stationId)throw new ConflictException('Confirme a identidade da estação comercial');
      if(binding)throw new ConflictException('A estação comercial deve conservar o GIE legado');
      return station;
    }
    if(kind==='PREDIO'){
      if(stationId!==13||process.env.GIE_PREDIO_STATION_ID!=='13'||station.name!=='Prédio Comercial')
        throw new ConflictException('Confirme a identidade local do Prédio Comercial 13');
      if(binding?.gieStationId!=='Commercial_HighAutonomy_V2'||binding.profile!=='COMMERCIAL'||
        binding.origin!=='SIMULATED')
        throw new ConflictException('O Prédio precisa do vínculo GIE simulado isolado');
      if(await tx.charger.count({where:{stationId}})!==3)
        throw new ConflictException('O Prédio precisa conservar seus três carregadores operacionais existentes');
      return station;
    }
    const expectedId=kind==='POSTO'?'DEMO_POSTO_24H_001':'DEMO_CASA_001';
    const provisioning=station.gieProvisioning;
    const simulated=provisioning!==null&&typeof provisioning==='object'&&!Array.isArray(provisioning)&&
      provisioning.origin==='SIMULATED'&&provisioning.profile===expectedId&&
      provisioning.physical_dispatch===false&&provisioning.hardware_commands_sent===false;
    if(station.reviewState!=='DRAFT'||station.visibility!=='PRIVATE'||station.status!=='PENDING'||
      station.guestAllowed||!simulated||binding?.gieStationId!==expectedId||
      binding?.profile!==kind||binding?.origin!=='SIMULATED')
      throw new ConflictException(`Instalação ${kind} não está em modo privado e simulado`);
    if(await tx.charger.count({where:{stationId,administrativeStatus:{not:'PENDING'}}}))
      throw new ConflictException(`Instalação ${kind} contém carregador operacional`);
    return station;
  }

  private async validateNetwork(user:AuthUser,prepared:Prepared[],tx:Prisma.TransactionClient=this.db){
    const stations=[];
    for(const item of prepared)stations.push(await this.validateStation(user,item.kind,item.stationId,tx));
    if(new Set(stations.map(station=>station.adminId)).size!==1)
      throw new ConflictException('As três instalações precisam pertencer à mesma conta proprietária');
  }

  private async chargerMap(item:Prepared,tx:Prisma.TransactionClient){
    const map=new Map<string,number>();
    if(item.kind==='PREDIO')return map; // Four source AC IDs have no proved 4:3 mapping to physical chargers.
    if(item.kind==='SHOPPING'){
      if(!item.commercialChargerMap)return map; // Historical IDs remain linked by sourceChargerId when no approved map exists.
      const ids=Object.values(item.commercialChargerMap);
      const chargers=await tx.charger.findMany({where:{stationId:item.stationId,id:{in:ids}},select:{id:true}});
      if(chargers.length!==ids.length)
        throw new ConflictException('Mapa comercial contém carregador inexistente ou pertencente a outra estação');
      for(const [sourceId,id] of Object.entries(item.commercialChargerMap))map.set(sourceId,id);
      return map;
    }
    const chargers=await tx.charger.findMany({where:{stationId:item.stationId},select:{id:true,ocppIdentity:true}});
    for(const sourceId of new Set(item.dataset.sessions.map(session=>session.sourceChargerId).filter((id):id is string=>!!id))){
      const expected=`SIMULATED_${item.dataset.gieStationId}_${sourceId}`;
      const charger=chargers.find(row=>row.ocppIdentity===expected);
      if(!charger)throw new ConflictException(`Carregador demonstrativo ${sourceId} não pertence à instalação ${item.kind}`);
      map.set(sourceId,charger.id);
    }
    return map;
  }

  private sourceManifest(item:Prepared){
    if(item.kind==='PREDIO')return {sourceFiles:item.dataset.sourceFiles,
      sharedSourceGroup:COMMERCIAL_SHARED_SOURCE_GROUP,
      sharedEnergySourceSha256:COMMERCIAL_SHARED_ENERGY_SHA256,
      supplementalPackage:PREDIO_SUPPLIED_PACKAGE,
      historicalChargerMapping:'UNVERIFIED_SOURCE_IDS_ONLY'};
    return item.commercialChargerMap?{sourceFiles:item.dataset.sourceFiles,
      commercialChargerMap:item.commercialChargerMap}:item.dataset.sourceFiles;
  }

  private async verifyBatch(item:Prepared,batchId:string,tx:Prisma.TransactionClient){
    const [sessionCount,paymentCount,readingCount,sessionSums,paymentSums]=await Promise.all([
      tx.demoChargingSession.count({where:{batchId,stationId:item.stationId}}),
      tx.demoPayment.count({where:{batchId,stationId:item.stationId}}),
      tx.demoEnergyReading.count({where:{batchId,stationId:item.stationId}}),
      tx.demoChargingSession.aggregate({where:{batchId,stationId:item.stationId},_sum:{deliveredEnergyKwh:true,amount:true}}),
      tx.demoPayment.aggregate({where:{batchId,stationId:item.stationId},_sum:{amount:true}}),
    ]);
    if(sessionCount!==item.sessions.length||paymentCount!==item.paymentCount||readingCount!==item.dataset.readings.length||
      !(sessionSums._sum.deliveredEnergyKwh??new Prisma.Decimal(0)).equals(item.deliveredEnergyKwh)||
      !(sessionSums._sum.amount??new Prisma.Decimal(0)).equals(item.simulatedRevenue)||
      !(paymentSums._sum.amount??new Prisma.Decimal(0)).equals(item.simulatedRevenue))
      throw new ConflictException(`Lote ${batchId} incompleto ou divergente; somente reset específico pode removê-lo`);
    if(item.kind==='PREDIO'){
      const mapped=await tx.demoChargingSession.count({where:{batchId,stationId:item.stationId,
        chargerId:{not:null}}});
      const sourceChargers=await tx.demoChargingSession.groupBy({by:['sourceChargerId'],
        where:{batchId,stationId:item.stationId}});
      const ids=sourceChargers.map(row=>row.sourceChargerId).filter((id):id is string=>!!id).sort();
      if(mapped||canonical(ids)!==canonical(['AC_01','AC_02','AC_03','AC_04']))
        throw new ConflictException('IDs históricos AC_01..AC_04 não podem ser mapeados para carregadores físicos do Prédio');
    }
  }

  /** Backfill the versioned residential view over existing source sessions, without importing readings again. */
  private async ensureResidentialScenario(item:Prepared,batchId:string,tx:Prisma.TransactionClient){
    if(item.kind!=='CASA')return;
    const saved=await tx.demoChargingSession.findMany({where:{batchId,stationId:item.stationId},
      select:{id:true,sourceSessionId:true}});
    const sessionIds=new Map(saved.map(row=>[row.sourceSessionId,row.id]));
    const expected=item.dataset.sessions.map(source=>{
      const sessionId=sessionIds.get(source.sourceSessionId);
      if(sessionId===undefined)throw new ConflictException('Sessão residencial demonstrativa não persistida');
      return {sessionId,stationId:item.stationId,batchId,...residentialScenarioFor(source)};
    });
    const existing=await tx.demoSessionScenario.findMany({where:{batchId,stationId:item.stationId,
      scenarioVersion:RESIDENTIAL_SCENARIO_VERSION}});
    if(existing.length===0){
      await chunks(expected,async rows=>{await tx.demoSessionScenario.createMany({data:rows});});
      return;
    }
    const bySession=new Map(existing.map(row=>[row.sessionId,row]));
    if(existing.length!==expected.length||bySession.size!==expected.length)
      throw new ConflictException(`Cenário residencial ${RESIDENTIAL_SCENARIO_VERSION} incompleto`);
    for(const row of expected){
      const actual=bySession.get(row.sessionId);
      if(!actual||actual.batchId!==row.batchId||actual.stationId!==row.stationId||
        actual.usageKind!==row.usageKind||actual.credentialKind!==row.credentialKind||
        actual.driverKey!==row.driverKey||actual.driverName!==row.driverName||
        actual.channel!==row.channel||actual.method!==row.method||
        actual.currency!==row.currency||actual.origin!==row.origin||
        !actual.tariffPerKwh.equals(row.tariffPerKwh)||
        !actual.energyCostPerKwh.equals(row.energyCostPerKwh)||
        !actual.costAmount.equals(row.costAmount)||!actual.amount.equals(row.amount))
        throw new ConflictException(`Cenário residencial ${RESIDENTIAL_SCENARIO_VERSION} divergente`);
    }
  }

  private result(item:Prepared,batchId:string,created:boolean):DemoImportResult{
    const residential=item.kind==='CASA'?item.dataset.sessions.map(source=>({source,
      financial:residentialScenarioFor(source)})):null;
    return {kind:item.kind,stationId:item.stationId,batchId,created,
      sessionCount:item.sessions.length,paymentCount:item.paymentCount,readingCount:item.dataset.readings.length,
      deliveredEnergyKwh:item.deliveredEnergyKwh.toFixed(10),simulatedRevenue:item.simulatedRevenue.toFixed(2),
      baseScenarioVersion:item.scenario.version,
      ...(residential?{activeFinancialScenario:{
        version:RESIDENTIAL_SCENARIO_VERSION,
        ownerSessions:residential.filter(row=>row.financial.usageKind==='OWNER').length,
        visitorSessions:residential.filter(row=>row.financial.usageKind==='VISITOR').length,
        ownerDeliveredEnergyKwh:decimalSum(residential.filter(row=>row.financial.usageKind==='OWNER')
          .map(row=>row.source.deliveredEnergyKwh)).toFixed(10),
        visitorDeliveredEnergyKwh:decimalSum(residential.filter(row=>row.financial.usageKind==='VISITOR')
          .map(row=>row.source.deliveredEnergyKwh)).toFixed(10),
        simulatedRevenue:decimalSum(residential.map(row=>row.financial.amount)).toFixed(2),
        estimatedEnergyCost:decimalSum(residential.map(row=>row.financial.costAmount)).toFixed(2),
      }}:{}),
      sourceStartedAt:item.dataset.sourceStartedAt,sourceEndedAt:item.dataset.sourceEndedAt};
  }

  private async stage(user:AuthUser,item:Prepared,sourceRevision?:string):Promise<DemoImportResult>{
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM stations WHERE id=${item.stationId} FOR UPDATE`;
      await this.validateStation(user,item.kind,item.stationId,tx);
      const key={stationId:item.stationId,datasetKey:item.dataset.datasetKey,
        datasetSha256:item.dataset.datasetSha256,scenarioVersion:item.scenario.version,seed:item.scenario.seed};
      const existing=await tx.demoImportBatch.findUnique({where:{stationId_datasetKey_datasetSha256_scenarioVersion_seed:key}});
      if(existing){
        if(existing.gieProfile!==item.kind||existing.gieStationId!==item.dataset.gieStationId||
          canonical(existing.tariffConfig)!==canonical(item.scenario)||
          canonical(existing.sourceManifest)!==canonical(this.sourceManifest(item)))
          throw new ConflictException('Lote demonstrativo existente possui configuração divergente');
        await this.verifyBatch(item,existing.id,tx);
        await this.ensureResidentialScenario(item,existing.id,tx);
        return this.result(item,existing.id,false);
      }
      const batch=await tx.demoImportBatch.create({data:{...key,gieProfile:item.kind,
        gieStationId:item.dataset.gieStationId,sourceRevision:sourceRevision??null,
        status:'STAGED',origin:'SIMULATED',sourceStartedAt:item.dataset.sourceStartedAt,
        sourceEndedAt:item.dataset.sourceEndedAt,tariffConfig:json(item.scenario),
        sourceManifest:json(this.sourceManifest(item)),completedAt:new Date()}});
      const chargerIds=await this.chargerMap(item,tx);
      const sessionData=item.sessions.map(({source,finance})=>({
        stationId:item.stationId,batchId:batch.id,sourceSessionId:source.sourceSessionId,
        sourceChargerId:source.sourceChargerId,
        chargerId:source.sourceChargerId?chargerIds.get(source.sourceChargerId)??null:null,
        sourceStatus:source.sourceStatus,status:source.status,billable:finance.billable,
        startedAt:source.startedAt,endedAt:source.endedAt,
        durationSeconds:source.endedAt?Math.floor((source.endedAt.getTime()-source.startedAt.getTime())/1000):null,
        requestedEnergyKwh:source.requestedEnergyKwh,deliveredEnergyKwh:source.deliveredEnergyKwh,
        tariffPerKwh:finance.tariffPerKwh,fixedFee:finance.fixedFee,
        energyCostPerKwh:finance.energyCostPerKwh,costAmount:finance.costAmount,
        amount:finance.amount,currency:'BRL',origin:'SIMULATED' as const,
        sourcePayload:json(source.sourcePayload),
      }));
      await chunks(sessionData,async rows=>{await tx.demoChargingSession.createMany({data:rows});});
      const saved=await tx.demoChargingSession.findMany({where:{batchId:batch.id,stationId:item.stationId},
        select:{id:true,sourceSessionId:true}});
      const sessionIds=new Map(saved.map(row=>[row.sourceSessionId,row.id]));
      const paymentData=item.sessions.flatMap(({source,finance})=>{
        if(!finance.payment)return [];
        const sessionId=sessionIds.get(source.sourceSessionId);
        if(!sessionId)throw new ConflictException('Sessão demonstrativa não persistida');
        return [{stationId:item.stationId,batchId:batch.id,sessionId,
          sourcePaymentId:finance.payment.sourcePaymentId,channel:finance.payment.channel,
          method:finance.payment.method,amount:finance.payment.amount,currency:'BRL',
          status:'SIMULATED_SETTLED' as const,origin:'SIMULATED' as const,
          settledAt:finance.payment.settledAt}];
      });
      await chunks(paymentData,async rows=>{await tx.demoPayment.createMany({data:rows});});
      const readingData=item.dataset.readings.map(reading=>({stationId:item.stationId,batchId:batch.id,
        sourceReadingId:reading.sourceReadingId,intervalStart:reading.intervalStart,intervalEnd:reading.intervalEnd,
        buildingPowerKw:reading.buildingPowerKw,solarPowerKw:reading.solarPowerKw,gridPowerKw:reading.gridPowerKw,
        evRequestedPowerKw:reading.evRequestedPowerKw,evDeliveredPowerKw:reading.evDeliveredPowerKw,
        buildingEnergyKwh:reading.buildingEnergyKwh,solarEnergyKwh:reading.solarEnergyKwh,
        gridEnergyKwh:null,evRequestedEnergyKwh:null,evDeliveredEnergyKwh:reading.evDeliveredEnergyKwh,
        ...(reading.batteryStates?{batteryStates:json(reading.batteryStates)}:{}),
        sourcePayload:json(reading.sourcePayload),origin:'SIMULATED' as const}));
      await chunks(readingData,async rows=>{await tx.demoEnergyReading.createMany({data:rows});});
      await this.verifyBatch(item,batch.id,tx);
      await this.ensureResidentialScenario(item,batch.id,tx);
      return this.result(item,batch.id,true);
    },{maxWait:30_000,timeout:TRANSACTION_TIMEOUT_MS});
  }

  /** Stage all three histories before a single, short activation transaction. */
  async importAll(user:AuthUser,stationIds:DemoStationIds,options:DemoImportOptions):Promise<DemoImportResult[]>{
    if(remoteDevelopment())throw new ConflictException('Ambiente remoto de desenvolvimento é somente leitura');
    const prepared=prepare(options,stationIds); // Validate every original CSV before writing any row.
    await this.validateNetwork(user,prepared);
    const staged:DemoImportResult[]=[];
    for(const item of prepared)staged.push(await this.stage(user,item,options.sourceRevision));
    await this.db.$transaction(async tx=>{
      for(const stationId of prepared.map(item=>item.stationId).sort((a,b)=>a-b))
        await tx.$queryRaw`SELECT id FROM stations WHERE id=${stationId} FOR UPDATE`;
      await this.validateNetwork(user,prepared,tx);
      for(const result of staged){
        await tx.demoImportBatch.updateMany({where:{stationId:result.stationId,status:'ACTIVE',id:{not:result.batchId}},
          data:{status:'SUPERSEDED'}});
        await tx.demoImportBatch.update({where:{id:result.batchId},data:{status:'ACTIVE'}});
      }
    },{maxWait:30_000,timeout:60_000});
    return staged;
  }

  /** Activate one audited commercial-source copy on local station 13 only. */
  async importPredio(user:AuthUser,stationIdInput:string|number,options:DemoImportOptions):Promise<DemoImportResult>{
    if(remoteDevelopment())throw new ConflictException('Ambiente remoto de desenvolvimento é somente leitura');
    const item=prepareOne(options,'PREDIO',intId(stationIdInput)); // Full source/hash/financial validation before writes.
    await this.validateStation(user,item.kind,item.stationId);
    const staged=await this.stage(user,item,options.sourceRevision);
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM stations WHERE id=${item.stationId} FOR UPDATE`;
      await this.validateStation(user,item.kind,item.stationId,tx);
      const foreignActive=await tx.demoImportBatch.count({where:{stationId:item.stationId,status:'ACTIVE',
        gieProfile:{not:'PREDIO'}}});
      if(foreignActive)throw new ConflictException('Outro histórico demonstrativo está ativo no Prédio');
      await tx.demoImportBatch.updateMany({where:{stationId:item.stationId,gieProfile:'PREDIO',
        status:'ACTIVE',id:{not:staged.batchId}},data:{status:'SUPERSEDED'}});
      await tx.demoImportBatch.update({where:{id:staged.batchId},data:{status:'ACTIVE'}});
    },{maxWait:30_000,timeout:60_000});
    return staged;
  }

  /** Delete exactly one selected demonstration batch; operational tables are untouched. */
  async resetBatch(user:AuthUser,stationIdInput:string|number,batchId:string){
    if(remoteDevelopment())throw new ConflictException('Ambiente remoto de desenvolvimento é somente leitura');
    const stationId=intId(stationIdInput);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId))
      throw new BadRequestException('ID de lote inválido');
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM stations WHERE id=${stationId} FOR UPDATE`;
      const batch=await tx.demoImportBatch.findFirst({where:{id:batchId,stationId}});
      if(!batch)throw new NotFoundException('Lote demonstrativo não encontrado nesta estação');
      if(!KINDS.includes(batch.gieProfile as (typeof KINDS)[number])&&batch.gieProfile!=='PREDIO')
        throw new ConflictException('Perfil demonstrativo inválido');
      await this.validateStation(user,batch.gieProfile as DemoDatasetKind,stationId,tx);
      await tx.demoSessionScenario.deleteMany({where:{stationId,batchId}});
      const payments=await tx.demoPayment.deleteMany({where:{stationId,batchId}});
      const sessions=await tx.demoChargingSession.deleteMany({where:{stationId,batchId}});
      const readings=await tx.demoEnergyReading.deleteMany({where:{stationId,batchId}});
      await tx.demoImportBatch.delete({where:{id:batchId}});
      return {stationId,batchId,payments:payments.count,sessions:sessions.count,readings:readings.count};
    },{maxWait:30_000,timeout:TRANSACTION_TIMEOUT_MS});
  }
}
