import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PrismaService} from '../src/prisma.service';
import {PrepaidBudgetService} from '../src/prepaid-budget.service';
import {ReservationsService} from '../src/reservations.service';
import {GieService} from '../src/gie.service';
import {ChargingGatewayService} from '../src/charging-gateway.service';
import {PaymentGatewayService} from '../src/payment-gateway.service';
import {MobileService} from '../src/mobile.service';
import {SessionBillingService} from '../src/session-billing.service';
import {NotificationGateway} from '../src/notification.gateway';
import {WebAuthService} from '../src/web-auth.service';
import {JwtService} from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertRemoteConfiguration, assertRemoteHttpRequest, backgroundJobsEnabled, protectRemoteClient, remoteDevelopment, verifyRemoteDatabase, RemoteDevelopmentGuard} from '../src/remote-development';

const valid: NodeJS.ProcessEnv = {
  NODE_ENV:'development', HOST:'127.0.0.1', PORT:'3011', EMPS_REMOTE_SITE_PORT:'3010', EMPS_REMOTE_TUNNEL_PORT:'3317',
  EMPS_REMOTE_DEVELOPMENT:'true', EMPS_REMOTE_ACCESS_MODE:'READ_ONLY', EMPS_REMOTE_ENVIRONMENT:'unit-tests',
  EMPS_BACKGROUND_JOBS_ENABLED:'false', EMPS_PHYSICAL_COMMANDS_ENABLED:'false', EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED:'false',
  EMPS_REMOTE_EXPECTED_DATABASE:'emps_official_test', EMPS_REMOTE_EXPECTED_SERVER_UUID:'00000000-1111-2222-3333-444444444444',
  EMPS_REMOTE_ALLOWED_EMAILS:'developer@example.invalid', DATABASE_URL:'mysql://reader:private-unit-test@127.0.0.1:3317/emps_official_test',
  JWT_SECRET:'unit-test-local-only-00000000000000000000000', PAYMENT_PROVIDER:'sandbox', CORS_ORIGINS:'http://localhost:3010',
};
async function isolated(action:()=>Promise<void>|void, overrides:NodeJS.ProcessEnv={}) {
  const before={...process.env};
  try {
    for(const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','OCPP_GATEWAY_URL','OCPP_GATEWAY_TOKEN','GIE_SERVICE_URL','GIE_SERVICE_TOKEN'])delete process.env[key];
    Object.assign(process.env,valid,overrides);await action();
  } finally {for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
}

test('remote mode requires every safety flag and a pinned private destination',()=>{
  assert.doesNotThrow(()=>assertRemoteConfiguration(valid));
  for(const key of ['EMPS_BACKGROUND_JOBS_ENABLED','EMPS_PHYSICAL_COMMANDS_ENABLED','EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED',
    'EMPS_REMOTE_EXPECTED_DATABASE','EMPS_REMOTE_EXPECTED_SERVER_UUID','JWT_SECRET','EMPS_REMOTE_ALLOWED_EMAILS','HOST']) {
    const env={...valid};delete env[key];assert.throws(()=>assertRemoteConfiguration(env),undefined,key);
  }
  for(const databaseUrl of ['mysql://root:secret@127.0.0.1:3317/emps_official_test','mysql://reader:secret@public.example:3317/emps_official_test',
    'mysql://reader:secret@127.0.0.1:3307/emps_official_test','mysql://reader:secret@127.0.0.1:3317/other'])
    assert.throws(()=>assertRemoteConfiguration({...valid,DATABASE_URL:databaseUrl}));
  for(const overrides of [{NODE_ENV:'production'},{EMPS_REMOTE_ACCESS_MODE:'WRITE'},{OCPP_GATEWAY_URL:'https://gateway.test'},
    {STRIPE_SECRET_KEY:'sk_test_placeholder'},{GIE_SERVICE_URL:'http://gie'},{CORS_ORIGINS:'*'}])
    assert.throws(()=>assertRemoteConfiguration({...valid,...overrides}));
  assert.throws(()=>remoteDevelopment({EMPS_REMOTE_DEVELOPMENT:'TRUE'}));
});

test('remote launcher cannot disable its own protection and validates every managed port',()=>{
  const {configuration} = require('../scripts/remote-development.cjs');
  const directory = mkdtempSync(join(tmpdir(),'emps-remote-policy-'));
  const file = join(directory,'.env.remote');
  const write = (overrides:NodeJS.ProcessEnv={}) => writeFileSync(file,Object.entries({...valid,
    EMPS_REMOTE_SSH_HOST:'verified-unit-alias',EMPS_REMOTE_MYSQL_HOST:'172.16.1.2',EMPS_REMOTE_MYSQL_PORT:'3306',
    ...overrides}).filter(([,value])=>value!==undefined).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n'));
  try {
    write();assert.equal(configuration(file).EMPS_REMOTE_DEVELOPMENT,'true');
    for(const mode of [undefined,'false','TRUE']) {write({EMPS_REMOTE_DEVELOPMENT:mode});assert.throws(()=>configuration(file));}
    for(const overrides of [{PORT:'0'},{PORT:'3010'},{EMPS_REMOTE_MYSQL_PORT:'65536'},
      {EMPS_REMOTE_SSH_HOST:'host -o ProxyCommand=bad'},{EMPS_REMOTE_MYSQL_HOST:'8.8.8.8'},{NODE_OPTIONS:'--require bad'}]) {
      write(overrides);assert.throws(()=>configuration(file));
    }
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('read-only HTTP permits web authentication only; mutations/mobile auth/webhooks fail',async()=>isolated(()=>{
  for(const method of ['GET','HEAD','OPTIONS'])assert.doesNotThrow(()=>assertRemoteHttpRequest(method,'/v2/stations'));
  for(const path of ['/auth/login','/auth/refresh','/auth/logout/'])assert.doesNotThrow(()=>assertRemoteHttpRequest('POST',path));
  for(const path of ['/auth/register','/mobile/v1/auth/login','/webhooks/stripe','/payments/stripe/webhook','/v2/stations','/chargers/1/start'])
    assert.throws(()=>assertRemoteHttpRequest('POST',path));
  assert.throws(()=>assertRemoteHttpRequest('DELETE','/v2/stations/1'));
  const guard=new RemoteDevelopmentGuard();
  assert.throws(()=>guard.canActivate({getType:()=> 'http',switchToHttp:()=>({getRequest:()=>({method:'POST',path:'/webhooks/stripe'})})} as any));
}));

test('prepaid/reservations/GIE never create timers or touch data in remote mode',async(t)=>isolated(async()=>{
  let timers=0,calls=0;
  t.mock.method(globalThis,'setInterval',()=>{timers++;throw Error('timer must not start');});
  const db=new Proxy({}, {get(){calls++;throw Error('database must not be touched');}}) as any;
  const prepaid=new PrepaidBudgetService(db,{} as any),reservations=new ReservationsService(db),gie=new GieService(db,{} as any);
  prepaid.onModuleInit();reservations.onModuleInit();gie.onModuleInit();
  await prepaid.tick();await reservations.sweep();assert.equal((await gie.refresh()).online,false);
  await assert.rejects(gie.action('/mode',{mode:'NORMAL'}));
  assert.equal(timers,0);assert.equal(calls,0);
  prepaid.onModuleDestroy();reservations.onModuleDestroy();gie.onModuleDestroy();
}));

test('physical commands, notifications and all financial provider entry points fail before effects',async(t)=>isolated(async()=>{
  let network=0;t.mock.method(globalThis,'fetch',()=>{network++;throw Error('No network expected');});
  const gateway=new PaymentGatewayService();
  for(const call of [()=>gateway.createSessionIntent({} as any),()=>gateway.cancelAuthorization('stripe','pi_test','1'),
    ()=>gateway.retrieveIntent('pi_test'),()=>gateway.assertAdmission('pi_test','1','10'),()=>gateway.settleReservation({} as any),
    ()=>gateway.createIntent({} as any),()=>gateway.settleIntent({} as any)])await assert.rejects(call);
  assert.throws(()=>gateway.constructWebhookEvent(Buffer.from(''),''));
  await assert.rejects(new ChargingGatewayService().dispatch({chargerId:1,commandId:1,type:'START'}));
  await assert.rejects(new NotificationGateway().send('station-review',{}));
  await assert.rejects(new MobileService({} as any,{} as any,gateway,{} as any,{} as any).processStripeWebhook({} as any));
  await assert.rejects(new SessionBillingService({} as any,gateway,{} as any).webhook({} as any));
  assert.equal(network,0);
}));

test('query protection allows reads, rejects mutations and covers interactive transactions/raw bypasses',async()=>{
  let writes=0;
  const base:any={user:{findMany:async()=>[1],create:async()=>{writes++;},update:async()=>{writes++;}},
    $transaction:async(fn:any)=>fn(base),$queryRaw:async()=>[1],$queryRawUnsafe:async()=>{writes++;},$executeRaw:async()=>{writes++;},$extends:()=>base};
  const db=protectRemoteClient(base);
  assert.deepEqual(await db.user.findMany(),[1]);
  assert.throws(()=>db.user.create({data:{}}));assert.throws(()=>db.user.update({data:{}}));
  await assert.rejects(db.$transaction(async(tx:any)=>tx.user.create({data:{}})));
  assert.deepEqual(await db.$queryRaw`SELECT 1`,[1]);
  assert.throws(()=>db.$queryRaw`SELECT users INTO OUTFILE '/tmp/leak'`);
  assert.throws(()=>db.$queryRawUnsafe('SELECT 1'));assert.throws(()=>db.$executeRaw('DELETE'));assert.throws(()=>db.$extends({}));
  assert.equal(writes,0);
});

test('real generated PrismaService blocks writes before connecting, including callback transactions',async()=>isolated(async()=>{
  const db=new PrismaService();assert.equal(typeof db.onModuleInit,'function');assert.equal(typeof db.onModuleDestroy,'function');
  assert.throws(()=>db.user.create({data:{name:'Blocked',email:'blocked@example.invalid',passwordHash:'never'}}));
  assert.throws(()=>db.$queryRawUnsafe('SELECT 1'));assert.throws(()=>db.$executeRaw`DELETE FROM users`);
  await db.onModuleDestroy();
}));

test('identity and least-privilege verification rejects wrong UUID/database/version/writable grants/roles',async()=>{
  const identity={databaseName:valid.EMPS_REMOTE_EXPECTED_DATABASE,serverUuid:valid.EMPS_REMOTE_EXPECTED_SERVER_UUID,version:'8.0.44'};
  const fixture=(override={},grants=['GRANT USAGE ON *.* TO `reader`@`%`','GRANT SELECT ON `emps_official_test`.* TO `reader`@`%`'])=>
    ({$queryRaw:async()=>[{...identity,...override}],$queryRawUnsafe:async()=>grants.map(grant=>({grant}))}) as any;
  assert.equal((await verifyRemoteDatabase(fixture(),valid)).readOnlyGrants,true);
  for(const overrides of [{databaseName:'another'},{serverUuid:'bad'},{version:'5.7.1'}])await assert.rejects(verifyRemoteDatabase(fixture(overrides),valid));
  for(const grants of [['GRANT ALL PRIVILEGES ON `emps_official_test`.* TO `reader`@`%`'],['GRANT SELECT ON *.* TO `reader`@`%`'],
    ['GRANT SELECT ON `emps_official_test`.* TO `reader`@`%` WITH GRANT OPTION'],['GRANT `admin_role`@`%` TO `reader`@`%`'],[]])
    await assert.rejects(verifyRemoteDatabase(fixture({},grants),valid));
});

test('web login/refresh/logout remain local to memory, with account checks and no DB mutations',async()=>isolated(async()=>{
  const user:any={id:17,name:'Authorized test',email:'developer@example.invalid',role:'ADMIN',accountStatus:'ACTIVE',passwordHash:await bcrypt.hash('only-unit-test',4)};
  let writes=0;
  const db:any={user:{findUnique:async({where}:any)=>where.email===user.email||where.id===user.id?user:null},
    refreshToken:new Proxy({}, {get(){writes++;throw Error('Remote auth must not write');}}),$transaction:()=>{writes++;throw Error('No transaction');}};
  const auth=new WebAuthService(db,{signAsync:async()=> 'local-token'} as JwtService);
  await assert.rejects(auth.login({email:'customer@example.invalid',password:'only-unit-test'}));
  const login=await auth.login({email:user.email,password:'only-unit-test'});
  assert.equal(login.accessToken,'local-token');
  const rotated=await auth.refresh(login.refreshToken);assert.notEqual(rotated.refreshToken,login.refreshToken);
  await assert.rejects(auth.refresh(login.refreshToken));await assert.rejects(auth.refresh(rotated.refreshToken));
  const next=await auth.login({email:user.email,password:'only-unit-test'});await auth.logout(next.refreshToken);await assert.rejects(auth.refresh(next.refreshToken));
  const inactive=await auth.login({email:user.email,password:'only-unit-test'});user.accountStatus='DISABLED';await assert.rejects(auth.refresh(inactive.refreshToken));
  await assert.rejects(auth.register({} as any));assert.equal(writes,0);
}));

test('standard environments retain existing HTTP behavior and background jobs',async()=>isolated(()=>{
  assert.equal(remoteDevelopment(),false);assert.equal(backgroundJobsEnabled(),true);
  assert.doesNotThrow(()=>assertRemoteHttpRequest('POST','/charging-sessions'));
},{EMPS_REMOTE_DEVELOPMENT:'false',EMPS_BACKGROUND_JOBS_ENABLED:'true'}));

test('logout while refresh is awaiting the account cannot mint a new local session',async()=>isolated(async()=>{
  const user:any={id:17,name:'Authorized test',email:'developer@example.invalid',role:'ADMIN',accountStatus:'ACTIVE',passwordHash:await bcrypt.hash('only-unit-test',4)};
  let release:(user:any)=>void=()=>{};
  const db:any={user:{findUnique:({where}:any)=>where.email?Promise.resolve(user):new Promise(resolve=>{release=resolve;})}};
  const auth=new WebAuthService(db,{signAsync:async()=> 'local-token'} as JwtService);
  const login=await auth.login({email:user.email,password:'only-unit-test'});
  const pending=auth.refresh(login.refreshToken);
  await auth.logout(login.refreshToken);release(user);
  await assert.rejects(pending,/family revoked/);
}));
