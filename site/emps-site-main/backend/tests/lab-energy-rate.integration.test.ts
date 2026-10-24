import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Module, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LabMaqueteDeviceController } from '../src/lab-maquete.controller';
import { LabMaqueteService } from '../src/lab-maquete.service';

let reports=0;
const token='unit-test-device-token-not-a-real-credential';
Reflect.defineMetadata('design:paramtypes',[LabMaqueteService],LabMaqueteDeviceController);
@Module({imports:[ThrottlerModule.forRoot([{ttl:60000,limit:120}])],controllers:[LabMaqueteDeviceController],
 providers:[{provide:LabMaqueteService,useValue:{
  authenticate:async(id:string,supplied:string)=>{if(id!=='maquete-01'||supplied!==token)throw new UnauthorizedException();return {};},
  energyReport:async()=>{reports++;return {accepted:true};},
 }},{provide:APP_GUARD,useClass:ThrottlerGuard}]})
class TestModule{}

test('real HTTP guard sustains frame sent/ACK/heartbeat traffic, authenticates and still bounds abuse',async()=>{
 const app=await NestFactory.create(TestModule,{logger:false});
 try {
  await app.listen(0,'127.0.0.1');
  const port=(app.getHttpServer().address() as any).port;
  const url=`http://127.0.0.1:${port}/devices/maquete-01/energy/report`;
  const post=(valid=true)=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...(valid?{'x-device-token':token}:{})},body:'{}'});
  assert.equal((await post(false)).status,401);
  for(let i=0;i<180;i++)assert.equal((await post()).status,200,`normal report ${i} must not be throttled`);
  assert.equal(reports,180);
  for(let i=0;i<119;i++)assert.equal((await post()).status,200);
  assert.equal((await post()).status,429,'finite device quota must remain enforced');
  assert.equal(reports,299);
 } finally {await app.close();}
});
