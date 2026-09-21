import 'dotenv/config';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawn, type ChildProcess} from 'node:child_process';
import {createWriteStream,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as bcrypt from 'bcrypt';
import {parse} from 'dotenv';
import {io} from 'socket.io-client';

async function main(){
 if(process.env.NODE_ENV==='production')throw Error('Somente desenvolvimento');
 const db=new PrismaClient();const children:ChildProcess[]=[];const logs:any[]=[];const requests:any[]=[];
 const configuration='.env.presentation';
 const config:Record<string,string>=existsSync(configuration)?parse(readFileSync(configuration)): {
   ADMIN_EMAIL:'admin.dev@emps.local',ADMIN_NAME:'Administrador EMPS Desenvolvimento',ADMIN_PASSWORD:randomBytes(24).toString('base64url'),
   CUSTOMER_EMAIL:'motorista.demo@emps.local',CUSTOMER_PASSWORD:randomBytes(24).toString('base64url'),
   GIE_SERVICE_TOKEN:randomBytes(32).toString('base64url'),GIE_SERVICE_URL:'http://127.0.0.1:8510',GIE_TIMEOUT_MS:'5000'};
 const save=()=>writeFileSync(configuration,Object.entries(config).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
 const base='http://127.0.0.1:3107';let socket:ReturnType<typeof io>|undefined;
 function start(args:string[],cwd=process.cwd(),env:Record<string,string>={},exe=process.execPath){
   const log=createWriteStream(`reports/full-process-${children.length}.log`);logs.push(log);
   const p=spawn(exe,args,{cwd,env:{...process.env,...config,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});
   children.push(p);p.stdout!.pipe(log);p.stderr!.pipe(log);return p;
 }
 async function ready(url:string,p:ChildProcess,headers:Record<string,string>={}){for(let i=0;i<60;i++){if(p.exitCode!==null)throw Error('Processo encerrou: '+url);try{if((await fetch(url,{headers})).ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('Timeout '+url);}
 async function req(method:string,path:string,body?:any,token?:string,key?:string,status=200){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();requests.push({method,path,status:r.status});assert.equal(r.status,status,text);return text?JSON.parse(text):null;}
 try{
   try{await fetch(base+'/auth/health',{signal:AbortSignal.timeout(500)});throw Error('Porta QA 3107 ocupada; não reutilizar servidor alheio');}catch(e){if(e instanceof Error&&e.message.includes('ocupada'))throw e;}
   let admin=await db.user.findUnique({where:{email:config.ADMIN_EMAIL}});
   if(!admin){admin=await db.user.create({data:{name:config.ADMIN_NAME,email:config.ADMIN_EMAIL,passwordHash:await bcrypt.hash(config.ADMIN_PASSWORD,12),role:'ADMIN',accountStatus:'ACTIVE'}});save();}
   assert.equal(admin.role,'ADMIN');assert.ok(await bcrypt.compare(config.ADMIN_PASSWORD,admin.passwordHash),'Conta existente não será sobrescrita');
   let server=start(['dist/main.js'],process.cwd(),{PORT:'3107',PAYMENT_PROVIDER:'sandbox',OCPP_GATEWAY_URL:'',CORS_ORIGINS:'http://localhost:3108',GIE_STATION_ID:''});
   await ready(base+'/auth/health',server);
   let auth=await req('POST','/auth/login',{email:config.ADMIN_EMAIL,password:config.ADMIN_PASSWORD},undefined,undefined,200);
   let stationId=config.GIE_STATION_ID;
   if(!stationId){const st=await req('POST','/stations',{name:'EMPS Demonstração Integrada',street:'Avenida Paulista',addressNumber:'1000',neighborhood:'Bela Vista',city:'São Paulo',state:'SP',postalCode:'01310100',latitude:-23.5614,longitude:-46.6559},auth.accessToken,undefined,201);stationId=st.id;config.GIE_STATION_ID=stationId;save();}
   let chargerId=config.PRESENTATION_CHARGER_ID;
   if(!chargerId){
     const p=await req('POST','/charger-provisionings',{stationId,name:'EMPS Demo 01',location:'Vaga 01',connectorType:'TYPE2',powerType:'AC',phaseCount:3,powerKw:22,pricePerKwh:1.89,manufacturer:'EMPS Protótipo',model:'Sandbox',serialNumber:'EMPS-DEV-'+randomUUID().slice(0,12),ocppIdentity:'EMPS-DEV-'+randomUUID().slice(0,12),ocppVersion:'1.6J'},auth.accessToken,undefined,201);
     const before=await db.charger.findFirstOrThrow({where:{serialNumber:p.serialNumber}});assert.equal(before.administrativeStatus,'PENDING');
     await req('POST','/device/v1/charger-provisionings/claim',{activationCode:p.activationCode,serialNumber:p.serialNumber,ocppIdentity:p.ocppIdentity},undefined,undefined,201);
     const a=await req('POST',`/charger-provisionings/${p.id}/approve`,{},auth.accessToken,undefined,201);chargerId=a.charger.id;config.PRESENTATION_CHARGER_ID=chargerId;save();
     // Deliberate presentation tariff with an explicit fee exercises the reported cash bug.
     await db.tariff.updateMany({where:{chargerId:Number(chargerId),status:'ACTIVE'},data:{fixedFee:.50}});
   }
   const customer=await db.user.findUnique({where:{email:config.CUSTOMER_EMAIL}});
   if(!customer)await req('POST','/mobile/v1/auth/register',{name:'Motorista Demonstração EMPS',email:config.CUSTOMER_EMAIL,password:config.CUSTOMER_PASSWORD},undefined,undefined,201);
   server.kill();await new Promise(r=>server.once('exit',r));
   const gieRoot=resolve(process.cwd(),'../../../gie/GIE');
   const gie=start(['-B','-m','uvicorn','service.api:create_app','--factory','--host','127.0.0.1','--port','8510'],gieRoot,{PYTHONPATH:gieRoot+';'+resolve(gieRoot,'src')},resolve(gieRoot,'.venv/Scripts/python.exe'));
   await ready(config.GIE_SERVICE_URL+'/health',gie,{Authorization:'Bearer '+config.GIE_SERVICE_TOKEN});
   server=start(['dist/main.js'],process.cwd(),{PORT:'3107',PAYMENT_PROVIDER:'sandbox',OCPP_GATEWAY_URL:'',CORS_ORIGINS:'http://localhost:3108'});await ready(base+'/auth/health',server);
   auth=await req('POST','/auth/login',{email:config.ADMIN_EMAIL,password:config.ADMIN_PASSWORD},undefined,undefined,200);const adminToken=auth.accessToken;
   const driver=(await req('POST','/mobile/v1/auth/login',{email:config.CUSTOMER_EMAIL,password:config.CUSTOMER_PASSWORD},undefined,undefined,201)).accessToken;
   const prefix=`/stations/${stationId}/gie`;
   const initial=await req('GET',prefix+'/state',undefined,adminToken);assert.equal(initial.mode,'NORMAL');assert.equal(initial.state,null);assert.equal(initial.presentation.playing,false);
   await req('GET',prefix+'/state',undefined,driver,undefined,403);
   await req('POST',prefix+'/mappings',{chargerId,evseSlot:1},adminToken,undefined,201);
   const stations=await req('GET','/mobile/v1/stations/nearby?lat=-23.5614&lng=-46.6559&radiusKm=5',undefined,driver);assert.equal(stations.filter((s:any)=>s.id===stationId).length,1);
   const station=await req('GET','/mobile/v1/stations/'+stationId,undefined,driver);assert.deepEqual(station.chargerIds,[chargerId]);
   const charger=await req('GET','/mobile/v1/chargers/'+chargerId,undefined,driver);assert.equal(charger.stationId,stationId);
   const qr=await req('GET','/mobile/v1/qr/'+charger.qrToken,undefined,driver);
   const events:any[]=[];socket=io(base+'/realtime',{auth:{token:adminToken},transports:['websocket']});socket.on('emps:change',e=>events.push(e));
   await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Realtime não conectou')),5000);socket!.once('emps:ready',()=>{clearTimeout(timeout);resolve();});});
   await req('POST',prefix+'/presentation/start',{},adminToken,undefined,201);
   await req('POST',prefix+'/presentation/pause',{},adminToken,undefined,201);
   const next=await req('POST',prefix+'/presentation/next',{},adminToken,undefined,201);assert.equal(next.presentation.scene_number,2);
   await req('POST',prefix+'/presentation/previous',{},adminToken,undefined,201);
   await req('POST',prefix+'/presentation/reset',{},adminToken,undefined,201);
   await req('POST',prefix+'/mode',{mode:'MANUAL_DEMO'},adminToken,undefined,201);
   await req('POST',prefix+'/manual-demo/event',{event:'RESET'},adminToken,undefined,201);
   const key=randomUUID();const intent=await req('POST','/mobile/v1/payment-intents',{chargerId,method:'pix',spendingLimit:20},driver,key,201);
   const begin={qrBindingId:qr.qrBindingId,paymentIntentId:intent.id,spendingLimit:20,idempotencyKey:key+'-start'};
   const session=await req('POST','/mobile/v1/charging-sessions/start',begin,driver,key+'-start',201);
   const state=await req('GET',prefix+'/state',undefined,adminToken);assert.equal(state.state.numeric_state.ev_demand_kw,22);assert.equal(state.state.numeric_state.evse_setpoints_kw[0],22);assert.equal(state.context.demands[0].session_id,session.id);
   await new Promise(r=>setTimeout(r,5500));
   const energy=await req('GET',prefix+'/state',undefined,adminToken);assert.equal(energy.state.execution_allowed,true);
   const active=await req('GET','/mobile/v1/charging-sessions/'+session.id,undefined,driver);assert.equal(active.managedPower,true);assert.ok(active.energyKwh>0);assert.equal(active.powerKw,22);
   const stopKey=key+'-stop';const stops=await Promise.all([req('POST',`/mobile/v1/charging-sessions/${session.id}/stop`,{},driver,stopKey,201),req('POST',`/mobile/v1/charging-sessions/${session.id}/stop`,{},driver,stopKey,201)]);
   assert.ok(stops.some(s=>s.status==='completed'));assert.equal(await db.payment.count({where:{sessionId:BigInt(session.id)}}),1);
   await req('GET',prefix+'/state',undefined,adminToken);
   const postpaid=await req('POST',`/chargers/${chargerId}/postpaid-sessions`,{tarifaKwh:1.89,origem:'caixa',motivo:'pagamento_no_encerramento'},adminToken,undefined,201);
   await req('GET',prefix+'/state',undefined,adminToken);await new Promise(r=>setTimeout(r,1100));
   const quote=await req('GET',`/charging-sessions/${postpaid.sessaoId}/quote`,undefined,adminToken);assert.equal(quote.fixedFee,.5);assert.equal(quote.total,Number((quote.energyKwh*quote.pricePerKwh+quote.fixedFee).toFixed(2)));
   const cash={energiaConsumidaKwh:quote.energyKwh,valorCobrado:quote.total,valorRecebido:quote.total,quoteToken:quote.quoteToken,origem:'caixa'};
   await req('POST',`/charging-sessions/${postpaid.sessaoId}/settle-cash`,cash,adminToken,undefined,201);
   await req('POST',`/charging-sessions/${postpaid.sessaoId}/settle-cash`,cash,adminToken,undefined,201);
   const prepaid=await req('POST',`/chargers/${chargerId}/manual-release`,{tarifaKwh:1.89,valorRecebido:5,origem:'caixa',motivo:'fallback_qr_code'},adminToken,undefined,201);
   const pq=await req('GET',`/charging-sessions/${prepaid.sessaoId}/quote`,undefined,adminToken);
   await req('POST',`/charging-sessions/${prepaid.sessaoId}/settle-cash`,{energiaConsumidaKwh:pq.energyKwh,valorCobrado:pq.total,valorRecebido:5,quoteToken:pq.quoteToken,origem:'caixa'},adminToken,undefined,201);
   await req('POST',prefix+'/presentation/reset',{},adminToken,undefined,201);
   await req('POST',prefix+'/mode',{mode:'NORMAL'},adminToken,undefined,201);
   gie.kill();await new Promise(r=>gie.once('exit',r));
   const offline=await req('GET',prefix+'/state',undefined,adminToken);assert.equal(offline.online,false);assert.equal(offline.state,null);
   await req('GET','/auth/health');assert.ok(events.some(e=>e.topic==='session.created'));
   writeFileSync('reports/full-integration.json',JSON.stringify({passed:true,stationId,chargerId,sessionId:session.id,requests,realtimeTopics:[...new Set(events.map(e=>e.topic))],gieOfflineSafe:true,core:'GIEControl + frozen V2 MPC',hardwareConfirmed:false},null,2));
   console.log(JSON.stringify({passed:true,stationId,chargerId,requests:requests.length,configuration:'backend/.env.presentation (ignorado pelo Git)'}));
 }catch(error){writeFileSync('reports/full-integration-failure.json',JSON.stringify({error:String(error),requests},null,2));throw error;}
 finally{socket?.disconnect();for(const p of children)if(p.exitCode===null)p.kill();for(const log of logs)log.end();await db.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
