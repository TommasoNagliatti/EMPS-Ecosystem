import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../src/auth';
import { UsersController } from '../src/users.controller';
import { OperationsController } from '../src/operations.controller';
import { stationScope } from '../src/persistence';
import { aggregateStorage, isWithinAvailability } from '../src/platform-domain';
import { PlatformAccessService } from '../src/platform-access.service';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MobileRegisterDto } from '../src/mobile.dtos';

const context=(request:any,handler:any,controller:any)=>({getHandler:()=>handler,getClass:()=>controller,switchToHttp:()=>({getRequest:()=>request})}) as any;
test('papel global CUSTOMER não recebe administração global ao criar estação',async()=>{
 const guard=new RolesGuard(new Reflector(),{} as any);
 await assert.rejects(guard.canActivate(context({user:{sub:'1',role:'CUSTOMER'},method:'POST'},UsersController.prototype.createAdmin,UsersController)),ForbiddenException);
});
test('guard de escrita exige associação e distingue gerência de operação',async()=>{
 const scopes:any[]=[];const guard=new RolesGuard(new Reflector(),{station:{findFirst:async({where}:any)=>{scopes.push(where);return null}}} as any);
 const req:any={user:{sub:'4',role:'ADMIN',selectedStationId:20},method:'PATCH'};
 await assert.rejects(guard.canActivate(context(req,OperationsController.prototype.updateCharger,OperationsController)),ForbiddenException);
 assert.equal(scopes[0].id,20);assert.deepEqual(scopes[0].OR[1].staff.some.staffRole.in,['OWNER','MANAGER']);
 await assert.rejects(guard.canActivate(context(req,OperationsController.prototype.command,OperationsController)),ForbiddenException);
 assert.deepEqual(scopes[1].OR[1].staff.some.staffRole.in,['OWNER','MANAGER','OPERATOR','COLLECTOR']);
});
test('proprietário, membros e capacidades são verificados no banco, não por role global',async()=>{
 let station:any={id:10,adminId:1,staff:[]};const access=new PlatformAccessService({station:{findUnique:async()=>station},user:{findUnique:async()=>({platformReviewer:false,presentationTools:false})}} as any);
 await access.require({sub:'1'},10,'OWNER');
 await assert.rejects(access.require({sub:'2'},10),ForbiddenException);
 station={...station,staff:[{staffRole:'VIEWER'}]};await access.require({sub:'2'},10,'READ');
 await assert.rejects(access.require({sub:'2'},10,'OPERATE'),ForbiddenException);
 station={...station,staff:[{staffRole:'MANAGER'}]};await access.require({sub:'2'},10,'MANAGE');await assert.rejects(access.require({sub:'2'},10,'OWNER'),ForbiddenException);
 await assert.rejects(access.reviewer({sub:'1'}),ForbiddenException);await assert.rejects(access.presentation({sub:'1'}),ForbiddenException);
 assert.deepEqual(stationScope({sub:'1',role:'ADMIN'}),stationScope({sub:'1',role:'CUSTOMER'}));
});
test('cadastro exige confirmação e aceite de termos',async()=>{
 const base={name:'Pessoa Teste',email:'teste@example.invalid',password:'Password-123'};
 assert.ok((await validate(plainToInstance(MobileRegisterDto,base))).length>=2);
 assert.equal((await validate(plainToInstance(MobileRegisterDto,{...base,passwordConfirmation:base.password,acceptTerms:true}))).length,0);
});
test('SOC agregado é ponderado e não inventa leituras ausentes',()=>{
 assert.equal(aggregateStorage([{capacityKwh:10,socPercent:10},{capacityKwh:90,socPercent:90}]).socPercent,82);
 assert.equal(aggregateStorage([{capacityKwh:10,socPercent:null}]).socPercent,null);
 assert.equal(aggregateStorage([{capacityKwh:10,socPercent:50,status:'INACTIVE'}]).capacityKwh,0);
});
test('horário cruza meia-noite e recusa intervalo parcialmente fora da janela',()=>{
 const config={alwaysOpen:false,windows:[{day:1,start:'19:00',end:'07:00'}]};
 assert.equal(isWithinAvailability(config,'America/Sao_Paulo',new Date('2026-09-28T22:00Z'),new Date('2026-09-29T10:00Z')),true);
 assert.equal(isWithinAvailability(config,'America/Sao_Paulo',new Date('2026-09-29T09:59Z'),new Date('2026-09-29T10:01Z')),false);
});
