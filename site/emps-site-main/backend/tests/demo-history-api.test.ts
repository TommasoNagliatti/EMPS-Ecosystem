import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BadRequestException,ForbiddenException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {DemoHistoryService,validateDemoHistoryFilters} from '../src/demo-history.service';

const d=(value:string)=>new Prisma.Decimal(value);
const owner={sub:'7'};
const station={id:11,name:'Posto 24h',adminId:7};
const batch={id:'batch-1',stationId:11,status:'ACTIVE',origin:'SIMULATED',gieProfile:'POSTO',
  datasetKey:'POSTO_24H_V1_2025',datasetSha256:'x'.repeat(64),scenarioVersion:'demo-finance-v1',
  sourceStartedAt:new Date('2025-01-01T03:00:00Z'),sourceEndedAt:new Date('2026-01-01T03:00:00Z')};
const delivered={id:1n,batchId:batch.id,stationId:11,sourceSessionId:'s1',sourceChargerId:'EVSE_01',chargerId:null,
  status:'COMPLETED',startedAt:new Date('2025-01-01T03:15:00Z'),endedAt:new Date('2025-01-01T04:00:00Z'),
  deliveredEnergyKwh:d('10.5000000000'),payment:{amount:d('23.10'),channel:'APP_EMPS',method:'PIX'}};
const unserved={...delivered,id:2n,sourceSessionId:'s2',sourceChargerId:null,status:'UNSERVED',
  deliveredEnergyKwh:d('0'),payment:null};
const readingDay={localDay:'2025-01-01',buildingKw:d('12'),solarKw:null,gridKw:null,
  evDeliveredKw:d('4'),buildingKwh:d('6'),solarKwh:null,gridKwh:null,evDeliveredKwh:d('2')};

function service(){
  const calls:{sessions?:unknown;readings?:Prisma.Sql;batch?:unknown}={};
  let readingQuery=0;
  const db={demoImportBatch:{findFirst:async(args:unknown)=>{calls.batch=args;return batch;}},
    demoChargingSession:{findMany:async(args:unknown)=>{calls.sessions=args;return [delivered,unserved];}},
    $queryRaw:async(args:Prisma.Sql)=>{
      if(readingQuery++%2===0){calls.readings=args;return [readingDay];}
      return [{localDay:'2025-01-01',batteryState:{BAT_01:{available:true}}}];
    },
    station:{findMany:async()=>[{id:11}]},
    chargingSession:{findMany:()=>{throw new Error('operational session queried');}},
    payment:{findMany:()=>{throw new Error('operational payment queried');}}};
  const access={require:async(user:{sub:string},stationId:string|number,permission:string)=>{
    assert.equal(user.sub,'7');assert.equal(Number(stationId),11);assert.equal(permission,'OWNER');return station;
  }};
  return {history:new DemoHistoryService(db as never,access as never),calls};
}

test('demo filters validate dates, channels, methods and station IDs',()=>{
  assert.equal(validateDemoHistoryFilters({from:'2025-01-01',to:'2025-01-01'}).toExclusive?.toISOString(),'2025-01-02T03:00:00.000Z');
  for(const invalid of [{from:'2025-02-30'},{from:'2025-13-01'},{from:'2025-02-02',to:'2025-02-01'},
    {channel:'STRIPE'},{method:'UNKNOWN'},{stationId:'0'}]){
    assert.throws(()=>validateDemoHistoryFilters(invalid),BadRequestException);
  }
});

test('owner-scoped station history aggregates only demo rows and keeps missing energy null',async()=>{
  const {history,calls}=service();
  const result=await history.station(owner,11,{from:'2025-01-01',to:'2025-01-31'});
  assert.equal(result.context,'SIMULATED');
  assert.deepEqual({attempts:result.summary.attempts,sessions:result.summary.sessions,deliveredKwh:result.summary.deliveredKwh,
    revenueSimulated:result.summary.revenueSimulated,avgTicket:result.summary.avgTicket},
    {attempts:2,sessions:1,deliveredKwh:10.5,revenueSimulated:23.1,avgTicket:23.1});
  assert.equal(result.readings[0].buildingKw,12);
  assert.equal(result.readings[0].buildingKwh,6);
  assert.equal(result.readings[0].gridKw,null);
  assert.equal(result.readings[0].solarKwh,null);
  assert.deepEqual(result.readings[0].batteryState,{BAT_01:{available:true}});
  assert.equal(result.sessions[1].amount,0);
  assert.equal(result.sessions[1].channel,null);
  assert.deepEqual(result.monthly.map(row=>row.month),['2025-01']);
  assert.equal((calls.sessions as {where:{batchId:string;payment:unknown}}).where.batchId,'batch-1');
  assert.match(calls.readings!.sql,/FROM demo_energy_readings WHERE batch_id = \? AND station_id = \?/);
  assert.deepEqual(calls.readings!.values.slice(0,2),['batch-1',11]);
  assert.equal((calls.batch as {where:{origin:string}}).where.origin,'SIMULATED');
  await history.station(owner,11,{channel:'APP_EMPS',method:'PIX'});
  assert.ok((calls.sessions as {where:{payment:unknown}}).where.payment);
  const unfiltered=await history.station(owner,11);
  assert.equal(unfiltered.monthly.length,12);
  assert.equal(unfiltered.monthly.at(-1)?.month,'2025-12');
  assert.equal(unfiltered.batch?.periodEnd,'2026-01-01T02:59:59.999Z');
});

test('network route restricts its search to owner and does not bypass station permission',async()=>{
  const {history}=service();
  const result=await history.network(owner,{stationId:'11'});
  assert.equal(result.stations.length,1);
  assert.equal(result.summary.revenueSimulated,23.1);
  const denied=new DemoHistoryService({station:{findMany:async()=>[{id:11}]}} as never,
    {require:async()=>{throw new ForbiddenException();}} as never);
  await assert.rejects(denied.network({sub:'9'},{}),ForbiddenException);
});

test('station route denies a staff OWNER belonging to another account',async()=>{
  const db={demoImportBatch:{findFirst:async()=>{throw new Error('batch must not be read');}}};
  const access={require:async()=>({...station,adminId:9,membershipRole:'OWNER'})};
  const history=new DemoHistoryService(db as never,access as never);
  await assert.rejects(history.station(owner,11),ForbiddenException);
});
