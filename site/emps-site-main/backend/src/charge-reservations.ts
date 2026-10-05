import {ConflictException} from '@nestjs/common';
import {Prisma} from '@prisma/client';
export function reservationNoShowAt(r:{startAt:Date;endAt:Date;policySnapshot:unknown}){
 const minutes=Math.max(1,Math.min(1440,Number((r.policySnapshot as {noShowMinutes?:number}|null)?.noShowMinutes)||15));
 return new Date(Math.min(r.endAt.getTime(),r.startAt.getTime()+minutes*60000));
}

// Shared admission rule; creation/cancellation of reservations is a separate API.
export async function currentReservation(db:Pick<Prisma.TransactionClient,'chargerReservation'>,chargerId:number,now=new Date()){
 const rows=await db.chargerReservation.findMany({where:{chargerId,startAt:{lte:now},endAt:{gt:now},OR:[{status:{in:['CONFIRMED','USED']}},{status:'PENDING_PAYMENT',expiresAt:{gt:now}}]},orderBy:{startAt:'asc'}});
 return rows.find(r=>r.status!=='CONFIRMED'||reservationNoShowAt(r)>now)??null;
}
export async function assertReservationAccess(db:Pick<Prisma.TransactionClient,'chargerReservation'>,chargerId:number,userId:number|null,now=new Date()){
 const reservation=await currentReservation(db,chargerId,now);
 if(reservation && (reservation.status!=='CONFIRMED'||reservation.userId!==userId))throw new ConflictException('Carregador reservado para outro horário ou usuário');
 return reservation;
}
