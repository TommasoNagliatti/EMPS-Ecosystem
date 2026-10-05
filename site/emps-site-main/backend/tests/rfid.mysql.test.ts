import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {RfidService,rfidHash} from '../src/rfid.service';
import {PlatformAccessService} from '../src/platform-access.service';
import {AdminOperationsService} from '../src/admin-operations.service';
import {ChargingGatewayService} from '../src/charging-gateway.service';

test('RFID MySQL: autorização por estação, revogação, Demo e rateio sem pagamento',{skip:process.env.EMPS_V2_MYSQL_TEST!=='true'},async()=>{
 process.loadEnvFile('.env');
 const prior={scope:process.env.CHARGE_RUNTIME_STATION_IDS,gateway:process.env.OCPP_GATEWAY_URL};delete process.env.OCPP_GATEWAY_URL;
 const db=new PrismaClient(),rollback=Error('ROLLBACK_RFID');
 try{await assert.rejects(db.$transaction(async tx=>{
  const adapter=new Proxy(tx,{get:(t,k)=>k==='$transaction'?async(fn:any)=>typeof fn==='function'?fn(adapter):Promise.all(fn):(t as any)[k]}) as any;
  const owner=await tx.user.create({data:{name:'RFID owner',email:randomUUID()+'@example.invalid',passwordHash:'not-a-login-hash'}});
  const outsider=await tx.user.create({data:{name:'RFID outsider',email:randomUUID()+'@example.invalid',passwordHash:'not-a-login-hash'}});
  const createStation=()=>tx.station.create({data:{adminId:owner.id,name:'RFID rollback',postalCode:'01001000',street:'Teste',addressNumber:'1',neighborhood:'Teste',city:'São Paulo',state:'SP',status:'ACTIVE',reviewState:'APPROVED',visibility:'PRIVATE',availability:{alwaysOpen:true,windows:[]}}});
  const station=await createStation(),other=await createStation();process.env.CHARGE_RUNTIME_STATION_IDS=String(station.id);
  const charger=await tx.charger.create({data:{stationId:station.id,name:'RFID DEMO',publicCode:randomUUID(),ocppIdentity:randomUUID(),connectorType:'TYPE2',powerKw:7,administrativeStatus:'ENABLED',liveStatus:{create:{operationalStatus:'AVAILABLE',currentPowerKw:0}},tariffs:{create:{stationId:station.id,name:'RFID tariff',basePricePerKwh:2,status:'ACTIVE',validFrom:new Date(Date.now()-60000)}}}});
  await tx.chargingCommand.create({data:{chargerId:charger.id,type:'RUN_CHECKLIST',status:'ACCEPTED',requestPayload:{kind:'platform-v2-demo',provenance:'SIMULATED'}}});
  const operations=new AdminOperationsService(adapter,new ChargingGatewayService(),{publish:()=>{}} as any,{} as any);
  const rfid=new RfidService(adapter,new PlatformAccessService(adapter),operations),user={sub:String(owner.id),email:owner.email,role:owner.role},uid='AABBCCDDEEFF',sid=String(station.id),cid=String(charger.id);
  const c=await rfid.create(user,sid,{uid,label:'Unidade 10',unitReference:'10',userId:owner.id});
  assert.equal('uidHash' in c,false);assert.notEqual(rfidHash(station.id,uid),rfidHash(other.id,uid));
  assert.equal((await rfid.authorize(user,sid,'aa:bb:cc:dd:ee:ff')).authorized,true);
  await assert.rejects(rfid.authorize(user,String(other.id),uid),/não autorizada/);
  await assert.rejects(rfid.authorize(user,sid,'11223344'),/não autorizada/);
  await assert.rejects(rfid.list({...user,sub:String(outsider.id)},sid),/Sem permissão/);
  const payments=await tx.payment.count();
  const started=await rfid.startDemo(user,sid,cid,uid);
  await tx.chargingSession.update({where:{id:BigInt(started.sessionId)},data:{startTime:new Date(Date.now()-600000)}});
  await rfid.stopDemo(user,sid,cid);
  const session=await tx.chargingSession.findUniqueOrThrow({where:{id:BigInt(started.sessionId)}});
  assert.equal(session.status,'FINISHED');assert.equal(session.rfidCredentialId,c.id);assert.equal(session.unitReference,'10');assert.equal(session.paymentIntentId,null);assert.equal(await tx.payment.count(),payments);
  const month=new Intl.DateTimeFormat('en-CA',{timeZone:station.timezone,year:'numeric',month:'2-digit'}).format(session.endTime!);
  const report=await rfid.monthly(user,sid,month);assert.equal(report.sessions.length,1);assert.equal(report.groups[0].sessions,1);assert.equal(report.paymentCollected,false);assert.ok(report.groups[0].referenceAmount.gt(0));
  await rfid.revoke(user,sid,c.id);await assert.rejects(rfid.startDemo(user,sid,cid,uid),/não autorizada/);
  assert.equal((await tx.chargerLiveStatus.findUniqueOrThrow({where:{chargerId:charger.id}})).operationalStatus,'AVAILABLE');
  assert.equal((await rfid.monthly(user,sid,month)).sessions.length,1);
  const expiring=await rfid.create(user,sid,{uid:'12345678',label:'Expired'});await tx.rfidCredential.update({where:{id:expiring.id},data:{expiresAt:new Date(Date.now()-1000)}});await assert.rejects(rfid.authorize(user,sid,'12345678'),/não autorizada/);
  throw rollback;
 },{timeout:60000}),e=>e===rollback)}finally{await db.$disconnect();if(prior.scope===undefined)delete process.env.CHARGE_RUNTIME_STATION_IDS;else process.env.CHARGE_RUNTIME_STATION_IDS=prior.scope;if(prior.gateway===undefined)delete process.env.OCPP_GATEWAY_URL;else process.env.OCPP_GATEWAY_URL=prior.gateway}
});
