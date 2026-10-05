import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { PlatformAccessService } from './platform-access.service';
import { NotificationGateway } from './notification.gateway';
import { StationDraftDto, ReviewDto } from './platform.dtos';
import { aggregateStorage, validateTimezone } from './platform-domain';
import { intId, stationScope, activeSessionStatuses } from './persistence';
import type { AuthUser } from './auth';
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const include={batteries:true,solarAssets:true,amenities:true,photos:{orderBy:{position:'asc' as const}},chargers:{include:{liveStatus:true,tariffs:true,qrBindings:true}},reviews:{orderBy:{createdAt:'desc' as const},take:1}};

@Injectable()
export class PlatformStationsService {
  constructor(private db:PrismaService,private access:PlatformAccessService,private notifications:NotificationGateway){}
  async chargers(user:AuthUser){
    return this.db.charger.findMany({where:{station:stationScope({...user,selectedStationId:undefined,stationPermission:'READ'})},include:{station:{select:{id:true,name:true,reviewState:true}},liveStatus:true,qrBindings:{where:{isActive:true},orderBy:{id:'desc'},take:1}},orderBy:[{stationId:'asc'},{id:'asc'}]});
  }
  private async ensureQr(tx:Prisma.TransactionClient,chargerId:number){
    const existing=await tx.qrBinding.findFirst({where:{chargerId,isActive:true},orderBy:{id:'desc'}});
    return existing??tx.qrBinding.create({data:{chargerId,code:'QR-'+randomBytes(10).toString('hex'),publicToken:randomBytes(32).toString('base64url')}});
  }
  async chargerQr(user:AuthUser,id:string){
    return this.db.$transaction(async tx=>{
      const charger=await tx.charger.findUnique({where:{id:intId(id)}});
      if(!charger)throw new NotFoundException('Carregador não encontrado');
      await tx.$queryRaw`SELECT id FROM stations WHERE id=${charger.stationId} FOR UPDATE`;
      await this.access.require(user,String(charger.stationId),'MANAGE',tx);
      const current=await tx.charger.findUniqueOrThrow({where:{id:charger.id}});
      if(current.administrativeStatus==='DISABLED')throw new ConflictException('Carregador desabilitado');
      return this.ensureQr(tx,current.id);
    });
  }
  async list(user:AuthUser){
    const rows=await this.db.station.findMany({where:stationScope({...user,selectedStationId:undefined,stationPermission:'READ'}),include:{photos:{orderBy:{position:'asc'},take:1},_count:{select:{chargers:true}},staff:{where:{userId:intId(user.sub)}}},orderBy:{createdAt:'desc'}});
    return rows.map(s=>({...s,membershipRole:s.adminId===intId(user.sub)?'OWNER':s.staff[0]?.staffRole,gieStatus:s.gieProvisioning?'BASE_PROVISIONED':String(s.id)===process.env.GIE_STATION_ID?'DEMO_CONNECTED':'NOT_PROVISIONED',reviewState:s.reviewState??(s.status==='ACTIVE'?'APPROVED':'DRAFT')}));
  }
  async get(user:AuthUser,id:string){
    const membership=await this.access.require(user,id);
    const s=await this.db.station.findUniqueOrThrow({where:{id:membership.id},include});
    return {...s,membershipRole:membership.membershipRole,storage:aggregateStorage(s.batteries),reviewState:s.reviewState??(s.status==='ACTIVE'?'APPROVED':'DRAFT')};
  }
  async create(user:AuthUser){
    const s=await this.db.station.create({data:{adminId:intId(user.sub),name:'Nova estação',postalCode:'',street:'',addressNumber:'',neighborhood:'',city:'',state:'',status:'PENDING',reviewState:'DRAFT',visibility:'PRIVATE',staff:{create:{userId:intId(user.sub),staffRole:'OWNER'}}}});
    return this.get(user,String(s.id));
  }
  private validate(dto:StationDraftDto){
    if(dto.timezone)try{validateTimezone(dto.timezone)}catch{throw new BadRequestException('Timezone inválido')}
    if(dto.batteries?.some(b=>b.minSocPercent>=b.maxSocPercent))throw new BadRequestException('SOC mínimo deve ser menor que o máximo');
    for(const rows of [dto.batteries,dto.solarAssets,dto.chargers]){const ids=rows?.map(r=>r.id).filter(Boolean)??[];if(new Set(ids).size!==ids.length)throw new BadRequestException('Ativo duplicado')}
  }
  private async apply(tx:Prisma.TransactionClient,id:number,dto:StationDraftDto){
    const {batteries,solarAssets,chargers,amenities,reservationPolicyText,availability,...data}=dto;
    await tx.station.update({where:{id},data:{...data,...(availability?{availability:json(availability)}:{}),...(reservationPolicyText?{reservationPolicy:json({text:reservationPolicyText,cancellation:'MANUAL_REVIEW',noShowMinutes:15})}:{})}});
    if(amenities){await tx.stationAmenity.deleteMany({where:{stationId:id}});await tx.stationAmenity.createMany({data:[...new Set(amenities)].map(amenityName=>({stationId:id,amenityName}))})}
    if(batteries){
      const retained:string[]=[];
      for(const b of batteries){const {id:assetId,...data}=b;if(assetId){if(!await tx.stationBattery.findFirst({where:{id:assetId,stationId:id}}))throw new BadRequestException('Bateria de outra estação');await tx.stationBattery.update({where:{id:assetId},data});retained.push(assetId)}else retained.push((await tx.stationBattery.create({data:{stationId:id,...data}})).id)}
      // Preserve removed equipment identities as inactive rather than deleting history.
      await tx.stationBattery.updateMany({where:{stationId:id,id:{notIn:retained}},data:{status:'INACTIVE'}});
    }
    if(solarAssets){
      const retained:string[]=[];
      for(const a of solarAssets){const {id:assetId,...data}=a;if(assetId){if(!await tx.stationSolarAsset.findFirst({where:{id:assetId,stationId:id}}))throw new BadRequestException('Ativo solar de outra estação');await tx.stationSolarAsset.update({where:{id:assetId},data});retained.push(assetId)}else retained.push((await tx.stationSolarAsset.create({data:{stationId:id,...data}})).id)}
      await tx.stationSolarAsset.updateMany({where:{stationId:id,id:{notIn:retained}},data:{status:'INACTIVE'}});
    }
    if(chargers){
      const retained:number[]=[];
      for(const c of chargers){
        const {id:chargerId,pricePerKwh,...data}=c;
        let saved;
        if(chargerId){
          if(!await tx.charger.findFirst({where:{id:chargerId,stationId:id}}))throw new BadRequestException('Carregador de outra estação');
          saved=await tx.charger.update({where:{id:chargerId},data});
        }else saved=await tx.charger.create({data:{...data,stationId:id,publicCode:'CH-'+randomBytes(10).toString('hex'),administrativeStatus:'PENDING',liveStatus:{create:{operationalStatus:'UNKNOWN'}}}});
        retained.push(saved.id);
        if(saved.administrativeStatus!=='DISABLED')await this.ensureQr(tx,saved.id);
        else await tx.qrBinding.updateMany({where:{chargerId:saved.id,isActive:true},data:{isActive:false,revokedAt:new Date()}});
        if(pricePerKwh!==undefined){
          const current=await tx.tariff.findFirst({where:{chargerId:saved.id,status:'ACTIVE'},orderBy:{validFrom:'desc'}});
          if(!current || Number(current.basePricePerKwh)!==pricePerKwh){
            await tx.tariff.updateMany({where:{chargerId:saved.id,status:'ACTIVE'},data:{status:'INACTIVE'}});
            await tx.tariff.create({data:{stationId:id,chargerId:saved.id,name:'Tarifa configurada',basePricePerKwh:pricePerKwh,status:'ACTIVE',validFrom:new Date()}});
          }
        }
      }
      const removed={stationId:id,id:{notIn:retained}};
      if(await tx.chargingSession.count({where:{charger:removed,status:{in:activeSessionStatuses}}}))throw new ConflictException('Não é possível retirar carregador com sessão em andamento');
      await tx.charger.updateMany({where:removed,data:{administrativeStatus:'DISABLED'}});
      await tx.qrBinding.updateMany({where:{charger:removed,isActive:true},data:{isActive:false,revokedAt:new Date()}});
    }
  }
  async save(user:AuthUser,id:string,dto:StationDraftDto){
    this.validate(dto);
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM stations WHERE id=${intId(id)} FOR UPDATE`;
      const s=await this.access.require(user,id,'MANAGE',tx);
      if(s.reviewState==='PENDING_REVIEW')throw new ConflictException('Estação em análise; aguarde a decisão');
      if(s.technicalReviewRequired)throw new ConflictException('Alteração técnica em análise; aguarde a decisão');
      if(s.status==='ACTIVE'&&(dto.batteries!==undefined||dto.solarAssets!==undefined||dto.chargers!==undefined||dto.powerLimitKw!==undefined)){
        await tx.stationReview.create({data:{stationId:s.id,submittedBy:intId(user.sub),proposedConfig:json(dto)}});
        await tx.station.update({where:{id:s.id},data:{technicalReviewRequired:true}});
      }else await this.apply(tx,s.id,dto);
      await tx.stationAuditEvent.create({data:{stationId:s.id,actorId:intId(user.sub),action:'station.saved'}});
    });return this.get(user,id);
  }
  private minimum(s:{name:string;street:string;city:string;state:string;postalCode:string;latitude:unknown;longitude:unknown;powerLimitKw:unknown;chargers:{administrativeStatus:string}[];timezone:string}){
    if(!s.name.trim()||!s.street||!s.city||!s.state||!s.postalCode||s.latitude===null||s.longitude===null||Number(s.powerLimitKw)<=0||!s.chargers.some(c=>c.administrativeStatus!=='DISABLED'))throw new BadRequestException('Complete localização, limite elétrico e ao menos um carregador antes da análise');
    validateTimezone(s.timezone);
  }
  async submit(user:AuthUser,id:string){
    const result=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM stations WHERE id=${intId(id)} FOR UPDATE`;
      const s=await this.access.require(user,id,'OWNER',tx);
      if(!['DRAFT','CHANGES_REQUESTED','REJECTED'].includes(s.reviewState??''))throw new ConflictException('Estado não permite envio');
      const full=await tx.station.findUniqueOrThrow({where:{id:s.id},include});this.minimum(full);
      const {reviews:previousReviews,...snapshot}=full;
      const review=await tx.stationReview.create({data:{stationId:s.id,submittedBy:intId(user.sub),proposedConfig:json(snapshot)}});
      await tx.station.update({where:{id:s.id},data:{reviewState:'PENDING_REVIEW'}});
      await tx.stationAuditEvent.create({data:{stationId:s.id,actorId:intId(user.sub),action:'review.submitted',details:{reviewId:review.id}}});
      return review;
    });await this.notifications.send('station-review',{reviewId:result.id,stationId:id,technicalSummary:result.proposedConfig});return result;
  }
  async reviews(user:AuthUser){await this.access.reviewer(user);return this.db.stationReview.findMany({where:{state:'PENDING_REVIEW'},include:{station:{include:{batteries:true,solarAssets:true,amenities:true,chargers:{include:{tariffs:true}}}}},orderBy:{createdAt:'asc'}})}
  async review(user:AuthUser,reviewId:string,dto:ReviewDto){
    await this.access.reviewer(user);
    if(dto.activateDemoChargers){await this.access.presentation(user);if(process.env.NODE_ENV==='production')throw new BadRequestException('Ativação demonstrativa indisponível em produção');}
    return this.db.$transaction(async tx=>{
      const review=await tx.stationReview.findUnique({where:{id:reviewId}});if(!review)throw new NotFoundException('Revisão não encontrada');
      await tx.$queryRaw`SELECT id FROM stations WHERE id=${review.stationId} FOR UPDATE`;
      const current=await tx.stationReview.findUniqueOrThrow({where:{id:reviewId}});if(current.state!=='PENDING_REVIEW')throw new ConflictException('Revisão já decidida');
      const s=await tx.station.findUniqueOrThrow({where:{id:review.stationId}});
      if(dto.decision==='APPROVED'){
        if(s.technicalReviewRequired)await this.apply(tx,s.id,review.proposedConfig as unknown as StationDraftDto);
        const full=await tx.station.findUniqueOrThrow({where:{id:s.id},include});this.minimum(full);
        if(dto.activateDemoChargers){
          for(const charger of full.chargers.filter(c=>c.administrativeStatus==='PENDING')){
            if(!charger.tariffs.some(t=>t.status==='ACTIVE'))throw new BadRequestException('Configure a tarifa antes de ativar o carregador DEMO');
            await tx.charger.update({where:{id:charger.id},data:{administrativeStatus:'ENABLED',liveStatus:{upsert:{create:{operationalStatus:'AVAILABLE',currentPowerKw:0},update:{operationalStatus:'AVAILABLE',currentPowerKw:0}}}}});
            if(!charger.qrBindings.some(q=>q.isActive))await tx.qrBinding.create({data:{chargerId:charger.id,code:'QR-'+randomBytes(10).toString('hex'),publicToken:randomBytes(32).toString('base64url')}});
            await tx.chargingCommand.create({data:{chargerId:charger.id,clientId:intId(user.sub),type:'RUN_CHECKLIST',status:'ACCEPTED',requestPayload:{kind:'platform-v2-demo',provenance:'SIMULATED',physicalConnectionVerified:false},processedAt:new Date()}});
          }
        }
        const provision={version:2,model:'GIE Base',status:'PENDING_GIE_V2',station_id:s.id,timezone:full.timezone,availability:full.availability,grid:{powerLimitKw:full.powerLimitKw},batteries:full.batteries,solarAssets:full.solarAssets,chargers:full.chargers.map(c=>({id:c.id,powerKw:c.powerKw,ocppIdentity:c.ocppIdentity})),compatibilityStorage:aggregateStorage(full.batteries),individualControlAvailable:false};
        await tx.station.update({where:{id:s.id},data:{status:'ACTIVE',reviewState:'APPROVED',technicalReviewRequired:false,gieProvisioning:json(provision)}});
      }else await tx.station.update({where:{id:s.id},data:s.status==='ACTIVE'?{technicalReviewRequired:false}:{reviewState:dto.decision}});
      await tx.stationReview.update({where:{id:reviewId},data:{state:dto.decision,reason:dto.reason,reviewedBy:intId(user.sub),reviewedAt:new Date()}});
      await tx.stationAuditEvent.create({data:{stationId:s.id,actorId:intId(user.sub),action:'review.'+dto.decision.toLowerCase(),details:{reviewId,reason:dto.reason}}});
      return {stationId:s.id,decision:dto.decision};
    });
  }
}
