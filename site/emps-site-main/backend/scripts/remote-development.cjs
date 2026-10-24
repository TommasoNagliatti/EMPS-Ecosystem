const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {spawn, spawnSync} = require('node:child_process');
const backend = path.resolve(__dirname, '..');
const frontend = path.resolve(backend, '../frontend');
const {parse} = require('dotenv');
const policy = require('../dist/remote-development');
const {localGieDemoConfiguration} = require('../dist/local-gie-demo.service');
const localDemoKeys = ['EMPS_LOCAL_GIE_DEMO','EMPS_LOCAL_GIE_STATION_ID','EMPS_LOCAL_GIE_PORT','EMPS_LOCAL_GIE_TOKEN'];
const gieRoot = path.resolve(backend,'../../../gie/GIE');

function localDemoEnvironment(config, parent=process.env) {
  const env = {};
  for (const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP']) if(parent[key]) env[key]=parent[key];
  for (const key of localDemoKeys) if(config[key]!==undefined) env[key]=config[key];
  return {...env,PYTHONPATH:path.join(gieRoot,'src'),PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'};
}

function configuration(file) {
  const resolved = path.resolve(file || path.join(backend, '.env.remote'));
  if (path.basename(resolved) !== '.env.remote' || !fs.existsSync(resolved))
    throw new Error('Create the ignored backend/.env.remote from .env.remote.example after the SSH audit');
  const config = parse(fs.readFileSync(resolved));
  if (config.EMPS_REMOTE_DEVELOPMENT !== 'true')
    throw new Error('The remote launcher requires EMPS_REMOTE_DEVELOPMENT=true; normal mode is not allowed here');
  policy.assertRemoteConfiguration(config);
  localGieDemoConfiguration(config);
  for (const name of ['PORT', 'EMPS_REMOTE_SITE_PORT', 'EMPS_REMOTE_TUNNEL_PORT', 'EMPS_REMOTE_MYSQL_PORT'])
    if (!/^\d+$/.test(config[name] || '') || Number(config[name]) < 1 || Number(config[name]) > 65535)
      throw new Error(`Invalid ${name}`);
  if (new Set([config.PORT, config.EMPS_REMOTE_SITE_PORT, config.EMPS_REMOTE_TUNNEL_PORT]).size !== 3)
    throw new Error('Backend, site and tunnel ports must be different');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(config.EMPS_REMOTE_SSH_HOST || ''))
    throw new Error('Configure a verified SSH alias, without options or a shell command');
  const host = config.EMPS_REMOTE_MYSQL_HOST || '';
  if (net.isIP(host) !== 4 || !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))
    throw new Error('The audited MySQL endpoint must be a loopback or private IPv4 address');
  if (config.NODE_OPTIONS || config.NODE_PATH || config.PATH || config.LD_PRELOAD)
    throw new Error('Runtime injection options are not accepted in the private configuration');
  return config;
}

async function preflight(config) {
  const {PrismaClient} = require('@prisma/client');
  const db = new PrismaClient({datasources:{db:{url:config.DATABASE_URL}},log:[]});
  try {
    await db.$connect();
    const identity = await policy.verifyRemoteDatabase(db, config);
    const counts = {stations:await db.station.count(), chargers:await db.charger.count()};
    // Names/password hashes are not displayed; each allowlisted identity must already exist.
    for (const email of config.EMPS_REMOTE_ALLOWED_EMAILS.split(',').map(value => value.trim().toLowerCase()).filter(Boolean)) {
      const user = await db.user.findUnique({where:{email},select:{id:true,accountStatus:true}});
      if (!user || user.accountStatus !== 'ACTIVE') throw new Error('An authorized test account is missing or inactive; no account was created');
    }
    const schema = path.join(backend, 'prisma/schema.prisma');
    const diff = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff',
      '--from-schema-datasource', schema, '--to-schema-datamodel', schema, '--exit-code'], {
      cwd:backend, env:{...process.env,...config},encoding:'utf8',windowsHide:true,timeout:120000,
    });
    if (diff.status !== 0) throw new Error(diff.status === 2 ? 'Schema drift detected; review a versioned patch before starting' : 'Read-only schema comparison failed; no SQL was applied');
    const demo=localGieDemoConfiguration(config);
    if(demo&&!await db.station.findUnique({where:{id:demo.stationId},select:{id:true}}))throw new Error('Local demo station does not exist; no station was created');
    return {environment:config.EMPS_REMOTE_ENVIRONMENT,...identity,...counts,schemaComparison:'NO_PRISMA_DIFF',
      localGieDemo:demo?{isolated:true,stationId:demo.stationId}:false,
      jobs:false,physicalCommands:false,paymentSideEffects:false,operationalWrites:false,authentication:'LOCAL_MEMORY_ONLY'};
  } finally { await db.$disconnect(); }
}

