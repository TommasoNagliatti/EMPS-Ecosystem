import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import type { AuthUser } from "./auth";
import type {
  ClaimChargerProvisioningDto,
  CreateChargerProvisioningDto,
  RejectChargerProvisioningDto,
} from "./charger-provisioning.dtos";
import { createOpaqueToken, hashOpaqueToken } from "./mobile.utils";
import {
  bigId,
  intId,
  chargerInclude,
  presentCharger,
  stationScope,
} from "./persistence";
import { PrismaService } from "./prisma.service";
import { RealtimeService } from "./realtime.service";

// Temporary adapter: an onboarding checklist is a RUN_CHECKLIST command attached
// to a pending charger. JSON holds activation/review metadata; no new table.
type Checklist = {
  kind: "provisioning-v1";
  status: string;
  activationTokenLastFour: string;
  activationExpiresAt: string;
  pricePerKwh: number;
  connectionVerifiedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  canceledAt?: string;
  reviewedById?: number;
  removed?: boolean;
};
const include = {
  charger: { include: { ...chargerInclude, qrBindings: true } },
  requestedBy: { select: { id: true, name: true, email: true } },
} as const;
type Record = Prisma.ChargingCommandGetPayload<{ include: typeof include }>;
const metadata = (record: Record) =>
  record.requestPayload as unknown as Checklist;
const normalize = (v: string) => v.trim().replace(/\s+/g, " ").toUpperCase();
const checklistWhere: Prisma.ChargingCommandWhereInput = {
  type: "RUN_CHECKLIST",
  requestPayload: { path: "$.kind", equals: "provisioning-v1" },
};

