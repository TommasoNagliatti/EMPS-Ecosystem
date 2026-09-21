import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const json=(v:unknown)=>JSON.stringify(v,(_,v)=>typeof v==='bigint'?String(v):v,2);
const qa=(u:{name:string,email:string})=>u.name.startsWith('QA ') && /^(?:(?:operator|other|driver|second)-)?mysql-qa-\d+@emps\.invalid$|^walkin-[a-f0-9-]+@emps\.invalid$|^qa-ui-qr-\d+@emps\.invalid$/.test(u.email);

export async function planQaCleanup(db:PrismaClient,label?:string){
  const users=await db.user.findMany({select:{id:true,name:true,email:true}});
  const candidateUsers=new Set(users.filter(qa).map(u=>u.id));
  const stations=await db.station.findMany({include:{chargers:{include:{sessions:true,commands:true}},staff:true}});
  const selected=stations.filter(s=>/^QA MySQL mysql-qa-\d+$/.test(s.name) && (!label || s.name===`QA MySQL ${label}`)
    && candidateUsers.has(s.adminId) && s.staff.every(m=>candidateUsers.has(m.userId))
    && s.chargers.every(c=>c.name.startsWith('QA ') && c.sessions.every(x=>(!x.clientId||candidateUsers.has(x.clientId))&&(!x.startedByUserId||candidateUsers.has(x.startedByUserId)))
      && c.commands.every(x=>!x.clientId||candidateUsers.has(x.clientId))));
  const stationIds=selected.map(s=>s.id),chargerIds=selected.flatMap(s=>s.chargers.map(c=>c.id));
  const retained=stations.filter(s=>!stationIds.includes(s.id));
  const keep=new Set(retained.flatMap(s=>[s.adminId,...s.staff.map(m=>m.userId),...s.chargers.flatMap(c=>[...c.sessions.flatMap(x=>[x.clientId,x.startedByUserId]),...c.commands.map(x=>x.clientId)])]));
  const usersToDelete=users.filter(u=>candidateUsers.has(u.id)&&!keep.has(u.id)&&(!label||u.email.includes(label)||selected.some(s=>s.chargers.some(c=>c.sessions.some(x=>x.clientId===u.id))))).map(u=>u.id);
  const ids:Record<string,Array<number|bigint>>={};
  const capture=async(model:string,where:object)=>{ids[model]=(await (db as any)[model].findMany({where,select:{id:true}})).map((x:any)=>x.id);};
  await capture('chargingSession',{chargerId:{in:chargerIds}});
  await capture('paymentIntent',{chargerId:{in:chargerIds}});
  await capture('payment',{sessionId:{in:ids.chargingSession}});
  await capture('chargingCommand',{chargerId:{in:chargerIds}});
  await capture('chargerReading',{chargerId:{in:chargerIds}});
  await capture('alert',{OR:[{stationId:{in:stationIds}},{chargerId:{in:chargerIds}}]});
  await capture('qrBinding',{chargerId:{in:chargerIds}});
  await capture('tariff',{stationId:{in:stationIds}});
  for(const m of ['gieEvseMapping','gieIntervalSnapshot','gieCycle','stationEnergyReading']) await capture(m,{stationId:{in:stationIds}});
  await capture('refreshToken',{userId:{in:usersToDelete}});
  await capture('userVehicle',{userId:{in:usersToDelete}});
  const composite = {stationStaff: await db.stationStaff.findMany({where:{stationId:{in:stationIds}},select:{stationId:true,userId:true}}),stationAmenity:await db.stationAmenity.findMany({where:{stationId:{in:stationIds}},select:{stationId:true,amenityName:true}})};
  ids.charger=chargerIds;ids.station=stationIds;ids.user=usersToDelete;
  return {ids,composite,stationLabels:selected.map(s=>({id:s.id,name:s.name})),preservedStations:retained.map(s=>({id:s.id,name:s.name,reason:'Não é fixture pura; pode conter cadastro/uso manual'})),preservedUserIds:users.filter(u=>!usersToDelete.includes(u.id)).map(u=>u.id)};
}
export async function cleanupQa(db:PrismaClient,label?:string,apply=false){
  if(process.env.NODE_ENV==='production')throw new Error('Limpeza exclusiva de desenvolvimento');
  const plan=await planQaCleanup(db,label);mkdirSync('reports',{recursive:true});
  const report=`reports/qa-cleanup-${Date.now()}.json`;writeFileSync(report,json({phase:'planned',...plan}));
  console.log(json({report,plannedCounts:Object.fromEntries(Object.entries(plan.ids).map(([k,v])=>[k,v.length])),preservedStations:plan.preservedStations}));
  if(!apply)return plan;
  const fingerprint=createHash('sha256').update(json(plan)).digest('hex');
  await db.$transaction(async tx=>{
    const current=await planQaCleanup(tx as PrismaClient,label);
    if(createHash('sha256').update(json(current)).digest('hex')!==fingerprint)throw new Error('Dados mudaram após planejamento; nenhuma exclusão executada');
    // Each deletion has an exact ID list. FK constraints remain enabled throughout.
    for(const m of ['payment','chargingCommand','chargerReading','alert','chargingSession','paymentIntent','qrBinding','tariff','gieEvseMapping','gieIntervalSnapshot','gieCycle','stationEnergyReading']) {
      if(plan.ids[m].length)await (tx as any)[m].deleteMany({where:{id:{in:plan.ids[m]}}});
    }
    for(const [model,keys] of Object.entries(plan.composite)) if(keys.length) await (tx as any)[model].deleteMany({where:{OR:keys}});
    if(plan.ids.charger.length)await tx.chargerLiveStatus.deleteMany({where:{chargerId:{in:plan.ids.charger as number[]}}});
    for(const m of ['charger','station','refreshToken','userVehicle','user'])if(plan.ids[m].length)await (tx as any)[m].deleteMany({where:{id:{in:plan.ids[m]}}});
  },{timeout:30000,isolationLevel:'Serializable'});
  writeFileSync(report,json({phase:'applied',...plan}));return plan;
}
if(process.argv[1]?.replace(/\\/g,'/').endsWith('/qa-cleanup.ts')){
 const db=new PrismaClient();cleanupQa(db,process.env.QA_LABEL,process.argv.includes('--apply')).finally(()=>db.$disconnect());
}
