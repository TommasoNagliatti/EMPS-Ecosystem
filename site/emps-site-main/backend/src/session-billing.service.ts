import {BadRequestException,ConflictException,Controller,Get,Injectable,NotFoundException,Param,Post,Req,UseGuards} from '@nestjs/common';
import {Prisma,Role} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import type Stripe from 'stripe';
import {PrismaService} from './prisma.service';
import {PaymentGatewayService} from './payment-gateway.service';
import {RealtimeService} from './realtime.service';
import {AuthRequest,JwtGuard,Roles,RolesGuard} from './auth';
import {bigId} from './persistence';
import {calculateSession,invoice,ledgerOf} from './tariff-engine';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
@Injectable()
export class SessionBillingService {
 constructor(private readonly db:PrismaService,private readonly gateway:PaymentGatewayService,private readonly realtime:RealtimeService){}
 private async owned(userId:string,id:string){const s=await this.db.chargingSession.findFirst({where:{id:bigId(id),clientId:Number(userId)},include:{paymentIntent:true,charger:true,payments:true}});if(!s)throw new NotFoundException('Sessão não encontrada');if(!ledgerOf(s))throw new ConflictException('Sessão usa cobrança legada');return s;}
 private publish(s:{id:bigint;clientId:number|null;chargerId:number}){this.realtime.publish({topic:'session.updated',entityId:s.id,customerId:s.clientId??undefined,operational:true});this.realtime.publish({topic:'payment.updated',entityId:s.id,customerId:s.clientId??undefined,operational:true});this.realtime.publish({topic:'charger.updated',entityId:s.chargerId});}
 async quote(userId:string,id:string){const s=await this.owned(userId,id),l=ledgerOf(s)!;const breakdown=l.phase==='frozen'?l.breakdown:calculateSession(id,l.intervals,l.charge_completed_at??s.endTime?.toISOString(),s.endTime?new Date().toISOString():null);return {sessionId:id,status:s.status.toLowerCase(),frozen:l.phase==='frozen',disconnectedAt:s.disconnectedAt,breakdown:{customer:breakdown!.customer,intervals:breakdown!.intervals,overstay:breakdown!.overstay,tariff_version:breakdown!.tariff_version},provider:s.paymentIntent?.provider?.replace('_deferred','')??'sandbox',paymentRequired:s.status!=='FINISHED'};}
 async disconnect(userId:string,id:string){
  await this.owned(userId,id);if(process.env.OCPP_GATEWAY_URL)throw new ConflictException('Aguarde confirmação de desconexão do gateway físico');
  const s=await this.db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM charging_sessions WHERE id=${bigId(id)} FOR UPDATE`;
   const s=await tx.chargingSession.findUniqueOrThrow({where:{id:bigId(id)}}),l=ledgerOf(s)!;
   if(l.phase==='frozen')return s;if(!s.endTime||s.status!=='WAITING_PAYMENT')throw new ConflictException('Encerre a carga antes de confirmar a retirada');
   const now=new Date();l.phase='frozen';l.disconnection_source='customer_confirmed_logical_sandbox';l.breakdown=calculateSession(id,l.intervals,l.charge_completed_at??s.endTime.toISOString(),now.toISOString());
   const updated=await tx.chargingSession.update({where:{id:s.id},data:{disconnectedAt:now,billingSnapshot:json(l),totalPrice:l.breakdown.customer.total_amount}});
   await tx.chargerLiveStatus.update({where:{chargerId:s.chargerId},data:{operationalStatus:'AVAILABLE',currentPowerKw:0}});return updated;
  });this.publish(s);return this.quote(userId,id);
 }
 async pay(userId:string,id:string){
  const s=await this.owned(userId,id),l=ledgerOf(s)!,b=invoice(s)!;
  if(s.status==='FINISHED')return {status:'approved',provider:s.payments[0]?.provider};
  if(l.phase!=='frozen'||s.status!=='WAITING_PAYMENT')throw new ConflictException('Confirme a retirada e o fechamento da cobrança');
  if(!s.paymentIntent)throw new ConflictException('Pagamento disponível pelo caixa');
  const provider=s.paymentIntent.provider?.replace('_deferred','');
  const key=`v1-session-${id}`;
  let reserved: Stripe.PaymentIntent | null = null;
  let finalExternalId = s.paymentIntent.providerIntentId?.startsWith("pi_") ? s.paymentIntent.providerIntentId : undefined;
  if (provider === "stripe" && finalExternalId) {
    const current = await this.gateway.retrieveIntent(finalExternalId);
    if (current.capture_method === "manual") {
      reserved = await this.gateway.settleReservation({externalId:current.id,internalIntentId:String(s.paymentIntent.id),sessionId:id,amount:b.customer.total_amount});
      if (reserved) {
        await this.webhook({type:"payment_intent.succeeded",data:{object:reserved}} as Stripe.Event);
        return {status:"approved",provider:"stripe"};
      }
      finalExternalId = undefined;
      // Keep the released reservation identifier in the audit fields, never a fake approval.
      await this.db.paymentIntent.updateMany({where:{id:s.paymentIntent.id,providerIntentId:current.id},data:{providerIntentId:null,status:'CANCELED',failureCode:'RESERVATION_RELEASED',failureMessage:'Released '+current.id}});
    }
  }
  if(provider==='sandbox'||new Prisma.Decimal(b.customer.total_amount).isZero()){
   const done=await this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM charging_sessions WHERE id=${s.id} FOR UPDATE`;
    const current=await tx.chargingSession.findUniqueOrThrow({where:{id:s.id}});if(current.status==='FINISHED')return current;
    await tx.payment.upsert({where:{idempotencyKey:key},create:{sessionId:s.id,paymentIntentId:s.paymentIntentId,code:'PAY-'+randomUUID(),method:provider==='sandbox'?'SIMULATED':'CARD',provider:provider==='sandbox'?'sandbox':'zero_amount',amount:b.customer.total_amount,amountReceived:b.customer.total_amount,status:'APPROVED',paidAt:new Date(),idempotencyKey:key,providerPaymentId:key},update:{}});
    return tx.chargingSession.update({where:{id:s.id},data:{status:'FINISHED'}});
   });this.publish(done);return {status:'approved',provider:provider==='sandbox'?'sandbox':'zero_amount'};
  }
  if(provider!=='stripe')throw new ConflictException('Provedor desta sessão não suportado');
  const external=await this.gateway.createSessionIntent({amount:b.customer.total_amount,sessionId:id,internalIntentId:String(s.paymentIntent.id),chargerId:String(s.chargerId),stationId:String(s.charger.stationId),externalId:finalExternalId});
  await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM charging_sessions WHERE id=${s.id} FOR UPDATE`;
   const current=await tx.chargingSession.findUniqueOrThrow({where:{id:s.id}});if(current.status==='FINISHED')return;
   await tx.paymentIntent.update({where:{id:s.paymentIntent!.id},data:{provider:'stripe',providerIntentId:external.id,status:'REQUIRES_ACTION'}});
   await tx.payment.upsert({where:{idempotencyKey:key},create:{sessionId:s.id,paymentIntentId:s.paymentIntentId,code:'PAY-'+randomUUID(),method:'CARD',provider:'stripe',providerPaymentId:external.id,amount:b.customer.total_amount,status:'PENDING',idempotencyKey:key},update:{}});
  });return {status:'requires_action',provider:'stripe',providerClientSecret:external.client_secret};
 }
 async webhook(event:Stripe.Event):Promise<boolean>{
  if(!['payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled','payment_intent.processing'].includes(event.type))return false;
  const eventIntent=event.data.object as Stripe.PaymentIntent;const sessionId=eventIntent.metadata?.emps_session_id;if(!sessionId)return false;
  // Fetch current provider state so a delayed event cannot regress a later success.
  const object=await this.gateway.retrieveIntent(eventIntent.id);if(object.livemode)throw new BadRequestException('Live Mode não permitido');
  const s=await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM charging_sessions WHERE id=${bigId(sessionId)} FOR UPDATE`;
   const s=await tx.chargingSession.findUnique({where:{id:bigId(sessionId)},include:{paymentIntent:true}});if(!s||!s.paymentIntent||String(s.paymentIntent.id)!==object.metadata.emps_payment_intent_id)throw new BadRequestException('Intent não corresponde à sessão');
   const l=ledgerOf(s);if(l?.phase!=='frozen')throw new ConflictException('Cobrança ainda não congelada');
   const b=invoice(s)!,cents=new Prisma.Decimal(b.customer.total_amount).mul(100).toNumber();
   if(object.currency!=='brl'||(object.capture_method!=='manual'&&object.amount!==cents)||object.metadata.emps_session_id!==sessionId||(s.paymentIntent.providerIntentId?.startsWith('pi_')&&s.paymentIntent.providerIntentId!==object.id))throw new BadRequestException('Valor, moeda ou intent divergente');
   if(s.status==='FINISHED')return s;
   const approved=object.status==='succeeded';if(approved&&object.amount_received!==cents)throw new BadRequestException('Valor recebido diverge do total oficial');
   const failed=object.status==='canceled'||!!object.last_payment_error;
   await tx.paymentIntent.update({where:{id:s.paymentIntent.id},data:{provider:'stripe',providerIntentId:object.id,status:approved?'AUTHORIZED':object.status==='canceled'?'CANCELED':failed?'REJECTED':'PROCESSING',authorizedAmount:approved?b.customer.total_amount:null,authorizedAt:approved?new Date():null}});
   await tx.payment.upsert({where:{idempotencyKey:`v1-session-${sessionId}`},create:{sessionId:s.id,paymentIntentId:s.paymentIntentId,code:'PAY-'+randomUUID(),method:'CARD',provider:'stripe',providerPaymentId:object.id,idempotencyKey:`v1-session-${sessionId}`,amount:b.customer.total_amount,status:approved?'APPROVED':failed?'REJECTED':'PROCESSING',amountReceived:approved?b.customer.total_amount:null,paidAt:approved?new Date():null},update:{status:approved?'APPROVED':failed?'REJECTED':'PROCESSING',amountReceived:approved?b.customer.total_amount:null,paidAt:approved?new Date():null}});
   if(approved)return tx.chargingSession.update({where:{id:s.id},data:{status:'FINISHED'}});return s;
  });this.publish(s);return true;
 }
}
@Controller('mobile/v1/charging-sessions/:id') @UseGuards(JwtGuard,RolesGuard) @Roles(Role.CUSTOMER)
export class SessionBillingController {
 constructor(private readonly billing:SessionBillingService){}
 @Get('billing') quote(@Req() r:AuthRequest,@Param('id') id:string){return this.billing.quote(r.user.sub,id);}
 @Post('disconnect') disconnect(@Req() r:AuthRequest,@Param('id') id:string){return this.billing.disconnect(r.user.sub,id);}
 @Post('payment') pay(@Req() r:AuthRequest,@Param('id') id:string){return this.billing.pay(r.user.sub,id);}
}
