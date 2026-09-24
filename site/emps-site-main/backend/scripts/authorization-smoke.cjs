// Explicit, retained DEMO sessions. Never deletes data or changes historical invoices.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {PrismaClient}=require('@prisma/client'),{parse}=require('dotenv'),Stripe=require('stripe');
const {startStripeListener}=require('./stripe-listener.cjs');
const root=path.resolve(__dirname,'..'),repo=path.resolve(root,'../../..'),children=[],proof={requests:[],sessions:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=v=>createHash('sha256').update(JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x)).digest('hex');
async function main(){
 if(!process.argv.includes('--apply')||!process.env.EMPS_PRIVATE_CONFIG)throw Error('Use --apply and EMPS_PRIVATE_CONFIG after a fresh backup');
 const cfg={...parse(fs.readFileSync(path.join(root,'.env'))),...parse(fs.readFileSync(process.env.EMPS_PRIVATE_CONFIG))};
 const db=new PrismaClient({datasources:{db:{url:cfg.DATABASE_URL}}}),stripe=new Stripe(cfg.STRIPE_SECRET_KEY);
 assert.match(cfg.STRIPE_SECRET_KEY,/^sk_test_/);
 const base='http://127.0.0.1:3117',gieRoot=path.join(repo,'gie/GIE');
 const folder=path.join(root,'reports/authorization-2026-09-24');fs.mkdirSync(folder,{recursive:true});
 const report=path.join(folder,'smoke-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
 function start(exe,args,cwd,extra){const p=spawn(exe,args,{cwd,env:{...process.env,...cfg,...extra},windowsHide:true,stdio:'ignore'});children.push(p);return p;}
 async function ready(url,p,headers={}){for(let i=0;i<100;i++){if(p.exitCode!==null)throw Error('Owned service exited');try{if((await fetch(url,{headers,signal:AbortSignal.timeout(500)})).ok)return;}catch{}await sleep(300);}throw Error('Readiness timeout');}
 async function req(method,route,token,body,key,status=200){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});proof.requests.push({method,route,status:r.status});assert.equal(r.status,status,method+' '+route);return r.json();}
 try{
  const before=await db.chargingSession.findMany({orderBy:{id:'asc'}}),ids=before.map(s=>s.id);proof.historyBefore=hash(before);
  const listener=startStripeListener({key:cfg.STRIPE_SECRET_KEY,url:base+'/payments/stripe/webhook'});children.push(listener.child);const secret=await listener.ready;
  const gie=start(path.join(gieRoot,'.venv/Scripts/python.exe'),['-B','-m','uvicorn','service.api:create_app','--factory','--host','127.0.0.1','--port','8520'],gieRoot,{PYTHONPATH:gieRoot+';'+path.join(gieRoot,'src'),GIE_NORMAL_DEMO:'true'});
  await ready('http://127.0.0.1:8520/health',gie,{Authorization:'Bearer '+cfg.GIE_SERVICE_TOKEN});
  const server=start(process.execPath,['dist/main.js'],root,{PORT:'3117',PAYMENT_PROVIDER:'stripe',GIE_SERVICE_URL:'http://127.0.0.1:8520',STRIPE_WEBHOOK_SECRET:secret,OCPP_GATEWAY_URL:''});await ready(base+'/auth/health',server);
  const admin=(await req('POST','/auth/login',null,{email:cfg.ADMIN_EMAIL,password:cfg.ADMIN_PASSWORD})).accessToken;
  const driver=(await req('POST','/mobile/v1/auth/login',null,{email:cfg.CUSTOMER_EMAIL,password:cfg.CUSTOMER_PASSWORD},null,201)).accessToken;
  const charger=await req('GET','/mobile/v1/chargers/50',driver),qr=await req('GET','/mobile/v1/qr/'+charger.qrToken,driver);
  for(let round=0;round<2;round++){
   const key='DEMO-presentation-'+randomUUID(),body={chargerId:'50',method:'card',spendingLimit:30};
   const intent=await req('POST','/mobile/v1/payment-intents',driver,body,key,201);
   assert.equal((await req('POST','/mobile/v1/payment-intents',driver,body,key,201)).id,intent.id);
   assert.equal(intent.status,'requires_action');
   await req('POST','/mobile/v1/charging-sessions/start',driver,{qrBindingId:qr.qrBindingId,paymentIntentId:intent.id,spendingLimit:30,idempotencyKey:key},key,400);
   const admission=await db.paymentIntent.findUniqueOrThrow({where:{id:BigInt(intent.id)}});
   const held=await stripe.paymentIntents.confirm(admission.providerIntentId,{payment_method:'pm_card_visa'});assert.equal(held.status,'requires_capture');
   const approved=await req('GET','/mobile/v1/payment-intents/'+intent.id,driver);assert.equal(approved.status,'authorized');
   const session=await req('POST','/mobile/v1/charging-sessions/start',driver,{qrBindingId:qr.qrBindingId,paymentIntentId:intent.id,spendingLimit:30,idempotencyKey:key},key,201);
   const route='/mobile/v1/charging-sessions/'+session.id;proof.sessions.push({id:session.id,intent:intent.id});
   let live;
   for(let n=0;n<45;n++){await req('GET','/stations/'+cfg.GIE_STATION_ID+'/gie/state',admin);await sleep(3000);live=await req('GET',route,driver);if(live.totalCost>=.55)break;}
   assert.ok(live.totalCost>=.50,'Real accumulated energy must cover card minimum');
   await req('POST',route+'/stop',driver,{},key+'-stop',201);await req('POST',route+'/disconnect',driver,{},null,201);
   const [a,b]=await Promise.all([req('POST',route+'/payment',driver,{},null,201),req('POST',route+'/payment',driver,{},null,201)]);assert.equal(a.status,'approved');assert.equal(b.status,'approved');
   const row=await db.paymentIntent.findUniqueOrThrow({where:{id:BigInt(intent.id)}});const paid=await stripe.paymentIntents.retrieve(row.providerIntentId);assert.equal(paid.status,'succeeded');assert.equal(paid.id,held.id);assert.ok(paid.amount_received<paid.amount);
   for(let n=0;n<40;n++){const s=await db.chargingSession.findUniqueOrThrow({where:{id:BigInt(session.id)}});if(s.status==='FINISHED')break;await sleep(500);}
   const finished=await req('GET',route,driver);assert.equal(finished.status,'completed');assert.equal(Number(finished.receipt.amountPaid), paid.amount_received/100);
   assert.equal(await db.payment.count({where:{sessionId:BigInt(session.id),status:'APPROVED'}}),1);
   Object.assign(proof.sessions[round],{stripeIntent:paid.id,cents:paid.amount_received,backendFinalized:true,manualAuthorizationBeforeStart:true,receipt:finished.receipt});
   console.log('Consecutive payment '+(round+1)+' approved via webhook');
  }
  assert.equal(new Set(proof.sessions.map(s=>s.stripeIntent)).size,2);
  proof.historyAfter=hash(await db.chargingSession.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}}));assert.equal(proof.historyAfter,proof.historyBefore);proof.passed=true;
 }finally{fs.writeFileSync(report,JSON.stringify(proof,null,2));for(const p of children)if(p.exitCode===null)p.kill();await db.$disconnect();console.log(JSON.stringify({report,passed:proof.passed===true}));}
}
main().catch(e=>{console.error(e.message?.replace(/(?:sk_test_|whsec_|pi_\w+_secret_)[A-Za-z0-9]+/g,'[REDACTED]'));process.exitCode=1;});
