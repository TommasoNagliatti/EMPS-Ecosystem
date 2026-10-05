import {BadRequestException,ConflictException,Injectable,Logger,NotFoundException,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {PrismaService} from './prisma.service';
import {eligibleStationWhere} from './station-visibility';
import {isWithinAvailability} from './platform-domain';
import {intId} from './persistence';
import {assertChargeRuntimeStation,chargeRuntimeStationIds} from './charge-runtime';
import {paymentCapabilities} from './payment-gateway.service';
import {reservationNoShowAt} from './charge-reservations';
export type ReservationInput={chargerId:string;startAt:string;endAt:string};
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
@Injectable()
export class ReservationsService implements OnModuleInit,OnModuleDestroy {
 private timer?:NodeJS.Timeout;private running=false;private logger=new Logger(ReservationsService.name);
 constructor(private db:PrismaService){}
 onModuleInit(){this.timer=setInterval(()=>void this.sweep().catch(e=>this.logger.error('Falha ao atualizar reservas',e instanceof Error?e.message:String(e))),30000);this.timer.unref()}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer)}
 async sweep(){if(this.running)return;this.running=true;try{const scope=chargeRuntimeStationIds();const stations=await this.db.chargerReservation.findMany({where:{status:{in:['PENDING_PAYMENT','CONFIRMED']},...(scope?{stationId:{in:scope}}:{})},distinct:['stationId'],select:{stationId:true}});for(const s of stations)await this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM stations WHERE id=${s.stationId} FOR UPDATE`;await this.expire(tx,s.stationId)})}finally{this.running=false}}
 private async expire(tx:Prisma.TransactionClient,stationId:number){
  const now=new Date();await tx.chargerReservation.updateMany({where:{stationId,status:'PENDING_PAYMENT',expiresAt:{lte:now}},data:{status:'EXPIRED'}});
  const confirmed=await tx.chargerReservation.findMany({where:{stationId,status:'CONFIRMED',sessionId:null,startAt:{lte:now}}});
  for(const r of confirmed)if(reservationNoShowAt(r)<=now)await tx.chargerReservation.updateMany({where:{id:r.id,status:'CONFIRMED',sessionId:null},data:{status:'NO_SHOW'}});
 }
 private async terms(tx:Prisma.TransactionClient,userId:number,input:ReservationInput){
  const startAt=new Date(input.startAt),endAt=new Date(input.endAt),now=new Date();
  if(!/([zZ]|[+-]\d\d:\d\d)$/.test(input.startAt)||!/([zZ]|[+-]\d\d:\d\d)$/.test(input.endAt)||!Number.isFinite(startAt.getTime())||!Number.isFinite(endAt.getTime())||startAt<=now||endAt<=startAt||endAt.getTime()-startAt.getTime()>86400000||startAt.getTime()-now.getTime()>90*86400000)throw new BadRequestException('Informe horários futuros com fuso, duração até 24 h e antecedência até 90 dias');
  const charger=await tx.charger.findFirst({where:{id:intId(input.chargerId),administrativeStatus:'ENABLED',station:eligibleStationWhere(userId)},include:{station:true}});
  if(!charger)throw new NotFoundException('Carregador não disponível para esta conta');
  const s=charger.station;
  if(s.reservationRatePerHour===null||!s.reservationPolicy)throw new ConflictException('Reservas ainda não configuradas nesta estação');
  if(!isWithinAvailability(s.availability,s.timezone,startAt,endAt))throw new ConflictException('Janela fora dos horários disponíveis');
  const fee=s.reservationRatePerHour.mul(endAt.getTime()-startAt.getTime()).div(3600000).toDecimalPlaces(2);
  const policy={...(s.reservationPolicy as Record<string,unknown>),ratePerHour:String(s.reservationRatePerHour),timezone:s.timezone,fee:String(fee),startAt:startAt.toISOString(),endAt:endAt.toISOString(),chargerId:charger.id,cancellation:'MANUAL_REVIEW',noShowMinutes:Math.max(1,Math.min(1440,Number((s.reservationPolicy as any).noShowMinutes)||15))};
  const termsHash=createHash('sha256').update(JSON.stringify(policy)).digest('hex');
  return {charger,startAt,endAt,fee,policy,termsHash};
 }
 async quote(userIdInput:string,input:ReservationInput){const q=await this.terms(this.db,intId(userIdInput),input);const now=new Date();const rows=await this.db.chargerReservation.findMany({where:{chargerId:q.charger.id,startAt:{lt:q.endAt},endAt:{gt:q.startAt},status:{in:['PENDING_PAYMENT','CONFIRMED','USED']}}});if(rows.some(r=>r.status==='USED'||(r.status==='CONFIRMED'&&reservationNoShowAt(r)>now)||(r.status==='PENDING_PAYMENT'&&r.expiresAt&&r.expiresAt>now)))throw new ConflictException('Já existe reserva neste intervalo');return {stationId:q.charger.stationId,stationName:q.charger.station.name,chargerId:q.charger.id,fee:String(q.fee),currency:'BRL',policy:q.policy,termsHash:q.termsHash,paymentMode:q.fee.isZero()?'FREE':paymentCapabilities().demoPayments?'SANDBOX':'UNAVAILABLE',energyIncluded:false}}
 async create(userIdInput:string,input:ReservationInput&{termsHash:string;acceptPolicy:boolean;idempotencyKey:string}){
  const userId=intId(userIdInput);
  if(input.acceptPolicy!==true)throw new BadRequestException('Aceite a política da reserva');
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
   const previous=await tx.chargerReservation.findUnique({where:{userId_idempotencyKey:{userId,idempotencyKey:input.idempotencyKey}}});
   if(previous){if(previous.chargerId!==intId(input.chargerId)||previous.startAt.getTime()!==Date.parse(input.startAt)||previous.endAt.getTime()!==Date.parse(input.endAt))throw new ConflictException('Chave já usada para outra reserva');return previous}
   const reference=await tx.charger.findUnique({where:{id:intId(input.chargerId)},select:{stationId:true}});if(!reference)throw new NotFoundException('Carregador não encontrado');
   assertChargeRuntimeStation(reference.stationId);await tx.$queryRaw`SELECT id FROM stations WHERE id=${reference.stationId} FOR UPDATE`;
   const q=await this.terms(tx,userId,input);if(q.termsHash!==input.termsHash)throw new ConflictException('Condições alteradas. Consulte a reserva novamente');
   if(!q.fee.isZero()&&!paymentCapabilities().demoPayments)throw new ConflictException('Pagamento de reserva ainda indisponível neste ambiente');
   await this.expire(tx,reference.stationId);
   const conflict=await tx.chargerReservation.findFirst({where:{chargerId:q.charger.id,startAt:{lt:q.endAt},endAt:{gt:q.startAt},status:{in:['PENDING_PAYMENT','CONFIRMED','USED']}}});
   if(conflict)throw new ConflictException('Já existe reserva neste intervalo');
   return tx.chargerReservation.create({data:{stationId:q.charger.stationId,chargerId:q.charger.id,userId,startAt:q.startAt,endAt:q.endAt,fee:q.fee,policySnapshot:json({...q.policy,termsHash:q.termsHash,acceptedAt:new Date().toISOString()}),idempotencyKey:input.idempotencyKey,status:q.fee.isZero()?'CONFIRMED':'PENDING_PAYMENT',expiresAt:q.fee.isZero()?null:new Date(Math.min(Date.now()+600000,q.startAt.getTime())),provider:q.fee.isZero()?'FREE':null}});
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
 }
 async list(userIdInput:string){return this.db.chargerReservation.findMany({where:{userId:intId(userIdInput)},include:{station:{select:{name:true,timezone:true}},charger:{select:{name:true}}},orderBy:{startAt:'desc'},take:100})}
 async action(userIdInput:string,id:string,action:'pay-demo'|'cancel'){
  const userId=intId(userIdInput);
  return this.db.$transaction(async tx=>{
   const reference=await tx.chargerReservation.findFirst({where:{id,userId}});if(!reference)throw new NotFoundException('Reserva não encontrada');assertChargeRuntimeStation(reference.stationId);
   await tx.$queryRaw`SELECT id FROM stations WHERE id=${reference.stationId} FOR UPDATE`;await this.expire(tx,reference.stationId);
   const r=await tx.chargerReservation.findUniqueOrThrow({where:{id}});
   if(action==='cancel'){
    if(r.status==='CANCELLED')return r;
    if(!['PENDING_PAYMENT','CONFIRMED'].includes(r.status))throw new ConflictException('Reserva não pode mais ser cancelada');
    return tx.chargerReservation.update({where:{id},data:{status:'CANCELLED',policySnapshot:json({...r.policySnapshot as object,cancelledAt:new Date().toISOString(),refundStatus:r.provider==='SANDBOX'?'PENDING_MANUAL_REVIEW':'NOT_REQUIRED'})}});
   }
   if(r.status==='CONFIRMED'&&r.provider==='SANDBOX')return r;
   if(r.status!=='PENDING_PAYMENT')throw new ConflictException('Reserva expirada ou indisponível para pagamento');
   if(!paymentCapabilities().demoPayments)throw new ConflictException('Pagamento Demo indisponível');
   if(!await tx.station.findFirst({where:{id:r.stationId,...eligibleStationWhere(userId)}}))throw new NotFoundException('Estação não autorizada para esta conta');
   return tx.chargerReservation.update({where:{id},data:{status:'CONFIRMED',provider:'SANDBOX',providerPaymentId:'reservation_demo_'+r.id,expiresAt:null,policySnapshot:json({...r.policySnapshot as object,payment:{provider:'SANDBOX',amount:String(r.fee),paidAt:new Date().toISOString(),provenance:'SIMULATED'}})}});
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
 }
}
