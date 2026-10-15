import { BadGatewayException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from './auth';
import { PlatformAccessService } from './platform-access.service';
import { PrismaService } from './prisma.service';
import { activeSessionStatuses, intId } from './persistence';
import { remoteDevelopment } from './remote-development';
import { GieService } from './gie.service';
import { GieV3Service } from './gie-v3.service';

type Demo = {gieId:string; profile:string; name:string; venueType:'posto'|'residencial'; importKw:number; exportKw:number;
  chargers:{evseId:string; powerKw:number}[]; solar:{solarId:string; inverterId:string; dcKwp:number; acKw:number}[];
  batteries:{batteryId:string; inverterId:string; capacityKwh:number; powerKw:number}[]};

// Technical envelopes copied from the versioned GIE profile manifests, never physical inventory.
const DEMOS:Demo[]=[
  {gieId:'DEMO_POSTO_24H_001',profile:'POSTO',name:'Posto 24h — Demonstração GIE',venueType:'posto',importKw:90,exportKw:60,
    chargers:[{evseId:'EVSE_01',powerKw:22},{evseId:'EVSE_02',powerKw:22}],
    solar:[{solarId:'PV_01',inverterId:'INV_01',dcKwp:25,acKw:30},{solarId:'PV_02',inverterId:'INV_02',dcKwp:25,acKw:30}],
    batteries:[{batteryId:'BAT_01',inverterId:'INV_01',capacityKwh:61.4,powerKw:12},{batteryId:'BAT_02',inverterId:'INV_02',capacityKwh:61.4,powerKw:12}]},
  {gieId:'DEMO_CASA_001',profile:'CASA',name:'Residência — Demonstração GIE',venueType:'residencial',importKw:17,exportKw:6,
    chargers:[{evseId:'EVSE_01',powerKw:7}],solar:[{solarId:'PV_01',inverterId:'INV_01',dcKwp:5.5,acKw:6}],batteries:[]},
];

function json(value:unknown):Prisma.InputJsonValue{return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;}

@Injectable()
export class GieDemoInstallationsService {
  constructor(private readonly db:PrismaService,private readonly access:PlatformAccessService,private readonly legacy:GieService,private readonly v3:GieV3Service){}
  async ensure(user:AuthUser,commercialStationId:string){
    if(remoteDevelopment())throw new ConflictException('Acesso remoto somente leitura');
    const pinned=process.env.GIE_COMMERCIAL_STATION_ID;
    if(!pinned||intId(pinned)!==intId(commercialStationId))throw new ConflictException('Confirme a identidade real da instalação comercial antes de cadastrar as demonstrações');
    await this.access.require(user,commercialStationId,'OWNER');
    try{
      await Promise.all([
        this.v3.preflightFixture('Commercial_HighAutonomy_V2','commercial','Commercial_HighAutonomy_V2'),
        this.v3.preflightFixture('DEMO_POSTO_24H_001','forecast','posto_24h_v1'),
        this.v3.preflightFixture('DEMO_CASA_001','forecast','residencial_v1'),
      ]);
    }catch(error){throw new BadGatewayException(error instanceof Error?error.message:'Pré-verificação dos perfis GIE indisponível');}
    const result=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM stations WHERE id=${intId(commercialStationId)} FOR UPDATE`;
      const commercial=await this.access.require(user,commercialStationId,'OWNER',tx);
      if(await tx.chargingSession.count({where:{charger:{stationId:commercial.id},status:{in:activeSessionStatuses}}}))
        throw new ConflictException('Aguarde o encerramento das sessões da estação comercial antes de vincular o novo GIE');
      const bound=await tx.gieStationBinding.findUnique({where:{stationId:commercial.id}});
      if(bound&&bound.gieStationId!=='Commercial_HighAutonomy_V2')throw new ConflictException('Estação comercial vinculada a outro GIE');
      const used=await tx.gieStationBinding.findUnique({where:{gieStationId:'Commercial_HighAutonomy_V2'}});
      if(used&&used.stationId!==commercial.id)throw new ConflictException('Perfil comercial já vinculado a outra estação');
      if(!bound)await tx.gieStationBinding.create({data:{stationId:commercial.id,gieStationId:'Commercial_HighAutonomy_V2',profile:'COMMERCIAL',origin:'SIMULATED'}});
      const installations=[];
      for(const demo of DEMOS){
        const existing=await tx.gieStationBinding.findUnique({where:{gieStationId:demo.gieId},include:{station:{include:{chargers:true}}}});
        if(existing){
          if(existing.station.adminId!==commercial.adminId||existing.profile!==demo.profile||
            existing.station.visibility!=='PRIVATE'||existing.station.reviewState!=='DRAFT'||
            existing.station.status!=='PENDING'||existing.station.chargers.some(c=>c.administrativeStatus!=='PENDING'))
            throw new ConflictException(`Perfil ${demo.gieId} possui vínculo ou estado comercial incompatível`);
          installations.push({stationId:existing.stationId,gieStationId:demo.gieId,created:false});
          continue;
        }
        const station=await tx.station.create({data:{adminId:commercial.adminId,name:demo.name,description:'Instalação privada de demonstração com dados sintéticos do GIE.',venueType:demo.venueType,
          postalCode:'',street:'',addressNumber:'',neighborhood:'',city:'',state:'',timezone:'America/Sao_Paulo',
          powerLimitKw:demo.importKw,status:'PENDING',reviewState:'DRAFT',visibility:'PRIVATE',guestAllowed:false,
          gieProvisioning:json({version:3,status:'DEMO_PRECONFIGURED',origin:'SIMULATED',profile:demo.gieId,
            grid:{importKw:demo.importKw,exportKw:demo.exportKw},
            ...(demo.profile==='POSTO'?{batteryUsableReferenceKwh:{BAT_01:60,BAT_02:60}}:{}),
            physical_dispatch:false,hardware_commands_sent:false}),
          staff:{create:{userId:commercial.adminId,staffRole:'OWNER'}},
          gieBinding:{create:{gieStationId:demo.gieId,profile:demo.profile,origin:'SIMULATED'}},
        }});
        for(const [index,c] of demo.chargers.entries())await tx.charger.create({data:{stationId:station.id,
          publicCode:`GIE-DEMO-${station.id}-${index+1}`,ocppIdentity:`SIMULATED_${demo.gieId}_${c.evseId}`,
          name:`${c.evseId} · simulado`,connectorType:'SIMULATED',powerKw:c.powerKw,
          configuredPowerLimitKw:c.powerKw,administrativeStatus:'PENDING',liveStatus:{create:{operationalStatus:'UNKNOWN'}}}});
        for(const asset of demo.solar)await tx.stationSolarAsset.create({data:{stationId:station.id,name:`${asset.solarId} · simulado`,installedKwp:asset.dcKwp,
          acPowerKw:asset.acKw,inverter:asset.inverterId,status:'CONFIGURED',integrationRef:`GIE:${asset.solarId}/${asset.inverterId}`}});
        for(const battery of demo.batteries)await tx.stationBattery.create({data:{stationId:station.id,name:`${battery.batteryId} · simulada`,capacityKwh:battery.capacityKwh,
          maxChargeKw:battery.powerKw,maxDischargeKw:battery.powerKw,socPercent:50,minSocPercent:20,maxSocPercent:95,
          efficiency:0.95,status:'CONFIGURED',integrationRef:`GIE:${battery.batteryId}/${battery.inverterId}`}});
        await tx.stationAuditEvent.create({data:{stationId:station.id,actorId:intId(user.sub),action:'gie.demo.created',
          details:{gieStationId:demo.gieId,origin:'SIMULATED',commercialStationId:commercial.id}}});
        installations.push({stationId:station.id,gieStationId:demo.gieId,created:true});
      }
      return {commercialStationId:commercial.id,ownerId:commercial.adminId,installations};
    },{timeout:20_000});
    this.legacy.markV3Bound(result.commercialStationId);
    return result;
  }
}
