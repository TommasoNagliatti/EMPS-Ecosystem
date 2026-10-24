import { PlatformAccessService } from './platform-access.service';
import { StationScoped } from './auth';
import { BadGatewayException, BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { AuthRequest, JwtGuard, Roles, RolesGuard } from './auth';
import { PrismaService } from './prisma.service';
import { RealtimeService } from './realtime.service';
import { activeSessionStatuses, intId, stationScope } from './persistence';
import {unknownFacts,type Facts} from './tariff-engine';
import {backgroundJobsEnabled, remoteDevelopment, assertPhysicalCommandsEnabled} from './remote-development';
import {LocalGieDemoService} from './local-gie-demo.service';
import {localLegacyIntegrationDatabase} from './local-legacy-integration';
import {GieV3Service} from './gie-v3.service';
import {officialDemoRuntimeActive} from './official-demo-runtime';

export type GieEnvelope = { station_id: string; mode: string; observed_at: string;
  state: null | { execution_allowed: boolean; numeric_state: Record<string, any>; visual_state: Record<string, any>; [key: string]: any };
  presentation?: Record<string, any>; context?: {demands: any[]}; manual_events?: Record<string,string>;
  online: boolean; error?: string; isolated?: boolean; source?: string; hardware_confirmed?: boolean; };

// These actions only change the legacy GIE presentation process. Keep the
// physical-command gate for every environment outside the disposable preview.
function localPresentationOnly() {
  if (officialDemoRuntimeActive() && process.env.GIE_STATION_ID==='39' &&
      process.env.GIE_COMMERCIAL_STATION_ID==='39' && process.env.GIE_SERVICE_URL==='http://127.0.0.1:8530') return true;
  if (remoteDevelopment() || process.env.NODE_ENV !== 'development' ||
      process.env.EMPS_GIE_PRESENTATION_ACTIONS_ENABLED !== 'true' ||
      process.env.EMPS_PHYSICAL_COMMANDS_ENABLED !== 'false' ||
      process.env.EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED !== 'false' ||
      process.env.PAYMENT_PROVIDER !== 'sandbox' || process.env.HOST !== '127.0.0.1' ||
      process.env.OCPP_GATEWAY_URL || process.env.OCPP_GATEWAY_TOKEN) return false;
  try {
    const database = new URL(process.env.DATABASE_URL ?? '');
    const gie = new URL(process.env.GIE_SERVICE_URL ?? '');
    const disposablePreview = database.protocol === 'mysql:' && database.hostname === '127.0.0.1' &&
      database.port === '3307' && database.pathname === '/emps_demo_test';
    const auditedClone = localLegacyIntegrationDatabase(database) &&
      process.env.GIE_STATION_ID === '39' && process.env.GIE_COMMERCIAL_STATION_ID === '39';
    return (disposablePreview || auditedClone) &&
      gie.protocol === 'http:' && gie.hostname === '127.0.0.1' &&
      gie.port === (process.env.EMPS_GIE_PRESENTATION_ACTIONS_PORT ?? '8510') &&
      gie.pathname.replace(/\/$/, '') === '';
  } catch { return false; }
}

@Injectable()
export class GieService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GieService.name);
  private timer?: NodeJS.Timeout;
  private pending?: Promise<GieEnvelope>;
  private cached?: GieEnvelope;
  constructor(private readonly db: PrismaService, private readonly realtime: RealtimeService) {}
  stationId() { return process.env.GIE_STATION_ID ? intId(process.env.GIE_STATION_ID) : null; }
  // The presentation GIE cannot provide a billable meter. Physical gateway
  // sessions retain the existing measured-energy path; sandbox charging is independent.
  manages(charger: {stationId: number}) { return this.stationId() === charger.stationId && !!process.env.GIE_SERVICE_URL && !!process.env.OCPP_GATEWAY_URL && !!process.env.OCPP_GATEWAY_TOKEN; }
  billingFacts():Facts { return unknownFacts(); }
  async onModuleInit() {
    if(remoteDevelopment())return;
    if (backgroundJobsEnabled() && this.stationId() && process.env.GIE_SERVICE_URL) {
      this.timer=setInterval(()=>{
        void this.refresh().catch(error=>this.logger.warn(`Falha na atualização do GIE comercial: ${error instanceof Error?error.message:String(error)}`));
      },5000);
      this.timer.unref();
    }
  }
  onModuleDestroy() { if(this.timer) clearInterval(this.timer); }
  private async request(path: string, body?: unknown): Promise<any> {
    if (!process.env.GIE_SERVICE_URL || !process.env.GIE_SERVICE_TOKEN) throw new Error('GIE não configurado');
    const r=await fetch(process.env.GIE_SERVICE_URL.replace(/\/$/,'')+path, {
      method: body === undefined ? 'GET' : 'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.GIE_SERVICE_TOKEN}`},
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(Number(process.env.GIE_TIMEOUT_MS ?? 5000))});
    if(!r.ok) throw new Error(`GIE respondeu ${r.status}`);
    const data=await r.json();
    if(String(data.station_id ?? this.stationId()) !== String(this.stationId())) throw new Error('GIE associado a outra estação');
    return data;
  }
  async allowed(user: AuthRequest['user'], stationId: string) {
    if (intId(stationId)!==this.stationId() || !await this.db.station.findFirst({where:{AND:[{id:intId(stationId)},stationScope(user)]}}))
      throw new NotFoundException('GIE não associado a esta estação');
  }
  refresh(): Promise<GieEnvelope> {
    if (remoteDevelopment()) return Promise.resolve({station_id:String(this.stationId()??''),mode:'REMOTE_READ_ONLY',observed_at:new Date().toISOString(),online:false,state:null,error:'GIE operational integration disabled in remote development'});
    if(this.pending) return this.pending;
    this.pending=this.collect().finally(()=>{this.pending=undefined;}); return this.pending;
  }
  private async collect(): Promise<GieEnvelope> {
    const stationId=this.stationId();
    if(!stationId) return {station_id:'',mode:'NORMAL',observed_at:new Date().toISOString(),online:false,state:null,error:'GIE não configurado'};
    // An explicitly V3-bound station uses the V3 controller, never this presentation feed.
    if(await this.db.gieStationBinding?.findUnique({where:{stationId}})){
      this.cached={station_id:String(stationId),mode:'UNKNOWN',observed_at:new Date().toISOString(),online:false,state:null,error:'Estação gerenciada pelo GIE V3'};
      return this.cached;
    }
    let maps: any[]=[];
    try {
      maps=await this.db.gieEvseMapping.findMany({where:{stationId,isActive:true},include:{chargers:{include:{station:true,sessions:{where:{status:{in:activeSessionStatuses}}}}}},orderBy:{evseSlot:'asc'}});
      const demands=maps.map(m=>{const s=m.chargers.sessions.find((s:any)=>s.status==='ACTIVE');return {
        charger_id:String(m.chargerId),session_id:s?String(s.id):null,evse_slot:m.evseSlot,connected:!!s,
        requested_kw:s?Math.min(22,Number(m.chargers.configuredPowerLimitKw ?? m.chargers.powerKw ?? 0)):0};});
      const location=maps[0]?.chargers.station;
      await this.request('/context',{station_id:String(stationId),demands,...(location?{latitude:Number(location.latitude),longitude:Number(location.longitude),timezone:location.timezone}:{})});
      const result=await this.request('/state'); this.cached={...result,online:true} as GieEnvelope;
      return this.cached;
    } catch(error) {
      this.cached={station_id:String(stationId),mode:'UNKNOWN',observed_at:new Date().toISOString(),online:false,state:null,
        error:error instanceof Error?error.message:'GIE indisponível'};
      return this.cached;
    }
  }
  async action(path: string, body: unknown={}) {
    if (localPresentationOnly()) {
      if (!/^\/(?:mode|manual-demo\/event|presentation\/(?:start|pause|resume|next|previous|reset|loop))$/.test(path))
        throw new ForbiddenException('Ação GIE fora dos controles de apresentação locais');
      const preview = await this.refresh();
      if (!preview.online || preview.station_id !== String(this.stationId()) ||
          preview.source !== 'GIEControl' || preview.hardware_confirmed !== false)
        throw new ForbiddenException('GIE local não confirmou a origem demonstrativa');
    } else assertPhysicalCommandsEnabled();
    if(this.pending) await this.pending;
    try { await this.request(path,body); const state=await this.refresh();
      this.realtime.publish({topic:'dashboard.updated',entityId:'gie',stationId:this.stationId()??undefined,operational:true}); return state;
    } catch {throw new BadGatewayException('GIE indisponível ou comando incompatível com o modo atual');}
  }
}

