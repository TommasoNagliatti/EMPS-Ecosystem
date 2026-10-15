import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {DemoHistoryImportService} from '../src/demo-history-import.service';
import {PlatformAccessService} from '../src/platform-access.service';
import {PrismaService} from '../src/prisma.service';

/** Full-size import test. Run only against a newly created disposable local MySQL 8 database. */
async function main(){
  const url=new URL(process.env.DATABASE_URL??'');
  const database=decodeURIComponent(url.pathname.slice(1));
  assert.equal(url.protocol,'mysql:');
  assert.equal(url.hostname,'127.0.0.1');
  assert.equal(database,'emps_demo_test');
  assert.equal(process.env.DEMO_HISTORY_TEST_DATABASE,database);
  assert.equal(process.env.NODE_ENV,'test');
  assert.equal(process.env.EMPS_REMOTE_DEVELOPMENT,'false');
  const dataRoot=process.argv[2];
  assert.ok(dataRoot,'Informe o diretório de dados GIE');
  const db=new PrismaService();
  await db.$connect();
  try{
    const [identity]=await db.$queryRaw<Array<{databaseName:string;version:string}>>`SELECT DATABASE() AS databaseName, VERSION() AS version`;
    assert.equal(identity?.databaseName,database);
    assert.match(identity.version,/^8\./);
    const owner=await db.user.create({data:{name:'QA histórico demonstrativo',
      email:`demo-history-${randomUUID()}@emps.invalid`,passwordHash:'local-test-only',role:'ADMIN'}});
    const outsider=await db.user.create({data:{name:'QA outro proprietário',
      email:`demo-outsider-${randomUUID()}@emps.invalid`,passwordHash:'local-test-only',role:'ADMIN'}});
    const base={adminId:owner.id,postalCode:'01310100',street:'Rua de teste',addressNumber:'1',
      neighborhood:'Bela Vista',city:'São Paulo',state:'SP',timezone:'America/Sao_Paulo'};
    const shopping=await db.station.create({data:{...base,name:'Shopping Frei Caneca QA',status:'ACTIVE',
      reviewState:'APPROVED',visibility:'PUBLIC'}});
    const posto=await db.station.create({data:{...base,name:'Posto 24h QA',status:'PENDING',
      reviewState:'DRAFT',visibility:'PRIVATE',guestAllowed:false,
      gieProvisioning:{origin:'SIMULATED',profile:'DEMO_POSTO_24H_001',physical_dispatch:false,hardware_commands_sent:false},
      gieBinding:{create:{gieStationId:'DEMO_POSTO_24H_001',profile:'POSTO',origin:'SIMULATED'}}}});
    const casa=await db.station.create({data:{...base,name:'Residência QA',status:'PENDING',
      reviewState:'DRAFT',visibility:'PRIVATE',guestAllowed:false,
      gieProvisioning:{origin:'SIMULATED',profile:'DEMO_CASA_001',physical_dispatch:false,hardware_commands_sent:false},
      gieBinding:{create:{gieStationId:'DEMO_CASA_001',profile:'CASA',origin:'SIMULATED'}}}});
    for(const [station,ids] of [[posto,['EVSE_01','EVSE_02']],[casa,['EVSE_01']]] as const){
      for(const sourceId of ids)await db.charger.create({data:{stationId:station.id,
        publicCode:`QA-${station.id}-${sourceId}`,name:`${sourceId} simulado`,
        ocppIdentity:`SIMULATED_${station===posto?'DEMO_POSTO_24H_001':'DEMO_CASA_001'}_${sourceId}`,
        administrativeStatus:'PENDING',connectorType:'SIMULATED'}});
    }
    process.env.GIE_COMMERCIAL_STATION_ID=String(shopping.id);
    const user={sub:String(owner.id),email:owner.email,role:owner.role};
    const ids={SHOPPING:shopping.id,POSTO:posto.id,CASA:casa.id};
    const importer=new DemoHistoryImportService(db,new PlatformAccessService(db));
    const operationalBefore=await Promise.all([
      db.chargingSession.count(),db.payment.count(),db.paymentIntent.count(),db.stationEnergyReading.count(),
    ]);
    const start=performance.now();
    const first=await importer.importAll(user,ids,{dataRoot});
    const firstMs=Math.round(performance.now()-start);
    assert.deepEqual(first.map(row=>row.kind),['SHOPPING','POSTO','CASA']);
    assert.deepEqual(first.map(row=>row.sessionCount),[5477,2289,42]);
    assert.deepEqual(first.map(row=>row.paymentCount),[2917,2085,42]);
    assert.deepEqual(first.map(row=>row.readingCount),[17376,35040,35040]);
    assert.ok(first.every(row=>row.created));
    const batchCount=await db.demoImportBatch.count();
    assert.equal(batchCount,3);
    assert.equal(await db.demoImportBatch.count({where:{status:'ACTIVE'}}),3);
    const secondStart=performance.now();
    const second=await importer.importAll(user,ids,{dataRoot});
    const secondMs=Math.round(performance.now()-secondStart);
    assert.ok(second.every(row=>!row.created));
    assert.deepEqual(second.map(row=>row.batchId),first.map(row=>row.batchId));
    assert.equal(await db.demoImportBatch.count(),3);
    assert.deepEqual(await Promise.all([
      db.chargingSession.count(),db.payment.count(),db.paymentIntent.count(),db.stationEnergyReading.count(),
    ]),operationalBefore);
    const outsiderUser={sub:String(outsider.id),email:outsider.email,role:outsider.role};
    await assert.rejects(importer.resetBatch(outsiderUser,casa.id,first[2].batchId));
    assert.equal(await db.demoImportBatch.count(),3);
    const reset=await importer.resetBatch(user,casa.id,first[2].batchId);
    assert.deepEqual([reset.sessions,reset.payments,reset.readings],[42,42,35040]);
    assert.equal(await db.demoImportBatch.count(),2);
    assert.equal(await db.demoImportBatch.count({where:{status:'ACTIVE'}}),2);
    const third=await importer.importAll(user,ids,{dataRoot});
    assert.deepEqual(third.map(row=>row.created),[false,false,true]);
    assert.equal(await db.demoImportBatch.count({where:{status:'ACTIVE'}}),3);
    assert.deepEqual(await Promise.all([
      db.chargingSession.count(),db.payment.count(),db.paymentIntent.count(),db.stationEnergyReading.count(),
    ]),operationalBefore);
    process.stdout.write(`${JSON.stringify({database,version:identity.version,ownerId:owner.id,
      stations:ids,firstImportMs:firstMs,idempotentReimportMs:secondMs,
      imports:first,reset,thirdImport:third.map(row=>({kind:row.kind,created:row.created})),
      operationalBefore,operationalAfter:operationalBefore},null,2)}\n`);
  }finally{await db.$disconnect();}
}

main().catch(error=>{process.stderr.write(`${error instanceof Error?error.stack:String(error)}\n`);process.exitCode=1;});
