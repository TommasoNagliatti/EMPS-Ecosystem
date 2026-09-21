// Opt-in development smoke. Creates and retains three auditable test sessions; never deletes data.
import 'dotenv/config';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import Stripe from 'stripe';
import {randomUUID,createHash} from 'node:crypto';
import {spawn,ChildProcess} from 'node:child_process';
import {readFileSync,writeFileSync,createWriteStream} from 'node:fs';
import {resolve} from 'node:path';
import {parse} from 'dotenv';
const {startStripeListener}=require('./stripe-listener.cjs');
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function main(){
 if(process.env.NODE_ENV==='production'||!process.argv.includes('--apply'))throw Error('Development only; use --apply to create and retain test sessions');
 const cfg=parse(readFileSync('.env.presentation')),db=new PrismaClient(),children:ChildProcess[]=[],logs:any[]=[],requests:any[]=[],sessions:string[]=[],proof:any={};
 const report='reports/tariff-stripe-smoke-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',base='http://127.0.0.1:3107',root=resolve('../../..'),gieRoot=resolve(root,'gie/GIE');
 const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v)).digest('hex');
 let webhookSecret='',server:ChildProcess,gie:ChildProcess;
 const stripe=new Stripe(cfg.STRIPE_SECRET_KEY);assert.match(cfg.STRIPE_SECRET_KEY,/^sk_test_/);
 function start(exe:string,args:string[],cwd:string,env:Record<string,string>){const log=createWriteStream(`reports/tariff-process-${children.length}.log`);logs.push(log);const p=spawn(exe,args,{cwd,env:{...process.env,...cfg,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(p);p.stdout!.pipe(log);p.stderr!.pipe(log);return p;}
 async function ready(url:string,p:ChildProcess,headers={}){for(let n=0;n<100;n++){if(p.exitCode!==null)throw Error('Owned test service exited');try{if((await fetch(url,{headers,signal:AbortSignal.timeout(1500)})).ok)return;}catch{}await pause(300);}throw Error('Service readiness timeout');}
 async function req(method:string,path:string,body?:any,token?:string,key?:string,status=200){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});requests.push({method,path,status:r.status});assert.equal(r.status,status,`${method} ${path}: ${r.status} ${r.status>=400?(await r.text()).slice(0,500):''}`);return r.bodyUsed?null:r.json();}
 const stop=async(p:ChildProcess)=>{if(p.exitCode===null){p.kill();await new Promise(r=>p.once('exit',r));}};
 async function backend(provider:string){const p=start(process.execPath,['dist/main.js'],process.cwd(),{PORT:'3107',PAYMENT_PROVIDER:provider,STRIPE_WEBHOOK_SECRET:webhookSecret,OCPP_GATEWAY_URL:'',TARIFF_V1_STATION_IDS:cfg.GIE_STATION_ID});await ready(base+'/auth/health',p);return p;}
 async function poll(check:()=>Promise<boolean>,label:string){for(let n=0;n<40;n++){if(await check())return;await pause(500);}throw Error(label+' timeout');}
 try{
  for(const url of [base+'/auth/health',cfg.GIE_SERVICE_URL+'/health']){try{await fetch(url,{signal:AbortSignal.timeout(500)});throw Error('Test port already in use');}catch(e){if(String(e).includes('already in use'))throw e;}}
  const old=await db.chargingSession.findMany({where:process.env.SMOKE_RESUME_CASH_SESSION?{id:{not:BigInt(process.env.SMOKE_RESUME_CASH_SESSION)}}:{},orderBy:{id:'asc'}}),oldIds=old.map(s=>s.id),oldHash=hash(old);proof.historicalSessions={count:old.length,before:oldHash};
  const preservedStations=await db.station.findMany({where:{id:{in:[11,14]}}});const stationHash=hash(preservedStations);
  const listener=startStripeListener({key:cfg.STRIPE_SECRET_KEY,url:base+'/payments/stripe/webhook',onOutput:(line:string)=>{if(line.includes('<--'))proof.stripeCliLastDelivery=line;}});children.push(listener.child);webhookSecret=await listener.ready;
  gie=start(resolve(gieRoot,'.venv/Scripts/python.exe'),['-B','-m','uvicorn','service.api:create_app','--factory','--host','127.0.0.1','--port','8510'],gieRoot,{PYTHONPATH:gieRoot+';'+resolve(gieRoot,'src'),GIE_NORMAL_DEMO:'true',GIE_WEATHER_ENABLED:'true'});
  await ready(cfg.GIE_SERVICE_URL+'/health',gie,{Authorization:'Bearer '+cfg.GIE_SERVICE_TOKEN});server=await backend('stripe');
  const admin=(await req('POST','/auth/login',{email:cfg.ADMIN_EMAIL,password:cfg.ADMIN_PASSWORD})).accessToken;
  const driver=(await req('POST','/mobile/v1/auth/login',{email:cfg.CUSTOMER_EMAIL,password:cfg.CUSTOMER_PASSWORD},undefined,undefined,201)).accessToken;
  const prefix=`/stations/${cfg.GIE_STATION_ID}/gie`,chargerId=process.env.SMOKE_CHARGER_ID??'50';
  const initial=await req('GET',prefix+'/state',undefined,admin);assert.equal(initial.mode,'NORMAL');assert.equal(initial.presentation.playing,false);assert.equal(initial.state.provenance.normal_demo,true);
  // Existing enabled charger 50 is mapped only when both it and slot 2 are currently unmapped.
  const mapping=await db.gieEvseMapping.findUnique({where:{chargerId:50}});
  if(!mapping){assert.equal((await db.charger.findUniqueOrThrow({where:{id:50}})).stationId,Number(cfg.GIE_STATION_ID));assert.equal(await db.gieEvseMapping.count({where:{stationId:Number(cfg.GIE_STATION_ID),evseSlot:2,isActive:true}}),0);await req('POST',prefix+'/mappings',{chargerId:'50',evseSlot:2},admin,undefined,201);proof.mappingAdded={chargerId:50,evseSlot:2};}
  await req('GET',prefix+'/state',undefined,driver,undefined,403);
  for(const action of ['start','pause','next','previous','reset'])await req('POST',prefix+'/presentation/'+action,{},admin,undefined,201);
  await req('POST',prefix+'/mode',{mode:'MANUAL_DEMO'},admin,undefined,201);await req('POST',prefix+'/manual-demo/event',{event:'RESET'},admin,undefined,201);
  await req('POST',prefix+'/mode',{mode:'NORMAL'},admin,undefined,201);
  const stations=await req('GET','/stations',undefined,admin);assert.ok(stations.some((s:any)=>String(s.id)===cfg.GIE_STATION_ID&&s.giePrimary));
  const charger=await req('GET','/mobile/v1/chargers/'+chargerId,undefined,driver);assert.equal(charger.tariff.tariff_version,'SP_ENEL_PROTO_V1');
  const qr=await req('GET','/mobile/v1/qr/'+charger.qrToken,undefined,driver);
  async function create(){const key=randomUUID(),body={chargerId,method:'card',spendingLimit:20};const intents=await Promise.all([req('POST','/mobile/v1/payment-intents',body,driver,key,201),req('POST','/mobile/v1/payment-intents',body,driver,key,201)]);assert.equal(intents[0].id,intents[1].id);const input={qrBindingId:qr.qrBindingId,paymentIntentId:intents[0].id,spendingLimit:20,idempotencyKey:key+'-start'};const a=await req('POST','/mobile/v1/charging-sessions/start',input,driver,key+'-start',201);sessions.push(a.id);const replay=await req('POST','/mobile/v1/charging-sessions/start',input,driver,key+'-start',201);assert.equal(a.id,replay.id);return a;}
  const resume=process.env.SMOKE_RESUME_SESSION;
  const s=resume?await req('GET','/mobile/v1/charging-sessions/'+resume,undefined,driver):await create(),route=`/mobile/v1/charging-sessions/${s.id}`;
  let pi:string,frozen:string,approved:Stripe.PaymentIntent;
  if(resume){
   assert.equal(s.status,'completed');const existing=await db.chargingSession.findUniqueOrThrow({where:{id:BigInt(resume)},include:{paymentIntent:true}});
   pi=existing.paymentIntent!.providerIntentId!;approved=await stripe.paymentIntents.retrieve(pi);assert.equal(approved.status,'succeeded');
   frozen=hash((await req('GET',route+'/billing',undefined,driver)).breakdown);proof.resumedApprovedSession=resume;
  }else{

  const activeState=await req('GET',prefix+'/state',undefined,admin);assert.equal(activeState.context.demands.find((d:any)=>d.charger_id===chargerId).session_id,s.id);assert.ok(activeState.state.numeric_state.ev_demand_kw>0);proof.normal=activeState;
  console.log('Real MySQL session running under NORMAL; accumulating test energy for Stripe minimum.');
  await pause(55000);
  const live=await req('GET',route,undefined,driver);assert.ok(live.energyKwh>0);assert.ok(live.totalCost>=.50);proof.live={energyKwh:live.energyKwh,totalCost:live.totalCost,powerKw:live.powerKw};
  const stopKey=randomUUID();await Promise.all([req('POST',route+'/stop',{},driver,stopKey,201),req('POST',route+'/stop',{},driver,stopKey,201)]);
  await req('POST',route+'/payment',{},driver,undefined,409);
  const disconnected=await req('POST',route+'/disconnect',{},driver,undefined,201);assert.equal(disconnected.frozen,true);frozen=hash(disconnected.breakdown);assert.equal(frozen,hash((await req('POST',route+'/disconnect',{},driver,undefined,201)).breakdown));
  const pays=await Promise.all([req('POST',route+'/payment',{},driver,undefined,201),req('POST',route+'/payment',{},driver,undefined,201)]);assert.equal(pays[0].providerClientSecret,pays[1].providerClientSecret);
  const intent=await db.paymentIntent.findUniqueOrThrow({where:{id:(await db.chargingSession.findUniqueOrThrow({where:{id:BigInt(s.id)}})).paymentIntentId!}});pi=intent.providerIntentId!;
  try{await stripe.paymentIntents.confirm(pi,{payment_method:'pm_card_visa_chargeDeclined'});throw Error('Expected declined test card');}catch(e:any){assert.equal(e.type,'StripeCardError');}
  await poll(async()=>await db.payment.count({where:{sessionId:BigInt(s.id),status:'REJECTED'}})===1,'Real failure webhook');proof.declinedWebhook=true;
  await req('POST',route+'/payment',{},driver,undefined,201);approved=await stripe.paymentIntents.confirm(pi,{payment_method:'pm_card_visa'});assert.equal(approved.status,'succeeded');assert.equal(approved.livemode,false);
  await poll(async()=>(await db.chargingSession.findUniqueOrThrow({where:{id:BigInt(s.id)}})).status==='FINISHED','Real success webhook');
  }
  const event={id:'evt_emps_replay_'+randomUUID(),object:'event',type:'payment_intent.payment_failed',data:{object:approved},livemode:false};const payload=JSON.stringify(event),sig=stripe.webhooks.generateTestHeaderString({payload,secret:webhookSecret});
  const replay=await fetch(base+'/payments/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':sig},body:payload});assert.equal(replay.status,200);requests.push({method:'POST',path:'/payments/stripe/webhook [signed delayed failure]',status:replay.status});
  const invalid=await fetch(base+'/payments/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':'invalid'},body:payload});assert.equal(invalid.status,400);requests.push({method:'POST',path:'/payments/stripe/webhook [invalid signature]',status:invalid.status});
  assert.equal(await db.payment.count({where:{sessionId:BigInt(s.id)}}),1);assert.equal((await req('GET',route,undefined,driver)).status,'completed');assert.equal(frozen,hash((await req('GET',route+'/billing',undefined,driver)).breakdown));proof.stripe={sessionId:s.id,paymentIntentId:pi,amount:approved.amount,received:approved.amount_received,live:approved.livemode,duplicateSafe:true,outOfOrderSafe:true};
  const cash=process.env.SMOKE_RESUME_CASH_SESSION?{sessaoId:process.env.SMOKE_RESUME_CASH_SESSION}:await req('POST',`/chargers/${chargerId}/postpaid-sessions`,{tarifaKwh:1.99,origem:'caixa',motivo:'pagamento_no_encerramento'},admin,undefined,201);sessions.push(cash.sessaoId);await req('GET',prefix+'/state',undefined,admin);await pause(5500);
  const quote=await req('GET',`/charging-sessions/${cash.sessaoId}/quote`,undefined,admin);assert.equal(quote.fixedFee,0);assert.equal(quote.total,Number((quote.energyAmount+(quote.overstayFee??0)).toFixed(2)));
  const cashBody={energiaConsumidaKwh:quote.energyKwh,valorCobrado:quote.total,valorRecebido:quote.total,quoteToken:quote.quoteToken,origem:'caixa'};
  await req('POST',`/charging-sessions/${cash.sessaoId}/settle-cash`,{...cashBody,valorCobrado:quote.total+1},admin,undefined,400);
  await req('POST',`/charging-sessions/${cash.sessaoId}/settle-cash`,cashBody,admin,undefined,201);await req('POST',`/charging-sessions/${cash.sessaoId}/settle-cash`,cashBody,admin,undefined,201);proof.cash={sessionId:cash.sessaoId,energy:quote.energyKwh,rate:quote.pricePerKwh,fixed:quote.fixedFee,total:quote.total};
  await stop(server);server=await backend('sandbox');
  const fallback=await create(),fr=`/mobile/v1/charging-sessions/${fallback.id}`;await req('GET',prefix+'/state',undefined,admin);await pause(5500);await req('POST',fr+'/stop',{},driver,randomUUID(),201);await req('POST',fr+'/disconnect',{},driver,undefined,201);
  const fp=await Promise.all([req('POST',fr+'/payment',{},driver,undefined,201),req('POST',fr+'/payment',{},driver,undefined,201)]);assert.equal(fp[0].provider,'sandbox');assert.equal(await db.payment.count({where:{sessionId:BigInt(fallback.id)}}),1);proof.sandbox={sessionId:fallback.id,approved:true};
  await stop(gie);assert.equal((await req('GET',prefix+'/state',undefined,admin)).online,false);await req('GET','/auth/health');proof.gieOfflineSafe=true;
  const after=hash(await db.chargingSession.findMany({where:{id:{in:oldIds}},orderBy:{id:'asc'}}));assert.equal(after,oldHash);proof.historicalSessions.after=after;assert.equal(stationHash,hash(await db.station.findMany({where:{id:{in:[11,14]}}})));proof.preservedStations=[11,14];proof.passed=true;
 }catch(e:any){proof.passed=false;proof.error=String(e?.message??e).replace(/(?:sk_test_|whsec_|pi_\w+_secret_)[A-Za-z0-9]+/g,'[REDACTED]');throw new Error(proof.error);}
 finally{writeFileSync(report,JSON.stringify({at:new Date().toISOString(),...proof,createdSessions:sessions,requests},null,2));for(const p of children)if(p.exitCode===null)p.kill();for(const l of logs)l.end();await db.$disconnect();console.log(JSON.stringify({report,passed:proof.passed,requests:requests.length,sessions}));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
