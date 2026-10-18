import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from './auth';
import { GieV3Service } from './gie-v3.service';
import { LAB_COMMAND_TTL_MS, LAB_HEARTBEAT_TIMEOUT_MS, deviceTokenMatches, heartbeatText, labConfig, labGieSnapshot, parseUid, uidHash, unavailableGie, type LabConfig, type LabEvse } from './lab-maquete-domain';
import { PlatformAccessService } from './platform-access.service';
import { PrismaService } from './prisma.service';

type DeviceReport = { bootId: string; ev1: boolean; ev2: boolean; batteryBars?: number; poleLight?: boolean; buildingLight?: boolean; lastCommandId?: string };
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
      connectionSource: 'UNKNOWN' as const, connected: false,
      lastHeartbeatAt: null as string | null, evses: { EV1: evse(), EV2: evse() }, gie: { ...unavailableGie } };
  }
  async state(user: AuthUser, stationId: string | number) {
    const station = await this.access.require(user, stationId, 'READ');
    let config: LabConfig | null;
    try { config = labConfig(); } catch { return { ...this.empty(station.id), error: 'Configuração local da maquete inválida' }; }
    if (!config || station.id !== config.stationId) return this.empty(station.id);
    const device = await this.db.labDevice.findUnique({ where: { id: config.deviceId } });
    if (!device || device.stationId !== station.id) return { ...this.empty(station.id), error: 'Vínculo da maquete ausente ou divergente' };
    const [first, second, gie] = await Promise.all([
      this.db.labDeviceCommand.findFirst({ where: { deviceId: config.deviceId, evse: 'EV1' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.db.labDeviceCommand.findFirst({ where: { deviceId: config.deviceId, evse: 'EV2' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.snapshot(config),
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
    return { available: true, bound: true, stationId: station.id, deviceId: config.deviceId,
      connectionSource: online ? connectionSource : 'UNKNOWN' as const, connected: online,
      lastHeartbeatAt: device.lastHeartbeatAt?.toISOString() ?? null,
      evses: { EV1: view('EV1', first), EV2: view('EV2', second) }, gie };
  }
  async issue(user: AuthUser, stationId: string, body: unknown) {
    const config = this.config();
    const station = await this.access.require(user, stationId, 'MANAGE');
    if (station.id !== config.stationId) throw new ForbiddenException('Maquete não vinculada a esta estação');
    const { evse, enabled, requestId } = parseCommand(body);
    const now = new Date();
    const command = await this.db.$transaction(async tx => {
      const device = await this.locked(config, tx);
      await this.expire(tx, config, now);
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
      await this.event(tx, config, 'COMMAND_REQUESTED', { commandId: created.id, evse, enabled, actorId: Number(user.sub) });
      return created;
    });
    return { command: this.commandView(command), ...(await this.state(user, stationId)) };
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
      const valid = report.accepted && actual === command.enabled && command.status === 'DELIVERED' &&
        command.expiresAt > now && command.bootId === device.bootId && connected(device.lastHeartbeatAt, now);
      const status = valid ? 'ACKED' : command.expiresAt <= now ? 'EXPIRED' : 'FAILED';
      await tx.labDeviceCommand.update({ where: { id: command.id }, data: { status, ackedAt: now,
        error: valid ? null : 'ACK rejeitado, expirado, fora de ordem ou diferente do GPIO reportado' } });
      const authorizedEv1 = (valid && command.evse === 'EV1' ? command.enabled : device.authorizedEv1) && report.ev1;
      const authorizedEv2 = (valid && command.evse === 'EV2' ? command.enabled : device.authorizedEv2) && report.ev2;
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
      const authorizedEv1 = !resumed && prior.authorizedEv1 && report.ev1;
      const authorizedEv2 = !resumed && prior.authorizedEv2 && report.ev2;
      const updated = await tx.labDevice.update({ where: { id: config.deviceId }, data: {
        bootId: report.bootId, lastHeartbeatAt: now, ev1: report.ev1, ev2: report.ev2,
        authorizedEv1, authorizedEv2, lastCommandId: report.lastCommandId ?? prior.lastCommandId } });
      if (report.ev1 && !authorizedEv1) await this.ensureSafetyStop(tx, config, 'EV1', 'HEARTBEAT_UNAUTHORIZED', now);
      if (report.ev2 && !authorizedEv2) await this.ensureSafetyStop(tx, config, 'EV2', 'HEARTBEAT_UNAUTHORIZED', now);
      if (resumed) await this.event(tx, config, 'DEVICE_CONNECTED', { bootId: report.bootId });
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
