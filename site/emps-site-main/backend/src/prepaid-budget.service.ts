import {prepaidMargin} from './prepaid-domain';
import {Injectable,Logger,OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {PrismaService} from './prisma.service';
import {MobileService} from './mobile.service';
import {chargeRuntimeStationIds} from './charge-runtime';
import {invoice,ledgerOf,tariffQuote} from './tariff-engine';
import {sessionInclude,type SessionRecord} from './persistence';

/** Conservative STOP threshold; the official invoice is never replaced by this bound. */
export function prepaidStopDecision(session:SessionRecord,now=new Date()){
 if(session.spendingLimit===null)return {stop:false,reason:'NO_LIMIT',remaining:null};
 const D=Prisma.Decimal,limit=new D(session.spendingLimit),power=new D(session.charger.powerKw??0),ledger=ledgerOf(session);
 if(power.lte(0))return {stop:true,reason:'MISSING_POWER_BOUND',remaining:null};
 const rate=ledger?new D(tariffQuote().maximum_tariff_per_kwh):new D(session.pricePerKwhSnapshot);
 const elapsed=Math.max(0,(now.getTime()-(session.startTime??session.requestedAt).getTime())/1000);
 const official=invoice(session);
 const cost=official?new D(official.customer.total_amount).add(power.mul(Math.max(0,(now.getTime()-Date.parse(ledger!.last_at))/1000)).div(3600).mul(rate))
  :D.max(new D(session.energyKwh).mul(rate).add(session.fixedFeeSnapshot),power.mul(elapsed).div(3600).mul(rate).add(session.fixedFeeSnapshot));
 const margin=prepaidMargin(power,rate);
 return {stop:cost.add(margin).gte(limit),reason:'AUTHORIZED_LIMIT',remaining:D.max(0,limit.sub(cost)).toFixed(2)};
}
@Injectable()
export class PrepaidBudgetService implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setInterval>;private running=false;private readonly log=new Logger(PrepaidBudgetService.name);
 constructor(private readonly db:PrismaService,private readonly mobile:MobileService){}
 onModuleInit(){this.timer=setInterval(()=>void this.tick(),5000);this.timer.unref();void this.tick()}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer)}
 async tick(){
  if(this.running)return;this.running=true;
  try{
   const ids=chargeRuntimeStationIds();
   const sessions=await this.db.chargingSession.findMany({where:{status:'ACTIVE',paymentIntentId:{not:null},spendingLimit:{not:null},...(ids?{charger:{stationId:{in:ids}}}:{})},include:sessionInclude});
   for(const session of sessions){
    const guestExpired=session.guestId?!(await this.db.guestCharge.findFirst({where:{id:session.guestId,expiresAt:{gt:new Date()}}})):false;
    if(prepaidStopDecision(session).stop||guestExpired)try{await this.mobile.stopForBudget(String(session.id),guestExpired?'GUEST_EXPIRED':prepaidStopDecision(session).reason)}catch(error){this.log.error(`STOP pendente para sessão ${session.id}: ${error instanceof Error?error.message:'erro'}`)}
   }
  }catch(error){this.log.error(error instanceof Error?error.message:'Falha no monitor pré-pago')}
  finally{this.running=false}
 }
}
