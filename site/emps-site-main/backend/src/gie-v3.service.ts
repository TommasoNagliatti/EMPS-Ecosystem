import { BadGatewayException, ConflictException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AlertSeverity, AlertStatus, Prisma } from '@prisma/client';
import type { AuthUser } from './auth';
import { PlatformAccessService } from './platform-access.service';
import { PrismaService } from './prisma.service';
import { RealtimeService } from './realtime.service';
import { backgroundJobsEnabled, remoteDevelopment } from './remote-development';
import { activeSessionStatuses } from './persistence';
import { buildGieV3Provision } from './gie-v3-provision';
import { GieV3Event, GieV3Health, GieV3State, parseGieV3Events, parseGieV3Health, parseGieV3State } from './gie-v3-contract';

export type GieV3Envelope = {
  station_id: string; gie_station_id: string; generation: string | null;
  mode: string; observed_at: string; online: boolean; state: Record<string,unknown> | null;
  decision_time?: string | null; presentation?: unknown;
  health: GieV3Health | null; source: 'SIMULATED'; physical_dispatch: false;
  hardware_commands_sent: false; capabilities?: GieV3State['capabilities'];
  history?: GieV3State['history'];
  simulation_state?: Record<string,unknown> | null; error?: string; event_feed_error?: string;
};

function json(value:unknown):Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function date(value:string) { const d=new Date(value); if(!Number.isFinite(d.getTime()))throw new Error('Timestamp GIE inválido'); return d; }
function severity(value:GieV3Event['alert']['severity']):AlertSeverity {
  return value==='critical'?'CRITICAL':value==='error'?'HIGH':value==='warning'?'MEDIUM':'LOW';
}
function status(value:GieV3Event['alert']['status']):AlertStatus {
  return value==='RESOLVED'?'RESOLVED':value==='ACKNOWLEDGED'?'CHECKING':'OPEN';
}

@Injectable()
export class GieV3Service implements OnModuleInit, OnModuleDestroy {
  private readonly pending=new Map<number,Promise<GieV3Envelope>>();
  private readonly cache=new Map<number,GieV3Envelope>();
  private poller?:NodeJS.Timeout;
  constructor(private readonly db:PrismaService,private readonly access:PlatformAccessService,private readonly realtime:RealtimeService){}

  onModuleInit(){
    if(backgroundJobsEnabled()&&process.env.GIE_V3_SERVICE_URL&&process.env.GIE_V3_SERVICE_TOKEN){
      this.poller=setInterval(()=>{void this.poll().catch(()=>undefined);},15_000);
      this.poller.unref();
    }
  }
  onModuleDestroy(){if(this.poller)clearInterval(this.poller);}
  private async poll(){
    const bindings=await this.db.gieStationBinding.findMany({select:{stationId:true}});
    await Promise.allSettled(bindings.map(binding=>this.refresh(binding.stationId,false)));
  }
  async binding(stationId:number){return this.db.gieStationBinding.findUnique({where:{stationId}});}

  /** Recently verified display state only. Physical laboratory heartbeats must never wait on Python. */
  cachedState(stationId:number,maxAgeMs:number):GieV3Envelope|null{
    const state=this.cache.get(stationId);
    const age=state?Date.now()-Date.parse(state.observed_at):Infinity;
    return state?.online&&Number.isFinite(age)&&age>=0&&age<=maxAgeMs?state:null;
  }

  async preflightFixture(gieStationId:string,kind:'commercial'|'forecast',profile:string){
    const health=parseGieV3Health(await this.request(this.path(gieStationId,'health')),gieStationId);
    const configuration=await this.request(`/v2/stations/${encodeURIComponent(gieStationId)}/configuration`);
    if(!configuration||typeof configuration!=='object'||Array.isArray(configuration))throw new Error('Configuração GIE inválida');
    const cfg=configuration as Record<string,unknown>;
    if(cfg.station_id!==gieStationId||cfg.kind!==kind||cfg.profile!==profile)
      throw new Error('Perfil GIE diferente do manifesto esperado');
    return health;
  }

  async preflightFixtureDecision(gieStationId:string){
    const result=parseGieV3State(await this.request(this.path(gieStationId,'state')),gieStationId);
    const decision=result.state;
    const visual=decision?.visual_state;
    if(result.revision<1||!decision||decision.execution_allowed!==true||
      !visual||typeof visual!=='object'||Array.isArray(visual)||
      (visual as Record<string,unknown>).valid!==true)
      throw new Error('Worker GIE não possui decisão simulada válida');
    return result;
  }

