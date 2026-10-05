import assert from 'node:assert/strict';
import test from 'node:test';
import { Global, Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { NestFactory } from '@nestjs/core';
import { io, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { RealtimeModule } from '../src/realtime.module';
import { RealtimeService } from '../src/realtime.service';
import { PrismaService } from '../src/prisma.service';

let members=[1,2];let publicStation=false;
const db={
 user:{findUnique:async({where}:any)=>where.id===9?{accountStatus:'BLOCKED',role:'CUSTOMER'}:{accountStatus:'ACTIVE',role:'CUSTOMER'},findFirst:async({where}:any)=>({id:where.id}),findMany:async()=>members.map(id=>({id}))},
 station:{findFirst:async()=>publicStation?{id:10}:null},
 charger:{findUnique:async()=>({stationId:10})},
 chargingSession:{findUnique:async()=>({charger:{stationId:10}})},
};
@Global() @Module({providers:[{provide:PrismaService,useValue:db}],exports:[PrismaService]}) class TestDatabase{}
@Module({imports:[TestDatabase,JwtModule.register({global:true,secret:'realtime-test-secret',signOptions:{expiresIn:'5m'}}),RealtimeModule]}) class TestModule{}
function connect(url:string,token:string):Promise<Socket>{
 const socket=io(url,{auth:{token},forceNew:true,reconnection:false,transports:['websocket']});
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.disconnect();reject(Error('Realtime timeout'))},2000);socket.once('emps:ready',()=>{clearTimeout(timer);resolve(socket)});socket.once('connect_error',e=>{clearTimeout(timer);socket.disconnect();reject(e)})});
}
const settle=()=>new Promise(r=>setTimeout(r,90));
test('realtime isola estações e remove acesso imediatamente após revogação',async()=>{
 const app=await NestFactory.create(TestModule,{logger:false});const sockets:Socket[]=[];
 try{
  await app.listen(0,'127.0.0.1');const url=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/realtime`;
  const jwt=app.get(JwtService),service=app.get(RealtimeService);
  await assert.rejects(connect(url,'invalid'),/Não autorizado/);
  await assert.rejects(connect(url,await jwt.signAsync({sub:'9',role:'CUSTOMER'})),/Não autorizado/);
  for(const id of [1,2,3,4])sockets.push(await connect(url,await jwt.signAsync({sub:String(id),role:'CUSTOMER'})));
  const events:any[][]=sockets.map(()=>[]);sockets.forEach((s,i)=>s.on('emps:change',e=>events[i].push(e)));
  service.publish({topic:'session.updated',entityId:100,stationId:10,customerId:4});await service.flush();await settle();
  assert.equal(events[0].length,1);assert.equal(events[1].length,1);assert.equal(events[2].length,0);assert.equal(events[3].length,1);
  members=[1];service.publish({topic:'session.updated',entityId:101,stationId:10});await service.flush();await settle();
  assert.equal(events[0].length,2);assert.equal(events[1].length,1);assert.equal(events[2].length,0);assert.equal(events[3].length,1);
  service.publish({topic:'charger.updated',entityId:20});await service.flush();await settle();assert.equal(events[2].length,0);
  publicStation=true;service.publish({topic:'charger.updated',entityId:20});await service.flush();await settle();
  assert.equal(events[2].length,1);assert.equal(events[2][0].customerId,undefined);
  const expiring=await connect(url,await jwt.signAsync({sub:'5',role:'CUSTOMER'},{expiresIn:'1s'}));sockets.push(expiring);
  await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>reject(Error('JWT expiry did not disconnect')),2100);expiring.once('disconnect',()=>{clearTimeout(t);resolve()})});
 }finally{sockets.forEach(s=>s.disconnect());await app.close();members=[1,2];publicStation=false;}
});
