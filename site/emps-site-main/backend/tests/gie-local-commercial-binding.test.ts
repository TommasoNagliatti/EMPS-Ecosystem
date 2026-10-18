import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ensureLocalBuildingGieBinding} from '../src/gie-local-commercial-binding';

const localEnv:NodeJS.ProcessEnv={
  NODE_ENV:'development',EMPS_LOCAL_LEGACY_INTEGRATION:'true',
  EMPS_REMOTE_DEVELOPMENT:'false',EMPS_PHYSICAL_COMMANDS_ENABLED:'false',
  EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED:'false',PAYMENT_PROVIDER:'sandbox',
  HOST:'127.0.0.1',DEMO_HISTORY_TEST_DATABASE:'emps_integration_test',
  DATABASE_URL:'mysql://emps_integration_app:test-secret@127.0.0.1:3308/emps_integration_test',
  EMPS_LEGACY_LOCAL_OWNER_ID:'105',GIE_STATION_ID:'39',GIE_COMMERCIAL_STATION_ID:'39',
  GIE_V3_SERVICE_URL:'http://127.0.0.1:8540',GIE_V3_SERVICE_TOKEN:'v'.repeat(32),
};

function fixture(){
  const bindings=new Map<number,any>();
  let creates=0;
  const tx={
    $queryRaw:async()=>[],
    station:{findUnique:async({where:{id}}:any)=>id===39
      ?{id:39,name:'Shopping Frei Caneca',adminId:105}
      :id===13?{id:13,name:'Prédio Comercial',_count:{chargers:3}}:null},
    gieStationBinding:{
      findUnique:async({where}:any)=>where.stationId!==undefined?bindings.get(where.stationId)??null:
        [...bindings.values()].find(binding=>binding.gieStationId===where.gieStationId)??null,
      create:async({data}:any)=>{creates++;bindings.set(data.stationId,data);return data},
    },
  };
  const db={$queryRaw:async()=>[{databaseName:'emps_integration_test',version:'8.0.36'}],
    $transaction:async(fn:any)=>fn(tx)};
  const v3={preflightFixture:async()=>({station_id:'Commercial_HighAutonomy_V2',status:'running',
    generation:'worker-one',physical_dispatch:false}),
    preflightFixtureDecision:async()=>({generation:'worker-one',revision:1,capabilities:{presentation:true,
      manual_demo:true,physical_dispatch:false},hardware_commands_sent:false})};
  return {bindings,db,v3,get creates(){return creates}};
}

test('commercial GIE binding is clone-only, preserves Shopping and is idempotent',async()=>{
  const f=fixture();
  const first=await ensureLocalBuildingGieBinding(f.db as any,f.v3 as any,localEnv);
  const second=await ensureLocalBuildingGieBinding(f.db as any,f.v3 as any,localEnv);
  assert.equal(first.created,true);assert.equal(second.created,false);
  assert.equal(first.stationId,13);assert.equal(first.chargerCount,3);
  assert.equal(f.creates,1);assert.equal(f.bindings.get(13).gieStationId,'Commercial_HighAutonomy_V2');
  assert.equal(f.bindings.has(39),false);
  await assert.rejects(ensureLocalBuildingGieBinding(f.db as any,f.v3 as any,
    {...localEnv,DATABASE_URL:'mysql://emps_integration_app:test-secret@127.0.0.1:3306/emps_db'}),/cópia local 3308/);
  assert.equal(f.creates,1);
});

test('commercial fixture cannot be shared with Shopping or another station',async()=>{
  const f=fixture();
  f.bindings.set(39,{stationId:39,gieStationId:'Commercial_HighAutonomy_V2',profile:'COMMERCIAL',origin:'SIMULATED'});
  await assert.rejects(ensureLocalBuildingGieBinding(f.db as any,f.v3 as any,localEnv),/Shopping 39/);
  assert.equal(f.creates,0);
});

test('commercial binding requires a current simulated decision before a write',async()=>{
  const f=fixture();
  f.v3.preflightFixtureDecision=async()=>({generation:'other-worker',revision:1,
    capabilities:{presentation:true,manual_demo:true,physical_dispatch:false},hardware_commands_sent:false});
  await assert.rejects(ensureLocalBuildingGieBinding(f.db as any,f.v3 as any,localEnv),/apresentação isolada/);
  assert.equal(f.creates,0);
});
