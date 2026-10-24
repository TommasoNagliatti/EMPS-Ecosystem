import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BadRequestException,ForbiddenException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {DemoHistoryAnalyticsService,summarizeDemoAnalyticsRows,validateDemoAnalyticsFilters} from '../src/demo-history-analytics.service';

const d=(value:string)=>new Prisma.Decimal(value);
function row(localKey:string,energy:string,overrides:Record<string,unknown>={}){
  return {localKey,intervalCount:1n,buildingKw:d('2'),solarKw:null,evDeliveredKw:d('1'),
    evRequestedKw:d('2'),gridKw:null,peakBuildingKw:d('2'),peakEvDeliveredKw:d('1'),peakEvRequestedKw:d('2'),
    buildingKwh:d('0.5'),solarKwh:null,evDeliveredKwh:d(energy),gridImportKwh:null,
    evRequestedKwhDerived:d('0.5'),gridImportProxyKwh:null,solarSurplusProxyKwh:null,
    buildingCount:1n,solarCount:0n,evDeliveredCount:1n,gridCount:0n,evRequestedCount:1n,proxyCount:0n,
    utilizationPercentSum:d('50'),utilizationCount:1n,queueCount:0n,queueObservedCount:1n,
    evse1OccupiedSum:d('0.5'),evse1OccupiedCount:1n,evse2OccupiedSum:null,evse2OccupiedCount:0n,
    ...overrides};
}

test('analytics dates and grain are strict and keep local calendar days',()=>{
  assert.deepEqual(validateDemoAnalyticsFilters({from:'2025-01-01',to:'2025-01-31',grain:'week'}),
    {from:'2025-01-01',to:'2025-01-31',grain:'week'});
  for(const invalid of [{from:'2025-02-30'},{from:'2025-10-02',to:'2025-10-01'},
    {grain:'quarter'},{from:'2025-1-1'}])
    assert.throws(()=>validateDemoAnalyticsFilters(invalid),BadRequestException);
});

test('exact interval energy sums reconcile; absent solar/grid remain null',()=>{
  const result=summarizeDemoAnalyticsRows([
    row('2025-01-01 00:00','0.1000000000'),row('2025-01-01 00:15','0.2000000000',
      {utilizationPercentSum:d('75'),queueCount:1n})
  ] as never,'day');
  assert.equal(result.totals.evDeliveredKwh,0.3);
  assert.equal(result.totals.buildingKwh,1);
  assert.equal(result.totals.solarKwh,null);
  assert.equal(result.totals.gridImportKwh,null);
  assert.equal(result.totals.utilizationPct,62.5);
  assert.equal(result.totals.queueIntervals,1);
  assert.deepEqual(result.totals.chargerUtilization,[{sourceChargerId:'EVSE_01',utilizationPct:50}]);
  assert.equal(result.points[0].at,'2025-01-01T03:00:00.000Z');
  assert.equal(result.buckets.length,1);
  assert.equal(result.buckets[0].evDeliveredKwh,result.totals.evDeliveredKwh);
  assert.equal(result.buckets[0].end,'2025-01-01T04:00:00.000Z');
  assert.equal(result.estimates.gridImportProxyKwh,null);
});

test('partial coverage is unknown; proxy is intervalwise, not netting monthly totals',()=>{
  const result=summarizeDemoAnalyticsRows([
    row('2025-01-01',d('0.1').toString(),{solarKwh:d('0.4'),solarCount:1n,
      gridImportProxyKwh:d('0.2'),solarSurplusProxyKwh:d('0.1'),proxyCount:1n}),
    row('2025-01-02',d('0.2').toString(),{buildingKwh:null,buildingCount:0n,
      solarKwh:d('0.9'),solarCount:1n})
  ] as never,'month');
  assert.equal(result.totals.buildingKwh,null);
  assert.equal(result.totals.solarKwh,1.3);
  assert.equal(result.estimates.gridImportProxyKwh,null);
  assert.equal(result.estimates.intervalCount,1);
  assert.equal(result.buckets[0].buildingKwh,0.5);
  assert.equal(result.buckets[1].buildingKwh,null);
});

test('owner and active simulated batch scope precede the raw energy query',async()=>{
  const batch={id:'batch-1',datasetKey:'POSTO_24H_V1_2025',datasetSha256:'a'.repeat(64),
    scenarioVersion:'demo-finance-v1',sourceStartedAt:new Date('2025-01-01T03:00:00Z'),
    sourceEndedAt:new Date('2026-01-01T03:00:00Z')};
  let raw:Prisma.Sql|undefined,search:unknown;
  const db={demoImportBatch:{findFirst:async(input:unknown)=>{search=input;return batch;}},
    $queryRaw:async(input:Prisma.Sql)=>{raw=input;return [row('2025-01-01', '0.25')];},
    stationEnergyReading:{findMany:()=>{throw new Error('operational reading queried');}}};
  const access={require:async()=>({id:11,name:'Posto',adminId:7,timezone:'America/Sao_Paulo'})};
  const result=await new DemoHistoryAnalyticsService(db as never,access as never)
    .station({sub:'7'},'11',{from:'2025-01-01',to:'2025-01-01',grain:'month'});
  assert.equal(result.context,'SIMULATED');
  assert.equal(result.source?.datasetKey,batch.datasetKey);
  assert.equal(result.source?.scenarioVersion,'demo-finance-v1');
  assert.equal(result.source?.sourceScenarioVersion,'demo-finance-v1');
  assert.equal(result.period.from,'2025-01-01');
  assert.equal(result.totals.evDeliveredKwh,0.25);
  assert.match(raw!.sql,/FROM demo_energy_readings/);
  assert.match(raw!.sql,/origin='SIMULATED'/);
  assert.deepEqual((search as {where:{status:string;origin:string}}).where.status,'ACTIVE');
  const denied=new DemoHistoryAnalyticsService(db as never,
    {require:async()=>({id:11,name:'Posto',adminId:8,timezone:'America/Sao_Paulo'})} as never);
  await assert.rejects(denied.station({sub:'7'},'11'),ForbiddenException);
});

test('residential analytics names the active financial sidecar without changing the energy source',async()=>{
  const batch={id:'source-batch',gieProfile:'CASA',datasetKey:'RESIDENCIAL_V1_2025',
    datasetSha256:'b'.repeat(64),scenarioVersion:'demo-finance-v1',
    sourceStartedAt:new Date('2025-01-01T03:00:00Z'),sourceEndedAt:new Date('2026-01-01T03:00:00Z')};
  const db={demoImportBatch:{findFirst:async()=>batch},$queryRaw:async()=>[row('2025-01', '1.0')]};
  const access={require:async()=>({id:3,name:'Residência',adminId:7,timezone:'America/Sao_Paulo'})};
  const result=await new DemoHistoryAnalyticsService(db as never,access as never)
    .station({sub:'7'},3,{grain:'year'});
  assert.equal(result.source?.scenarioVersion,'residential-owner-visitor-v2');
  assert.equal(result.source?.sourceScenarioVersion,'demo-finance-v1');
  assert.equal(result.source?.batchId,'source-batch');
  assert.equal(result.totals.evDeliveredKwh,1);
});
