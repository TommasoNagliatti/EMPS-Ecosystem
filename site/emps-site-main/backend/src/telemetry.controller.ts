import {BadRequestException,Body,Controller,Get,Headers,Param,Post,Query,Req,UploadedFile,UseGuards,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {IsArray,IsEnum,IsString,Length,ArrayMinSize,ArrayMaxSize} from 'class-validator';
import {DataProvenance} from '@prisma/client';
import {AuthRequest,JwtGuard} from './auth';
import {TelemetryService} from './telemetry.service';
import {TelemetryInput} from './telemetry-domain';
class SourceDto {@IsString() @Length(1,100) label!:string;@IsEnum(DataProvenance) kind!:DataProvenance}
class VerifyDto {@IsString() @Length(20,2000) evidence!:string}
class DeriveDto {@IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({each:true}) parentIds!:string[]}
class IngestDto {@IsEnum(DataProvenance) provenance!:DataProvenance;@IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) rows!:TelemetryInput[]}
class ImportDto {@IsString() @Length(3,80) timezone!:string;@IsString() @Length(4,7) mode!:string}
@Controller('v2/stations/:id/telemetry') @UseGuards(JwtGuard)
export class TelemetryController {
 constructor(private telemetry:TelemetryService){}
 @Get('sources') sources(@Req() r:AuthRequest,@Param('id') id:string){return this.telemetry.sources(r.user,id)}
 @Post('sources') create(@Req() r:AuthRequest,@Param('id') id:string,@Body() dto:SourceDto){return this.telemetry.createSource(r.user,id,dto.label,dto.kind)}
 @Post('sources/:sourceId/revoke') revoke(@Req() r:AuthRequest,@Param('id') id:string,@Param('sourceId') sourceId:string){return this.telemetry.revokeSource(r.user,id,sourceId)}
 @Post('sources/:sourceId/verify') verify(@Req() r:AuthRequest,@Param('id') id:string,@Param('sourceId') sourceId:string,@Body() dto:VerifyDto){return this.telemetry.verifyPhysical(r.user,id,sourceId,dto.evidence)}
 @Post('sources/:sourceId/calculate') calculate(@Req() r:AuthRequest,@Param('id') id:string,@Param('sourceId') sourceId:string,@Body() dto:DeriveDto){return this.telemetry.calculate(r.user,id,sourceId,dto.parentIds)}
 @Get('history') history(@Req() r:AuthRequest,@Param('id') id:string,@Query('from') from:string,@Query('to') to:string,@Query('provenance') provenance?:DataProvenance){return this.telemetry.history(r.user,id,from,to,provenance)}
 @Get('readiness') readiness(@Req() r:AuthRequest,@Param('id') id:string){return this.telemetry.readiness(r.user,id)}
 @Get('dataset') dataset(@Req() r:AuthRequest,@Param('id') id:string,@Query('from') from:string,@Query('to') to:string,@Query('origin') origin:string,@Query('model') model?:string){return this.telemetry.dataset(r.user,id,from,to,origin,model)}
 @Post('import') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:8*1024*1024,files:1,fields:2}}))
 import(@Req() r:AuthRequest,@Param('id') id:string,@Body() dto:ImportDto,@UploadedFile() file?:{buffer:Buffer;originalname:string}){if(!file||!['preview','commit'].includes(dto.mode))throw new BadRequestException('Arquivo e modo preview/commit obrigatórios');return this.telemetry.importHistory(r.user,id,file,dto.timezone,dto.mode==='commit')}
}
@Controller('device/v2/stations/:id/telemetry/:sourceId')
export class DeviceTelemetryController {
 constructor(private telemetry:TelemetryService){}
 @Post() ingest(@Param('id') id:string,@Param('sourceId') sourceId:string,@Headers('x-telemetry-token') token:string,@Body() dto:IngestDto){return this.telemetry.ingest(id,sourceId,token,dto.provenance,dto.rows)}
}
