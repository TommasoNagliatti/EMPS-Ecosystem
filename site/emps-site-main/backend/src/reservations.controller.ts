import {Body,Controller,Get,Param,Post,Req,UseGuards} from '@nestjs/common';
import {IsBoolean,IsDateString,IsString,Length,Matches} from 'class-validator';
import {AuthRequest,JwtGuard} from './auth';
import {ReservationsService} from './reservations.service';
class ReservationQuoteDto {
 @IsString() @Matches(/^[1-9]\d*$/) chargerId!:string;
 @IsDateString() startAt!:string;
 @IsDateString() endAt!:string;
}
class ReservationCreateDto extends ReservationQuoteDto {
 @IsString() @Length(64,64) termsHash!:string;
 @IsBoolean() acceptPolicy!:boolean;
 @IsString() @Length(8,100) idempotencyKey!:string;
}
@Controller('mobile/v1/reservations') @UseGuards(JwtGuard)
export class ReservationsController {
 constructor(private reservations:ReservationsService){}
 @Get() list(@Req() r:AuthRequest){return this.reservations.list(r.user.sub)}
 @Post('quote') quote(@Req() r:AuthRequest,@Body() dto:ReservationQuoteDto){return this.reservations.quote(r.user.sub,dto)}
 @Post() create(@Req() r:AuthRequest,@Body() dto:ReservationCreateDto){return this.reservations.create(r.user.sub,dto)}
 @Post(':id/pay-demo') pay(@Req() r:AuthRequest,@Param('id') id:string){return this.reservations.action(r.user.sub,id,'pay-demo')}
 @Post(':id/cancel') cancel(@Req() r:AuthRequest,@Param('id') id:string){return this.reservations.action(r.user.sub,id,'cancel')}
}
