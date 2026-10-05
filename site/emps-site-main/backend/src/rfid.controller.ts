import {Body,Controller,Get,Param,Post,Query,Req,UseGuards} from '@nestjs/common';
import {IsDateString,IsInt,IsOptional,IsString,Length,Min} from 'class-validator';
import {AuthRequest,JwtGuard} from './auth';
import {RfidService} from './rfid.service';
class RfidUidDto {@IsString() @Length(8,80) uid!:string}
class RfidCreateDto extends RfidUidDto {
 @IsString() @Length(1,100) label!:string;
 @IsOptional() @IsInt() @Min(1) userId?:number;
 @IsOptional() @IsString() @Length(1,100) unitReference?:string;
 @IsOptional() @IsString() @Length(1,100) vehicleReference?:string;
 @IsOptional() @IsString() @Length(1,100) organization?:string;
 @IsOptional() @IsDateString() expiresAt?:string;
}
@Controller('v2/stations/:id/rfid') @UseGuards(JwtGuard)
export class RfidController {
 constructor(private rfid:RfidService){}
 @Get() list(@Req() r:AuthRequest,@Param('id') id:string){return this.rfid.list(r.user,id)}
 @Post() create(@Req() r:AuthRequest,@Param('id') id:string,@Body() dto:RfidCreateDto){return this.rfid.create(r.user,id,dto)}
 @Post(':credentialId/revoke') revoke(@Req() r:AuthRequest,@Param('id') id:string,@Param('credentialId') credentialId:string){return this.rfid.revoke(r.user,id,credentialId)}
 @Post('authorize') authorize(@Req() r:AuthRequest,@Param('id') id:string,@Body() dto:RfidUidDto){return this.rfid.authorize(r.user,id,dto.uid)}
 @Post('demo/:chargerId/start') start(@Req() r:AuthRequest,@Param('id') id:string,@Param('chargerId') chargerId:string,@Body() dto:RfidUidDto){return this.rfid.startDemo(r.user,id,chargerId,dto.uid)}
 @Post('demo/:chargerId/stop') stop(@Req() r:AuthRequest,@Param('id') id:string,@Param('chargerId') chargerId:string){return this.rfid.stopDemo(r.user,id,chargerId)}
 @Get('monthly') monthly(@Req() r:AuthRequest,@Param('id') id:string,@Query('month') month:string){return this.rfid.monthly(r.user,id,month)}
}
