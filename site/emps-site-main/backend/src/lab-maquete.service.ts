import { chargerDemoEnabled, chargerDemoEnergy } from './charger-demo-mode';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from './auth';
import { GieV3Service } from './gie-v3.service';
import { LAB_COMMAND_TTL_MS, LAB_HEARTBEAT_TIMEOUT_MS, deviceTokenMatches, heartbeatText, labConfig, labGieSnapshot, parseUid, uidHash, unavailableGie, type LabConfig, type LabEvse } from './lab-maquete-domain';
import { PlatformAccessService } from './platform-access.service';
import { PrismaService } from './prisma.service';
import { demoIntegrationActive } from './official-demo-runtime';
import { energySnapshot, effectiveRelay, EnergyOrderGuard, ENERGY_TTL_MS } from './lab-energy-contract';
import { commercialSessionChannels, sessionIndication, maquetePresentation } from './lab-session-mapping';
import { USB_RELAY_CAPABILITY, usbRelayApproval } from './lab-usb-relay-policy';

type DeviceReport = { bootId: string; ev1: boolean; ev2: boolean; firmwareVersion?: string; batteryBars?: number; poleLight?: boolean; buildingLight?: boolean; lastCommandId?: string };
type AckReport = { commandId: string; accepted: boolean; ev1: boolean; ev2: boolean };
type Tx = Prisma.TransactionClient;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const connected = (at: Date | null, now = new Date()) => !!at && at.getTime() <= now.getTime() && now.getTime() - at.getTime() <= LAB_HEARTBEAT_TIMEOUT_MS;

function parseCommand(value: unknown): { evse: LabEvse; enabled: boolean; requestId: string | null } {
  const body = object(value);
  if (!body || !['EV1', 'EV2'].includes(String(body.evse)) || typeof body.enabled !== 'boolean' ||
      (body.requestId !== undefined && (typeof body.requestId !== 'string' || !uuid.test(body.requestId))))
    throw new BadRequestException('Comando de laboratório inválido');
  return { evse: body.evse as LabEvse, enabled: body.enabled, requestId: body.requestId as string | undefined ?? null };
}
function parseHeartbeat(value: unknown): DeviceReport {
  const body = object(value);
  if (!body || typeof body.bootId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.bootId) ||
      typeof body.ev1 !== 'boolean' || typeof body.ev2 !== 'boolean' ||
      (body.firmwareVersion !== undefined && (typeof body.firmwareVersion !== 'string' || !/^[A-Za-z0-9._-]{1,50}$/.test(body.firmwareVersion))) ||
      (body.batteryBars !== undefined && (!Number.isInteger(body.batteryBars) || (body.batteryBars as number) < 0 || (body.batteryBars as number) > 4)) ||
      (body.poleLight !== undefined && typeof body.poleLight !== 'boolean') ||
      (body.buildingLight !== undefined && typeof body.buildingLight !== 'boolean') ||
      (body.lastCommandId !== undefined && (typeof body.lastCommandId !== 'string' || !uuid.test(body.lastCommandId))))
    throw new BadRequestException('Heartbeat da maquete inválido');
  return body as DeviceReport;
}
function parseAck(value: unknown): AckReport {
  const body = object(value);
  if (!body || typeof body.commandId !== 'string' || !uuid.test(body.commandId) ||
      typeof body.accepted !== 'boolean' || typeof body.ev1 !== 'boolean' || typeof body.ev2 !== 'boolean')
    throw new BadRequestException('Confirmação da maquete inválida');
  return body as AckReport;
}

@Injectable()
export class LabMaqueteService {
  /** Read-only switch admission. Does not open/replace an ESP stream or expose user data. */
  async authority(config: LabConfig) {
    await this.binding(config);
    const stationId = config.energyStationId ?? config.stationId;
    const [gie, activeSessions] = await Promise.all([
      this.gie.refresh(stationId),
      this.db.labChargeSession.count({where:{stationId,status:{in:['STARTING','CHARGING','FINISHING']}}}),
    ]);
    return {stationId:String(stationId),gieStationId:gie.gie_station_id,
      online:gie.online && gie.station_id===String(stationId),activeSessions};
  }
  private lastEnergyFrame: Record<string, any> | null = null;
  private deliveredEnergyFrame: Record<string, any> | null = null;
  async energyJson(user: AuthUser, stationId: string) {
    const station = await this.access.require(user, stationId, 'READ');
    const config = this.config();
    if (station.id !== (config.energyStationId ?? config.stationId)) return { snapshot:null, current:false, ack:null };
    const snapshot = this.deliveredEnergyFrame;
    return { snapshot, current:!!snapshot && !!this.stream && snapshot.channelId === this.stream.id &&
      snapshot.expiresAtMs > Date.now() && Date.now()-this.stream.seenAt < 6000,
      ack:this.stream?.ack ?? null };
  }
  private stream: { id: string; bootId: string; seenAt: number; sequence: number; order: EnergyOrderGuard;
    usbCapable: boolean;
    relayActiveLevel: 'HIGH' | 'LOW' | null;
    issued: Map<string, { sequence:number; expires:number; ev1:boolean; ev2:boolean }>;
    latest: { id: string; sequence: number; expires: number } | null;
    ack: { commandId: string; sequence: number; at: string; ev1: boolean; ev2: boolean; accepted: boolean } | null } | null = null;
  private readonly gieRefreshAttemptAt = new Map<number, number>();
  constructor(private readonly db: PrismaService, private readonly access: PlatformAccessService, private readonly gie: GieV3Service) {}

