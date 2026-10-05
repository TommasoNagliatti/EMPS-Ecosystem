import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {MobileService} from '../src/mobile.service';

test('Web Charge resumes unpaid session only for its owner, preserving mobile active semantics',{skip:process.env.EMPS_V2_MYSQL_TEST!=='true'},async()=>{
 process.loadEnvFile('.env');const db=new PrismaClient(),rollback=Error('ROLLBACK_RECOVERY');
 try{await assert.rejects(db.$transaction(async tx=>{
  const owner=await tx.user.create({data:{name:'Recovery test',email:randomUUID()+'@example.invalid',passwordHash:'not-login',role:'CUSTOMER'}});
  const other=await tx.user.create({data:{name:'Other',email:randomUUID()+'@example.invalid',passwordHash:'not-login',role:'CUSTOMER'}});
  const station=await tx.station.create({data:{adminId:owner.id,name:'Recovery fixture',postalCode:'01001000',street:'Test',addressNumber:'1',neighborhood:'Test',city:'São Paulo',state:'SP'}});
  const charger=await tx.charger.create({data:{stationId:station.id,name:'Recovery',publicCode:randomUUID(),ocppIdentity:randomUUID(),connectorType:'TYPE2',powerKw:7}});
  const tariff=await tx.tariff.create({data:{stationId:station.id,chargerId:charger.id,name:'Test',basePricePerKwh:2,validFrom:new Date()}});
  const session=await tx.chargingSession.create({data:{code:randomUUID(),chargerId:charger.id,tariffId:tariff.id,clientId:owner.id,sessionOrigin:'MOBILE_APP',status:'WAITING_PAYMENT',startTime:new Date(),endTime:new Date(),basePricePerKwhSnapshot:2,pricePerKwhSnapshot:2,totalPrice:1}});
  const mobile=new MobileService(tx as any,{} as any,{} as any,{} as any,{} as any);
  assert.equal(await mobile.activeSession(String(owner.id)),null);
  assert.equal((await mobile.activeSession(String(owner.id),true))?.id,String(session.id));
  assert.equal(await mobile.activeSession(String(other.id),true),null);
  await tx.chargingSession.update({where:{id:session.id},data:{status:'FINISHED'}});
  assert.equal(await mobile.activeSession(String(owner.id),true),null);
  throw rollback;
 },{timeout:30000}),e=>e===rollback)}finally{await db.$disconnect()}
});
