import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ConflictException,ForbiddenException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {DemoHistoryService} from '../src/demo-history.service';
import {RESIDENTIAL_SCENARIO_VERSION} from '../src/demo-history-residential-scenario';

const d=(value:string)=>new Prisma.Decimal(value);
const owner={sub:'7'};
const residence={id:3,name:'Residência',adminId:7};
const batch={id:'residence-batch',stationId:3,status:'ACTIVE',origin:'SIMULATED',gieProfile:'CASA',
  gieStationId:'DEMO_CASA_001',datasetKey:'RESIDENCIAL_V1_2025',datasetSha256:'x'.repeat(64),
  scenarioVersion:'demo-finance-v1',sourceStartedAt:new Date('2025-01-01T03:00:00Z'),
  sourceEndedAt:new Date('2026-01-01T03:00:00Z')};
const fixture=[
  {id:1n,sourceSessionId:'DEMO_CASA_001_S00001',at:'2025-01-05T20:00:00Z',kwh:'10',
    kind:'OWNER',amount:'0.00',cost:'8.00',channel:null,method:null},
  {id:2n,sourceSessionId:'DEMO_CASA_001_S00002',at:'2025-01-06T20:00:00Z',kwh:'5',
    kind:'OWNER',amount:'0.00',cost:'4.00',channel:null,method:null},
  {id:3n,sourceSessionId:'DEMO_CASA_001_S00004',at:'2025-01-07T20:00:00Z',kwh:'20',
    kind:'VISITOR',amount:'44.00',cost:'16.00',channel:'APP_EMPS',method:'PIX'},
  {id:4n,sourceSessionId:'DEMO_CASA_001_S00008',at:'2025-02-08T20:00:00Z',kwh:'10',
    kind:'VISITOR',amount:'22.00',cost:'8.00',channel:'CAIXA',method:'CASH'},
  {id:5n,sourceSessionId:'DEMO_CASA_001_S00009',at:'2025-02-09T20:00:00Z',kwh:'5',
    kind:'OWNER',amount:'0.00',cost:'4.00',channel:null,method:null},
] as const;
const sourceSessions=fixture.map(row=>({id:row.id,batchId:batch.id,stationId:3,
  sourceSessionId:row.sourceSessionId,sourceChargerId:'EVSE_01',chargerId:31,
  status:'COMPLETED',startedAt:new Date(row.at),endedAt:new Date(new Date(row.at).getTime()+3_600_000),
  durationSeconds:3600,requestedEnergyKwh:d(row.kwh),deliveredEnergyKwh:d(row.kwh),
  costAmount:d('999.00'),
  // Deliberately wrong v1 receipts prove that the residential view reads only v2.
  payment:{amount:d('1000.00'),channel:'WEB_CHARGE',method:'CREDIT_CARD'},
}));
const scenarioRows=fixture.map(row=>({sessionId:row.id,batchId:batch.id,stationId:3,
  scenarioVersion:RESIDENTIAL_SCENARIO_VERSION,usageKind:row.kind,
  credentialKind:row.kind==='OWNER'?'HYPOTHETICAL_RFID':'NONE',
  driverKey:row.kind==='OWNER'?'DEMO-CASA-OWNER-001':`DEMO-CASA-VISITOR-${row.sourceSessionId.slice(-5)}`,
  driverName:row.kind==='OWNER'?'Proprietário demonstrativo':
    `Visitante demonstrativo ${row.sourceSessionId.slice(-5)}`,
  amount:d(row.amount),costAmount:d(row.cost),channel:row.channel,method:row.method,
}));

function harness(options:{partialScenario?:boolean}={}){
  const calls:{sessions:unknown[];scenarios:unknown[]}={sessions:[],scenarios:[]};
  const db={
    demoImportBatch:{findFirst:async()=>batch},
    demoChargingSession:{findMany:async(args:{where:{batchId:string;stationId:number;
      startedAt?:{gte?:Date;lt?:Date};payment?:unknown}})=>{
      calls.sessions.push(args);
      assert.equal(args.where.batchId,batch.id);
      assert.equal(args.where.stationId,3);
      assert.equal(args.where.payment,undefined);
      return sourceSessions.filter(row=>{
        const scope=args.where.startedAt;
        return (!scope?.gte||row.startedAt>=scope.gte)&&(!scope?.lt||row.startedAt<scope.lt);
      });
    }},
    demoSessionScenario:{findMany:async(args:{where:{scenarioVersion:string;sessionId:{in:bigint[]}}})=>{
      calls.scenarios.push(args);
      assert.equal(args.where.scenarioVersion,RESIDENTIAL_SCENARIO_VERSION);
      const rows=scenarioRows.filter(row=>args.where.sessionId.in.includes(row.sessionId));
      return options.partialScenario?rows.slice(0,-1):rows;
    }},
    $queryRaw:async()=>[],
    station:{findMany:async(args:{where:{adminId:number;id?:number}})=>
      args.where.adminId===7&&(!args.where.id||args.where.id===3)?[{id:3}]:[]},
    chargingSession:{findMany:()=>{throw new Error('operational charging queried');}},
    payment:{findMany:()=>{throw new Error('operational payment queried');}},
  };
  const access={require:async(user:{sub:string},stationId:string|number,permission:string)=>{
    assert.equal(permission,'OWNER');
    assert.equal(Number(stationId),3);
    if(user.sub!=='7')throw new ForbiddenException();
    return residence;
  }};
  return {service:new DemoHistoryService(db as never,access as never),calls};
}

