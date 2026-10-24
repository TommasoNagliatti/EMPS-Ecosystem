import {Body,Controller,Headers,NotFoundException,Param,Post,Req,UseGuards} from '@nestjs/common';
import {Role} from '@prisma/client';
import {IsIn,IsInt,IsNumber,IsOptional,IsString,Min} from 'class-validator';
import {AuthRequest,JwtGuard,Roles,RolesGuard,StationScoped} from './auth';
import {ChargeLifecycleService} from './charge-lifecycle.service';
import {PrismaService} from './prisma.service';
import {bigId,stationScope} from './persistence';

class RefundConfirmationDto { @IsNumber({maxDecimalPlaces:2}) @Min(0.01) amount!:number; }
class RemovalConfirmationDto { @IsIn([true]) connectorRemoved!:true; }
class DeviceEventDto {
 @IsInt() @Min(1) chargerId!:number;
 @IsString() ocppIdentity!:string;
 @IsIn(['start_confirmed','stop_confirmed','connector_removed']) event!:'start_confirmed'|'stop_confirmed'|'connector_removed';
 @IsString() occurredAt!:string;
 @IsOptional() @IsNumber({maxDecimalPlaces:3}) @Min(0) meterTotalKwh?:number;
}
@StationScoped() @UseGuards(JwtGuard,RolesGuard) @Roles(Role.ADMIN,Role.OPERATOR)
@Controller('charging-sessions/:id')
export class ChargeLifecycleController {
 constructor(private readonly db:PrismaService,private readonly lifecycle:ChargeLifecycleService){}
 private async owned(request:AuthRequest,id:string){
  if(!await this.db.chargingSession.findFirst({where:{id:bigId(id),charger:{station:stationScope(request.user)}},select:{id:true}}))throw new NotFoundException('Sessao nao encontrada para esta conta');
 }
 @Post('confirm-removal') async removal(@Req() request:AuthRequest,@Param('id') id:string,@Body() _dto:RemovalConfirmationDto){await this.owned(request,id);return this.lifecycle.confirmRemoval(id,request.user.sub)}
 @Post('confirm-cash-refund') async refund(@Req() request:AuthRequest,@Param('id') id:string,@Body() dto:RefundConfirmationDto){await this.owned(request,id);return this.lifecycle.confirmRefund(id,dto.amount,request.user.sub)}
}
@Controller('device/v1/charging-sessions/:id')
export class DeviceChargeLifecycleController {
 constructor(private readonly lifecycle:ChargeLifecycleService){}
 @Post('events') event(@Param('id') id:string,@Headers('x-ocpp-gateway-token') token:string,@Body() dto:DeviceEventDto){return this.lifecycle.deviceEvent(id,token,dto)}
}
