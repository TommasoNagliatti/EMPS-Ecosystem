import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialFixtureCycleBody } from '../src/gie-commercial-cycle';
import { GieV3Service } from '../src/gie-v3.service';
import type { GieV3State } from '../src/gie-v3-contract';
import { chargerDemoEnabled, setChargerDemo } from '../src/charger-demo-mode';

const sid='Commercial_HighAutonomy_V2';
function wire():GieV3State{return {station_id:sid,schema_version:'1.0',generation:'worker-generation',revision:4,
 mode:'NORMAL',source:'SIMULATED',hardware_commands_sent:false,
 capabilities:{forecasts:true,mpc_demo:true,physical_dispatch:false,load_balancer:true,presentation:true,manual_demo:true},
 state:{execution_allowed:true,visual_state:{valid:true},provenance:{station_id:sid,origin:'SIMULATED'}},
 history:[{station_id:sid,issue_time:'2026-06-15T12:00:00-03:00',origin:'SIMULATED',status:'ok'}]};}

test('commercial next cycle uses native historical quarter hour, never wall clock or replay',()=>{
 const w=wire();assert.deepEqual(commercialFixtureCycleBody(w),{issue_time:'2026-06-15T15:15:00.000Z'});
 assert.deepEqual(commercialFixtureCycleBody({...w,history:[]}),{});
 for(const issue_time of ['invalid','2026-06-15T12:00:00','2026-06-15T12:01:00-03:00'])
  assert.throws(()=>commercialFixtureCycleBody({...w,history:[{...w.history[0],issue_time}]}));
 assert.throws(()=>commercialFixtureCycleBody({...w,station_id:'DEMO_POSTO_24H_001'}));
 assert.throws(()=>commercialFixtureCycleBody({...w,history:[{...w.history[0],station_id:'wrong'}]}));
});

async function harness(run:(service:GieV3Service,calls:any[],native:GieV3State)=>Promise<void>){
 const previous={...process.env};Object.assign(process.env,{NODE_ENV:'development',EMPS_LOCAL_LEGACY_INTEGRATION:'true',
  EMPS_REMOTE_DEVELOPMENT:'false',EMPS_PHYSICAL_COMMANDS_ENABLED:'false',EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED:'false',
  PAYMENT_PROVIDER:'sandbox',HOST:'127.0.0.1',DEMO_HISTORY_TEST_DATABASE:'emps_integration_test',
  DATABASE_URL:'mysql://emps_integration_app:unit-test@127.0.0.1:3308/emps_integration_test',
  OCPP_GATEWAY_URL:'',OCPP_GATEWAY_TOKEN:'',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:''});setChargerDemo(13,false);
 let native=wire();const calls:any[]=[];
 const service=new GieV3Service({gieStationBinding:{findUnique:async()=>({gieStationId:sid,profile:'COMMERCIAL'})}} as any,
  {require:async()=>({id:13,membershipRole:'OWNER'})} as any,{publish:()=>{}} as any);
 (service as any).request=async(path:string,method='GET',body?:any)=>{
  calls.push({path,method,body});
  if(method==='POST'&&path.endsWith('/mode')){native.mode=body.mode;native.state=null;native.revision++;}
  if(method==='POST'&&path.endsWith('/cycle')){
   if((native as any).failCycle)throw Error('Native cycle failed');
   native.state=wire().state;native.revision++;
   native.history.push({...wire().history[0],issue_time:body.issue_time??'2026-06-15T12:00:00-03:00'});
  }
  return structuredClone(native);
 };
 (service as any).refresh=async()=>({online:true,generation:native.generation,revision:native.revision,
  state:native.state,mode:chargerDemoEnabled(13)?'CHARGER_DEMO':native.mode});
 try{await run(service,calls,native);}finally{setChargerDemo(13,false);for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
}

test('selecting charger demonstration preserves an existing NORMAL decision and does not cycle twice',async()=>harness(async(s,calls,native)=>{
 const original=structuredClone(native.state);
 const result=await s.action({} as any,'13','mode',{mode:'CHARGER_DEMO'});
 assert.equal(result.mode,'CHARGER_DEMO');assert.deepEqual(result.state,original);
 assert.equal(calls.filter(c=>c.method==='POST').length,0);
 await s.action({} as any,'13','mode',{mode:'CHARGER_DEMO'});
 assert.equal(calls.filter(c=>c.method==='POST').length,0);
}));

test('returning from scenes obtains one real native decision after NORMAL cleared it',async()=>harness(async(s,calls,native)=>{
 native.mode='PRESENTATION';
 const result=await s.action({} as any,'13','mode',{mode:'CHARGER_DEMO'});
 assert.equal(result.mode,'CHARGER_DEMO');assert.equal(result.state?.execution_allowed,true);
 const posts=calls.filter(c=>c.method==='POST');assert.equal(posts.length,2);
 assert.deepEqual(posts[0].body,{mode:'NORMAL'});assert.deepEqual(posts[1].body,{issue_time:'2026-06-15T15:15:00.000Z'});
}));

test('a missing decision is initialized once and explicit cycle advances the commercial timestamp',async()=>harness(async(s,calls,native)=>{
 native.state=null;
 await s.action({} as any,'13','mode',{mode:'CHARGER_DEMO'});
 await s.cycle({} as any,'13',{});
 const posts=calls.filter(c=>c.method==='POST');assert.equal(posts.length,2);
 assert.deepEqual(posts[0].body,{issue_time:'2026-06-15T15:15:00.000Z'});
 assert.deepEqual(posts[1].body,{issue_time:'2026-06-15T15:30:00.000Z'});
}));

test('failed initialization is not retried and an infeasible decision is never promoted or replaced',async()=>{
 await harness(async(s,calls,native)=>{
  native.state=null;(native as any).failCycle=true;
  await assert.rejects(s.action({} as any,'13','mode',{mode:'CHARGER_DEMO'}),/Native cycle failed/);
  assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(chargerDemoEnabled(13),false);
 });
 await harness(async(s,calls,native)=>{
  native.state={...native.state,execution_allowed:false};
  const result=await s.action({} as any,'13','mode',{mode:'CHARGER_DEMO'});
  assert.equal(result.state?.execution_allowed,false);assert.equal(calls.filter(c=>c.method==='POST').length,0);
 });
});