  private async request(path:string,method:'GET'|'POST'='GET',body?:unknown,provision=false):Promise<unknown>{
    const base=process.env.GIE_V3_SERVICE_URL, token=provision?process.env.GIE_V3_PROVISIONING_TOKEN:process.env.GIE_V3_SERVICE_TOKEN;
    if(!base||!token||token.length<24)throw new Error('Serviço GIE V3 não configurado');
    const timeout=Number(process.env.GIE_V3_TIMEOUT_MS??'7000');
    if(!Number.isInteger(timeout)||timeout<1000||timeout>60000)throw new Error('Timeout GIE V3 inválido');
    const response=await fetch(base.replace(/\/$/,'')+path,{
      method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:method==='POST'?JSON.stringify(body??{}):undefined,signal:AbortSignal.timeout(timeout),
    });
    if(!response.ok)throw new Error(`GIE V3 respondeu ${response.status}`);
    return response.json();
  }
  private path(gieStationId:string,suffix:string){return `/v1/stations/${encodeURIComponent(gieStationId)}/${suffix}`;}
  private offline(stationId:number,gieStationId:string,reason:string,health:GieV3Health|null=null):GieV3Envelope{
    return {station_id:String(stationId),gie_station_id:gieStationId,generation:health?.generation??null,
      mode:'UNKNOWN',observed_at:new Date().toISOString(),online:false,state:null,health,source:'SIMULATED',
      physical_dispatch:false,hardware_commands_sent:false,error:reason};
  }
  private envelope(stationId:number,gieStationId:string,health:GieV3Health,state:GieV3State):GieV3Envelope{
    if(health.generation!==state.generation)throw new Error('Geração GIE alterada durante consulta');
    const decisionTime=state.state && typeof state.state.timestamp==='string'?state.state.timestamp:null;
    return {station_id:String(stationId),gie_station_id:gieStationId,generation:state.generation,mode:state.mode,
      observed_at:new Date().toISOString(),decision_time:decisionTime,presentation:state.presentation,
      online:true,state:state.state,health,source:'SIMULATED',physical_dispatch:false,
      hardware_commands_sent:false,capabilities:state.capabilities,simulation_state:state.simulation_state,
      history:state.history};
  }
  private async collect(stationId:number,startStopped:boolean):Promise<GieV3Envelope>{
    const binding=await this.binding(stationId);
    if(!binding)throw new NotFoundException('GIE V3 não associado a esta estação');
    const sid=binding.gieStationId;
    if(remoteDevelopment())return this.offline(stationId,sid,'Integração operacional indisponível em acesso remoto somente leitura');
    let health:GieV3Health|null=null;
    try{
      health=parseGieV3Health(await this.request(this.path(sid,'health')),sid);
      if(health.status==='stopped'&&startStopped){
        parseGieV3State(await this.request(this.path(sid,'initialize'),'POST',{}),sid);
        health=parseGieV3Health(await this.request(this.path(sid,'health')),sid);
      }
      if(binding.lastGeneration&&health.generation!==binding.lastGeneration)this.cache.delete(stationId);
      if(health.status!=='running'){
        this.cache.delete(stationId);
        const result=this.offline(stationId,sid,health.error??`Worker GIE ${health.status}`,health);
        try{await this.syncEvents(stationId,sid);}
        catch(error){result.event_feed_error=error instanceof Error?error.message:'Eventos GIE indisponíveis';}
        return result;
      }
      const state=parseGieV3State(await this.request(this.path(sid,'state')),sid);
      const result=this.envelope(stationId,sid,health,state);
      this.cache.set(stationId,result);
      if(binding.lastGeneration!==state.generation)
        await this.db.gieStationBinding.update({where:{stationId},data:{lastGeneration:state.generation}});
      try{await this.syncEvents(stationId,sid);}
      catch(error){result.event_feed_error=error instanceof Error?error.message:'Eventos GIE indisponíveis';}
      return result;
    }catch(error){
      this.cache.delete(stationId);
      return this.offline(stationId,sid,error instanceof Error?error.message:'GIE V3 indisponível',health);
    }
  }
  refresh(stationId:number,startStopped=true):Promise<GieV3Envelope>{
    const existing=this.pending.get(stationId);if(existing)return existing;
    const task=this.collect(stationId,startStopped).finally(()=>{this.pending.delete(stationId);});
    this.pending.set(stationId,task);return task;
  }
  async state(user:AuthUser,stationId:string){
    const station=await this.access.require(user,stationId,'READ');
    return this.refresh(station.id);
  }
  async health(user:AuthUser,stationId:string){
    const station=await this.access.require(user,stationId,'READ');
    const result=await this.refresh(station.id);
    return {stationId,gieStationId:result.gie_station_id,online:result.online,generation:result.generation,
      status:result.health?.status??'unavailable',source:result.source,error:result.error,
      physical_dispatch:false,hardware_commands_sent:false};
  }
  async action(user:AuthUser,stationId:string,kind:'mode'|'presentation'|'manual-demo/event'|'cycle',body:unknown){
    const station=await this.access.require(user,stationId,'OPERATE');
    if(station.membershipRole!=='OWNER')await this.access.presentation(user);
    const binding=await this.binding(station.id);if(!binding)throw new NotFoundException('GIE V3 não associado');
    if(remoteDevelopment())throw new ConflictException('Acesso remoto somente leitura');
    try{
      const parsed=parseGieV3State(await this.request(this.path(binding.gieStationId,kind),'POST',body),binding.gieStationId);
      this.cache.delete(station.id);
      const result=await this.refresh(station.id,false);
      if(!result.online||result.generation!==parsed.generation)throw new Error('GIE não confirmou a geração da ação');
      this.realtime.publish({topic:'dashboard.updated',entityId:'gie',stationId:station.id,operational:true});
      return result;
    }catch(error){throw new BadGatewayException(error instanceof Error?error.message:'Ação GIE indisponível');}
  }
  async cycle(user:AuthUser,stationId:string,body:unknown){
    const station=await this.access.require(user,stationId,'OPERATE');
    if(station.membershipRole!=='OWNER')await this.access.presentation(user);
    const binding=await this.binding(station.id);if(!binding)throw new NotFoundException('GIE V3 não associado');
    if(binding.profile!=='BASELINE'){
      if(body&&typeof body==='object'&&Object.keys(body).length)throw new ConflictException('Perfis demonstrativos usam apenas o ciclo de fixture');
      return this.action(user,stationId,'cycle',{});
    }
    if(!body||typeof body!=='object'||Array.isArray(body))throw new ConflictException('Ciclo BASELINE requer instante explícito');
    const cycle=body as Record<string,unknown>;
    if(typeof cycle.issue_time!=='string'||!/[+-]\d\d:\d\d$|Z$/.test(cycle.issue_time)||!Number.isFinite(Date.parse(cycle.issue_time)))
      throw new ConflictException('issue_time deve ter offset');
    if(cycle.current!==undefined){
      if(!cycle.current||typeof cycle.current!=='object'||Array.isArray(cycle.current))throw new ConflictException('Current inválido');
      const current=cycle.current as Record<string,unknown>;
      if(current.station_id!==binding.gieStationId||current.origin!=='SIMULATED'||
        !['TRUSTED','UNTRUSTED'].includes(String(current.quality)))throw new ConflictException('Origem ou identidade do current inválida');
    }
    if(remoteDevelopment())throw new ConflictException('Acesso remoto somente leitura');
    try{
      parseGieV3State(await this.request(`/v2/stations/${encodeURIComponent(binding.gieStationId)}/cycle`,'POST',body),binding.gieStationId);
      this.cache.delete(station.id);
      const result=await this.refresh(station.id,false);
      if(!result.online)throw new Error(result.error??'GIE indisponível');
      this.realtime.publish({topic:'dashboard.updated',entityId:'gie',stationId:station.id,operational:true});
      return result;
    }catch(error){throw new BadGatewayException(error instanceof Error?error.message:'Ciclo GIE indisponível');}
  }
  async provision(user:AuthUser,stationId:string){
    const station=await this.access.require(user,stationId,'OWNER');
    if([process.env.GIE_COMMERCIAL_STATION_ID,process.env.GIE_STATION_ID].includes(String(station.id)))
      throw new ConflictException('Instalação comercial usa a vinculação do perfil congelado, não BASELINE');
    if(station.reviewState!=='APPROVED')throw new ConflictException('Provisionamento exige configuração técnica aprovada');
    if(remoteDevelopment())throw new ConflictException('Acesso remoto somente leitura');
    const full=await this.db.station.findUniqueOrThrow({where:{id:station.id},include:{batteries:true,solarAssets:true,chargers:true}});
    const contract=buildGieV3Provision(full);
    const existing=await this.binding(station.id);
    if(existing&&(existing.gieStationId!==contract.station_id||existing.profile!=='BASELINE'))throw new ConflictException('Estação já vinculada a outro perfil GIE');
    try{
      const response=await this.request('/v2/stations','POST',contract,true);
      const cfg=response as Record<string,unknown>;
      if(cfg.station_id!==contract.station_id)throw new Error('Provisionamento retornou outra estação');
      // Provision and read credentials have separate explicit scopes in FastAPI.
      parseGieV3Health(await this.request(this.path(contract.station_id,'health')),contract.station_id);
    }catch(error){
      throw new BadGatewayException(error instanceof Error?error.message:'Provisionamento GIE indisponível');
    }
    // A failed remote provision must never reroute the station's dashboard or billing.
    if(!existing){
      await this.db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM stations WHERE id=${station.id} FOR UPDATE`;
        if(await tx.chargingSession.count({where:{charger:{stationId:station.id},status:{in:activeSessionStatuses}}}))
          throw new ConflictException('Aguarde o encerramento das sessões antes de vincular o GIE V3');
        const current=await tx.gieStationBinding.findUnique({where:{stationId:station.id}});
        if(current&&(current.gieStationId!==contract.station_id||current.profile!=='BASELINE'))
          throw new ConflictException('Estação vinculada a outro perfil GIE');
        if(!current)await tx.gieStationBinding.create({data:{stationId:station.id,gieStationId:contract.station_id,profile:'BASELINE',origin:'SIMULATED'}});
      });
    }
    return {stationId:station.id,gieStationId:contract.station_id,status:'PROVISIONED',origin:'SIMULATED'};
  }
  private async syncEvents(stationId:number,sid:string){
    const binding=await this.binding(stationId);if(!binding)return;
    const raw=await this.request(`${this.path(sid,'events')}?after=${binding.lastEventCursor}`);
    const events=parseGieV3Events(raw,sid,binding.lastEventCursor);
    for(const event of events)await this.persistEvent(stationId,event);
  }
  private async persistEvent(stationId:number,event:GieV3Event){
    const a=event.alert;
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT station_id FROM gie_station_bindings WHERE station_id=${stationId} FOR UPDATE`;
      const binding=await tx.gieStationBinding.findUniqueOrThrow({where:{stationId}});
      if(event.cursor<=binding.lastEventCursor)return;
      const existing=await tx.alert.findUnique({where:{gieAlertId:a.alert_id}});
      if(existing&&existing.stationId!==stationId)throw new Error('Alerta GIE associado a outra estação');
      const receivedAt=new Date();
      // Alert lifecycle timestamps describe when EMPS observed a transition. The original
      // SIMULATED scenario timestamp stays intact in giePayload, including old fixture dates.
      const resolvedAt=a.status==='RESOLVED'
        ? (existing?.createdAt && existing.createdAt>receivedAt ? existing.createdAt : receivedAt)
        : null;
      const data={stationId,alertType:`GIE:${a.code}`.slice(0,100),title:a.title.slice(0,150),description:a.description,
        severity:severity(a.severity),status:status(a.status),alertSource:'GIE' as const,errorCode:a.code.slice(0,100),
        gieLastRevision:a.revision,gieGeneration:a.generation,giePayload:json(event),
        acknowledgedAt:a.acknowledged_at?date(String(a.acknowledged_at)):null,
        resolvedAt};
      if(existing){
        if(a.revision>existing.gieLastRevision)await tx.alert.update({where:{id:existing.id},data});
      }else await tx.alert.create({data:{...data,gieAlertId:a.alert_id,createdAt:receivedAt}});
      await tx.gieStationBinding.update({where:{stationId},data:{lastEventCursor:event.cursor}});
    });
    this.realtime.publish({topic:'alert.updated',entityId:a.alert_id,stationId,operational:true});
  }
  async acknowledge(user:AuthUser,stationId:string,alertId:string){
    const station=await this.access.require(user,stationId,'OPERATE');
    const binding=await this.binding(station.id);if(!binding)throw new NotFoundException('GIE V3 não associado');
    const alert=await this.db.alert.findFirst({where:{stationId:station.id,gieAlertId:alertId}});
    if(!alert)throw new NotFoundException('Alerta GIE não encontrado');
    if(alert.status==='RESOLVED')return alert;
    await this.request(`${this.path(binding.gieStationId,'alerts')}/${encodeURIComponent(alertId)}/ack`,'POST',{});
    await this.syncEvents(station.id,binding.gieStationId);
    return this.db.alert.findUnique({where:{id:alert.id}});
  }
}