test('residential API uses v2 owner/visitor rows and ignores all v1 payments',async()=>{
  const {service,calls}=harness();
  const result=await service.station(owner,3);
  assert.equal(result.batch?.scenarioVersion,RESIDENTIAL_SCENARIO_VERSION);
  assert.equal(result.batch?.sourceScenarioVersion,'demo-finance-v1');
  assert.deepEqual({sessions:result.summary.sessions,paid:result.summary.paidSessions,
    owner:result.summary.ownerSessions,visitor:result.summary.visitorSessions,
    energy:result.summary.deliveredKwh,ownerEnergy:result.summary.ownerEnergyKwh,
    visitorEnergy:result.summary.visitorEnergyKwh,revenue:result.summary.revenueSimulated,
    cost:result.summary.estimatedEnergyCost,visitorCost:result.summary.visitorEstimatedCost,
    margin:result.summary.estimatedContributionMargin,
    resultAfterOwnerEnergy:result.summary.resultAfterOwnerEnergy,netProfit:result.summary.netProfit},
    {sessions:5,paid:2,owner:3,visitor:2,energy:50,ownerEnergy:20,visitorEnergy:30,
      revenue:66,cost:40,visitorCost:24,margin:42,resultAfterOwnerEnergy:26,netProfit:null});
  assert.equal(result.sessions.filter(row=>row.usageKind==='OWNER'&&row.amount===0).length,3);
  assert.equal(result.sessions.filter(row=>row.usageKind==='VISITOR'&&row.amount>0).length,2);
  assert.ok(result.sessions.filter(row=>row.usageKind==='OWNER').every(row=>
    row.channel===null&&row.method===null&&row.credentialKind==='HYPOTHETICAL_RFID'));
  assert.deepEqual(new Set(result.sessions.filter(row=>row.usageKind==='OWNER').map(row=>row.driver.id)),
    new Set(['DEMO-CASA-OWNER-001']));
  assert.deepEqual(result.channels.map(row=>row.channel).sort(),['APP_EMPS','CAIXA']);
  assert.deepEqual(result.methods.map(row=>row.method).sort(),['CASH','PIX']);
  assert.equal(calls.scenarios.length,1);
});

test('residential channel, method and month filters apply to v2 and reconcile with network totals',async()=>{
  const {service}=harness();
  const pix=await service.station(owner,3,{channel:'APP_EMPS',method:'PIX'});
  assert.deepEqual({attempts:pix.summary.attempts,sessions:pix.summary.sessions,
    paid:pix.summary.paidSessions,energy:pix.summary.deliveredKwh,
    revenue:pix.summary.revenueSimulated,cost:pix.summary.estimatedEnergyCost},
    {attempts:1,sessions:1,paid:1,energy:20,revenue:44,cost:16});
  assert.equal(pix.sessions[0].sourceSessionId,'DEMO_CASA_001_S00004');
  const cash=await service.station(owner,3,{channel:'CAIXA',method:'CASH'});
  assert.equal(cash.summary.revenueSimulated,22);
  assert.equal(cash.sessions[0].driver.id,'DEMO-CASA-VISITOR-00008');
  const jan=await service.station(owner,3,{from:'2025-01-01',to:'2025-01-31'});
  assert.deepEqual(jan.monthly.map(row=>row.month),['2025-01']);
  assert.deepEqual({sessions:jan.summary.sessions,kwh:jan.summary.deliveredKwh,
    revenue:jan.summary.revenueSimulated,cost:jan.summary.estimatedEnergyCost},
    {sessions:3,kwh:35,revenue:44,cost:28});
  const full=await service.station(owner,3);
  const network=await service.network(owner,{stationId:'3'});
  assert.equal(network.summary.revenueSimulated,full.summary.revenueSimulated);
  assert.equal(network.summary.deliveredKwh,full.summary.deliveredKwh);
  assert.equal(network.summary.ownerSessions,full.summary.ownerSessions);
  assert.equal(network.summary.visitorSessions,full.summary.visitorSessions);
  assert.equal(network.monthly.reduce((sum,row)=>sum+row.revenueSimulated,0),66);
  assert.equal(network.monthly.reduce((sum,row)=>sum+row.deliveredKwh,0),50);
});

test('residential API rejects incomplete sidecar and denies a different owner',async()=>{
  const {service}=harness({partialScenario:true});
  await assert.rejects(service.station(owner,3),ConflictException);
  await assert.rejects(service.station({sub:'9'},3),ForbiddenException);
  await assert.rejects(service.network({sub:'9'},{stationId:'3'}),ForbiddenException);
});
