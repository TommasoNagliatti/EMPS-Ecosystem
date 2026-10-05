import {Body,CanActivate,Controller,ExecutionContext,Get,Headers,Injectable,NotFoundException,Param,Post,Req,Res,UnauthorizedException,UseGuards} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import {Equals,IsBoolean,IsString,Length} from 'class-validator';
import type {Request,Response} from 'express';
import {AuthRequest,JwtGuard} from './auth';
import {PrismaService} from './prisma.service';
import {MobileService} from './mobile.service';
import {SessionBillingService} from './session-billing.service';
import {CreatePaymentIntentDto,StartMobileChargingDto} from './mobile.dtos';
import {createOpaqueToken,hashOpaqueToken} from './mobile.utils';
import type {ChargeSubject} from './charge-subject';
import {eligibleStationWhere} from './station-visibility';

type ChargeRequest=Request & {chargeSubject:ChargeSubject};
class GuestDto {
 @IsString() @Length(1,200) qrToken!:string;
 @IsBoolean() @Equals(true) acceptTerms!:boolean;
}
@Injectable()
export class WebChargeGuard implements CanActivate {
 constructor(private readonly db:PrismaService,private readonly jwt:JwtGuard){}
 async canActivate(context:ExecutionContext){
  const request=context.switchToHttp().getRequest<ChargeRequest>();
  const token=request.headers['x-guest-token'];
  if(token!==undefined){
   if(typeof token!=='string'||token.length<32||token.length>512)throw new UnauthorizedException('Acesso de visitante inválido');
   const guest=await this.db.guestCharge.findUnique({where:{tokenHash:hashOpaqueToken(token)}});
   if(!guest || guest.expiresAt<=new Date())throw new UnauthorizedException('Acesso de visitante expirado');
   request.chargeSubject={guestId:guest.id};
  }else{
   await this.jwt.canActivate(context);
   request.chargeSubject={userId:(request as unknown as AuthRequest).user.sub,channel:'WEB_CHARGE'};
  }
  return true;
 }
}

@Controller('web-charge')
export class PublicWebChargeController {
 constructor(private readonly mobile:MobileService,private readonly db:PrismaService){}
 @Get('qr/:token') async qr(@Param('token') token:string,@Res({passthrough:true}) response:Response){
  response.setHeader('Cache-Control','no-store');
  const resolved=await this.mobile.resolveQr(token);
  const station=await this.db.station.findUniqueOrThrow({where:{id:resolved.station.id}});
  return {...resolved,guestAllowed:station.guestAllowed,paymentProvider:(process.env.PAYMENT_PROVIDER??'sandbox').toLowerCase(),physicalGateway:!!process.env.OCPP_GATEWAY_URL};
 }
 @Post('guest') @Throttle({default:{limit:8,ttl:60000}})
 async guest(@Body() dto:GuestDto,@Res({passthrough:true}) response:Response){
  response.setHeader('Cache-Control','no-store');
  const resolved=await this.mobile.resolveQr(dto.qrToken),token=createOpaqueToken(),expiresAt=new Date(Date.now()+24*60*60*1000);
  await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM stations WHERE id=${resolved.station.id} FOR UPDATE`;
   const station=await tx.station.findFirst({where:{id:resolved.station.id,...eligibleStationWhere(),guestAllowed:true}});
   if(!station)throw new NotFoundException('Recarga como visitante indisponível');
   await tx.guestCharge.create({data:{tokenHash:hashOpaqueToken(token),chargerId:resolved.charger.id,expiresAt}});
  });
  return {token,expiresAt};
 }
}

@Controller('web-charge') @UseGuards(WebChargeGuard)
export class WebChargeController {
 constructor(private readonly mobile:MobileService,private readonly billing:SessionBillingService){}
 @Get('authorized-qr/:token') async qr(@Req() r:ChargeRequest,@Param('token') token:string){
  const subject=r.chargeSubject;
  return this.mobile.resolveQr(token,typeof subject==='object'&&'userId'in subject?subject.userId:undefined);
 }
 @Post('payment-intents') intent(@Req() r:ChargeRequest,@Body() dto:CreatePaymentIntentDto,@Headers('idempotency-key') key?:string){return this.mobile.createPaymentIntent(r.chargeSubject,dto,key);}
 @Post('payment-intents/:id/cancel') cancel(@Req() r:ChargeRequest,@Param('id') id:string){return this.mobile.cancelPaymentIntent(r.chargeSubject,id);}
 @Get('payment-intents/:id') paymentIntent(@Req() r:ChargeRequest,@Param('id') id:string){return this.mobile.paymentIntent(r.chargeSubject,id);}
 @Post('sessions/start') start(@Req() r:ChargeRequest,@Body() dto:StartMobileChargingDto,@Headers('idempotency-key') key?:string){return this.mobile.startCharging(r.chargeSubject,dto,key);}
 @Get('sessions/active') active(@Req() r:ChargeRequest){return this.mobile.activeSession(r.chargeSubject,true);}
 @Get('sessions/:id') session(@Req() r:ChargeRequest,@Param('id') id:string){return this.mobile.session(r.chargeSubject,id);}
 @Post('sessions/:id/stop') stop(@Req() r:ChargeRequest,@Param('id') id:string,@Headers('idempotency-key') key?:string){return this.mobile.stopCharging(r.chargeSubject,id,key);}
 @Get('sessions/:id/billing') quote(@Req() r:ChargeRequest,@Param('id') id:string){return this.billing.quote(r.chargeSubject,id);}
 @Post('sessions/:id/disconnect') disconnect(@Req() r:ChargeRequest,@Param('id') id:string){return this.billing.disconnect(r.chargeSubject,id);}
 @Post('sessions/:id/payment') pay(@Req() r:ChargeRequest,@Param('id') id:string){return this.billing.pay(r.chargeSubject,id);}
}
