import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as bcrypt from 'bcrypt';
import {UsersController} from '../src/users.controller';
import {OperationsController} from '../src/operations.controller';
import {Role} from '@prisma/client';
import {AdminOperationsService} from '../src/admin-operations.service';
import {calculateSession,TARIFF_VERSION} from '../src/tariff-engine';

test('cadastro ADMIN mantém restrição de role e grava hash, nunca senha',async()=>{
 assert.deepEqual(Reflect.getMetadata('emps:roles',UsersController.prototype.createAdmin),[Role.ADMIN]);
 let written:any;
 const c=new UsersController({user:{create:async(input:any)=>{written=input;return {id:99};}}} as any);
 await c.createAdmin({name:' Demo ',email:'DEMO@example.invalid',password:'Temporary-test-123!'});
 assert.equal(written.data.role,'ADMIN');assert.equal(written.data.accountStatus,'ACTIVE');assert.equal(written.data.email,'demo@example.invalid');
 assert.ok(await bcrypt.compare('Temporary-test-123!',written.data.passwordHash));assert.ok(!('password' in written.data));assert.ok(!('passwordHash' in written.select));
 await assert.rejects(c.createAdmin({name:'Demo',email:'a@b.invalid',password:'é'.repeat(40)}),/72 bytes/);
});
test('busca numérica consulta ID exato no banco e preserva escopo da estação',async()=>{
 let query:any;
 const c=new OperationsController({chargingSession:{findMany:async(q:any)=>{query=q;return [];}}} as any,{} as any,{} as any);
 await c.sessions({user:{sub:'2',role:Role.ADMIN}} as any,undefined,'9007199254740993');
 assert.deepEqual(query.where.OR,[{id:9007199254740993n}]);assert.deepEqual(query.where.charger.station.OR,[{adminId:2},{staff:{some:{userId:2,staffRole:{in:['OWNER','MANAGER','OPERATOR','COLLECTOR','VIEWER']}}}}]);
});
test('caixa de valor mínimo preserva snapshot e não libera carregador ocupado por outra sessão',async()=>{
 const breakdown=calculateSession('1',[],'2026-09-22T12:00:00Z','2026-09-22T12:16:00Z');
 const row:any={id:1n,chargerId:50,clientId:2,status:'WAITING_PAYMENT',disconnectedAt:new Date(),tariffVersion:TARIFF_VERSION,billingSnapshot:{tariff_version:TARIFF_VERSION,phase:'frozen',breakdown},paymentIntentId:1n,paymentIntent:{providerIntentId:'deferred_1'},payments:[],energyKwh:0};
 let payment:any,count=0;
 const db:any={chargingSession:{findUnique:async()=>row,findUniqueOrThrow:async()=>row,update:async({data}:any)=>{Object.assign(row,data);return row;}},payment:{create:async({data}:any)=>{payment=data;count++;},findUniqueOrThrow:async()=>payment},$queryRaw:async()=>[]};db.$transaction=async(fn:any)=>fn(db);
 const service:any=Object.create(AdminOperationsService.prototype);service.prisma=db;service.realtime={publish:()=>{}};
 const dto:any={energiaConsumidaKwh:0,valorCobrado:.25,valorRecebido:.25,origem:'caixa'};
 await assert.rejects(service.settleCash('1',{...dto,valorCobrado:.24}),/valor/);
 await service.settleCash('1',dto);await service.settleCash('1',dto);assert.equal(count,1);assert.equal(row.status,'FINISHED');assert.equal(payment.method,'CASH');assert.equal(row.billingSnapshot.breakdown,breakdown);
 row.status='WAITING_PAYMENT';row.paymentIntent.providerIntentId='pi_existing';await assert.rejects(service.settleCash('1',dto),/Stripe/);
});
