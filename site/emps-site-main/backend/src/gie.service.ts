import { PlatformAccessService } from './platform-access.service';
import { StationScoped } from './auth';
import { BadGatewayException, Body, Controller, Get, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';
import { Prisma, Role } from '@prisma/client';
import { AuthRequest, JwtGuard, Roles, RolesGuard } from './auth';
import { PrismaService } from './prisma.service';
import { RealtimeService } from './realtime.service';
import { activeSessionStatuses, intId, stationScope } from './persistence';
import {invoice,ledgerOf,recordEnergy,unknownFacts,v1Enabled,type Facts} from './tariff-engine';
import { bill } from './billing';

export type GieEnvelope = { station_id: string; mode: string; observed_at: string;
  state: null | { execution_allowed: boolean; numeric_state: Record<string, any>; visual_state: Record<string, any>; [key: string]: any };
  presentation?: Record<string, any>; context?: {demands: any[]}; manual_events?: Record<string,string>;
  online: boolean; error?: string; };

@Injectable()
export class GieService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private pending?: Promise<GieEnvelope>;
  private cached?: GieEnvelope;
  constructor(private readonly db: PrismaService, private readonly realtime: RealtimeService) {}
  stationId() { return process.env.GIE_STATION_ID ? intId(process.env.GIE_STATION_ID) : null; }
  manages(charger: {stationId: number}) { return this.stationId() === charger.stationId && !!process.env.GIE_SERVICE_URL; }
  billingFacts():Facts {
    const e=this.cached,at=e?.observed_at??new Date().toISOString();
    if(!e?.online||!e.state?.execution_allowed||!['NORMAL','MANUAL_DEMO'].includes(e.mode)||Date.now()-Date.parse(at)>15000)return unknownFacts();
    const demands=e.context?.demands??[],connected=demands.filter(d=>d.connected).length;
    return {grid_support_for_ev:Number(e.state.flows?.grid_to_ev_kw??0)>0.00001,high_demand:demands.length>0&&connected/demands.length>=0.6,source:'gie_demo_station_allocation_and_mapped_occupancy_0.60',observed_at:at};
  }
  onModuleInit() { if (this.stationId() && process.env.GIE_SERVICE_URL) { this.timer=setInterval(()=>{void this.refresh();},5000); this.timer.unref(); } }
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
    if(this.pending) return this.pending;
    this.pending=this.collect().finally(()=>{this.pending=undefined;}); return this.pending;
  }
  private async collect(): Promise<GieEnvelope> {
    const stationId=this.stationId();
    if(!stationId) return {station_id:'',mode:'NORMAL',observed_at:new Date().toISOString(),online:false,state:null,error:'GIE não configurado'};
    let maps: any[]=[];
    try {
      maps=await this.db.gieEvseMapping.findMany({where:{stationId,isActive:true},include:{chargers:{include:{station:true,sessions:{where:{status:{in:activeSessionStatuses}}}}}},orderBy:{evseSlot:'asc'}});
      const demands=maps.map(m=>{const s=m.chargers.sessions.find((s:any)=>s.status==='ACTIVE');return {
        charger_id:String(m.chargerId),session_id:s?String(s.id):null,evse_slot:m.evseSlot,connected:!!s,
        requested_kw:s?Math.min(22,Number(m.chargers.configuredPowerLimitKw ?? m.chargers.powerKw ?? 0)):0};});
      const location=maps[0]?.chargers.station;
      await this.request('/context',{station_id:String(stationId),demands,...(location?{latitude:Number(location.latitude),longitude:Number(location.longitude),timezone:location.timezone}:{})});
      const result=await this.request('/state'); this.cached={...result,online:true} as GieEnvelope;
      // Presentation snapshots never drive commercial sessions. Manual Demo is explicitly sandbox.
      await this.sample(maps, this.cached);
      return this.cached;
    } catch(error) {
      this.cached={station_id:String(stationId),mode:'UNKNOWN',observed_at:new Date().toISOString(),online:false,state:null,
        error:error instanceof Error?error.message:'GIE indisponível'};
      await this.sample(maps,this.cached).catch(()=>undefined);
      return this.cached;
    }
  }
  private async sample(maps: any[], envelope: GieEnvelope) {
    if(process.env.OCPP_GATEWAY_URL) return; // Never fabricate physical meter readings.
    for(const m of maps) {
      const target=envelope.online && (envelope.mode==='MANUAL_DEMO'||(envelope.mode==='NORMAL'&&envelope.state?.provenance?.normal_demo===true)) && envelope.state?.execution_allowed
        ? Number(envelope.state.numeric_state.evse_setpoints_kw?.[m.evseSlot-1] ?? 0) : 0;
      const changed=await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT charger_id FROM charger_live_status WHERE charger_id=${m.chargerId} FOR UPDATE`;
        const live=await tx.chargerLiveStatus.findUnique({where:{chargerId:m.chargerId}});
        let s=await tx.chargingSession.findFirst({where:{chargerId:m.chargerId,status:'ACTIVE'}});
        if(!live || !s) return;
        await tx.$queryRaw`SELECT id FROM charging_sessions WHERE id=${s.id} FOR UPDATE`;
        s=await tx.chargingSession.findFirst({where:{chargerId:m.chargerId,status:'ACTIVE'}});if(!s)return;
        // A rollout must not advance/reprice an already-open historical session.
        const cutover=Date.parse(process.env.TARIFF_V1_ACTIVATED_AT??'');
        if(v1Enabled(m.stationId)&&!s.tariffVersion&&(!Number.isFinite(cutover)||s.requestedAt.getTime()<cutover))return;
        const ledger=ledgerOf(s);
        const now=new Date();
        const since=Math.max(ledger?Date.parse(ledger.last_at):(live.lastSeenAt ?? s.startTime ?? s.requestedAt).getTime(),(s.startTime ?? s.requestedAt).getTime());
        const seconds=Math.min(15,Math.max(0,(now.getTime()-since)/1000));
        const energy=new Prisma.Decimal(ledger?.meter_energy_kwh??s.energyKwh).add(new Prisma.Decimal(live.currentPowerKw ?? 0).mul(seconds).div(3600));
        const nextLedger=ledger?recordEnergy(ledger,energy,now,this.billingFacts()):null;
        const v1=nextLedger?invoice({...s,billingSnapshot:nextLedger}):null;
        const amount=bill(energy,s.pricePerKwhSnapshot,s.fixedFeeSnapshot,s.spendingLimit);
        await tx.chargingSession.update({where:{id:s.id},data:{...(nextLedger?{billingSnapshot:JSON.parse(JSON.stringify(nextLedger))}:{}),energyKwh:energy.toDecimalPlaces(3),totalPrice:v1?.customer.total_amount??amount.total,durationSeconds:Math.max(0,Math.floor((now.getTime()-(s.startTime ?? s.requestedAt).getTime())/1000))}});
        await tx.chargerLiveStatus.update({where:{chargerId:m.chargerId},data:{currentPowerKw:Math.max(0,Math.min(target,Number(m.chargers.powerKw ?? 22),s.spendingLimit&&v1?Math.max(0,Number(s.spendingLimit)-Number(v1.customer.total_amount)-0.01)/2.29*3600/15:Infinity)),
          meterTotalKwh:new Prisma.Decimal(s.meterStartKwh ?? 0).add(energy),lastSeenAt:now}});
        return !energy.equals(s.energyKwh) || Number(live.currentPowerKw ?? 0)!==target ? {id:s.id,clientId:s.clientId} : null;
      });
      if(changed) this.realtime.publish({topic:'session.updated',entityId:changed.id,customerId:changed.clientId ?? undefined,operational:true});
    }
  }
  async action(path: string, body: unknown={}) {
    if(this.pending) await this.pending;
    try { await this.request(path,body); const state=await this.refresh();
      this.realtime.publish({topic:'dashboard.updated',entityId:'gie',stationId:this.stationId()??undefined,operational:true}); return state;
    } catch {throw new BadGatewayException('GIE indisponível ou comando incompatível com o modo atual');}
  }
}

class GieModeDto { @IsIn(['NORMAL','SIMULATION','PRESENTATION','MANUAL_DEMO']) mode!: string; }
class GieEventDto { @IsString() event!: string; }
class GieMappingDto { @IsString() chargerId!: string; @IsInt() @Min(1) @Max(4) evseSlot!: number; }
@Controller('stations/:stationId/gie') @StationScoped() @UseGuards(JwtGuard,RolesGuard) @Roles(Role.ADMIN,Role.OPERATOR)
export class GieController {
  constructor(private readonly gie:GieService,private readonly db:PrismaService,private readonly access:PlatformAccessService){}
  @Get('state') async state(@Req() req:AuthRequest,@Param('stationId') id:string){await this.gie.allowed(req.user,id);return this.gie.refresh();}
  @Get('health') async health(@Req() req:AuthRequest,@Param('stationId') id:string){await this.gie.allowed(req.user,id);const r=await this.gie.refresh();return {online:r.online,error:r.error,stationId:id};}
  @Post('mode') async mode(@Req() req:AuthRequest,@Param('stationId') id:string,@Body() body:GieModeDto){await this.gie.allowed(req.user,id);await this.access.presentation(req.user);return this.gie.action('/mode',body);}
  @Post('presentation/:action') async presentation(@Req() req:AuthRequest,@Param('stationId') id:string,@Param('action') action:string){await this.gie.allowed(req.user,id);if(!['start','pause','resume','next','previous','reset'].includes(action)) throw new NotFoundException();await this.access.presentation(req.user);return this.gie.action('/presentation/'+action);}
  @Post('manual-demo/event') async event(@Req() req:AuthRequest,@Param('stationId') id:string,@Body() body:GieEventDto){await this.gie.allowed(req.user,id);await this.access.presentation(req.user);return this.gie.action('/manual-demo/event',body);}
  @Post('mappings') @Roles(Role.ADMIN) async mapping(@Req() req:AuthRequest,@Param('stationId') id:string,@Body() body:GieMappingDto){
    await this.gie.allowed(req.user,id); const charger=await this.db.charger.findFirst({where:{id:intId(body.chargerId),stationId:intId(id),administrativeStatus:'ENABLED'}});
    if(!charger)throw new NotFoundException('Carregador habilitado não encontrado nesta estação');
    return this.db.gieEvseMapping.upsert({where:{chargerId:charger.id},create:{chargerId:charger.id,stationId:intId(id),evseSlot:body.evseSlot},update:{evseSlot:body.evseSlot,isActive:true}});
  }
}
