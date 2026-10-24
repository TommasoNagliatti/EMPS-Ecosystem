import 'dotenv/config';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {DashboardController} from '../src/dashboard.controller';
import {DemoHistoryService} from '../src/demo-history.service';
import {PlatformAccessService} from '../src/platform-access.service';
import {PrismaService} from '../src/prisma.service';
import type {AuthRequest} from '../src/auth';

async function main(){
  const url=new URL(process.env.DATABASE_URL??'');
  assert.equal(url.protocol,'mysql:');
  assert.equal(url.hostname,'127.0.0.1');
  assert.equal(decodeURIComponent(url.pathname.slice(1)),'emps_demo_test');
  assert.equal(process.env.DEMO_HISTORY_TEST_DATABASE,'emps_demo_test');
  assert.equal(process.env.NODE_ENV,'test');
  const ownerId=Number(process.argv[2]);
  const commercialId=Number(process.argv[3]);
  const postoId=Number(process.argv[4]);
  const casaId=Number(process.argv[5]);
  assert.ok([ownerId,commercialId,postoId,casaId].every(id=>Number.isSafeInteger(id)&&id>0));
  const db=new PrismaService();
  await db.$connect();
  try{
    const owner=await db.user.findUniqueOrThrow({where:{id:ownerId}});
    const user={sub:String(ownerId),email:owner.email,role:owner.role};
    const history=new DemoHistoryService(db,new PlatformAccessService(db));
    const read=async<T>(label:string,fn:()=>Promise<T>)=>{
      const start=performance.now();const result=await fn();
      return {label,milliseconds:Math.round(performance.now()-start),result};
    };
    const individual=[];
    for(const [kind,id] of [['SHOPPING',commercialId],['POSTO',postoId],['CASA',casaId]] as const){
      const measurement=await read(kind,()=>history.station(user,id));
      assert.equal(measurement.result.context,'SIMULATED');
      assert.ok(measurement.result.summary.sessions>0);
      assert.ok(measurement.result.summary.revenueSimulated>0);
      individual.push({kind,milliseconds:measurement.milliseconds,attempts:measurement.result.summary.attempts,
        sessions:measurement.result.summary.sessions,readings:measurement.result.readings.length,
        revenueSimulated:measurement.result.summary.revenueSimulated});
    }
    const network=await read('network',()=>history.network(user));
    assert.equal(network.result.summary.stations,3);
    assert.equal(network.result.summary.attempts,7808);
    assert.equal(network.result.summary.sessions,5044);
    assert.ok(Math.abs(network.result.summary.revenueSimulated-189936.12)<0.001);
    assert.equal(network.result.monthly.length,18);
    const narrow=await read('network-filter-2025',()=>history.network(user,{from:'2025-01-01',to:'2025-12-31'}));
    assert.equal(narrow.result.summary.sessions,2127);
    const cash=await read('network-filter-cash',()=>history.network(user,{channel:'CAIXA',method:'CASH'}));
    const cashLedger=await db.demoPayment.aggregate({where:{stationId:{in:[commercialId,postoId,casaId]},
      batch:{status:'ACTIVE'},channel:'CAIXA',method:'CASH'},
      _count:{_all:true},_sum:{amount:true}});
    assert.equal(cash.result.summary.sessions,cashLedger._count._all);
    assert.equal(cash.result.summary.attempts,cashLedger._count._all);
    assert.equal(cash.result.summary.revenueSimulated,cashLedger._sum.amount?.toNumber());
    assert.equal(cash.result.summary.sessions,618);
    assert.equal(cash.result.summary.revenueSimulated,23256.23);
    const outsider=await db.user.findFirstOrThrow({where:{id:{not:ownerId},
      email:{startsWith:'demo-outsider-'}}});
    const outsiderUser={sub:String(outsider.id),email:outsider.email,role:outsider.role};
    await assert.rejects(history.station(outsiderUser,commercialId));
    const outsiderNetwork=await history.network(outsiderUser);
    assert.equal(outsiderNetwork.summary.stations,0);
    assert.equal(outsiderNetwork.summary.revenueSimulated,0);
    await assert.rejects(history.network(outsiderUser,{stationId:String(commercialId)}));
    const panel=new DashboardController(db);
    const operational=[];
    for(const stationId of [commercialId,postoId,casaId]){
      const response=await read(`operational-panel-${stationId}`,
        ()=>panel.panel({user:{...user,selectedStationId:stationId}} as AuthRequest));
      assert.equal(response.result.sessions.length,0);
      assert.equal(response.result.payments.length,0);
      assert.equal(response.result.summary.revenueToday,0);
      assert.equal(response.result.summary.revenueMonth,0);
      operational.push({stationId,milliseconds:response.milliseconds,
        operationalSessions:response.result.sessions.length,operationalPayments:response.result.payments.length,
        operationalRevenueMonth:response.result.summary.revenueMonth});
    }
    process.stdout.write(`${JSON.stringify({individual,network:{milliseconds:network.milliseconds,
      summary:network.result.summary,months:network.result.monthly.length},
      networkFilter2025:{milliseconds:narrow.milliseconds,summary:narrow.result.summary},
      channelMethodFilter:{milliseconds:cash.milliseconds,channel:'CAIXA',method:'CASH',
        sessions:cash.result.summary.sessions,revenueSimulated:cash.result.summary.revenueSimulated,
        matchedDemoPayments:cashLedger._count._all},
      otherOwner:{individualRejected:true,networkStations:outsiderNetwork.summary.stations,
        networkRevenueSimulated:outsiderNetwork.summary.revenueSimulated,foreignStationFilterRejected:true},
      operational},null,2)}\n`);
  }finally{await db.$disconnect();}
}

main().catch(error=>{process.stderr.write(`${error instanceof Error?error.stack:String(error)}\n`);process.exitCode=1;});
