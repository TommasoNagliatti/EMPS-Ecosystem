import 'dotenv/config';
import assert from 'node:assert/strict';
import {DemoHistoryImportService} from '../src/demo-history-import.service';
import {PlatformAccessService} from '../src/platform-access.service';
import {PrismaService} from '../src/prisma.service';

async function main(){
  const url=new URL(process.env.DATABASE_URL??'');
  assert.equal(url.protocol,'mysql:');
  assert.equal(url.hostname,'127.0.0.1');
  assert.equal(decodeURIComponent(url.pathname.slice(1)),'emps_demo_test');
  assert.equal(process.env.DEMO_HISTORY_TEST_DATABASE,'emps_demo_test');
  assert.equal(process.env.NODE_ENV,'test');
  const [ownerId,shoppingId,postoId,casaId]=process.argv.slice(2,6).map(Number);
  assert.ok([ownerId,shoppingId,postoId,casaId].every(id=>Number.isSafeInteger(id)&&id>0));
  const dataRoot=process.argv[6];assert.ok(dataRoot);
  const db=new PrismaService();await db.$connect();
  try{
    const owner=await db.user.findUniqueOrThrow({where:{id:ownerId}});
    const user={sub:String(owner.id),email:owner.email,role:owner.role};
    const ids={SHOPPING:shoppingId,POSTO:postoId,CASA:casaId};
    process.env.GIE_COMMERCIAL_STATION_ID=String(shoppingId);
    const importer=new DemoHistoryImportService(db,new PlatformAccessService(db));
    const mapping:Record<string,number>={};
    for(const sourceId of ['AC_01','AC_02','AC_03','AC_04']){
      const charger=await db.charger.create({data:{stationId:shoppingId,
        publicCode:`QA-SHOPPING-${shoppingId}-${sourceId}`,name:`Comercial ${sourceId}`,
        ocppIdentity:`QA-SHOPPING-${shoppingId}-${sourceId}`,administrativeStatus:'ENABLED'}});
      mapping[sourceId]=charger.id;
    }
    const old=await db.demoImportBatch.findFirstOrThrow({where:{stationId:shoppingId,status:'ACTIVE'}});
    const reset=await importer.resetBatch(user,shoppingId,old.id);
    assert.equal(reset.sessions,5477);
    const wrong={...mapping,AC_01:(await db.charger.findFirstOrThrow({where:{stationId:postoId}})).id};
    await assert.rejects(importer.importAll(user,ids,{dataRoot,commercialChargerMap:wrong}));
    assert.equal(await db.demoImportBatch.count({where:{stationId:shoppingId}}),0);
    const imported=await importer.importAll(user,ids,{dataRoot,commercialChargerMap:mapping});
    assert.deepEqual(imported.map(row=>row.created),[true,false,false]);
    for(const [sourceId,chargerId] of Object.entries(mapping)){
      const matched=await db.demoChargingSession.count({where:{batchId:imported[0].batchId,
        sourceChargerId:sourceId,chargerId}});
      const all=await db.demoChargingSession.count({where:{batchId:imported[0].batchId,sourceChargerId:sourceId}});
      assert.equal(matched,all);
      assert.ok(matched>0);
    }
    const repeat=await importer.importAll(user,ids,{dataRoot,commercialChargerMap:mapping});
    assert.ok(repeat.every(row=>!row.created));
    await assert.rejects(importer.importAll(user,ids,{dataRoot}));
    assert.equal(await db.demoImportBatch.count({where:{status:'ACTIVE'}}),3);
    process.stdout.write(`${JSON.stringify({database:'emps_demo_test',mapping,
      invalidForeignChargerRejected:true,reset,imported:imported.map(row=>({kind:row.kind,created:row.created})),
      idempotentWithSameMap:true,changedMapRequiresReset:true},null,2)}\n`);
  }finally{await db.$disconnect();}
}

main().catch(error=>{process.stderr.write(`${error instanceof Error?error.stack:String(error)}\n`);process.exitCode=1;});
