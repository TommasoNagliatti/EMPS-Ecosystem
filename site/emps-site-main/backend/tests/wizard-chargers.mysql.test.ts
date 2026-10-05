import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {PlatformStationsService} from '../src/platform-stations.service';
import {PlatformAccessService} from '../src/platform-access.service';

test('wizard canonical chargers: 0/2, stable QR, edits, isolation and soft removal', {skip:process.env.EMPS_V2_MYSQL_TEST!=='true'},async()=>{
 process.loadEnvFile('.env');const db=new PrismaClient(),rollback=Error('ROLLBACK');
 try{await assert.rejects(db.$transaction(async tx=>{
  const adapter=new Proxy(tx,{get:(t,k)=>k==='$transaction'?async(fn:any)=>fn(adapter):(t as any)[k]}) as any;
  const service=new PlatformStationsService(adapter,new PlatformAccessService(adapter),{} as any);
  const owner=await tx.user.create({data:{name:'Wizard QR test',email:randomUUID()+'@example.invalid',passwordHash:'not-login',role:'CUSTOMER'}});
  const outsider=await tx.user.create({data:{name:'Outsider',email:randomUUID()+'@example.invalid',passwordHash:'not-login',role:'CUSTOMER'}});
  const auth=(u:typeof owner)=>({sub:String(u.id),email:u.email,role:u.role});
  const user=auth(owner),station=await service.create(user),id=String(station.id);
  assert.equal((await service.chargers(user)).length,0);
  const chargers=[1,2].map(n=>({name:'Wizard '+n,ocppIdentity:randomUUID(),connectorType:'TYPE2',powerKw:7.4,pricePerKwh:2,administrativeStatus:'PENDING' as const}));
  const saved=await service.save(user,id,{chargers});
  assert.equal(saved.chargers.length,2);
  assert.deepEqual((await service.chargers(user)).map(c=>c.id),saved.chargers.map(c=>c.id));
  const ids=saved.chargers.map(c=>c.id),tokens=saved.chargers.map(c=>c.qrBindings[0].publicToken);
  assert.equal(new Set(tokens).size,2);
  const edit=chargers.map((c,i)=>({...c,id:ids[i],name:c.name+' edited'}));
  await service.save(user,id,{chargers:edit});await service.save(user,id,{chargers:edit});
  assert.equal(await tx.charger.count({where:{stationId:station.id}}),2);
  for(let i=0;i<2;i++){assert.equal((await service.chargerQr(user,String(ids[i]))).publicToken,tokens[i]);assert.equal(await tx.qrBinding.count({where:{chargerId:ids[i],isActive:true}}),1)}
  assert.equal((await service.chargers(auth(outsider))).length,0);
  await assert.rejects(service.chargerQr(auth(outsider),String(ids[0])),/Sem permissão/);
  await service.save(user,id,{chargers:[edit[0]]});
  assert.equal((await tx.charger.findUniqueOrThrow({where:{id:ids[1]}})).administrativeStatus,'DISABLED');
  assert.equal(await tx.qrBinding.count({where:{chargerId:ids[1],isActive:true}}),0);
  assert.equal(await tx.charger.count({where:{stationId:station.id}}),2);
  throw rollback;
 },{timeout:30000}),e=>e===rollback)}finally{await db.$disconnect()}
});
