import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalGieDemoService, localGieDemoConfiguration, LOCAL_GIE_SOURCE} from '../src/local-gie-demo.service';
import {GieService} from '../src/gie.service';
import {assertRemoteHttpRequest} from '../src/remote-development';

const token = 'local-preview-unit-test-only-0000000000';
const valid: NodeJS.ProcessEnv = {
  NODE_ENV:'development', HOST:'127.0.0.1', PORT:'3011', EMPS_REMOTE_SITE_PORT:'3010', EMPS_REMOTE_TUNNEL_PORT:'3317',
  EMPS_REMOTE_DEVELOPMENT:'true', EMPS_REMOTE_ACCESS_MODE:'READ_ONLY', EMPS_REMOTE_ENVIRONMENT:'unit-tests',
  EMPS_BACKGROUND_JOBS_ENABLED:'false', EMPS_PHYSICAL_COMMANDS_ENABLED:'false', EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED:'false',
  EMPS_REMOTE_EXPECTED_DATABASE:'emps_official_test', EMPS_REMOTE_EXPECTED_SERVER_UUID:'00000000-1111-2222-3333-444444444444',
  EMPS_REMOTE_ALLOWED_EMAILS:'developer@example.invalid', DATABASE_URL:'mysql://reader:private-unit-test@127.0.0.1:3317/emps_official_test',
  JWT_SECRET:'unit-test-local-only-00000000000000000000000', PAYMENT_PROVIDER:'sandbox', CORS_ORIGINS:'http://localhost:3010',
  EMPS_LOCAL_GIE_DEMO:'true', EMPS_LOCAL_GIE_STATION_ID:'39', EMPS_LOCAL_GIE_PORT:'8013', EMPS_LOCAL_GIE_TOKEN:token,
};
const user = {sub:'105',role:'CUSTOMER',selectedStationId:39,stationPermission:'READ'} as any;
async function isolated(action:()=>Promise<void>|void) {
  const before = {...process.env};
  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env,valid); await action();
  } finally { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env,before); }
}
const envelope = (changes = {}) => ({station_id:'39',source:LOCAL_GIE_SOURCE,isolated:true,hardware_confirmed:false,
  mode:'PRESENTATION',observed_at:new Date().toISOString(),state:{execution_allowed:true},...changes});

test('local replay is opt-in and cannot weaken the remote read-only policy',()=>{
  assert.equal(localGieDemoConfiguration({}),null);
  assert.equal(localGieDemoConfiguration({...valid,EMPS_LOCAL_GIE_DEMO:'false'}),null);
  assert.deepEqual(localGieDemoConfiguration(valid),{stationId:39,port:8013,token});
  for (const overrides of [{EMPS_LOCAL_GIE_DEMO:'TRUE'},{EMPS_REMOTE_DEVELOPMENT:'false'},
    {EMPS_REMOTE_ACCESS_MODE:'WRITE'},{NODE_ENV:'production'},{EMPS_PHYSICAL_COMMANDS_ENABLED:'true'},
    {EMPS_LOCAL_GIE_STATION_ID:'0'},{EMPS_LOCAL_GIE_STATION_ID:'39 OR 1=1'},
    {EMPS_LOCAL_GIE_PORT:'3011'},{EMPS_LOCAL_GIE_PORT:'3010'},{EMPS_LOCAL_GIE_PORT:'3317'},
    {EMPS_LOCAL_GIE_PORT:'80'},{EMPS_LOCAL_GIE_PORT:'65536'},
    {EMPS_LOCAL_GIE_TOKEN:'short'},{EMPS_LOCAL_GIE_TOKEN:valid.JWT_SECRET},
    {GIE_SERVICE_URL:'http://operational'},{OCPP_GATEWAY_URL:'http://hardware'}])
    assert.throws(()=>localGieDemoConfiguration({...valid,...overrides}));
});

test('replay authorizes the station before a GET-only loopback read',async(t)=>isolated(async()=>{
  const reads:any[] = [], network:any[] = [];
  const service = new LocalGieDemoService({station:{findFirst:async(args:any)=>{reads.push(args);return{id:39};}}} as any);
  t.mock.method(globalThis,'fetch',async(url:any,init:any)=>{network.push({url,init});return Response.json(envelope());});
  assert.equal((await service.read(user,'39')).online,true);
  assert.equal(reads[0].where.AND[0].id,39);
  assert.equal(reads[0].where.AND[1].id,39);
  assert.ok(reads[0].where.AND[1].OR.length);
  assert.deepEqual(reads[0].select,{id:true});
  assert.equal(network[0].url,'http://127.0.0.1:8013/state');
  assert.equal(network[0].init.method ?? 'GET','GET');
  assert.equal(network[0].init.redirect,'error');
  assert.equal(network[0].init.headers.Authorization,'Bearer '+token);
  assert.equal(network[0].init.body,undefined);
}));