  private config(): LabConfig {
    let config: LabConfig | null;
    try { config = labConfig(); } catch (error) { throw new ServiceUnavailableException(error instanceof Error ? error.message : 'Modo laboratório inválido'); }
    if (!config) throw new ServiceUnavailableException('Maquete de laboratório desabilitada');
    return config;
  }
  private async binding(config: LabConfig, tx: Tx | PrismaService = this.db) {
    const device = await tx.labDevice.findUnique({ where: { id: config.deviceId } });
    if (!device || device.stationId !== config.stationId) throw new ConflictException('Vínculo explícito da maquete não coincide com a estação configurada');
    return device;
  }
  private async locked(config: LabConfig, tx: Tx) {
    await tx.$queryRaw`SELECT id FROM lab_devices WHERE id=${config.deviceId} AND station_id=${config.stationId} FOR UPDATE`;
    return this.binding(config, tx);
  }
  private async event(tx: Tx, config: LabConfig, kind: string, details?: Record<string, unknown>) {
    await tx.labDeviceEvent.create({ data: { deviceId: config.deviceId, stationId: config.stationId, kind,
      details: details ? JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue : undefined } });
  }
  private async expire(tx: Tx, config: LabConfig, now: Date) {
    const expired = await tx.labDeviceCommand.updateMany({ where: { deviceId: config.deviceId,
      status: { in: ['PENDING', 'DELIVERED'] }, expiresAt: { lte: now } }, data: { status: 'EXPIRED', error: 'Prazo de entrega ou confirmação esgotado' } });
    if (expired.count) await this.event(tx, config, 'COMMANDS_EXPIRED', { count: expired.count });
  }
  private async ensureSafetyStop(tx: Tx, config: LabConfig, evse: LabEvse, reason: string, now: Date) {
    const pending = await tx.labDeviceCommand.findFirst({ where: { deviceId: config.deviceId, evse, enabled: false,
      status: { in: ['PENDING', 'DELIVERED'] }, expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } });
    if (pending) return pending;
    const command = await tx.labDeviceCommand.create({ data: { id: randomUUID(), deviceId: config.deviceId,
      stationId: config.stationId, evse, enabled: false, status: 'PENDING', expiresAt: new Date(now.getTime() + LAB_COMMAND_TTL_MS) } });
    await this.event(tx, config, 'SAFETY_STOP_QUEUED', { evse, reason, commandId: command.id });
    return command;
  }
  private snapshot(config: LabConfig) {
    const now = Date.now();
    const cached = this.gie.cachedState(config.stationId, 6_000);
    if (now - (this.gieRefreshAttemptAt.get(config.stationId) ?? 0) >= 5_000) {
      this.gieRefreshAttemptAt.set(config.stationId, now);
      void this.gie.refresh(config.stationId, false).catch(() => undefined);
    }
    return labGieSnapshot(cached, config.stationId);
  }
  private commandView(command: {id:string; evse:string; enabled:boolean; status:string; expiresAt:Date}) {
    return { id: command.id, evse: command.evse, enabled: command.enabled, status: command.status, expiresAt: command.expiresAt.toISOString() };
  }
  private empty(stationId: number) {
    const evse = () => ({ state: 'OFFLINE' as const, relayActive: false, pendingCommandId: null as string | null,
      lastCommandId: null as string | null, lastCommandStatus: null as string | null, lastAckAt: null as string | null });
    return { available: false, bound: false, stationId, deviceId: null as string | null,
      connectionSource: 'UNKNOWN' as const, connected: false, firmwareVersion: null as string | null,
      lastHeartbeatAt: null as string | null, evses: { EV1: evse(), EV2: evse() }, gie: { ...unavailableGie } };
  }
  async state(user: AuthUser, stationId: string | number) {
    const station = await this.access.require(user, stationId, 'READ');
    let config: LabConfig | null;
    try { config = labConfig(); } catch { return { ...this.empty(station.id), error: 'Configuração local da maquete inválida' }; }
    if (!config || station.id !== (config.energyStationId ?? config.stationId)) return this.empty(station.id);
    const device = await this.db.labDevice.findUnique({ where: { id: config.deviceId } });
    if (!device || device.stationId !== config.stationId) return { ...this.empty(station.id), error: 'Vínculo da maquete ausente ou divergente' };
    const [first, second, gie, connectedEvent] = await Promise.all([
      this.db.labDeviceCommand.findFirst({ where: { deviceId: config.deviceId, evse: 'EV1' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.db.labDeviceCommand.findFirst({ where: { deviceId: config.deviceId, evse: 'EV2' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.snapshot({ ...config, stationId:station.id }),
      this.db.labDeviceEvent.findFirst({ where: { deviceId: config.deviceId, kind: 'DEVICE_CONNECTED' }, orderBy: { id: 'desc' } }),
    ]);
    const online = connected(device.lastHeartbeatAt);
    const view = (evse: LabEvse, last: typeof first) => {
      const reported = evse === 'EV1' ? device.ev1 : device.ev2;
      const authorized = evse === 'EV1' ? device.authorizedEv1 : device.authorizedEv2;
      const pending = last && ['PENDING', 'DELIVERED'].includes(last.status) && last.expiresAt > new Date();
      const state = !online ? 'OFFLINE' : reported && !authorized ? 'FAULT' : pending ? 'PENDING' : reported && authorized ? 'CHARGING' : 'AVAILABLE';
      const effectiveStatus = last && last.expiresAt <= new Date() && ['PENDING', 'DELIVERED'].includes(last.status) ? 'EXPIRED' : last?.status ?? null;
      return { state, relayActive: online && reported && authorized,
        pendingCommandId: pending ? last!.id : null, lastCommandId: last?.id ?? null,
        lastCommandStatus: effectiveStatus,
        lastAckAt: last?.ackedAt?.toISOString() ?? null };
    };
    const connectionSource = device.bootId?.startsWith('sim_') ? 'SIMULATOR' as const
      : device.bootId?.startsWith('esp_') ? 'FIRMWARE' as const : 'UNKNOWN' as const;
    const eventDetails = object(connectedEvent?.details);
    const firmwareVersion = online && connectionSource === 'FIRMWARE' && eventDetails?.bootId === device.bootId &&
      typeof eventDetails.firmwareVersion === 'string' ? eventDetails.firmwareVersion : null;
    return { available: true, bound: true, stationId: station.id, deviceId: config.deviceId,
      operationalStationId:config.stationId, displayOnly:station.id !== config.stationId,
      connectionSource: online ? connectionSource : 'UNKNOWN' as const, connected: online,
      firmwareVersion,
      lastHeartbeatAt: device.lastHeartbeatAt?.toISOString() ?? null,
      evses: { EV1: view('EV1', first), EV2: view('EV2', second) }, gie,
      energyStream: this.stream ? { connected: Date.now() - this.stream.seenAt < 6000,
        ...usbRelayApproval(config, this.stream.usbCapable, Date.now(), process.env, this.stream.relayActiveLevel), physicalMeasurement: false,
        lastAck: this.stream.ack && Date.now() - Date.parse(this.stream.ack.at) < ENERGY_TTL_MS ? this.stream.ack : null } : null };
  }

  async openEnergyStream(config: LabConfig, body: unknown) {
    const b = object(body);
    const energyStationId = config.energyStationId ?? config.stationId;
    if (![13,46].includes(energyStationId) || b?.stationId !== String(energyStationId) || typeof b.bootId !== 'string' ||
        !/^(sim|esp)_[A-Za-z0-9_-]{1,55}$/.test(b.bootId)) throw new BadRequestException('Identidade de stream inválida');
    this.stream = { id: randomUUID(), bootId: b.bootId, seenAt: Date.now(), sequence: 0,
      usbCapable: b.relayCapability === USB_RELAY_CAPABILITY && b.bootId.startsWith('esp_'), issued: new Map(),
      relayActiveLevel: b.relayActiveLevel==='HIGH'||b.relayActiveLevel==='LOW' ? b.relayActiveLevel : null,
      order: new EnergyOrderGuard(), latest: null, ack: null };
    await this.heartbeat(config, { bootId: b.bootId, ev1: false, ev2: false,
      firmwareVersion: this.stream.usbCapable ? 'energy-v1-usb' : 'energy-v1-serial' });
    return { channelId: this.stream.id, stationId: String(energyStationId), deviceId: config.deviceId,
      heartbeatMs: 2000, ttlMs: ENERGY_TTL_MS, serverTimeMs:Date.now(),
      mode: usbRelayApproval(config, this.stream.usbCapable, Date.now(), process.env, this.stream.relayActiveLevel).mode };
  }
  private energyChannel(id: unknown) {
    if (!this.stream || id !== this.stream.id || Date.now() - this.stream.seenAt > 6000)
      throw new UnauthorizedException('Stream expirado ou substituído');
    return this.stream;
  }
  async assertChargerStartMode(station:number) {
    if(station!==13) return;
    const state=await this.gie.refresh(station,false);
    if(!state.online || state.mode==='PRESENTATION')
      throw new ConflictException('Inicio indisponivel em cenas ou GIE offline; selecione Demonstracao de carregadores');
  }
  async energyFrame(config: LabConfig, channelId: string) {
    const stream = this.energyChannel(channelId), now = Date.now();
    const safety = usbRelayApproval(config, stream.usbCapable, now, process.env, stream.relayActiveLevel);
    const energyStationId = config.energyStationId ?? config.stationId;
    if (now - (this.gieRefreshAttemptAt.get(energyStationId) ?? 0) >= 1000) {
      this.gieRefreshAttemptAt.set(energyStationId, now);
      void this.gie.refresh(energyStationId, false).catch(() => undefined);
    }
    const gieState = this.gie.cachedState(energyStationId, 6000);
    const data = energySnapshot(gieState, energyStationId, now);
    const commercialChannels = energyStationId === 13 ? await commercialSessionChannels(this.db,new Date(now)) : null;
    if (data.valid && !stream.order.accept(data.generation!, data.revision!)) {
      data.valid = false; data.errors.push('GIE_REPLAY');
    }
    const sessions = energyStationId !== config.stationId ? [] : await this.db.labChargeSession.findMany({ where: { stationId: config.stationId,
      status: 'CHARGING', autoStopAt: { gt: new Date(now) }, chargerId: { in: [76,77] } },
      select: { id:true, evse:true, chargerId:true, autoStopAt:true } });
    const commands = sessions.length ? await this.db.labDeviceCommand.findMany({ where: {
      stationId: config.stationId, deviceId: config.deviceId, enabled:true, requestId: { in: sessions.map(s => s.id) },
      OR: [{ status:'ACKED' }, { status: { in:['PENDING','DELIVERED'] }, expiresAt: { gt:new Date(now) } }] },
      select: { id:true, requestId:true, evse:true } }) : [];
    const evses = Object.fromEntries((['EV1','EV2'] as const).map((id,i) => {
      const session = sessions.find(s => s.evse === id && s.chargerId === 76+i);
      const authorization = commands.find(c => c.evse === id && c.requestId === session?.id);
      if (commercialChannels) {
        const channel = commercialChannels[id];
        const relay = effectiveRelay({ valid:data.valid && gieState?.mode !== 'PRESENTATION',
          gieAuthorized:data.evses[id].gieAuthorized, sessionAuthorized:channel.sessionAuthorized,
          operationalAuthorized:channel.operationalAuthorized, connected:now-stream.seenAt<6000,
          hardwareApproved:safety.hardwareApproved, electricalSafe:safety.electricalSafe });
        return [id,{...data.evses[id],...channel,
          chargingRequested:sessionIndication(channel),
          operationalState:sessionIndication(channel) ? 'CHARGING' : 'AVAILABLE',
          effectiveRelay:relay,blockedReason:relay ? null : !safety.hardwareApproved ? 'HARDWARE_NOT_APPROVED' :
            !data.valid ? 'GIE_OFFLINE_OR_INVALID' : gieState?.mode==='PRESENTATION' ? 'PRESENTATION_MODE' :
            !channel.sessionAuthorized ? 'NO_ACTIVE_SESSION' : !channel.operationalAuthorized ? 'OPERATIONAL_AUTHORIZATION_MISSING' :
            !data.evses[id].gieAuthorized ? 'GIE_EVSE_NOT_AUTHORIZED' : 'AUTHORIZATION_UNAVAILABLE'}];
      }
      return [id, { ...data.evses[id], gieAuthorized: data.valid && data.evses[id].gieAuthorized,
        sessionAuthorized: !!session, sessionId: session?.id ?? null, sessionExpiresAt: session?.autoStopAt?.toISOString() ?? null,
        operationalAuthorized: !!authorization, authorizationId: authorization?.id ?? null,
        effectiveRelay: effectiveRelay({ valid:data.valid, gieAuthorized:data.evses[id].gieAuthorized,
          sessionAuthorized:!!session, operationalAuthorized:!!authorization, connected:Date.now()-stream.seenAt<6000,
          electricalSafe:false, hardwareApproved:false }), blockedReason: 'HARDWARE_NOT_APPROVED' }];
    }));
    let maqueteDisplay:any=null;
    if(energyStationId===13 && chargerDemoEnabled(13) && commercialChannels) {
      const rows=await this.db.labChargeSession.findMany({where:{stationId:13,status:'CHARGING',endedAt:null,autoStopAt:{gt:new Date(now)}},select:{simulatedPowerKw:true}});
      const evKw=rows.reduce((sum,row)=>sum+Number(row.simulatedPowerKw),0);
      maqueteDisplay={...chargerDemoEnergy(new Date(now),evKw),
        EV1:commercialChannels.EV1.sessionPowerKw,EV2:commercialChannels.EV2.sessionPowerKw};
    }
    const commandId = randomUUID(), sequence = ++stream.sequence;
    stream.latest = { id:commandId, sequence, expires: now + ENERGY_TTL_MS };
    for (const [id, issued] of stream.issued) if (issued.expires <= now) stream.issued.delete(id);
    stream.issued.set(commandId, {sequence,expires:now+ENERGY_TTL_MS,
      ev1:evses.EV1.effectiveRelay === true, ev2:evses.EV2.effectiveRelay === true});
    while (stream.issued.size > 8) stream.issued.delete(stream.issued.keys().next().value!);
    const frame = { type:'energy.snapshot', ...data, evses,
      presentation:maquetePresentation(gieState?.mode, data.valid), maqueteDisplay, channelId:stream.id, bootId:stream.bootId,
      commandId, sequence, emittedAtMs:now, expiresAtMs:now+ENERGY_TTL_MS, ttlMs:ENERGY_TTL_MS,
      mode:safety.mode, hardwareApproved:safety.hardwareApproved, electricalSafe:safety.electricalSafe,
      relayApproval:safety.approval, physicalMeasurement:false };
    this.lastEnergyFrame = JSON.parse(JSON.stringify(frame));
    return frame;
  }
  async energyReport(config: LabConfig, body: unknown) {
    const b = object(body), stream = this.energyChannel(b?.channelId);
    if (b?.bootId !== stream.bootId || b?.stationId !== String(config.energyStationId ?? config.stationId) ||
        !['heartbeat','ack','sent','disconnect'].includes(String(b?.type))) throw new BadRequestException('Rapport de stream inválido');
    const issued = typeof b.commandId === 'string' ? stream.issued.get(b.commandId) : null;
    const safety = usbRelayApproval(config, stream.usbCapable, Date.now(), process.env, stream.relayActiveLevel);
    if (typeof b.ev1 !== 'boolean' || typeof b.ev2 !== 'boolean' ||
        ((b.ev1 || b.ev2) && (b.type === 'sent' || b.accepted === false || !safety.hardwareApproved || !safety.electricalSafe ||
          !issued || issued.expires <= Date.now() || issued.sequence !== b.sequence ||
          (b.ev1 && !issued.ev1) || (b.ev2 && !issued.ev2)))) {
      this.stream = null; throw new ConflictException('Relés USB sem autorização vigente');
    }
    if (b.type === 'sent') {
      if (!this.lastEnergyFrame || b.commandId !== this.lastEnergyFrame.commandId || b.sequence !== this.lastEnergyFrame.sequence ||
          this.lastEnergyFrame.channelId !== stream.id) throw new ConflictException('Snapshot divergente');
      this.deliveredEnergyFrame = this.lastEnergyFrame;
      return { accepted:true };
    }
    if (b.type === 'disconnect') { this.stream = null; return { disconnected:true }; }
    if (b.type === 'ack') {
      const last = stream.latest;
      if (!last || b.commandId !== last.id || b.sequence !== last.sequence || last.expires <= Date.now() || typeof b.accepted !== 'boolean')
        throw new ConflictException('ACK expirado ou fora de ordem');
      if (stream.ack?.commandId === b.commandId) return { duplicate:true };
      stream.ack = { commandId:last.id, sequence:last.sequence, at:new Date().toISOString(),
        accepted:b.accepted, ev1:b.ev1, ev2:b.ev2 };
      this.deliveredEnergyFrame = this.lastEnergyFrame;
    }
    stream.seenAt = Date.now();
    // Legacy station 46 commands stay off. The independent station 13 USB report is
    // recorded in energyStream.lastAck; GPIO confirmation is never a meter reading.
    await this.heartbeat(config,{bootId:stream.bootId,ev1:false,ev2:false,
      firmwareVersion:stream.usbCapable ? 'energy-v1-usb' : 'energy-v1-serial',buildingLight:true});
    return { accepted:true, physicalMeasurement:false };
  }
  async issue(user: AuthUser, stationId: string, body: unknown, origin: 'MANUAL' | 'CHARGING_SESSION' = 'MANUAL') {
    const config = this.config();
    if (origin === 'MANUAL' && process.env.EMPS_CHARGING_SANDBOX_ENABLED === 'true' && demoIntegrationActive())
      throw new ConflictException('Comandos manuais desabilitados; utilize a recarga SANDBOX do carregador');
    const station = await this.access.require(user, stationId, origin === 'CHARGING_SESSION' ? 'OPERATE' : 'MANAGE');
    if (station.id !== config.stationId) throw new ForbiddenException('Maquete não vinculada a esta estação');
    const { evse, enabled, requestId } = parseCommand(body);
    const now = new Date();
    const command = await this.db.$transaction(async tx => {
      const device = await this.locked(config, tx);
      await this.expire(tx, config, now);
      if (origin === 'CHARGING_SESSION' && enabled) {
        if (!requestId) throw new BadRequestException('Sessão SANDBOX obrigatória para iniciar a maquete');
        const chargerId = evse === 'EV1' ? 76 : 77;
        // Use the same charger lock as session STOP so a late START cannot follow a completed charge.
        await tx.$queryRaw`SELECT id FROM chargers WHERE id=${chargerId} FOR UPDATE`;
        const session = await tx.labChargeSession.findUnique({ where: { id: requestId } });
        if (!session || session.stationId !== config.stationId || session.chargerId !== chargerId ||
            session.actorUserId !== Number(user.sub) || session.evse !== evse || session.status !== 'CHARGING')
          throw new ConflictException('Sessão SANDBOX já não autoriza iniciar a maquete');
      }
      if (requestId) {
        const duplicate = await tx.labDeviceCommand.findUnique({ where: { deviceId_requestId: { deviceId: config.deviceId, requestId } } });
        if (duplicate) {
          if (duplicate.evse !== evse || duplicate.enabled !== enabled || duplicate.requestedBy !== Number(user.sub))
            throw new ConflictException('Chave de idempotência já usada para outro comando');
          return duplicate;
        }
      }
      if (enabled && !connected(device.lastHeartbeatAt, now)) throw new ConflictException('ESP32 sem heartbeat recente; iniciar teste é proibido');
      const targetReported = evse === 'EV1' ? device.ev1 : device.ev2;
      if (enabled && targetReported) throw new ConflictException('EVSE já reporta relé ativo; confirme uma parada antes de reiniciar');
      const pending = await tx.labDeviceCommand.findFirst({ where: { deviceId: config.deviceId, evse,
        status: { in: ['PENDING', 'DELIVERED'] }, expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } });
      if (enabled && pending && !pending.enabled) throw new ConflictException('Parada pendente; iniciar teste é proibido até a confirmação');
      if (pending && pending.enabled === enabled) return pending;
      if (pending) await tx.labDeviceCommand.update({ where: { id: pending.id }, data: { status: 'FAILED', error: 'Substituído por comando posterior' } });
      if (!enabled) await tx.labDevice.update({ where: { id: config.deviceId }, data: evse === 'EV1' ? { authorizedEv1: false } : { authorizedEv2: false } });
      const created = await tx.labDeviceCommand.create({ data: { id: randomUUID(), deviceId: config.deviceId,
        stationId: config.stationId, requestedBy: Number(user.sub), requestId, evse, enabled,
        status: 'PENDING', expiresAt: new Date(now.getTime() + LAB_COMMAND_TTL_MS) } });
      await this.event(tx, config, 'COMMAND_REQUESTED', { commandId: created.id, evse, enabled, actorId: Number(user.sub), origin });
      return created;
    });
    return { command: this.commandView(command), ...(await this.state(user, stationId)) };
  }

  /** Internal safety STOP after a sandbox session closes; never accepts START or an HTTP actor. */
  async stopCompletedSandboxSession(sessionId: string) {
    if (process.env.EMPS_CHARGING_SANDBOX_ENABLED !== 'true' || !demoIntegrationActive() || !uuid.test(sessionId))
      throw new ServiceUnavailableException('Parada automática restrita à cópia local SANDBOX');
    const config = this.config();
    if (config.stationId !== 46) throw new ForbiddenException('Maquete fora do Posto SANDBOX');
    const now = new Date();
    const command = await this.db.$transaction(async tx => {
      await this.locked(config, tx);
      await this.expire(tx, config, now);
      const session = await tx.labChargeSession.findUnique({ where: { id: sessionId } });
      if (!session || session.stationId !== 46 || session.status !== 'FINISHED' ||
          !((session.chargerId === 76 && session.evse === 'EV1') || (session.chargerId === 77 && session.evse === 'EV2')))
        throw new ConflictException('Parada sem sessão SANDBOX concluída');
      await tx.$queryRaw`SELECT id FROM chargers WHERE id=${session.chargerId} FOR UPDATE`;
      const [station, binding] = await Promise.all([
        tx.station.findUnique({ where: { id: 46 } }),
        tx.gieStationBinding.findUnique({ where: { stationId: 46 } }),
      ]);
      if (!station || station.visibility !== 'PRIVATE' || station.reviewState !== 'DRAFT' ||
          binding?.profile !== 'POSTO' || binding.origin !== 'SIMULATED')
        throw new ConflictException('Perfil local inválido para parada segura');
      await tx.labDeviceCommand.updateMany({ where: { deviceId: config.deviceId, evse: session.evse,
        enabled: true, status: { in: ['PENDING', 'DELIVERED'] } },
        data: { status: 'FAILED', error: 'Sessão SANDBOX concluída' } });
      await tx.labDevice.update({ where: { id: config.deviceId }, data: session.evse === 'EV1'
        ? { authorizedEv1: false } : { authorizedEv2: false } });
      return this.ensureSafetyStop(tx, config, session.evse as LabEvse, 'SESSION_FINISHED', now);
    });
    return { command: this.commandView(command) };
  }

  async authenticate(deviceId: string, supplied: unknown): Promise<LabConfig> {
    const config = this.config();
    if (deviceId !== config.deviceId || !deviceTokenMatches(config.token, supplied)) throw new UnauthorizedException('Dispositivo não autorizado');
    await this.binding(config);
    return config;
  }
  async next(config: LabConfig): Promise<string | null> {
    const now = new Date();
    return this.db.$transaction(async tx => {
      const device = await this.locked(config, tx);
      await this.expire(tx, config, now);
      // A STOP outranks a delivered START; a disconnected device may receive STOP only.
      const queue = await tx.labDeviceCommand.findMany({ where: { deviceId: config.deviceId,
        status: { in: ['PENDING', 'DELIVERED'] }, expiresAt: { gt: now },
        ...(!connected(device.lastHeartbeatAt, now) ? { enabled: false } : {}) },
        orderBy: [{ enabled: 'asc' }, { createdAt: 'asc' }], take: 1 });
      const command = queue[0];
      if (!command) return null;
      const remaining = Math.min(15_000, Math.floor(command.expiresAt.getTime() - now.getTime()));
      if (remaining < 1) return null;
      if (command.status === 'PENDING') {
        await tx.labDeviceCommand.update({ where: { id: command.id }, data: { status: 'DELIVERED', deliveredAt: now, bootId: device.bootId } });
        await this.event(tx, config, 'COMMAND_DELIVERED', { commandId: command.id });
      }
      return `${command.id}|${command.evse}=${command.enabled ? 1 : 0}|${remaining}`;
    });
  }
  async ack(config: LabConfig, body: unknown) {
    const report = parseAck(body), now = new Date();
    return this.db.$transaction(async tx => {
      const device = await this.locked(config, tx);
      const command = await tx.labDeviceCommand.findFirst({ where: { id: report.commandId, deviceId: config.deviceId, stationId: config.stationId } });
      if (!command) throw new NotFoundException('Comando de laboratório não encontrado');
      if (command.status === 'ACKED') return { commandId: command.id, status: 'ACKED', duplicate: true };
      const actual = command.evse === 'EV1' ? report.ev1 : report.ev2;
      let sessionStillAuthorizesStart = true;
      if (command.enabled && process.env.EMPS_CHARGING_SANDBOX_ENABLED === 'true' && demoIntegrationActive()) {
        const session = command.requestId ? await tx.labChargeSession.findUnique({ where: { id: command.requestId } }) : null;
        sessionStillAuthorizesStart = !!session && session.stationId === 46 && session.status === 'CHARGING' &&
          session.evse === command.evse && session.chargerId === (command.evse === 'EV1' ? 76 : 77) &&
          !!session.autoStopAt && session.autoStopAt > now;
      }
      const valid = report.accepted && actual === command.enabled && command.status === 'DELIVERED' &&
        command.expiresAt > now && command.bootId === device.bootId && connected(device.lastHeartbeatAt, now) &&
        sessionStillAuthorizesStart;
      const status = valid ? 'ACKED' : command.expiresAt <= now ? 'EXPIRED' : 'FAILED';
      await tx.labDeviceCommand.update({ where: { id: command.id }, data: { status, ackedAt: now,
        error: valid ? null : 'ACK rejeitado, expirado, fora de ordem ou diferente do GPIO reportado' } });
      const authorizedEv1 = (command.evse === 'EV1' ? valid && command.enabled : device.authorizedEv1) && report.ev1;
      const authorizedEv2 = (command.evse === 'EV2' ? valid && command.enabled : device.authorizedEv2) && report.ev2;
      await tx.labDevice.update({ where: { id: config.deviceId }, data: { ev1: report.ev1, ev2: report.ev2,
        authorizedEv1, authorizedEv2, lastCommandId: command.id } });
      await this.event(tx, config, valid ? 'COMMAND_ACKED' : 'COMMAND_ACK_REJECTED',
        { commandId: command.id, reportedEv1: report.ev1, reportedEv2: report.ev2, accepted: report.accepted });
      if (report.ev1 && !authorizedEv1) await this.ensureSafetyStop(tx, config, 'EV1', 'UNAUTHORIZED_RELAY', now);
      if (report.ev2 && !authorizedEv2) await this.ensureSafetyStop(tx, config, 'EV2', 'UNAUTHORIZED_RELAY', now);
      return { commandId: command.id, status };
    });
  }
  async heartbeat(config: LabConfig, body: unknown): Promise<string> {
    const report = parseHeartbeat(body), now = new Date();
    const device = await this.db.$transaction(async tx => {
      const prior = await this.locked(config, tx);
      const resumed = prior.bootId !== report.bootId || !connected(prior.lastHeartbeatAt, now);
      if (resumed) {
        await tx.labDeviceCommand.updateMany({ where: { deviceId: config.deviceId, enabled: true,
          status: { in: ['PENDING', 'DELIVERED'] } }, data: { status: 'EXPIRED', error: 'Boot ou heartbeat interrompido' } });
        await this.event(tx, config, 'AUTHORIZATION_RESET', { bootChanged: prior.bootId !== report.bootId, heartbeatLost: !connected(prior.lastHeartbeatAt, now) });
      }
      await this.expire(tx, config, now);
      let authorizedEv1 = !resumed && prior.authorizedEv1 && report.ev1;
      let authorizedEv2 = !resumed && prior.authorizedEv2 && report.ev2;
      if ((authorizedEv1 || authorizedEv2) && process.env.EMPS_CHARGING_SANDBOX_ENABLED === 'true' &&
          demoIntegrationActive()) {
        // A previous START ACK cannot authorize a later charge on the same EVSE.
        const sessions = await tx.labChargeSession.findMany({ where: { stationId: 46, status: 'CHARGING',
          chargerId: { in: [76, 77] }, autoStopAt: { gt: now } }, select: { id: true, chargerId: true, evse: true } });
        const acknowledged = sessions.length ? await tx.labDeviceCommand.findMany({ where: {
          deviceId: config.deviceId, enabled: true, status: 'ACKED', requestId: { in: sessions.map(session => session.id) },
        }, select: { requestId: true, evse: true } }) : [];
        const authorizedIds = new Set(acknowledged.map(command => `${command.requestId}:${command.evse}`));
        authorizedEv1 = authorizedEv1 && sessions.some(session => session.chargerId === 76 && session.evse === 'EV1' &&
          authorizedIds.has(`${session.id}:EV1`));
        authorizedEv2 = authorizedEv2 && sessions.some(session => session.chargerId === 77 && session.evse === 'EV2' &&
          authorizedIds.has(`${session.id}:EV2`));
      }
      const updated = await tx.labDevice.update({ where: { id: config.deviceId }, data: {
        bootId: report.bootId, lastHeartbeatAt: now, ev1: report.ev1, ev2: report.ev2,
        authorizedEv1, authorizedEv2, lastCommandId: report.lastCommandId ?? prior.lastCommandId } });
      if (report.ev1 && !authorizedEv1) await this.ensureSafetyStop(tx, config, 'EV1', 'HEARTBEAT_UNAUTHORIZED', now);
      if (report.ev2 && !authorizedEv2) await this.ensureSafetyStop(tx, config, 'EV2', 'HEARTBEAT_UNAUTHORIZED', now);
      if (resumed) await this.event(tx, config, 'DEVICE_CONNECTED', { bootId: report.bootId, firmwareVersion: report.firmwareVersion });
      return updated;
    });
    const station = await this.db.station.findUnique({ where: { id: config.stationId }, select: { name: true } });
    const gie = await this.snapshot(config);
    return heartbeatText(config.stationId, station?.name ?? 'ESTACAO', gie, device.authorizedEv1 && device.ev1,
      device.authorizedEv2 && device.ev2);
  }
  async rfid(config: LabConfig, body: unknown): Promise<string> {
    let uid: string;
    try { uid = parseUid(body); } catch { throw new BadRequestException('UID RFID inválido'); }
    const hash = uidHash(uid, config.token);
    const tag = await this.db.labRfidTag.findUnique({ where: { deviceId_uidHash: { deviceId: config.deviceId, uidHash: hash } } });
    const approved = !!tag?.enabled && tag.stationId === config.stationId;
    await this.db.labDeviceEvent.create({ data: { deviceId: config.deviceId, stationId: config.stationId,
      kind: approved ? 'RFID_APPROVED_DISPLAY_ONLY' : 'RFID_DENIED',
      details: { uidHashPrefix: hash.slice(0, 12), label: approved ? tag!.label : undefined } } });
    // A cloned RC522 UID is not sufficient authentication and must never toggle a relay.
    return approved ? `APPROVED|${tag!.label}` : 'DENIED';
  }
  async enrollTag(user: AuthUser, stationId: string, body: unknown) {
    const config = this.config();
    const station = await this.access.require(user, stationId, 'MANAGE');
    if (station.id !== config.stationId) throw new ForbiddenException('Maquete não vinculada a esta estação');
    const input = object(body);
    let uid: string;
    try { uid = parseUid(input); } catch { throw new BadRequestException('UID RFID inválido'); }
    const label = input?.label;
    if (typeof label !== 'string' || !/^[A-Z0-9 ]{3,16}$/.test(label)) throw new BadRequestException('Rótulo RFID de demonstração inválido');
    await this.binding(config);
    const tag = await this.db.labRfidTag.upsert({ where: { deviceId_uidHash: { deviceId: config.deviceId, uidHash: uidHash(uid, config.token) } },
      create: { deviceId: config.deviceId, stationId: config.stationId, uidHash: uidHash(uid, config.token), label, enabled: true },
      update: { label, enabled: true } });
    await this.db.labDeviceEvent.create({ data: { deviceId: config.deviceId, stationId: config.stationId,
      kind: 'RFID_TAG_ENROLLED', details: { tagId: tag.id, actorId: Number(user.sub) } } });
    return { id: tag.id, label: tag.label, enabled: tag.enabled, source: 'LAB_DISPLAY_ONLY' };
  }
  async revokeTag(user: AuthUser, stationId: string, tagId: string) {
    const config = this.config();
    const station = await this.access.require(user, stationId, 'MANAGE');
    if (station.id !== config.stationId) throw new ForbiddenException('Maquete não vinculada a esta estação');
    if (!uuid.test(tagId)) throw new BadRequestException('Tag inválida');
    const result = await this.db.labRfidTag.updateMany({ where: { id: tagId, deviceId: config.deviceId, stationId: config.stationId }, data: { enabled: false } });
    if (!result.count) throw new NotFoundException('Tag de laboratório não encontrada');
    await this.db.labDeviceEvent.create({ data: { deviceId: config.deviceId, stationId: config.stationId,
      kind: 'RFID_TAG_REVOKED', details: { tagId, actorId: Number(user.sub) } } });
    return { id: tagId, enabled: false };
  }
}
