import {ForbiddenException, UnauthorizedException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {PrismaService} from './prisma.service';
import {intId} from './persistence';

// Objects are constructed by server guards, never from a request body.
export type ChargeSubject = string | {guestId:string} | {userId:string; channel:'WEB_CHARGE'};
export type ChargeActor = {id:number|null; guestId:string|null; chargerId?:number; key:string; origin:'MOBILE_APP'|'ADMIN_SITE'};
export async function chargeActor(db:PrismaService, subject:ChargeSubject, allowExpiredGuest=false):Promise<ChargeActor> {
  if(typeof subject==='object' && 'guestId' in subject){
    const guest=await db.guestCharge.findUnique({where:{id:subject.guestId}});
    if(!guest || (!allowExpiredGuest && guest.expiresAt<=new Date()))throw new UnauthorizedException('Acesso de visitante expirado');
    return {id:null,guestId:guest.id,chargerId:guest.chargerId,key:'guest:'+guest.id,origin:'ADMIN_SITE'};
  }
  const id=intId(typeof subject==='string'?subject:subject.userId);
  const user=await db.user.findUnique({where:{id}});
  if(!user || user.accountStatus!=='ACTIVE')throw new UnauthorizedException('Conta inválida');
  return {id,guestId:null,key:String(id),origin:typeof subject==='string'?'MOBILE_APP':'ADMIN_SITE'};
}
export const chargeOwner=(actor:ChargeActor)=>actor.guestId?{clientId:null,guestId:actor.guestId}:{clientId:actor.id!};
export const intentKey=(actor:ChargeActor,idempotencyKey:string):Prisma.PaymentIntentWhereUniqueInput=>actor.guestId
  ?{guestId_idempotencyKey:{guestId:actor.guestId,idempotencyKey}}
  :{clientId_idempotencyKey:{clientId:actor.id!,idempotencyKey}};
export function checkGuestCharger(actor:ChargeActor, charger:{id:number;station:{visibility:string;guestAllowed:boolean}}){
  if(actor.guestId && (actor.chargerId!==charger.id || charger.station.visibility!=='PUBLIC' || !charger.station.guestAllowed))
    throw new ForbiddenException('Este carregador não permite esta recarga como visitante');
}
