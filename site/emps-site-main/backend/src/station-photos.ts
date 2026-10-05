import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Response } from 'express';
import { PrismaService } from './prisma.service';
import { PlatformAccessService } from './platform-access.service';
import { AuthRequest, AuthUser, JwtGuard } from './auth';
import { intId } from './persistence';
import { eligibleStationWhere } from './station-visibility';

export interface PhotoUpload {buffer:Buffer;size:number;mimetype:string}
export class PhotoPositionDto { @Type(()=>Number) @IsInt() @Min(0) @Max(4) position!:number; }
export function imageType(buffer:Buffer):string {
 if(buffer.length>8*1024*1024 || buffer.length<12)throw new BadRequestException('Imagem inválida ou maior que 8 MB');
 if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
 if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'image/webp';
 throw new BadRequestException('Use uma foto JPEG, PNG ou WebP');
}
@Injectable()
export class PhotoStorage {
 private readonly root=resolve(process.env.STATION_PHOTOS_DIR??'reports/station-photos');
 private path(key:string){if(!/^[a-f0-9-]{36}\.image$/.test(key))throw new BadRequestException('Foto inválida');return join(this.root,key)}
 async put(buffer:Buffer){await mkdir(this.root,{recursive:true});const key=randomUUID()+'.image';await writeFile(this.path(key),buffer,{flag:'wx',mode:0o600});return key}
 read(key:string){return readFile(this.path(key))}
 async remove(key:string){await unlink(this.path(key)).catch(()=>undefined)}
}
@Injectable()
export class StationPhotosService {
 constructor(private db:PrismaService,private access:PlatformAccessService,private storage:PhotoStorage){}
 async save(user:AuthUser,id:string,position:number,file?:PhotoUpload){
  if(!file)throw new BadRequestException('Selecione uma foto');
  await this.access.require(user,id,'MANAGE');
  const mimeType=imageType(file.buffer),key=await this.storage.put(file.buffer);let previous:string|undefined;
  try{
   const photo=await this.db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM stations WHERE id=${intId(id)} FOR UPDATE`;
    await this.access.require(user,id,'MANAGE',tx);
    const old=await tx.stationPhoto.findUnique({where:{stationId_position:{stationId:intId(id),position}}});previous=old?.storageKey;
    const result=await tx.stationPhoto.upsert({where:{stationId_position:{stationId:intId(id),position}},create:{stationId:intId(id),position,storageKey:key,mimeType,sizeBytes:file.size},update:{storageKey:key,mimeType,sizeBytes:file.size}});
    await tx.stationAuditEvent.create({data:{stationId:intId(id),actorId:intId(user.sub),action:'photo.saved',details:{photoId:result.id,position}}});return result;
   });if(previous)await this.storage.remove(previous);return photo;
  }catch(e){await this.storage.remove(key);throw e}
 }
 async read(id:string,user?:AuthUser){
  const photo=await this.db.stationPhoto.findUnique({where:{id},include:{station:{select:{status:true,visibility:true,reviewState:true}}}});
  if(!photo)throw new NotFoundException('Foto não encontrada');
  if(user){
   const eligible=await this.db.station.count({where:{id:photo.stationId,...eligibleStationWhere(intId(user.sub))}});
   if(!eligible)await this.access.require(user,photo.stationId);
  }
  else if(photo.station.status!=='ACTIVE'||photo.station.visibility!=='PUBLIC'||(photo.station.reviewState!==null&&photo.station.reviewState!=='APPROVED'))throw new NotFoundException('Foto não encontrada');
  try{return {data:await this.storage.read(photo.storageKey),mimeType:photo.mimeType}}catch{throw new NotFoundException('Arquivo da foto indisponível')}
 }
 async remove(user:AuthUser,id:string,photoId:string){
  const photo=await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM stations WHERE id=${intId(id)} FOR UPDATE`;await this.access.require(user,id,'MANAGE',tx);
   const photo=await tx.stationPhoto.findFirst({where:{id:photoId,stationId:intId(id)}});if(!photo)throw new NotFoundException('Foto não encontrada');
   await tx.stationPhoto.delete({where:{id:photoId}});await tx.stationAuditEvent.create({data:{stationId:intId(id),actorId:intId(user.sub),action:'photo.removed',details:{photoId}}});return photo;
  });await this.storage.remove(photo.storageKey);return {ok:true};
 }
}
@Controller('v2') @UseGuards(JwtGuard)
export class StationPhotosController {
 constructor(private photos:StationPhotosService){}
 @Post('stations/:id/photos') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:8*1024*1024,files:1,fields:1}}))
 save(@Req() r:AuthRequest,@Param('id') id:string,@Body() body:PhotoPositionDto,@UploadedFile() file?:PhotoUpload){return this.photos.save(r.user,id,body.position,file)}
 @Get('station-photos/:id') async read(@Req() r:AuthRequest,@Param('id') id:string,@Res() res:Response){const photo=await this.photos.read(id,r.user);res.setHeader('Cache-Control','private, no-store');res.type(photo.mimeType).send(photo.data)}
 @Delete('stations/:id/photos/:photoId') remove(@Req() r:AuthRequest,@Param('id') id:string,@Param('photoId') photoId:string){return this.photos.remove(r.user,id,photoId)}
}
@Controller('public/station-photos')
export class PublicStationPhotosController {
 constructor(private photos:StationPhotosService){}
 @Get(':id') async read(@Param('id') id:string,@Res() res:Response){const photo=await this.photos.read(id);res.setHeader('Cache-Control','no-store');res.type(photo.mimeType).send(photo.data)}
}
