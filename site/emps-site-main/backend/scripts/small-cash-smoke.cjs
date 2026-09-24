// Explicit DEMO-only test against a running local backend/GIE; retains its session.
const fs=require('fs'),{parse}=require('dotenv'),assert=require('assert/strict'),{randomUUID}=require('crypto');
require('dotenv').config({quiet:true});const {PrismaClient}=require('@prisma/client'),db=new PrismaClient();
(async()=>{
 if(!process.argv.includes('--apply')||!process.env.EMPS_PRIVATE_CONFIG)throw Error('Use --apply and EMPS_PRIVATE_CONFIG after backup');
 const cfg=parse(fs.readFileSync(process.env.EMPS_PRIVATE_CONFIG)),proof={};
 const req=async(method,path,token,body,key,status=200)=>{const r=await fetch('http://localhost:3118'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});assert.equal(r.status,status,path);return r.json();};
 const a=(await req('POST','/auth/login',null,{email:cfg.ADMIN_EMAIL,password:cfg.ADMIN_PASSWORD})).accessToken,d=(await req('POST','/mobile/v1/auth/login',null,{email:cfg.CUSTOMER_EMAIL,password:cfg.CUSTOMER_PASSWORD},null,201)).accessToken;
 if(process.env.ZERO_DEMO_SESSION){const zero=await req('GET','/mobile/v1/charging-sessions/'+process.env.ZERO_DEMO_SESSION,d);assert.equal(zero.totalCost,0);await req('POST','/mobile/v1/charging-sessions/'+zero.id+'/payment',d,{},null,201);proof.zeroSession=zero.id;}
 const c=await req('GET','/mobile/v1/chargers/50',d),qr=await req('GET','/mobile/v1/qr/'+c.qrToken,d),key='DEMO-small-cash-'+randomUUID();
 const intent=await req('POST','/mobile/v1/payment-intents',d,{chargerId:'50',method:'card',spendingLimit:30},key,201);
 const s=await req('POST','/mobile/v1/charging-sessions/start',d,{qrBindingId:qr.qrBindingId,paymentIntentId:intent.id,spendingLimit:30,idempotencyKey:key},key,201),route='/mobile/v1/charging-sessions/'+s.id;
 await req('GET','/stations/'+cfg.GIE_STATION_ID+'/gie/state',a);await new Promise(r=>setTimeout(r,6000));await req('GET',route,d);
 await req('POST',route+'/stop',d,{},key+'-stop',201);const frozen=await req('POST',route+'/disconnect',d,{},null,201),amount=Number(frozen.breakdown.customer.total_amount);assert.ok(amount>0&&amount<.5);
 await req('POST',route+'/payment',d,{},null,400);
 const body={energiaConsumidaKwh:Number(frozen.breakdown.customer.energy_kwh),valorCobrado:amount,valorRecebido:amount,origem:'caixa'};
 await req('POST','/charging-sessions/'+s.id+'/settle-cash',d,body,null,403);
 await Promise.all([req('POST','/charging-sessions/'+s.id+'/settle-cash',a,body,null,201),req('POST','/charging-sessions/'+s.id+'/settle-cash',a,body,null,201)]);
 assert.equal(await db.payment.count({where:{sessionId:BigInt(s.id)}}),1);proof.smallCash={id:s.id,amount,onePayment:true};
 const exact=await req('GET','/charging-sessions?q=65',a);assert.equal(exact.length,1);assert.equal(exact[0].id,'65');proof.exactId=true;
 const payments=await req('GET','/payments',a),dash=await req('GET','/dashboard/summary',a),today=new Date();today.setHours(0,0,0,0);
 const sum=payments.filter(p=>p.status==='APPROVED'&&new Date(p.paidAt??p.createdAt)>=today).reduce((sum,p)=>sum+Number(p.amount),0);assert.ok(Math.abs(sum-dash.revenueToday)<.00001);proof.dashboardEqualsPayments=true;
 proof.legacy64Preserved=!!await db.chargingSession.findUnique({where:{id:64n}});proof.station11Preserved=!!await db.station.findUnique({where:{id:11}});
 fs.writeFileSync('reports/presentation-2026-09-22/final-http.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
