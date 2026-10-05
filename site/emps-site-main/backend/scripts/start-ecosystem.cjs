// Development only. Starts existing code; never seeds, migrates, cleans or resets data.
const {spawn,spawnSync}=require('node:child_process');
const {existsSync,readFileSync,mkdirSync,createWriteStream,writeFileSync,renameSync}=require('node:fs');
const path=require('node:path'),net=require('node:net'),os=require('node:os');
const backend=path.resolve(__dirname,'..'),site=path.resolve(backend,'../frontend');
const root=path.resolve(backend,'../../..'),gie=path.join(root,'gie/GIE'),app=path.join(root,'app/emps-charge');
const argv=process.argv.slice(2),option=(key,fallback)=>{const i=argv.indexOf(key);return i<0?fallback:argv[i+1]};
if(argv.includes('--help')){console.log('node scripts/start-ecosystem.cjs [--with-app] [--backend-port 3001] [--site-port 3000] [--expo-port 8081] [--lan-ip LAN_IP]\nCtrl+C stops only the services started here. MySQL and all data are preserved.');process.exit(0)}
const bp=Number(option('--backend-port','3001')),sp=Number(option('--site-port','3000')),ep=Number(option('--expo-port','8081'));
const withApp=argv.includes('--with-app'),v2=argv.includes('--v2');
const presentationFile=path.join(backend,'.env.presentation'),localFile=path.join(backend,'.env');
const configFile=existsSync(presentationFile)?presentationFile:localFile;
if(!existsSync(configFile))throw Error('Missing backend/.env. Run the root setup script and review local configuration.');
const parse=require(path.join(backend,'node_modules/dotenv')).parse;
const config={...(existsSync(localFile)?parse(readFileSync(localFile)):{}),...parse(readFileSync(configFile))};
const appConfig=parse(readFileSync(path.join(app,'.env')));
// Web Charge receives the same public test key as the App, even when this entry
// point is used directly. Preserve an explicitly configured backend key.
config.STRIPE_PUBLISHABLE_KEY ||= appConfig.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
if(v2){delete config.CHARGE_RUNTIME_STATION_IDS;config.ENABLE_DEMO_PAYMENTS='true';}
if(config.PAYMENT_PROVIDER==='stripe'&&!config.STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_'))throw Error('Configure STRIPE_PUBLISHABLE_KEY or EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY with the matching Sandbox public key before startup.');
const gu=new URL(config.GIE_SERVICE_URL);if(!['localhost','127.0.0.1'].includes(gu.hostname))throw Error('This launcher starts a local GIE only.');
const lan=option('--lan-ip',Object.values(os.networkInterfaces()).flat().find(n=>n&&n.family==='IPv4'&&!n.internal&&n.address.startsWith('192.168.'))?.address||'127.0.0.1');
const children=[],logs=[];let stopping=false;
const stateFile=path.join(backend,'reports/ecosystem-v2-state.json');
const state={root,supervisor:{pid:process.pid,startedAt:new Date().toISOString(),marker:__filename},children:[],status:'STARTING'};
function saveState(){if(!v2)return;mkdirSync(path.dirname(stateFile),{recursive:true});writeFileSync(stateFile+'.tmp',JSON.stringify(state,null,2));renameSync(stateFile+'.tmp',stateFile)}
function track(p,name,marker,cwd){children.push(p);state.children.push({pid:p.pid,name,marker,cwd,startedAt:new Date().toISOString()});saveState()}
saveState();
function stop(code=0){if(stopping)return;stopping=true;state.status='STOPPED';saveState();process.exitCode=code;for(const p of children)if(p.exitCode===null)p.kill();for(const l of logs)l.end();setTimeout(()=>process.exit(code),500).unref();}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
async function free(port){if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');await new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();reject(Error('Port '+port+' is occupied; no existing process was stopped.'))});socket.once('timeout',()=>{socket.destroy();reject(Error('Cannot verify port '+port))});socket.once('error',e=>{socket.destroy();e.code==='ECONNREFUSED'?resolve():reject(e)});});await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(Error(`Port ${port} is occupied; no existing process was stopped.`)));s.listen(port,'0.0.0.0',()=>s.close(resolve))})}
function start(name,exe,args,cwd,env){const l=createWriteStream(path.join(backend,'reports',`startup-${name}.log`));logs.push(l);const p=spawn(exe,args,{cwd,env:{...process.env,...env,...(v2?{CI:'false',NODE_OPTIONS:'--dns-result-order=ipv4first'}:{})},windowsHide:true,stdio:['ignore','pipe','pipe']});track(p,name,args.find(a=>path.isAbsolute(a))||exe,cwd);p.stdout.pipe(l);p.stderr.pipe(l);p.once('error',e=>{console.error(name,e.message);stop(1)});p.once('exit',code=>{if(!stopping){console.error(`${name} exited (${code}); inspect reports/startup-${name}.log`);stop(1)}});return p;}
async function ready(url,headers={}){for(let i=0;i<120;i++){if(stopping)throw Error('Service exited');try{if((await fetch(url,{headers,signal:AbortSignal.timeout(1000)})).ok)return}catch{}await new Promise(r=>setTimeout(r,500))}throw Error('Service not ready: '+url)}
(async()=>{
 if(v2){delete process.env.CHARGE_RUNTIME_STATION_IDS;process.env.CI='false';}
 if(process.env.NODE_ENV==='production')throw Error('Development launcher only');
 await Promise.all([bp,sp,Number(gu.port||80),...(withApp?[ep]:[])].map(free));
 const dockerPath=path.join(process.env.ProgramFiles||'C:/Program Files','Docker/Docker/resources/bin/docker.exe');const localDocker=path.join(process.env.LOCALAPPDATA||'', 'Programs/DockerDesktop/resources/bin/docker.exe');const docker=existsSync(dockerPath)?dockerPath:existsSync(localDocker)?localDocker:'docker';
 const check=spawnSync(docker,['inspect','emps-mysql','--format','{{.State.Running}}'],{encoding:'utf8',windowsHide:true});
 if(check.status!==0)throw Error('Start Docker Desktop; existing container emps-mysql must be available.');
 if(check.stdout.trim()!=='true'){const started=spawnSync(docker,['start','emps-mysql'],{windowsHide:true});if(started.status!==0)throw Error('Unable to start emps-mysql');}
 mkdirSync(path.join(backend,'reports'),{recursive:true});
 if(config.PAYMENT_PROVIDER==='stripe'){
   const {child,ready}=require('./stripe-listener.cjs').startStripeListener({key:config.STRIPE_SECRET_KEY,url:`http://127.0.0.1:${bp}/payments/stripe/webhook`,onOutput:line=>{if(line.includes('-->')||line.includes('<--'))console.log('[Stripe Sandbox] '+line);},onExit:()=>{if(!stopping)stop(1);}});
   track(child,'stripe',require.resolve('@stripe/cli/bin/shim.js'),backend);config.STRIPE_WEBHOOK_SECRET=await ready;
 }

 start('gie',path.join(gie,'.venv/Scripts/python.exe'),['-B','-m','uvicorn','service.api:create_app','--factory','--host','127.0.0.1','--port',gu.port||'80'],gie,{GIE_STATION_ID:config.GIE_STATION_ID,GIE_SERVICE_TOKEN:config.GIE_SERVICE_TOKEN,GIE_NORMAL_DEMO:config.GIE_NORMAL_DEMO??'true',GIE_WEATHER_ENABLED:config.GIE_WEATHER_ENABLED??'false',PYTHONPATH:gie+path.delimiter+path.join(gie,'src')});
 await ready(config.GIE_SERVICE_URL+'/health',{Authorization:'Bearer '+config.GIE_SERVICE_TOKEN});
 const gieEnv={...config};
 start('backend',process.execPath,[path.join(backend,'dist/main.js')],backend,{...gieEnv,PORT:String(bp),PAYMENT_PROVIDER:config.PAYMENT_PROVIDER??'sandbox',TARIFF_V1_STATION_IDS:config.TARIFF_V1_STATION_IDS??config.GIE_STATION_ID,OCPP_GATEWAY_URL:'',ADMIN_SITE_URL:`http://localhost:${sp}`,CORS_ORIGINS:`http://localhost:${sp},http://127.0.0.1:${sp},http://localhost:${ep},http://127.0.0.1:${ep},http://${lan}:${ep},http://${lan}:${sp}`});
 await ready(`http://127.0.0.1:${bp}/auth/health`);
 start('site',process.execPath,[path.join(site,'node_modules/next/dist/bin/next'),'dev','--port',String(sp)],site,{NEXT_PUBLIC_API_URL:`http://localhost:${bp}`,NEXT_PUBLIC_EMPS_DEMO_MODE:'false'});
 await ready(`http://localhost:${sp}/login`);
 if(withApp){start('expo',process.execPath,[path.join(app,'node_modules/expo/bin/cli'),'start','--lan',...(v2?['--clear']:[]),'--port',String(ep)],app,{EXPO_PUBLIC_EMPS_API_URL:`http://${lan}:${bp}`,EXPO_PUBLIC_EMPS_DEMO_MODE:'false',REACT_NATIVE_PACKAGER_HOSTNAME:lan});await ready(`http://127.0.0.1:${ep}/status`);}
 state.status='READY';saveState();
 console.log(`Site: http://localhost:${sp}\nBackend: http://localhost:${bp}/auth/health\nGIE: ${config.GIE_SERVICE_URL} (autenticado; NORMAL demonstrativo, apresentação pausada)\n${withApp?'Expo: exp://'+lan+':'+ep+' / Web: http://localhost:'+ep+'\n':''}Configuration: ${path.basename(configFile)} (local, ignored). Logs: backend/reports/startup-*.log\nCtrl+C to stop this launch. MySQL stays running.`);
})().catch(e=>{console.error(e.message);stop(1)});
