import {BadRequestException,ConflictException,Injectable,UnauthorizedException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {createHash,timingSafeEqual} from 'node:crypto';
import {PrismaService} from './prisma.service';
import {RealtimeService} from './realtime.service';
import {MobileService} from './mobile.service';
import {bigId,sessionInclude} from './persistence';
import {confirmCashRefund,disconnectLifecycle,lifecycleOf,presentLifecycle,stopLifecycle,budgetPrice} from './charge-lifecycle';
import {calculateSession,ledgerOf,recordEnergy} from './tariff-engine';
import {assertChargeRuntimeStation} from './charge-runtime';
import {assertPhysicalCommandsEnabled} from './remote-development';

export type DeviceChargeEvent={chargerId:number;ocppIdentity:string;event:'start_confirmed'|'stop_confirmed'|'connector_removed';occurredAt:string;meterTotalKwh?:number};

@Injectable()
export class ChargeLifecycleService {
 constructor(private readonly db:PrismaService,private readonly realtime:RealtimeService,private readonly mobile:MobileService){}
 private publish(session:{id:bigint;chargerId:number}){
  this.realtime.publish({topic:'session.updated',entityId:session.id,operational:true});
  this.realtime.publish({topic:'charger.updated',entityId:session.chargerId});
  this.realtime.publish({topic:'payment.updated',entityId:session.id,operational:true});
 }
 async confirmRemoval(id:string,actorId:string){
  if(process.env.OCPP_GATEWAY_URL)throw new ConflictException('Retirada fisica exige confirmacao do gateway; desbloquear nao confirma retirada');
  const session=await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM charging_sessions WHERE id=${bigId(id)} FOR UPDATE`;
   const s=await tx.chargingSession.findUniqueOrThrow({where:{id:bigId(id)},include:{charger:true}});
   assertChargeRuntimeStation(s.charger.stationId);
   const state=lifecycleOf(s.billingSnapshot);
   if(state?.startedAt)throw new ConflictException('A retirada desta sessao exige confirmacao do gateway fisico');
   if(!s.endTime||!state?.stoppedAt)throw new ConflictException('Aguarde a confirmacao da parada de energia');
   if(state.disconnectedAt)return s;
   const now=new Date(),updated=await tx.chargingSession.update({where:{id:s.id},data:{disconnectedAt:now,billingSnapshot:disconnectLifecycle(s.billingSnapshot,now,'OPERATOR_CONFIRMED_SANDBOX')}});
   await tx.chargerLiveStatus.updateMany({where:{chargerId:s.chargerId,operationalStatus:'FINISHING',currentPowerKw:0},data:{operationalStatus:'AVAILABLE'}});
   await tx.stationAuditEvent.create({data:{stationId:s.charger.stationId,actorId:Number(actorId),action:'charge.connector_removed',details:{sessionId:id,source:'OPERATOR_CONFIRMED_SANDBOX'}}});
   return updated;
  });this.publish(session);return presentLifecycle(session.billingSnapshot);
 }
 async confirmRefund(id:string,amount:number,actorId:string){
  const session=await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM charging_sessions WHERE id=${bigId(id)} FOR UPDATE`;
   const s=await tx.chargingSession.findUniqueOrThrow({where:{id:bigId(id)},include:{charger:true,payments:true}});
   assertChargeRuntimeStation(s.charger.stationId);
   const state=lifecycleOf(s.billingSnapshot);
   const receipt=s.payments.find(p=>p.idempotencyKey===`cash-settle-${s.id}`&&p.status==='APPROVED'&&p.method==='CASH'&&p.provider==='CASH_REGISTER'&&p.paidAt);
   if(!s.endTime||!receipt||!state?.cashRefund)throw new ConflictException('Devolucao exige consumo fechado e recebimento Caixa confirmado');
   if(!new Prisma.Decimal(receipt.amount).sub(s.totalPrice).equals(state.cashRefund.dueAmount))throw new ConflictException('O recebimento ou consumo mudou; revise a devolucao');
   let snapshot:Prisma.InputJsonValue;
   try{snapshot=confirmCashRefund(s.billingSnapshot,amount,actorId,new Date())}catch(error){throw new BadRequestException(error instanceof Error?error.message:'Valor de devolucao invalido')}
   if(state.cashRefund.returnedAmount===new Prisma.Decimal(amount).toFixed(2))return s;
   const updated=await tx.chargingSession.update({where:{id:s.id},data:{billingSnapshot:snapshot}});
   await tx.stationAuditEvent.create({data:{stationId:s.charger.stationId,actorId:Number(actorId),action:'charge.cash_return_confirmed',details:{sessionId:id,amount:new Prisma.Decimal(amount).toFixed(2),method:'CASH',paymentId:String(receipt.id)}}});
   return updated;
  });this.publish(session);return presentLifecycle(session.billingSnapshot);
 }
 async deviceEvent(id:string,token:string,input:DeviceChargeEvent){
  assertPhysicalCommandsEnabled();
  const secret=process.env.OCPP_GATEWAY_TOKEN;
  const digest=(value:string)=>createHash('sha256').update(value).digest();
  if(!process.env.OCPP_GATEWAY_URL||!secret||!token||!timingSafeEqual(digest(token),digest(secret)))throw new UnauthorizedException('Gateway nao autorizado');
  if(!/(Z|[+-]\d\d:\d\d)$/.test(input.occurredAt)||!Number.isFinite(Date.parse(input.occurredAt))||Date.parse(input.occurredAt)>Date.now()+5000)throw new BadRequestException('Horario do evento invalido');
  const at=new Date(input.occurredAt);
  const session=await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT charger_id FROM charger_live_status WHERE charger_id=${input.chargerId} FOR UPDATE`;
   await tx.$queryRaw`SELECT id FROM charging_sessions WHERE id=${bigId(id)} FOR UPDATE`;
   const s=await tx.chargingSession.findUniqueOrThrow({where:{id:bigId(id)},include:sessionInclude});
   assertChargeRuntimeStation(s.charger.stationId);
   const state=lifecycleOf(s.billingSnapshot);
   if(!state||s.chargerId!==input.chargerId||s.charger.ocppIdentity!==input.ocppIdentity)throw new ConflictException('Evento nao corresponde a sessao e conector');
   if(input.event==='start_confirmed'){
    if(input.meterTotalKwh===undefined||!Number.isFinite(input.meterTotalKwh)||input.meterTotalKwh<0)throw new BadRequestException('Inicio exige medidor cumulativo');
    if(state.startedAt){if(state.startedAt!==at.toISOString()||!new Prisma.Decimal(s.meterStartKwh??-1).equals(input.meterTotalKwh))throw new ConflictException('Replay de inicio divergente');return s;}
    const command=[...s.commands].reverse().find(c=>c.type==='START_CHARGING'&&c.status==='ACCEPTED');
    if(s.status!=='STARTING'||!command||at<s.requestedAt)throw new ConflictException('Inicio nao solicitado para esta sessao');
    const ledger=ledgerOf(s);
    const snapshot={...(s.billingSnapshot as Prisma.JsonObject),...(ledger?{last_at:at.toISOString(),meter_energy_kwh:'0'}:{}),chargeLifecycle:{...state,startedAt:at.toISOString()}};
    const updated=await tx.chargingSession.update({where:{id:s.id},data:{status:'ACTIVE',startTime:at,meterStartKwh:input.meterTotalKwh,billingSnapshot:snapshot}});
    await tx.chargerLiveStatus.update({where:{chargerId:s.chargerId},data:{operationalStatus:'CHARGING',currentPowerKw:0,meterTotalKwh:input.meterTotalKwh,lastSeenAt:at}});
    await tx.chargingCommand.update({where:{id:command.id},data:{status:'COMPLETED',processedAt:at,responsePayload:{source:'AUTHENTICATED_GATEWAY',event:'start_confirmed'}}});
    return updated;
   }
   if(input.event==='connector_removed'){
    if(!state.stoppedAt||!s.endTime||at.getTime()<Date.parse(state.stoppedAt))throw new ConflictException('Retirada requer parada confirmada e horario posterior');
    if(state.disconnectedAt){if(state.disconnectedAt!==at.toISOString())throw new ConflictException('Retirada ja registrada em outro horario');return s;}
    const updated=await tx.chargingSession.update({where:{id:s.id},data:{disconnectedAt:at,billingSnapshot:disconnectLifecycle(s.billingSnapshot,at,'GATEWAY_CONFIRMED')}});
    await tx.chargerLiveStatus.updateMany({where:{chargerId:s.chargerId,operationalStatus:'FINISHING',currentPowerKw:0},data:{operationalStatus:'AVAILABLE',lastSeenAt:at}});
    return updated;
   }
   if(input.meterTotalKwh===undefined||!Number.isFinite(input.meterTotalKwh)||input.meterTotalKwh<0||s.meterStartKwh===null)throw new BadRequestException('STOP exige medidor cumulativo inicial e final');
   if(state.stoppedAt){if(state.stoppedAt!==at.toISOString()||!new Prisma.Decimal(s.meterEndKwh??-1).equals(input.meterTotalKwh))throw new ConflictException('Replay de STOP divergente');return s;}
   const command=[...s.commands].reverse().find(c=>c.type==='STOP_CHARGING'&&c.status==='ACCEPTED');
   if(s.status!=='STOPPING'||!command||at<(s.startTime??s.requestedAt))throw new ConflictException('STOP nao foi solicitado ou aceito para esta sessao');
   const energy=new Prisma.Decimal(input.meterTotalKwh).sub(s.meterStartKwh);
   if(energy.lt(s.energyKwh))throw new ConflictException('Regressao do medidor');
   const ledger=ledgerOf(s);
   const closing=ledger?recordEnergy(ledger,energy,at,ledger.facts):null;
   const breakdown=closing?calculateSession(id,closing.intervals,at.toISOString(),null,true,s.spendingLimit):null;
   const rawAmount=breakdown?new Prisma.Decimal(breakdown.customer.energy_amount):energy.mul(s.pricePerKwhSnapshot).add(s.fixedFeeSnapshot).toDecimalPlaces(2);
   const amount=new Prisma.Decimal(budgetPrice(rawAmount,s.spendingLimit).chargedAmount);
   const receipt=s.payments.find(p=>p.idempotencyKey===`cash-settle-${s.id}`&&p.status==='APPROVED'&&p.method==='CASH'&&p.provider==='CASH_REGISTER'&&p.paidAt);
   const covered=receipt&&receipt.amount.gte(amount);
   const snapshot=stopLifecycle(closing?{...closing,phase:'frozen',charge_completed_at:at.toISOString(),breakdown}:s.billingSnapshot,at,rawAmount,covered?receipt.amount:undefined,s.spendingLimit);
   const updated=await tx.chargingSession.update({where:{id:s.id},data:{endTime:at,energyKwh:energy,meterEndKwh:input.meterTotalKwh,totalPrice:amount,durationSeconds:Math.floor((at.getTime()-(s.startTime??s.requestedAt).getTime())/1000),status:covered?'FINISHED':'WAITING_PAYMENT',billingSnapshot:snapshot}});
   await tx.chargerLiveStatus.update({where:{chargerId:s.chargerId},data:{operationalStatus:'FINISHING',currentPowerKw:0,meterTotalKwh:input.meterTotalKwh,lastSeenAt:at}});
   await tx.chargingCommand.update({where:{id:command.id},data:{status:'COMPLETED',processedAt:at,responsePayload:{source:'AUTHENTICATED_GATEWAY',event:'stop_confirmed',meterTotalKwh:input.meterTotalKwh}}});
   return updated;
  });
  this.publish(session);
  if(input.event==='stop_confirmed')await this.mobile.settleConfirmedStop(id);
  return presentLifecycle(session.billingSnapshot);
 }
}
