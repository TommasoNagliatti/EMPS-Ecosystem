import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {createHmac} from 'node:crypto';
import {PrismaService} from './prisma.service';
import {PlatformAccessService} from './platform-access.service';
import {AdminOperationsService} from './admin-operations.service';
import {AuthUser} from './auth';
import {intId} from './persistence';
import {assertChargeRuntimeStation} from './charge-runtime';
import {assertReservationAccess} from './charge-reservations';
import {isWithinAvailability} from './platform-domain';

export function rfidHash(stationId:number,uid:string){
 const normalized=uid.replace(/[\s:-]/g,'').toUpperCase();
 if(!/^[0-9A-F]{8,40}$/.test(normalized)||normalized.length%2)throw new BadRequestException('UID deve conter entre 4 e 20 bytes hexadecimais');
 const secret=process.env.RFID_HASH_SECRET||process.env.JWT_SECRET;
 if(!secret)throw new ServiceUnavailableException('Segredo para identificação RFID não configurado');
 return createHmac('sha256',secret).update(`rfid-v1:${stationId}:${normalized}`).digest('hex');
}
const safeSelect={id:true,stationId:true,userId:true,label:true,unitReference:true,vehicleReference:true,organization:true,enabled:true,expiresAt:true,createdAt:true} as const;
export type RfidInput={uid:string;label:string;userId?:number;unitReference?:string;vehicleReference?:string;organization?:string;expiresAt?:string};