test('unknown or unauthorized stations never contact the local replay',async(t)=>isolated(async()=>{
  let reads=0,network=0;
  t.mock.method(globalThis,'fetch',async()=>{network++;throw Error('forbidden');});
  const service=new LocalGieDemoService({station:{findFirst:async()=>{reads++;return null;}}} as any);
  await assert.rejects(service.read(user,'40'));
  assert.equal(reads,0);
  await assert.rejects(service.read(user,'39'));
  assert.equal(reads,1); assert.equal(network,0);
}));

test('concurrent reads share replay work but do not share authorization',async(t)=>isolated(async()=>{
  let reads=0,network=0,release:(response:Response)=>void=()=>{};
  const service=new LocalGieDemoService({station:{findFirst:async()=>++reads===3?null:{id:39}}} as any);
  t.mock.method(globalThis,'fetch',()=>{network++;return new Promise<Response>(resolve=>{release=resolve;});});
  const first=service.read(user,'39'),second=service.read(user,'39');
  await assert.rejects(service.read({...user,sub:'999'},'39'));
  assert.equal(network,1);release(Response.json(envelope()));
  assert.equal((await first).online,true); assert.equal((await second).online,true); assert.equal(reads,3);
}));

test('failed, stale or non-isolated responses stay offline without fabricated telemetry',async(t)=>isolated(async()=>{
  const service=new LocalGieDemoService({station:{findFirst:async()=>({id:39})}} as any);
  for (const changes of [{source:'REAL'},{isolated:false},{hardware_confirmed:true},{station_id:'40'},
    {mode:'NORMAL'},{observed_at:'invalid'},{observed_at:new Date(Date.now()-60000).toISOString()},
    {observed_at:new Date(Date.now()+60000).toISOString()},{state:null}]) {
    t.mock.method(globalThis,'fetch',async()=>Response.json(envelope(changes)));
    const result=await service.read(user,'39');
    assert.equal(result.online,false);assert.equal(result.isolated,true);assert.equal(result.state,null);
    t.mock.restoreAll();
  }
  for (const response of [()=>Promise.reject(Error('private failure')),()=>Promise.resolve(new Response('',{status:503}))]) {
    t.mock.method(globalThis,'fetch',response as any);
    const result=await service.read(user,'39');assert.equal(result.online,false);assert.equal(result.state,null);
    assert.ok(!result.error?.includes('private failure'));t.mock.restoreAll();
  }
}));

test('Python environment has no database, account or operational secrets',()=>{
  const {localDemoEnvironment}=require('../scripts/remote-development.cjs');
  const env=localDemoEnvironment(valid,{PATH:'unit-path',DATABASE_URL:'private',JWT_SECRET:'private',
    GIE_SERVICE_TOKEN:'private',STRIPE_SECRET_KEY:'private',OCPP_GATEWAY_TOKEN:'private',PYTHONPATH:'injected',NODE_OPTIONS:'injected'});
  assert.equal(env.EMPS_LOCAL_GIE_TOKEN,token);
  for (const key of ['DATABASE_URL','JWT_SECRET','GIE_SERVICE_TOKEN','STRIPE_SECRET_KEY','OCPP_GATEWAY_TOKEN','NODE_OPTIONS'])
    assert.equal(env[key],undefined);
  assert.notEqual(env.PYTHONPATH,'injected');assert.equal(env.PYTHONNOUSERSITE,'1');assert.equal(env.PATH,'unit-path');
});

test('local replay does not start operational GIE or allow POST commands',async()=>isolated(async()=>{
  const db=new Proxy({}, {get(){throw Error('operational GIE must not access data');}}) as any;
  const gie=new GieService(db,{} as any);gie.onModuleInit();
  assert.equal((await gie.refresh()).online,false);
  await assert.rejects(gie.action('/mode',{mode:'NORMAL'}));
  for (const path of ['/gie/stations/39/mode','/gie/stations/39/mappings','/gie/stations/39/presentation/next'])
    assert.throws(()=>assertRemoteHttpRequest('POST',path));
  gie.onModuleDestroy();
}));