async function portFree(port) {
  await new Promise((resolve,reject) => {
    const server = net.createServer();
    server.once('error',()=>reject(new Error(`Port ${port} is occupied; no existing service was stopped`)));
    server.listen(Number(port),'127.0.0.1',()=>server.close(resolve));
  });
}

async function waitFor(check, alive) {
  for (let attempt=0;attempt<90;attempt++) {
    if (!alive()) throw new Error('A managed process stopped before readiness');
    if (await check().catch(()=>false)) return;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('Timed out waiting for the managed service');
}

function probe(port) {
  return new Promise(resolve=>{
    const socket=net.connect({host:'127.0.0.1',port:Number(port)});
    socket.setTimeout(1000);
    const done=value=>{socket.destroy();resolve(value);};
    socket.once('connect',()=>done(true));socket.once('error',()=>done(false));socket.once('timeout',()=>done(false));
  });
}

async function run(argv=process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log('remote-development.cjs [--check] [--preview] [--config backend/.env.remote]\n--preview builds an optimized local frontend, without live editing. Optional EMPS_LOCAL_GIE_DEMO starts a GET-only isolated replay, not operational GIE. Start owns the loopback SSH tunnel; --check uses an already-open tunnel. No Docker, seed, migration apply or Stripe listener is started.');
    return;
  }
  const configIndex=argv.indexOf('--config');
  const config=configuration(configIndex<0?undefined:argv[configIndex+1]);
  const demo=localGieDemoConfiguration(config);
  if (argv.includes('--check')) { console.log(JSON.stringify(await preflight(config),null,2));return; }
  for (const port of [config.PORT,config.EMPS_REMOTE_SITE_PORT,config.EMPS_REMOTE_TUNNEL_PORT]) await portFree(port);
  if(demo)await portFree(demo.port);
  const statePath=path.resolve(backend,'../../../remote-dev.private.json');
  if(fs.existsSync(statePath)) {
    const existing=JSON.parse(fs.readFileSync(statePath,'utf8'));
    let alive=false;
    try {process.kill(existing.pid,0);alive=true;} catch(error) {if(error.code!=='ESRCH')alive=true;}
    if(alive)throw new Error('A recorded remote launcher is still alive; no process was stopped');
    fs.unlinkSync(statePath);
  }
  fs.writeFileSync(statePath,JSON.stringify({pid:process.pid,script:__filename,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
  const children=[];
  let stopping=false;
  function stop(code=0) {
    if(stopping)return;stopping=true;process.exitCode=code;
    for(const child of children)if(child.exitCode===null && child.pid){
      if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      else child.kill('SIGTERM');
    }
    if(fs.existsSync(statePath)) {
      const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
      if(state.pid===process.pid)fs.unlinkSync(statePath);
    }
  }
  process.once('SIGINT',()=>stop());process.once('SIGTERM',()=>stop());
  function start(exe,args,cwd,env,stdio='inherit',persistent=true) {
    const child=spawn(exe,args,{cwd,env,stdio,windowsHide:true});children.push(child);
    child.once('error',()=>{console.error('Managed process failed to start; details and secrets are not logged');stop(1);});
    child.once('exit',()=>{if(persistent&&!stopping){console.error('Managed process exited; stopping only this remote launch');stop(1);}});
    return child;
  }
  try {
    const forward=`127.0.0.1:${config.EMPS_REMOTE_TUNNEL_PORT}:${config.EMPS_REMOTE_MYSQL_HOST}:${config.EMPS_REMOTE_MYSQL_PORT}`;
    const tunnel=start('ssh',['-N','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
      '-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3',
      '-L',forward,config.EMPS_REMOTE_SSH_HOST],backend,process.env,'ignore');
    await waitFor(()=>probe(config.EMPS_REMOTE_TUNNEL_PORT),()=>!stopping&&tunnel.exitCode===null);
    console.log(JSON.stringify(await preflight(config),null,2));
    if(stopping)throw new Error('Tunnel stopped');
    if(demo){
      const python=path.join(gieRoot,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
      if(!fs.existsSync(python))throw new Error('Install the existing GIE service dependencies in its private .venv before starting the isolated demo');
      const replay=start(python,['-B','-m','uvicorn','service.isolated_preview:create_app','--factory',
        '--host','127.0.0.1','--port',String(demo.port),'--no-access-log'],gieRoot,localDemoEnvironment(config));
      await waitFor(async()=>{
        const r=await fetch(`http://127.0.0.1:${demo.port}/health`,{headers:{Authorization:`Bearer ${demo.token}`},signal:AbortSignal.timeout(1000),redirect:'error'});
        const body=await r.json();return r.ok&&body.status==='ok'&&body.source==='LOCAL_ISOLATED_GIE_DEMO'&&body.isolated===true&&body.hardware_confirmed===false&&String(body.station_id)===String(demo.stationId);
      },()=>!stopping&&replay.exitCode===null);
      console.log('Isolated GIE replay ready on loopback; no database or operational credentials were passed to Python.');
    }
    const backendEnv={...process.env,...config};
    // Never inherit integrations or test-mode switches from the developer's shell.
    for(const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_PUBLISHABLE_KEY','OCPP_GATEWAY_URL','OCPP_GATEWAY_TOKEN',
      'GIE_SERVICE_URL','GIE_SERVICE_TOKEN','GIE_STATION_ID','EMPS_V2_MYSQL_TEST','CHARGE_RUNTIME_STATION_IDS','NODE_OPTIONS','NODE_PATH'])delete backendEnv[key];
    for(const key of localDemoKeys){delete backendEnv[key];if(config[key]!==undefined)backendEnv[key]=config[key];}
    const api=start(process.execPath,[path.join(backend,'dist/main.js')],backend,backendEnv);
    const health=`http://127.0.0.1:${config.PORT}/auth/health`;
    await waitFor(async()=>{
      const response=await fetch(health,{signal:AbortSignal.timeout(1000)});
      const json=await response.json();return response.ok&&json.status==='ok';
    },()=>!stopping&&api.exitCode===null);
    const siteEnv={...process.env,NEXT_PUBLIC_API_URL:`http://localhost:${config.PORT}`,NEXT_PUBLIC_EMPS_DEMO_MODE:'false',NEXT_PUBLIC_EMPS_READ_ONLY:'true'};
    delete siteEnv.DATABASE_URL;delete siteEnv.JWT_SECRET;delete siteEnv.NODE_OPTIONS;delete siteEnv.NODE_PATH;
    for(const key of localDemoKeys)delete siteEnv[key];
    const preview=argv.includes('--preview');
    siteEnv.EMPS_LOCAL_PREVIEW=preview?'true':'false';
    siteEnv.NODE_ENV=preview?'production':'development';
    const nextCli=path.join(frontend,'node_modules/next/dist/bin/next');
    if(preview){
      console.log('Preparing optimized local preview; the backend remains development/read-only. No production deploy is performed.');
      const build=start(process.execPath,[nextCli,'build'],frontend,siteEnv,'inherit',false);
      const result=await new Promise((resolve,reject)=>{build.once('exit',resolve);build.once('error',reject);});
      if(result!==0||stopping)throw new Error('Local frontend build failed; no production code was changed');
    }
    const site=start(process.execPath,[nextCli,preview?'start':'dev','--hostname','127.0.0.1',
      '--port',config.EMPS_REMOTE_SITE_PORT],frontend,siteEnv);
    await waitFor(async()=> (await fetch(`http://127.0.0.1:${config.EMPS_REMOTE_SITE_PORT}/login`,{signal:AbortSignal.timeout(2000)})).ok,
      ()=>!stopping&&site.exitCode===null);
    console.log(`REMOTE READ-ONLY: http://localhost:${config.EMPS_REMOTE_SITE_PORT}/stations\nCtrl+C stops only this launch, including its SSH tunnel. The production backend and database are not stopped.`);
  } catch (error) {stop(1);throw error;}
}

module.exports={configuration,preflight,run,localDemoEnvironment};
if(require.main===module)run().catch(error=>{
  // Prisma errors can contain a connection URL. Only display intentional application messages.
  console.error(error?.constructor===Error?error.message:'Remote preflight failed; verify credentials and tunnel privately');
  process.exitCode=1;
});