@Injectable()
export class RfidService {
 constructor(private db:PrismaService,private access:PlatformAccessService,private operations:AdminOperationsService){}
 async list(user:AuthUser,id:string){const s=await this.access.require(user,id,'MANAGE');return this.db.rfidCredential.findMany({where:{stationId:s.id},select:safeSelect,orderBy:{createdAt:'desc'}})}
 async create(user:AuthUser,id:string,dto:RfidInput){
  return this.db.$transaction(async tx=>{
   const s=await this.access.require(user,id,'MANAGE',tx);
   await tx.$queryRaw`SELECT id FROM stations WHERE id=${s.id} FOR UPDATE`;
   if(dto.userId&&!await tx.user.findFirst({where:{id:dto.userId,accountStatus:'ACTIVE'}}))throw new BadRequestException('Usuário não disponível');
   const expiresAt=dto.expiresAt?new Date(dto.expiresAt):null;
   if(expiresAt&&(!Number.isFinite(expiresAt.getTime())||expiresAt<=new Date()))throw new BadRequestException('Validade deve estar no futuro');
   const uidHash=rfidHash(s.id,dto.uid);
   if(await tx.rfidCredential.findUnique({where:{stationId_uidHash:{stationId:s.id,uidHash}}}))throw new ConflictException('Credencial já cadastrada nesta estação; histórico preservado');
   const {uid,...fields}=dto;
   const saved=await tx.rfidCredential.create({data:{...fields,expiresAt,stationId:s.id,uidHash},select:safeSelect});
   await tx.stationAuditEvent.create({data:{stationId:s.id,actorId:intId(user.sub),action:'rfid.created',details:{credentialId:saved.id}}});
   return saved;
  });
 }
 async revoke(user:AuthUser,id:string,credentialId:string){
  return this.db.$transaction(async tx=>{
   const s=await this.access.require(user,id,'MANAGE',tx);
   await tx.$queryRaw`SELECT id FROM stations WHERE id=${s.id} FOR UPDATE`;
   const row=await tx.rfidCredential.findFirst({where:{id:credentialId,stationId:s.id}});
   if(!row)throw new NotFoundException('Credencial não encontrada');
   if(row.enabled)await tx.stationAuditEvent.create({data:{stationId:s.id,actorId:intId(user.sub),action:'rfid.revoked',details:{credentialId}}});
   return tx.rfidCredential.update({where:{id:row.id},data:{enabled:false},select:safeSelect});
  });
 }
 private async identify(tx:Prisma.TransactionClient,stationId:number,uid:string){
  const row=await tx.rfidCredential.findUnique({where:{stationId_uidHash:{stationId,uidHash:rfidHash(stationId,uid)}},include:{user:{select:{accountStatus:true}}}});
  if(!row||!row.enabled||(row.expiresAt&&row.expiresAt<=new Date())||(row.userId&&row.user?.accountStatus!=='ACTIVE'))throw new ForbiddenException('Credencial não autorizada nesta estação');
  return row;
 }
 async authorize(user:AuthUser,id:string,uid:string){
  const s=await this.access.require(user,id,'OPERATE'),c=await this.identify(this.db,s.id,uid);
  return {authorized:true,credentialId:c.id,label:c.label,unitReference:c.unitReference,userId:c.userId,paymentAuthorized:false,hardwareVerified:false};
 }
 private async demoCharger(user:AuthUser,id:string,chargerId:string){
  const s=await this.access.require(user,id,'OPERATE');assertChargeRuntimeStation(s.id);
  if(process.env.NODE_ENV==='production'||process.env.OCPP_GATEWAY_URL)throw new ConflictException('RFID Demo indisponível com gateway físico ou em produção');
  const charger=await this.db.charger.findFirst({where:{id:intId(chargerId),stationId:s.id}});
  if(!charger)throw new NotFoundException('Carregador não encontrado nesta estação');
  const demo=await this.db.chargingCommand.findFirst({where:{chargerId:charger.id,type:'RUN_CHECKLIST',requestPayload:{path:'$.kind',equals:'platform-v2-demo'}}});
  if(!demo)throw new ConflictException('Carregador sem habilitação DEMO auditada');
  return {s,charger};
 }
 async startDemo(user:AuthUser,id:string,chargerId:string,uid:string){
  const {s,charger}=await this.demoCharger(user,id,chargerId);
  const identity=await this.identify(this.db,s.id,uid);
  const result=await this.operations.startRfidSession(String(charger.id),identity.userId,async tx=>{
   await tx.$queryRaw`SELECT id FROM stations WHERE id=${s.id} FOR UPDATE`;
   const current=await this.access.require(user,id,'OPERATE',tx);
   if(current.status!=='ACTIVE'||current.reviewState!=='APPROVED')throw new ConflictException('Estação não aprovada/ativa');
   const c=await this.identify(tx,s.id,uid),now=new Date();
   if(current.availability&&!isWithinAvailability(current.availability,current.timezone,now,new Date(now.getTime()+60000)))throw new ConflictException('Estação fora do horário disponível');
   await assertReservationAccess(tx,charger.id,c.userId,now);
   await tx.stationAuditEvent.create({data:{stationId:s.id,actorId:intId(user.sub),action:'rfid.demo.start',details:{credentialId:c.id,chargerId:charger.id,provenance:'SIMULATED'}}});
   return {rfidCredentialId:c.id,unitReference:c.unitReference,clientId:c.userId};
  });
  return {sessionId:String(result.session.id),startedAt:result.startedAt,provenance:'SIMULATED',settlement:'MONTHLY_REFERENCE',paymentAuthorized:false};
 }
 async stopDemo(user:AuthUser,id:string,chargerId:string){
  const {s,charger}=await this.demoCharger(user,id,chargerId);
  const session=await this.db.chargingSession.findFirst({where:{chargerId:charger.id,status:'ACTIVE',rfidCredentialId:{not:null}}});
  if(!session)throw new NotFoundException('Sessão RFID ativa não encontrada');
  const result=await this.operations.sendCommand(String(charger.id),'encerrar_carga');
  await this.db.stationAuditEvent.create({data:{stationId:s.id,actorId:intId(user.sub),action:'rfid.demo.stop',details:{sessionId:String(session.id),provenance:'SIMULATED'}}});
  return {...result,settlement:'MONTHLY_REFERENCE',paymentAuthorized:false};
 }
 async monthly(user:AuthUser,id:string,month:string){
  const s=await this.access.require(user,id,'MANAGE');
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new BadRequestException('Mês deve ter formato AAAA-MM');
  const [y,m]=month.split('-').map(Number);
  // UTC padding bounds the query; the station timezone decides month membership.
  const rows=await this.db.chargingSession.findMany({where:{charger:{stationId:s.id},rfidCredentialId:{not:null},status:'FINISHED',endTime:{gte:new Date(Date.UTC(y,m-1,0)),lt:new Date(Date.UTC(y,m,2))}},include:{client:{select:{name:true}},rfidCredential:{select:{label:true,vehicleReference:true,organization:true}},commands:{where:{type:'START_CHARGING'},select:{requestPayload:true},take:1}},orderBy:{endTime:'asc'}});
  const fmt=new Intl.DateTimeFormat('en-US',{timeZone:s.timezone,year:'numeric',month:'2-digit'});
  const sessions=rows.filter(r=>{const p=Object.fromEntries(fmt.formatToParts(r.endTime!).map(v=>[v.type,v.value]));return `${p.year}-${p.month}`===month}).map(r=>({sessionId:String(r.id),credentialId:r.rfidCredentialId,unitReference:r.unitReference,userId:r.clientId,resident:r.client?.name??r.rfidCredential?.label,vehicle:r.rfidCredential?.vehicleReference,organization:r.rfidCredential?.organization,startedAt:r.startTime,endedAt:r.endTime,kwh:String(r.energyKwh??0),referenceAmount:String(r.totalPrice??0),provenance:(r.commands[0]?.requestPayload as {provenance?:string}|null)?.provenance??'UNKNOWN'}));
  const groups=new Map<string,{unitReference:string|null;userId:number|null;resident:string|undefined;sessions:number;kwh:Prisma.Decimal;referenceAmount:Prisma.Decimal}>();
  for(const r of sessions){const key=JSON.stringify([r.unitReference,r.userId??r.credentialId]),g=groups.get(key)??{unitReference:r.unitReference,userId:r.userId,resident:r.resident,sessions:0,kwh:new Prisma.Decimal(0),referenceAmount:new Prisma.Decimal(0)};g.sessions++;g.kwh=g.kwh.add(r.kwh);g.referenceAmount=g.referenceAmount.add(r.referenceAmount);groups.set(key,g)}
  return {stationId:s.id,month,timezone:s.timezone,allocationBy:'SESSION_END',settlement:'MONTHLY_REFERENCE',paymentCollected:false,hardwareVerified:false,groups:[...groups.values()],sessions};
 }
}