class GieModeDto { @IsIn(['NORMAL','SIMULATION','PRESENTATION','MANUAL_DEMO','CHARGER_DEMO']) mode!: string; }
class GieEventDto { @IsString() event!: string; }
class GiePresentationDto { @IsOptional() @IsBoolean() enabled?: boolean; }
class GieMappingDto { @IsString() chargerId!: string; @IsInt() @Min(1) @Max(4) evseSlot!: number; }
@Controller('stations/:stationId/gie') @StationScoped() @UseGuards(JwtGuard,RolesGuard) @Roles(Role.ADMIN,Role.OPERATOR)
export class GieController {
  constructor(private readonly gie:GieService,private readonly v3:GieV3Service,private readonly db:PrismaService,private readonly access:PlatformAccessService,private readonly localDemo:LocalGieDemoService){}
  private async bound(user:AuthRequest['user'],id:string){await this.access.require(user,id,'READ');return this.v3.binding(intId(id));}
  @Get('state') async state(@Req() req:AuthRequest,@Param('stationId') id:string){if(await this.bound(req.user,id))return this.v3.state(req.user,id);if(this.localDemo.matches(id))return this.localDemo.read(req.user,id);await this.gie.allowed(req.user,id);return this.gie.refresh();}
  @Get('health') async health(@Req() req:AuthRequest,@Param('stationId') id:string){if(await this.bound(req.user,id))return this.v3.health(req.user,id);if(this.localDemo.matches(id)){const r=await this.localDemo.read(req.user,id);return {online:r.online,error:r.error,stationId:id,isolated:true};}await this.gie.allowed(req.user,id);const r=await this.gie.refresh();return {online:r.online,error:r.error,stationId:id};}
  @Post('mode') async mode(@Req() req:AuthRequest,@Param('stationId') id:string,@Body() body:GieModeDto){if(await this.bound(req.user,id))return this.v3.action(req.user,id,'mode',body);await this.gie.allowed(req.user,id);await this.access.presentation(req.user);return this.gie.action('/mode',body);}
  @Post('presentation/:action') async presentation(@Req() req:AuthRequest,@Param('stationId') id:string,@Param('action') action:string,@Body() body:GiePresentationDto){
    if(!['start','pause','resume','next','previous','reset','loop'].includes(action)) throw new NotFoundException();
    if(action==='loop' ? typeof body?.enabled!=='boolean' : body?.enabled!==undefined)
      throw new BadRequestException('Loop exige enabled booleano; outras ações não aceitam enabled');
    const options=action==='loop'?{enabled:body.enabled}:{};
    if(await this.bound(req.user,id))return this.v3.action(req.user,id,'presentation',{action,...options});
    await this.gie.allowed(req.user,id);await this.access.presentation(req.user);
    return this.gie.action('/presentation/'+action,options);
  }
  @Post('manual-demo/event') async event(@Req() req:AuthRequest,@Param('stationId') id:string,@Body() body:GieEventDto){if(await this.bound(req.user,id))return this.v3.action(req.user,id,'manual-demo/event',body);await this.gie.allowed(req.user,id);await this.access.presentation(req.user);return this.gie.action('/manual-demo/event',body);}
  @Post('cycle') async cycle(@Req() req:AuthRequest,@Param('stationId') id:string,@Body() body:unknown){if(!await this.bound(req.user,id))throw new NotFoundException('Ciclo V3 indisponível');return this.v3.cycle(req.user,id,body);}
  @Post('provision') @Roles(Role.ADMIN) async provision(@Req() req:AuthRequest,@Param('stationId') id:string){return this.v3.provision(req.user,id);}
  @Post('alerts/:alertId/ack') async acknowledge(@Req() req:AuthRequest,@Param('stationId') id:string,@Param('alertId') alertId:string){return this.v3.acknowledge(req.user,id,alertId);}
  @Post('mappings') @Roles(Role.ADMIN) async mapping(@Req() req:AuthRequest,@Param('stationId') id:string,@Body() body:GieMappingDto){
    await this.gie.allowed(req.user,id); const charger=await this.db.charger.findFirst({where:{id:intId(body.chargerId),stationId:intId(id),administrativeStatus:'ENABLED'}});
    if(!charger)throw new NotFoundException('Carregador habilitado não encontrado nesta estação');
    return this.db.gieEvseMapping.upsert({where:{chargerId:charger.id},create:{chargerId:charger.id,stationId:intId(id),evseSlot:body.evseSlot},update:{evseSlot:body.evseSlot,isActive:true}});
  }
}
