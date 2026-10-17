import assert from 'node:assert/strict';
import test from 'node:test';
import {ConflictException,ForbiddenException,NotFoundException} from '@nestjs/common';
import {AdminOperationsService} from '../src/admin-operations.service';
import {DemoHistoryService} from '../src/demo-history.service';
import {DemoHistoryAnalyticsService} from '../src/demo-history-analytics.service';
import {localLegacyIntegrationActive,localLegacyIntegrationDatabase,localLegacyOwnerStaffAccess} from '../src/local-legacy-integration';
import {PlatformAccessService} from '../src/platform-access.service';

const cloneUrl = 'mysql://emps_integration_app:local-test-secret@127.0.0.1:3308/emps_integration_test';
const safeEnv = {
  NODE_ENV: 'development', EMPS_LOCAL_LEGACY_INTEGRATION: 'true',
  EMPS_REMOTE_DEVELOPMENT: 'false', EMPS_PHYSICAL_COMMANDS_ENABLED: 'false',
  EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED: 'false', PAYMENT_PROVIDER: 'sandbox',
  HOST: '127.0.0.1', DEMO_HISTORY_TEST_DATABASE: 'emps_integration_test',
};

test('only the explicitly confirmed, isolated MySQL clone may use legacy integration controls', () => {
  assert.equal(localLegacyIntegrationDatabase(new URL(cloneUrl), safeEnv), true);
  for (const changed of [
    cloneUrl.replace('3308', '3306'), cloneUrl.replace('3308', '3307'),
    cloneUrl.replace('emps_integration_test', 'emps_db'),
    cloneUrl.replace('127.0.0.1', 'localhost'),
    cloneUrl.replace('emps_integration_app', 'root'),
    cloneUrl.replace('local-test-secret', ''),
  ]) assert.equal(localLegacyIntegrationDatabase(new URL(changed), safeEnv), false, changed);
  for (const [key,value] of [
    ['NODE_ENV','production'], ['EMPS_LOCAL_LEGACY_INTEGRATION','false'],
    ['EMPS_REMOTE_DEVELOPMENT','true'], ['EMPS_PHYSICAL_COMMANDS_ENABLED','true'],
    ['EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED','true'], ['PAYMENT_PROVIDER','stripe'],
    ['HOST','0.0.0.0'], ['OCPP_GATEWAY_URL','http://127.0.0.1:9000'],
    ['STRIPE_SECRET_KEY','sk_test_exposed'],
  ]) assert.equal(localLegacyIntegrationDatabase(new URL(cloneUrl), {...safeEnv,[key]:value}), false, key);
  assert.equal(localLegacyOwnerStaffAccess({...safeEnv,DATABASE_URL:cloneUrl}),true);
  assert.equal(localLegacyOwnerStaffAccess({...safeEnv,DATABASE_URL:cloneUrl.replace('3308','3306')}),false);
  assert.equal(localLegacyIntegrationActive({...safeEnv,DATABASE_URL:cloneUrl}),true);
  assert.equal(localLegacyIntegrationActive({...safeEnv,DATABASE_URL:cloneUrl.replace('3308','3306')}),false);
});

test('local integration rejects charger commands and maintenance before any database access',async()=>{
  const envKeys=[...Object.keys(safeEnv),'DATABASE_URL','OCPP_GATEWAY_URL','OCPP_GATEWAY_TOKEN',
    'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'] as const;
  const saved=new Map(envKeys.map(key=>[key,process.env[key]]));
  let reads=0;
  const db={charger:{findUnique:async()=>{reads++;return null;}}};
  const operations=new AdminOperationsService(db as never,{} as never,{} as never,{} as never);
  try{
    Object.assign(process.env,safeEnv,{DATABASE_URL:cloneUrl});
    for(const key of ['OCPP_GATEWAY_URL','OCPP_GATEWAY_TOKEN','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'])
      delete process.env[key];
    for(const action of ['solicitar_manutencao','sincronizar_status','encerrar_carga'] as const)
      await assert.rejects(operations.sendCommand('51',action),ConflictException);
    assert.equal(reads,0,'the cloned database must not be touched by an operational command');

    process.env.DATABASE_URL=cloneUrl.replace('3308','3306');
    await assert.rejects(operations.sendCommand('51','sincronizar_status'),NotFoundException);
    assert.equal(reads,1,'the clone-specific guard must not change other environments');
  }finally{
    for(const key of envKeys){const value=saved.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});

test('demo history and analytics accept OWNER staff only on the isolated clone',async()=>{
  const envKeys=[...Object.keys(safeEnv),'DATABASE_URL','OCPP_GATEWAY_URL','OCPP_GATEWAY_TOKEN',
    'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'] as const;
  const saved=new Map(envKeys.map(key=>[key,process.env[key]]));
  const calls:{batch:number;stationQuery:unknown[];accessQuery:unknown[]}={batch:0,stationQuery:[],accessQuery:[]};
  let staffRole='OWNER';
  const db={
    demoImportBatch:{findFirst:async()=>{calls.batch++;return null;}},
    station:{
      findUnique:async(args:unknown)=>{
        calls.accessQuery.push(args);
        return {id:11,name:'Posto 24h',adminId:105,timezone:'America/Sao_Paulo',staff:[{staffRole}]};
      },
      findMany:async(args:unknown)=>{calls.stationQuery.push(args);return [];}
    }
  };
  const access=new PlatformAccessService(db as never);
  const history=new DemoHistoryService(db as never,access as never);
  const analytics=new DemoHistoryAnalyticsService(db as never,access as never);
  const reviewUser={sub:'113'};
  try{
    Object.assign(process.env,safeEnv,{DATABASE_URL:cloneUrl});
    for(const key of ['OCPP_GATEWAY_URL','OCPP_GATEWAY_TOKEN','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'])
      delete process.env[key];
    assert.equal((await history.station(reviewUser,11)).context,'SIMULATED');
    assert.equal((await analytics.station(reviewUser,11)).context,'SIMULATED');
    await history.network(reviewUser);
    assert.deepEqual((calls.accessQuery[0] as {include:{staff:{where:{userId:number}}}}).include.staff.where,
      {userId:113});
    assert.equal(calls.batch,2);
    assert.deepEqual((calls.stationQuery[0] as {where:{OR:unknown[]}}).where.OR,[
      {adminId:113},{staff:{some:{userId:113,staffRole:'OWNER'}}}
    ]);

    staffRole='MANAGER';
    await assert.rejects(history.station(reviewUser,11),ForbiddenException);
    await assert.rejects(analytics.station(reviewUser,11),ForbiddenException);
    staffRole='OWNER';

    process.env.DATABASE_URL=cloneUrl.replace('3308','3306');
    await assert.rejects(history.station(reviewUser,11),ForbiddenException);
    await assert.rejects(analytics.station(reviewUser,11),ForbiddenException);
    await history.network(reviewUser);
    assert.deepEqual((calls.stationQuery[1] as {where:{adminId:number}}).where.adminId,113);
    assert.equal(calls.batch,2,'a denied read must not fetch a demo batch');
  }finally{
    for(const key of envKeys){const value=saved.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