@Injectable()
export class ChargerProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}
  private async get(id: string, user?: AuthUser) {
    const record = await this.prisma.chargingCommand.findFirst({
      where: {
        ...checklistWhere,
        id: bigId(id),
        ...(user ? { charger: { station: stationScope(user) } } : {}),
      },
      include,
    });
    if (!record || metadata(record).removed)
      throw new NotFoundException("Solicitação não encontrada");
    return record;
  }
  private present(record: Record) {
    const m = metadata(record);
    const charger = presentCharger(record.charger);
    const status =
      m.status === "PENDING_CONNECTION" &&
      new Date(m.activationExpiresAt) <= new Date()
        ? "EXPIRED"
        : m.status;
    return {
      ...charger,
      ...m,
      id: record.id,
      chargerId: m.status === "ENABLED" ? charger.id : null,
      status,
      pricePerKwh: m.pricePerKwh,
      station: { ...charger.station, code: `ST-${charger.station.id}` },
      requestedBy: record.requestedBy,
      reviewedBy: null,
      charger: m.status === "ENABLED" ? charger : null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
  async stationOptions(user: AuthUser) {
    const rows = await this.prisma.station.findMany({
      where: { ...stationScope(user), status: "ACTIVE" },
      include: { chargers: { select: { administrativeStatus: true } } },
      orderBy: { name: "asc" },
    });
    return rows.map((s) => ({
      ...s,
      code: `ST-${s.id}`,
      _count: {
        chargers: s.chargers.filter((c) => c.administrativeStatus === "ENABLED")
          .length,
        provisionings: s.chargers.filter(
          (c) => c.administrativeStatus === "PENDING",
        ).length,
      },
    }));
  }
  async list(user: AuthUser) {
    const records = await this.prisma.chargingCommand.findMany({
      where: { ...checklistWhere, charger: { station: stationScope(user) } },
      include,
      orderBy: { createdAt: "desc" },
    });
    return records
      .filter((r) => !metadata(r).removed)
      .map((r) => this.present(r));
  }
  async create(user: AuthUser, dto: CreateChargerProvisioningDto) {
    const station = await this.prisma.station.findFirst({
      where: {
        ...stationScope(user),
        id: intId(dto.stationId),
        status: "ACTIVE",
      },
    });
    if (!station)
      throw new ForbiddenException(
        "Eletroposto ativo não encontrado para esta conta",
      );
    const activationCode = `EMPS-${randomBytes(16).toString("hex").toUpperCase()}`;
    const days = Number(process.env.CHARGER_ACTIVATION_DAYS ?? 7);
    const activationExpiresAt = new Date(
      Date.now() +
        Math.min(30, Math.max(1, Number.isFinite(days) ? days : 7)) * 86400000,
    );
    const request: Checklist = {
      kind: "provisioning-v1",
      status: "PENDING_CONNECTION",
      activationExpiresAt: activationExpiresAt.toISOString(),
      activationTokenLastFour: activationCode.slice(-4),
      pricePerKwh: dto.pricePerKwh,
    };
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const charger = await tx.charger.create({
          data: {
            stationId: station.id,
            publicCode: `CH-${randomBytes(10).toString("hex")}`,
            name: dto.name.trim(),
            location: dto.location.trim(),
            connectorType: normalize(dto.connectorType),
            manufacturer: dto.manufacturer.trim(),
            model: dto.model.trim(),
            serialNumber: normalize(dto.serialNumber),
            ocppIdentity: normalize(dto.ocppIdentity),
            ocppVersion: dto.ocppVersion,
            powerType: dto.powerType,
            phaseCount: dto.phaseCount,
            powerKw: dto.powerKw,
            configuredPowerLimitKw: dto.powerKw,
            liveStatus: { create: { operationalStatus: "UNKNOWN" } },
          },
        });
        return tx.chargingCommand.create({
          data: {
            chargerId: charger.id,
            clientId: intId(user.sub),
            type: "RUN_CHECKLIST",
            correlationId: hashOpaqueToken(activationCode),
            requestPayload: request,
            timeoutAt: activationExpiresAt,
          },
          include,
        });
      });
      this.realtime.publishToOperations({
        entityId: record.id,
        topic: "station.updated",
      });
      return { ...this.present(record), activationCode };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(
          "Número de série ou identidade OCPP já cadastrados",
        );
      throw error;
    }
  }
  async claim(dto: ClaimChargerProvisioningDto) {
    const record = await this.prisma.chargingCommand.findUnique({
      where: {
        correlationId: hashOpaqueToken(
          dto.activationCode.trim().replace(/\s/g, "").toUpperCase(),
        ),
      },
      include,
    });
    if (!record || metadata(record)?.kind !== "provisioning-v1")
      throw new NotFoundException("Código de ativação inválido");
    const m = metadata(record);
    if (
      normalize(dto.serialNumber) !== record.charger.serialNumber ||
      normalize(dto.ocppIdentity) !== record.charger.ocppIdentity
    )
      throw new BadRequestException(
        "Equipamento não corresponde à solicitação",
      );
    if (m.status === "PENDING_APPROVAL")
      return {
        id: record.id,
        status: m.status,
        verifiedAt: m.connectionVerifiedAt,
      };
    if (m.status !== "PENDING_CONNECTION")
      throw new ConflictException("Código utilizado ou cancelado");
    if (new Date(m.activationExpiresAt) <= new Date())
      throw new GoneException("Código de ativação expirado");
    const verifiedAt = new Date().toISOString();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.chargingCommand.updateMany({
        where: { id: record.id, status: "PENDING" },
        data: {
          status: "ACCEPTED",
          requestPayload: {
            ...m,
            status: "PENDING_APPROVAL",
            connectionVerifiedAt: verifiedAt,
          },
        },
      });
      if (updated.count !== 1)
        throw new ConflictException("Solicitação mudou de estado");
      await tx.charger.update({
        where: { id: record.chargerId },
        data: { firmwareVersion: dto.firmwareVersion },
      });
    });
    this.realtime.publishToOperations({
      entityId: record.id,
      topic: "station.updated",
    });
    return { id: record.id, status: "PENDING_APPROVAL", verifiedAt };
  }
  async approve(user: AuthUser, id: string) {
    const record = await this.get(id, user);
    const m = metadata(record);
    if (m.status !== "PENDING_APPROVAL" || !m.connectionVerifiedAt)
      throw new ConflictException(
        "Somente equipamentos validados podem ser aprovados",
      );
    if (record.charger.station.status !== "ACTIVE")
      throw new ConflictException("Eletroposto inativo");
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.chargingCommand.updateMany({
        where: { id: record.id, status: "ACCEPTED" },
        data: {
          status: "COMPLETED",
          processedAt: now,
          requestPayload: {
            ...m,
            status: "ENABLED",
            approvedAt: now.toISOString(),
            reviewedById: intId(user.sub),
          },
        },
      });
      if (claim.count !== 1)
        throw new ConflictException("Solicitação já analisada");
      await tx.charger.update({
        where: { id: record.chargerId },
        data: {
          administrativeStatus: "ENABLED",
          provisionedAt: now,
          liveStatus: {
            upsert: {
              create: { operationalStatus: "AVAILABLE", lastSeenAt: now },
              update: { operationalStatus: "AVAILABLE", lastSeenAt: now },
            },
          },
          qrBindings: {
            create: {
              publicToken: createOpaqueToken(24),
              code: record.charger.publicCode,
              validFrom: new Date(Math.floor(now.getTime() / 1000) * 1000),
            },
          },
          tariffs: {
            create: {
              stationId: record.charger.stationId,
              name: "Tarifa de cadastro",
              basePricePerKwh: m.pricePerKwh,
              validFrom: new Date(Math.floor(now.getTime() / 1000) * 1000),
              status: "ACTIVE",
            },
          },
        },
      });
    });
    this.realtime.publish({
      entityId: record.chargerId,
      topic: "charger.updated",
    });
    this.realtime.publishToOperations({
      entityId: record.id,
      topic: "station.updated",
    });
    this.realtime.publishToOperations({
      entityId: "summary",
      topic: "dashboard.updated",
    });
    return this.present(await this.get(id, user));
  }
  private async close(
    user: AuthUser,
    id: string,
    status: "REJECTED" | "CANCELED",
    reason?: string,
  ) {
    const record = await this.get(id, user);
    const m = metadata(record);
    const now = new Date();
    if (!["PENDING_CONNECTION", "PENDING_APPROVAL"].includes(m.status))
      throw new ConflictException("Solicitação não está pendente");
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.chargingCommand.updateMany({
        where: { id: record.id, status: { in: ["PENDING", "ACCEPTED"] } },
        data: {
          status: "REJECTED",
          processedAt: now,
          requestPayload: {
            ...m,
            status,
            ...(status === "REJECTED"
              ? { rejectionReason: reason!, rejectedAt: now.toISOString() }
              : { canceledAt: now.toISOString() }),
            reviewedById: intId(user.sub),
          },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException("Solicitação já analisada");
      await tx.charger.update({
        where: { id: record.chargerId },
        data: { administrativeStatus: "DISABLED" },
      });
    });
    this.realtime.publishToOperations({
      entityId: record.id,
      topic: "station.updated",
    });
    return this.present(await this.get(id, user));
  }
  reject(user: AuthUser, id: string, dto: RejectChargerProvisioningDto) {
    const reason = dto.reason.trim();
    if (reason.length < 5)
      throw new BadRequestException("Informe o motivo da rejeição");
    return this.close(user, id, "REJECTED", reason);
  }
  cancel(user: AuthUser, id: string) {
    return this.close(user, id, "CANCELED");
  }
  async remove(user: AuthUser, id: string) {
    const record = await this.get(id, user);
    const result = this.present(record);
    if (!["REJECTED", "CANCELED", "EXPIRED"].includes(result.status))
      throw new ConflictException(
        "Somente solicitações encerradas podem ser removidas",
      );
    // Preserve equipment identity and command audit history when hiding the request.
    const changed = await this.prisma.chargingCommand.updateMany({
      where: { id: record.id, status: record.status },
      data: {
        status: "REJECTED",
        requestPayload: {
          ...metadata(record),
          status: result.status,
          removed: true,
        },
      },
    });
    if (changed.count !== 1)
      throw new ConflictException("Solicitação mudou de estado");
    this.realtime.publishToOperations({
      entityId: record.id,
      topic: "station.updated",
    });
    return { deleted: true, id };
  }
}
