import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../site/emps-site-main/backend/package.json',import.meta.url));
const env=Object.fromEntries(readFileSync(new URL('../../EMPS_BACKUPS/emps-legacy-integration.mysql.env',import.meta.url),'utf8').split(/\r?\n/).filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const {PrismaClient}=require('@prisma/client');const db=new PrismaClient({datasources:{db:{url:'mysql://'+env.MYSQL_USER+':'+encodeURIComponent(env.MYSQL_PASSWORD)+'@127.0.0.1:3308/emps_integration_test'}}});
const base='http://127.0.0.1:3011/web-charge';
async function call(path,body,guest,key,expected=body?201:200){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(guest?{'X-Guest-Token':guest}:{}),...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});const v=await r.json();assert.equal(r.status,expected,`${path}: ${r.status} ${v.message??''}`);return v;}
const counts=async()=>({users:await db.user.count(),sessions:await db.chargingSession.count(),payments:await db.payment.count(),intents:await db.paymentIntent.count()});
try{const before=await counts();const evidence=[];
for(const chargerId of [49,50,51]){assert.equal(await db.labChargeSession.count({where:{chargerId,status:'CHARGING'}}),0,'User session active; abort');const qr=await db.qrBinding.findFirstOrThrow({where:{chargerId,isActive:true,revokedAt:null},orderBy:{id:'desc'}});const r=await call('/qr/'+qr.publicToken);assert.equal(r.guestAllowed,true);assert.equal(r.mode,'SANDBOX');
const guest=await call('/guest',{qrToken:qr.publicToken,acceptTerms:true});const other=await call('/guest',{qrToken:qr.publicToken,acceptTerms:true});const key=randomUUID();const intent=await call('/payment-intents',{chargerId:String(chargerId),method:'pix',spendingLimit:20},guest.token,key);assert.equal((await call('/payment-intents',{chargerId:String(chargerId),method:'pix',spendingLimit:20},guest.token,key)).id,intent.id);
let session;try{session=await call('/sessions/start',{qrBindingId:String(qr.id),paymentIntentId:intent.id,spendingLimit:20},guest.token,randomUUID());assert.equal(String(session.stationId),'13');assert.equal(session.status,'charging');await call('/sessions/'+session.id,undefined,other.token,undefined,404);assert.equal((await call('/sessions/active',undefined,guest.token)).id,session.id);await new Promise(r=>setTimeout(r,1000));}catch(e){console.error('FLOW FAILURE: '+e.message);throw e;}finally{if(session){const stopped=await call('/sessions/'+session.id+'/stop',{},guest.token,randomUUID());assert.equal(stopped.status,'completed');assert.ok(stopped.receipt.sandbox);evidence.push({chargerId,sessionId:stopped.id,energy:stopped.energyKwh,receipt:!!stopped.receipt});}}
}
assert.deepEqual(await counts(),before);console.log(JSON.stringify({result:'PASS',evidence,unchanged:before}));
}finally{await db.$disconnect()}
