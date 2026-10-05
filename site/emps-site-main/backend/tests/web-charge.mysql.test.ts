import {PrepaidBudgetService,prepaidStopDecision} from '../src/prepaid-budget.service';
import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {MobileService} from '../src/mobile.service';
import {PaymentGatewayService} from '../src/payment-gateway.service';
import {ChargingGatewayService} from '../src/charging-gateway.service';
import {PublicWebChargeController} from '../src/web-charge.controller';
import {hashOpaqueToken} from '../src/mobile.utils';

test('Web Charge MySQL: guest isolado, expirável, sem usuário compartilhado; gateways sandbox reais',{skip:process.env.EMPS_V2_MYSQL_TEST!=='true'},async()=>{
 process.loadEnvFile('.env');
 const previous={payment:process.env.PAYMENT_PROVIDER,ocpp:process.env.OCPP_GATEWAY_URL};process.env.PAYMENT_PROVIDER='sandbox';delete process.env.OCPP_GATEWAY_URL;
 const db=new PrismaClient(),rollback=Error('ROLLBACK_WEB_CHARGE');
 try{await assert.rejects(db.$transaction(async tx=>{
  const adapter=new Proxy(tx,{get:(t,k)=>k==='$transaction'?async(fn:any)=>typeof fn==='function'?fn(adapter):Promise.all(fn):(t as any)[k]}) as any;
  const owner=await tx.user.create({data:{name:'Web Charge test',email:randomUUID()+'@example.invalid',passwordHash:'not-a-login-hash',role:'CUSTOMER'}});
  const station=await tx.station.create({data:{adminId:owner.id,name:'Web Charge rollback fixture',postalCode:'01001000',street:'Teste',addressNumber:'1',neighborhood:'Teste',city:'São Paulo',state:'SP',latitude:-23.55,longitude:-46.63,status:'ACTIVE',reviewState:'APPROVED',visibility:'PUBLIC',guestAllowed:true}});
  const charger=await tx.charger.create({data:{stationId:station.id,name:'DEMO',publicCode:randomUUID(),ocppIdentity:randomUUID(),connectorType:'TYPE2',powerKw:7,administrativeStatus:'ENABLED',liveStatus:{create:{operationalStatus:'AVAILABLE',currentPowerKw:0}},tariffs:{create:{stationId:station.id,name:'Web Charge test',basePricePerKwh:2,status:'ACTIVE',validFrom:new Date(Date.now()-60000)}}}});
  const qr=await tx.qrBinding.create({data:{chargerId:charger.id,publicToken:randomUUID(),code:randomUUID().slice(0,16),validFrom:new Date(Date.now()-60000)}});
  const mobile=new MobileService(adapter,{} as any,new PaymentGatewayService(),new ChargingGatewayService(),{publish:()=>{}} as any);
  const controller=new PublicWebChargeController(mobile,adapter),response={setHeader:()=>{}} as any;
  const usersBefore=await tx.user.count();
  const credentials=await controller.guest({qrToken:qr.publicToken!,acceptTerms:true},response);
  const guest=await tx.guestCharge.findUniqueOrThrow({where:{tokenHash:hashOpaqueToken(credentials.token)}});
  assert.equal(await tx.user.count(),usersBefore);assert.notEqual(guest.tokenHash,credentials.token);
  const second=await tx.guestCharge.create({data:{chargerId:charger.id,tokenHash:hashOpaqueToken(randomUUID()),expiresAt:credentials.expiresAt}});
  const subject={guestId:guest.id},other={guestId:second.id};
  const intent=await mobile.createPaymentIntent(subject,{chargerId:String(charger.id),method:'pix',spendingLimit:10},'guest-intent-key');
  assert.equal(intent.status,'authorized');
  assert.equal((await mobile.createPaymentIntent(subject,{chargerId:String(charger.id),method:'pix',spendingLimit:10},'guest-intent-key')).id,intent.id);
  await assert.rejects(mobile.paymentIntent(other,String(intent.id)),/não encontrada/);
  await tx.station.update({where:{id:station.id},data:{visibility:'PRIVATE'}});
  await assert.rejects(controller.guest({qrToken:qr.publicToken!,acceptTerms:true},response),/QR inválido/);
  await assert.rejects(mobile.startCharging(subject,{qrBindingId:String(qr.id),paymentIntentId:String(intent.id),spendingLimit:10},'guest-start-key'),/visitante/);
  await tx.station.update({where:{id:station.id},data:{visibility:'PUBLIC'}});
  const session=await mobile.startCharging(subject,{qrBindingId:String(qr.id),paymentIntentId:String(intent.id),spendingLimit:10},'guest-start-key');
  const stored=await tx.chargingSession.findUniqueOrThrow({where:{id:BigInt(session.id)}});
  assert.equal(stored.clientId,null);assert.equal(stored.guestId,guest.id);assert.equal(stored.sessionOrigin,'ADMIN_SITE');
  assert.equal((await mobile.startCharging(subject,{qrBindingId:String(qr.id),paymentIntentId:String(intent.id),spendingLimit:10},'guest-start-key')).id,session.id);
  await assert.rejects(mobile.session(other,session.id),/não encontrada/);
  await assert.rejects(mobile.stopCharging(other,session.id,'other-stop-key'),/não encontrada/);
  const stopped=await mobile.stopCharging(subject,session.id,'guest-stop-key');assert.equal(stopped.outcome,'finished');assert.equal(stopped.receipt?.sandbox,true);
  assert.equal((await tx.chargerLiveStatus.findUniqueOrThrow({where:{chargerId:charger.id}})).operationalStatus,'AVAILABLE');
  await tx.guestCharge.update({where:{id:guest.id},data:{expiresAt:new Date(Date.now()-1000)}});
  await assert.rejects(mobile.session(subject,session.id),/expirado/);
  // Same shared implementation still accepts the existing mobile identity contract.
  const accountIntent=await mobile.createPaymentIntent(String(owner.id),{chargerId:String(charger.id),method:'card',spendingLimit:20},'account-intent-key');
  const accountSession=await mobile.startCharging(String(owner.id),{qrBindingId:String(qr.id),paymentIntentId:String(accountIntent.id),spendingLimit:20},'account-start-key');
  assert.equal((await tx.chargingSession.findUniqueOrThrow({where:{id:BigInt(accountSession.id)}})).sessionOrigin,'MOBILE_APP');
  assert.equal(prepaidStopDecision(await tx.chargingSession.findUniqueOrThrow({where:{id:BigInt(accountSession.id)},include:(await import('../src/persistence')).sessionInclude})).stop,false);
  await tx.chargingSession.update({where:{id:BigInt(accountSession.id)},data:{startTime:new Date(Date.now()-2*3600000)}});
  const previousScope=process.env.CHARGE_RUNTIME_STATION_IDS;process.env.CHARGE_RUNTIME_STATION_IDS=String(station.id);
  try{await new PrepaidBudgetService(adapter,mobile).tick()}finally{if(previousScope===undefined)delete process.env.CHARGE_RUNTIME_STATION_IDS;else process.env.CHARGE_RUNTIME_STATION_IDS=previousScope}
  const stoppedByBudget=await tx.chargingSession.findUniqueOrThrow({where:{id:BigInt(accountSession.id)}});
  assert.equal(stoppedByBudget.status,'FINISHED');assert.equal(Number(stoppedByBudget.totalPrice),20);
  const budgetCommand=await tx.chargingCommand.findFirstOrThrow({where:{sessionId:stoppedByBudget.id,type:'STOP_CHARGING'}});
  assert.equal((budgetCommand.requestPayload as any).source,'SERVER_BUDGET_MONITOR');
  const reservation=await tx.chargerReservation.create({data:{stationId:station.id,chargerId:charger.id,userId:owner.id,startAt:new Date(Date.now()-60000),endAt:new Date(Date.now()+600000),status:'CONFIRMED',fee:0,policySnapshot:{test:true},idempotencyKey:randomUUID()}});
  await assert.rejects(mobile.createPaymentIntent(other,{chargerId:String(charger.id),method:'card',spendingLimit:10},'reserved-guest-key'),/reservado/);
  assert.equal((await mobile.resolveQr(qr.publicToken!)).reservation?.canUse,false);
  assert.equal((await mobile.resolveQr(qr.publicToken!,String(owner.id))).reservation?.canUse,true);
  throw rollback;
 },{timeout:60000}),e=>e===rollback)}finally{await db.$disconnect();if(previous.payment===undefined)delete process.env.PAYMENT_PROVIDER;else process.env.PAYMENT_PROVIDER=previous.payment;if(previous.ocpp===undefined)delete process.env.OCPP_GATEWAY_URL;else process.env.OCPP_GATEWAY_URL=previous.ocpp;}
});
