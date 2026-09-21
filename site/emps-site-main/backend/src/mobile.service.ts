import {initialBilling,invoice,ledgerOf,recordEnergy,tariffQuote,v1Enabled} from './tariff-engine';
import {SessionBillingService} from './session-billing.service';
import { GieService } from './gie.service';
import {
  intId,
  bigId,
  chargerInclude,
  chargerStatus,
  ChargerStatus,
  currentTariff,
  activeSessionStatuses,
  mobileSessionStatus,
  sessionInclude,
  type SessionRecord,
} from "./persistence";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ChargerAdministrativeStatus,
  ChargerOperationalStatus,
  ChargingCommandStatus,
  ChargingCommandType,
  PaymentIntentStatus,
  IntentPaymentMethod,
  type User,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Role,
  SessionStatus,
  StationStatus,
} from "@prisma/client";
import * as bcrypt from "bcrypt";
import { randomBytes, randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { ChargingGatewayService } from "./charging-gateway.service";
import type {
  CreatePaymentIntentDto,
  MobileLoginDto,
  MobilePaymentMethod,
  MobileRegisterDto,
  NearbyStationsQueryDto,
  StartMobileChargingDto,
} from "./mobile.dtos";
import {
  createOpaqueToken,
  elapsedSeconds,
  hashOpaqueToken,
  haversineDistanceKm,
  normalizeEmail,
  resolveIdempotencyKey,
} from "./mobile.utils";
import { PaymentGatewayService } from "./payment-gateway.service";
import { PrismaService } from "./prisma.service";
import { RealtimeService } from "./realtime.service";

const activeQrWhere = (now = new Date()): Prisma.QrBindingWhereInput => ({
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  isActive: true,
  revokedAt: null,
  validFrom: { lte: now },
});

const customerVisibleWhere = (now = new Date()): Prisma.ChargerWhereInput => ({
  administrativeStatus: 'ENABLED', station: {status:'ACTIVE',latitude:{not:null},longitude:{not:null}},
  liveStatus: {is: {operationalStatus:{not:'UNKNOWN'}}},
  qrBindings: {some: activeQrWhere(now)},
  OR: [{tariffs:{some:{status:'ACTIVE',validFrom:{lte:now},OR:[{validUntil:null},{validUntil:{gt:now}}]}}},
       {station:{tariffs:{some:{chargerId:null,status:'ACTIVE',validFrom:{lte:now},OR:[{validUntil:null},{validUntil:{gt:now}}]}}}}]
});
const chargerRelations = {
  ...chargerInclude,
  liveStatus: true,
  qrBindings: { orderBy: { createdAt: "desc" as const }, take: 1 },
} as const;

const stationRelations = {
  amenities: true,
  chargers: {
    where: { administrativeStatus: ChargerAdministrativeStatus.ENABLED },
    include: {
      liveStatus: true,
      qrBindings: { orderBy: { createdAt: "desc" as const }, take: 1 },
    },
    orderBy: { name: "asc" as const },
  },
} as const;

const sessionRelations = sessionInclude;

type ChargerRecord = Prisma.ChargerGetPayload<{
  include: typeof chargerRelations;
}>;
type StationRecord = Prisma.StationGetPayload<{
  include: typeof stationRelations;
}>;
type CustomerRecord = User;

const paymentMethodFromMobile: Record<
  MobilePaymentMethod,
  IntentPaymentMethod
> = {
  card: PaymentMethod.CARD,
  pix: PaymentMethod.PIX,
  wallet: PaymentMethod.DIGITAL_WALLET,
};

function mobilePaymentMethod(method: PaymentMethod): MobilePaymentMethod {
  if (method === PaymentMethod.PIX) return "pix";
  if (method === PaymentMethod.DIGITAL_WALLET) return "wallet";
  return "card";
}

function mobileChargerStatus(status: ChargerStatus) {
  if (status === ChargerStatus.AVAILABLE) return "available" as const;
  if (status === ChargerStatus.IN_USE) return "in_use" as const;
  if (status === ChargerStatus.MAINTENANCE) return "maintenance" as const;
  return "offline" as const;
}

function paymentIntentStatus(status: PaymentIntentStatus) {
  if (
    status === PaymentIntentStatus.REJECTED ||
    status === PaymentIntentStatus.CANCELED
  ) {
    return "rejected" as const;
  }
  if (status === PaymentIntentStatus.AUTHORIZED) {
    return "authorized" as const;
  }
  return "requires_action" as const;
}

function sessionCode(prefix: "EMP" | "PAY") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? String(item) : item,
    ),
  ) as Prisma.InputJsonValue;
}

@Injectable()
export class MobileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly payments: PaymentGatewayService,
    private readonly charging: ChargingGatewayService,
    private readonly realtime: RealtimeService,
    @Optional() private readonly energy?: GieService,
    @Optional() private readonly billing?: SessionBillingService,
  ) {}

  private refreshTokenExpiry() {
    const configured = Number(process.env.REFRESH_TOKEN_DAYS ?? 30);
    const days = Number.isFinite(configured)
      ? Math.min(365, Math.max(1, configured))
      : 30;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1_000);
  }

  private publicUser(user: Pick<CustomerRecord, "id" | "name" | "email">) {
    return { email: user.email, id: String(user.id), name: user.name };
  }

  private async issueAuthentication(user: CustomerRecord, familyId?: string) {
    const refreshToken = createOpaqueToken();
    await this.prisma.refreshToken.create({
      data: {
        expiresAt: this.refreshTokenExpiry(),
        familyId: familyId ?? randomUUID(),
        tokenHash: hashOpaqueToken(refreshToken),
        userId: user.id,
      },
    });
    const accessToken = await this.jwt.signAsync({
      email: user.email,
      role: user.role,
      sub: String(user.id),
    });
    return { accessToken, refreshToken, user: this.publicUser(user) };
  }

  private async customer(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: intId(userId) },
    });
    if (
      !user ||
      user.role !== Role.CUSTOMER ||
      user.accountStatus !== "ACTIVE"
    ) {
      throw new UnauthorizedException("Conta de motorista inválida");
    }
    return user;
  }

  private requireIdempotency(
    headerValue: string | undefined,
    bodyValue?: string,
  ) {
    try {
      return resolveIdempotencyKey(headerValue, bodyValue);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Chave inválida",
      );
    }
  }

  async register(dto: MobileRegisterDto) {
    const email = normalizeEmail(dto.email);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    let user: CustomerRecord;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          name: dto.name.trim(),
          passwordHash,
          role: Role.CUSTOMER,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Já existe uma conta com este e-mail");
      }
      throw error;
    }
    const authentication = await this.issueAuthentication(user);
    this.realtime.publish({
      customerId: user.id,
      entityId: user.id,
      operational: true,
      topic: "customer.updated",
    });
    return authentication;
  }

  async login(dto: MobileLoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(dto.email) },
    });
    const valid = user
      ? await bcrypt.compare(dto.password, user.passwordHash)
      : false;
    if (
      !valid ||
      user?.role !== Role.CUSTOMER ||
      user.accountStatus !== "ACTIVE"
    ) {
      throw new UnauthorizedException("E-mail ou senha inválidos");
    }
    return this.issueAuthentication(user);
  }

  async refresh(refreshToken: string) {
    const tokenHash = hashOpaqueToken(refreshToken);
    const current = await this.prisma.refreshToken.findUnique({
      include: { user: true },
      where: { tokenHash },
    });
    if (!current || current.expiresAt <= new Date()) {
      throw new UnauthorizedException("Sessão expirada. Entre novamente");
    }
    if (current.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        data: { revokedAt: new Date() },
        where: { familyId: current.familyId, revokedAt: null },
      });
      throw new UnauthorizedException("Sessão inválida. Entre novamente");
    }
    if (
      current.user.role !== Role.CUSTOMER ||
      current.user.accountStatus !== "ACTIVE"
    ) {
      throw new UnauthorizedException("Conta de motorista inválida");
    }

    const nextRawToken = createOpaqueToken();
    const rotated = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        data: {
          lastUsedAt: new Date(),
          revokedAt: new Date(),
        },
        where: { id: current.id, revokedAt: null },
      });
      if (revoked.count !== 1) return false;
      await tx.refreshToken.create({
        data: {
          expiresAt: this.refreshTokenExpiry(),
          familyId: current.familyId,
          tokenHash: hashOpaqueToken(nextRawToken),
          userId: current.userId,
        },
      });
      return true;
    });
    if (!rotated)
      throw new UnauthorizedException("Sessão já renovada. Entre novamente");

    const accessToken = await this.jwt.signAsync({
      email: current.user.email,
      role: current.user.role,
      sub: String(current.user.id),
    });
    return {
      accessToken,
      refreshToken: nextRawToken,
      user: this.publicUser(current.user),
    };
  }

  async logout(userId: string, refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      data: { revokedAt: new Date() },
      where: {
        tokenHash: hashOpaqueToken(refreshToken),
        userId: intId(userId),
        revokedAt: null,
      },
    });
  }

  async me(userId: string) {
    return this.publicUser(await this.customer(userId));
  }

  private presentStation(station: StationRecord) {
    if (station.latitude === null || station.longitude === null) {
      throw new BadRequestException(
        "Eletroposto ainda não possui coordenadas válidas",
      );
    }
    return {
      address: `${station.street}, ${station.addressNumber}${station.complement ? ` - ${station.complement}` : ""}`,
      amenities: station.amenities.map((item) => item.amenityName),
      chargerIds: station.chargers.map((charger) => charger.id),
      city: `${station.city} · ${station.state}`,
      coordinates: {
        latitude: Number(station.latitude),
        longitude: Number(station.longitude),
      },
      featured: station.featured,
      id: station.id,
      name: station.name,
      neighborhood: station.neighborhood,
      openingHours: station.openingHours ?? "Consulte o horário no local",
    };
  }

  private presentCharger(charger: ChargerRecord) {
    const now = new Date();
    const qr = charger.qrBindings.find(
      (binding) =>
        binding.isActive &&
        !binding.revokedAt &&
        binding.validFrom <= now &&
        (!binding.expiresAt || binding.expiresAt > now),
    );
    return {
      bay: charger.location,
      connectorType: charger.connectorType,
      id: charger.id,
      label: charger.name,
      lastUpdatedAt: (
        charger.liveStatus?.updatedAt ?? charger.updatedAt
      ).toISOString(),
      powerKw: Number(charger.powerKw),
      pricePerKwh: v1Enabled(charger.stationId)?Number(tariffQuote(this.energy?.billingFacts()).current_tariff_per_kwh):Number(currentTariff(charger).basePricePerKwh),
      ...(v1Enabled(charger.stationId)?{tariff:tariffQuote(this.energy?.billingFacts())}:{}),
      publicCode: charger.publicCode ?? charger.id,
      qrToken: qr?.publicToken ?? "",
      stationId: charger.stationId ?? "",
      status: mobileChargerStatus(chargerStatus(charger)),
    };
  }

  async nearbyStations(query: NearbyStationsQueryDto) {
    const stations = await this.prisma.station.findMany({
      include: {...stationRelations,chargers:{...stationRelations.chargers,where:customerVisibleWhere()}},
      where: {
        chargers: {
          some: customerVisibleWhere(),
        },
        latitude: { not: null },
        longitude: { not: null },
        status: StationStatus.ACTIVE,
      },
    });
    return stations
      .map((station) => ({
        distance: haversineDistanceKm(
          { latitude: query.lat, longitude: query.lng },
          {
            latitude: Number(station.latitude),
            longitude: Number(station.longitude),
          },
        ),
        station,
      }))
      .filter(({ distance }) => distance <= query.radiusKm)
      .sort((first, second) => first.distance - second.distance)
      .map(({ station }) => this.presentStation(station));
  }

  async station(stationId: string) {
    const station = await this.prisma.station.findFirst({
      include: {...stationRelations,chargers:{...stationRelations.chargers,where:customerVisibleWhere()}},
      where: {
        chargers: {
          some: customerVisibleWhere(),
        },
        id: intId(stationId),
        status: StationStatus.ACTIVE,
      },
    });
    if (!station) throw new NotFoundException("Eletroposto não encontrado");
    return this.presentStation(station);
  }

  async charger(chargerId: string) {
    const charger = await this.prisma.charger.findFirst({
      include: chargerRelations,
      where: {
        ...customerVisibleWhere(),
        id: intId(chargerId),
      },
    });
    if (!charger) throw new NotFoundException("Carregador não encontrado");
    return this.presentCharger(charger);
  }

  async resolveQr(publicToken: string) {
    const now = new Date();
    const binding = await this.prisma.qrBinding.findFirst({
      include: { charger: { include: chargerRelations } },
      where: {
        AND: [activeQrWhere(now)],
        OR: [
          { publicToken },
          { code: publicToken },
          { charger: { publicCode: publicToken } },
        ],
      },
    });
    if (!binding || !binding.charger.station) {
      throw new NotFoundException(
        "QR inválido, expirado ou ainda não cadastrado",
      );
    }
    if (
      binding.charger.administrativeStatus !==
        ChargerAdministrativeStatus.ENABLED ||
      binding.charger.station.status !== StationStatus.ACTIVE
    ) {
      throw new ConflictException(
        "Este carregador não está habilitado para recarga",
      );
    }

    const station = await this.prisma.station.findUnique({
      include: {...stationRelations,chargers:{...stationRelations.chargers,where:customerVisibleWhere()}},
      where: { id: binding.charger.station.id },
    });
    if (!station) throw new NotFoundException("Eletroposto não encontrado");
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60_000);
    const tariffLockedUntil =
      binding.expiresAt && binding.expiresAt < fiveMinutesFromNow
        ? binding.expiresAt
        : fiveMinutesFromNow;
    return {
      charger: this.presentCharger(binding.charger),
      qrBindingId: binding.id,
      station: this.presentStation(station),
      tariffLockedUntil: tariffLockedUntil.toISOString(),
    };
  }

  private presentPaymentIntent(
    intent: {
      id: bigint;
      method: IntentPaymentMethod;
      providerIntentId: string | null;
      status: PaymentIntentStatus;
    },
    clientSecret?: string,
  ) {
    return {
      id: intent.id,
      method: mobilePaymentMethod(intent.method),
      ...(clientSecret ? { providerClientSecret: clientSecret } : {}),
      status: paymentIntentStatus(intent.status),
    };
  }

  async createPaymentIntent(
    userId: string,
    dto: CreatePaymentIntentDto,
    headerIdempotencyKey?: string,
  ) {
    const user = await this.customer(userId);
    const idempotencyKey = this.requireIdempotency(headerIdempotencyKey);
    const existing = await this.prisma.paymentIntent.findUnique({
      where: {
        clientId_idempotencyKey: { clientId: user.id, idempotencyKey },
      },
    });
    if (
      existing &&
      (existing.chargerId !== intId(dto.chargerId) ||
        existing.method !== paymentMethodFromMobile[dto.method] ||
        Number(existing.spendingLimit) !== Number(dto.spendingLimit))
    )
      throw new ConflictException("Chave já utilizada com outros parâmetros");
    if(existing?.providerIntentId){
      if(existing.provider==='stripe'&&existing.status==='REQUIRES_ACTION'){const pi=await this.payments.retrieveIntent(existing.providerIntentId);return this.presentPaymentIntent(existing,pi.client_secret??undefined);}
      return this.presentPaymentIntent(existing);
    }

    const charger = await this.prisma.charger.findUnique({
      include: chargerInclude,
      where: { id: intId(dto.chargerId) },
    });
    if (!charger) throw new NotFoundException("Carregador não encontrado");
    if (
      chargerStatus(charger) !== ChargerStatus.AVAILABLE ||
      charger.administrativeStatus !== ChargerAdministrativeStatus.ENABLED
    ) {
      throw new ConflictException(
        "Carregador indisponível para uma nova recarga",
      );
    }

    const tariff = currentTariff(charger);
    const intent =
      existing ??
      (await this.prisma.paymentIntent
        .upsert({
          where: {
            clientId_idempotencyKey: { clientId: user.id, idempotencyKey },
          },
          update: {},
          create: {
            chargerId: charger.id,
            clientId: user.id,
            idempotencyKey,
            method: paymentMethodFromMobile[dto.method],
            provider: "PENDING",
            tariffId: tariff.id,
            tariffLockedUntil: new Date(Date.now() + 5 * 60_000),
            expiresAt: new Date(Date.now() + 15 * 60_000),
            spendingLimit: dto.spendingLimit,
            status: PaymentIntentStatus.REQUIRES_ACTION,
          },
        })
        .catch(async (error) => {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          )
            return this.prisma.paymentIntent.findUniqueOrThrow({
              where: {
                clientId_idempotencyKey: { clientId: user.id, idempotencyKey },
              },
            });
          throw error;
        }));
    if (
      intent.chargerId !== charger.id ||
      intent.method !== paymentMethodFromMobile[dto.method] ||
      Number(intent.spendingLimit) !== Number(dto.spendingLimit)
    ) {
      throw new ConflictException(
        "A chave de idempotência já foi usada em outra operação",
      );
    }

    if(v1Enabled(charger.stationId)){
      const mode=(process.env.PAYMENT_PROVIDER??'sandbox').toLowerCase();
      if(mode==='stripe'&&dto.method!=='card')throw new BadRequestException('Somente cartão no Stripe Sandbox');
      if(!['stripe','sandbox'].includes(mode))throw new BadRequestException('Provedor inválido');
      // Admission record only. No money is authorized; payment occurs after final billing.
      const updated=await this.prisma.paymentIntent.update({where:{id:intent.id},data:{provider:mode+'_deferred',providerIntentId:'deferred_'+intent.id,status:'AUTHORIZED',authorizedAmount:null}});
      return {...this.presentPaymentIntent(updated),billingTiming:'after_charge'};
    }
    const gateway = await this.payments.createIntent({
      idempotencyKey: `emps-intent-${intent.id}`,
      internalIntentId: String(intent.id),
      method: dto.method,
      spendingLimit: dto.spendingLimit,
    });
    const status =
      gateway.status === "authorized"
        ? PaymentIntentStatus.AUTHORIZED
        : gateway.status === "rejected"
          ? PaymentIntentStatus.REJECTED
          : PaymentIntentStatus.REQUIRES_ACTION;
    const updated = await this.prisma.paymentIntent.update({
      data: {
        authorizedAmount:
          status === PaymentIntentStatus.AUTHORIZED
            ? dto.spendingLimit
            : undefined,
        authorizedAt:
          status === PaymentIntentStatus.AUTHORIZED ? new Date() : undefined,
        provider: gateway.provider.toLowerCase(),
        providerIntentId: gateway.externalId,
        status,
      },
      where: { id: intent.id },
    });
    this.realtime.publish({
      customerId: userId,
      entityId: updated.id,
      operational: true,
      topic: "payment.updated",
    });
    return this.presentPaymentIntent(updated, gateway.clientSecret);
  }

  async paymentIntent(userId: string, intentId: string) {
    const user = await this.customer(userId);
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { clientId: user.id, id: bigId(intentId) },
    });
    if (!intent)
      throw new NotFoundException("Autorização de pagamento não encontrada");
    return this.presentPaymentIntent(intent);
  }

  private async fetchSession(sessionId: string | bigint, clientId: number) {
    const session = await this.prisma.chargingSession.findFirst({
      include: sessionRelations,
      where: { clientId, id: bigId(sessionId) },
    });
    if (!session) throw new NotFoundException("Recarga não encontrada");
    return session;
  }

  private presentSession(session: SessionRecord) {
    const breakdown=invoice(session);
    const duration =
      session.durationSeconds ??
      elapsedSeconds(
        session.startTime ?? session.requestedAt,
        session.endTime ?? new Date(),
      );
    const running = activeSessionStatuses.includes(session.status);
    const powerKw = running
      ? Number(session.charger.liveStatus?.currentPowerKw ?? 0)
      : 0;
    const energy = session.endTime || this.energy?.manages(session.charger)
      ? Number(session.energyKwh)
      : Math.max(Number(session.energyKwh), (powerKw * duration) / 3600);
    const method =
      session.paymentIntent?.method ??
      session.payments[0]?.method ??
      PaymentMethod.CARD;
    const status = mobileSessionStatus(session.status);
    return {
      ...(breakdown?{tariffVersion:session.tariffVersion,billing:breakdown.customer,billingFrozen:ledgerOf(session)?.phase==='frozen',disconnectedAt:session.disconnectedAt?.toISOString()}:{}),
      chargerId: String(session.chargerId),
      durationSeconds: duration,
      ...(session.endTime ? { endedAt: ledgerOf(session)?.charge_completed_at??session.endTime.toISOString() } : {}),
      energyKwh: breakdown?Number(breakdown.customer.energy_kwh):Number(energy.toFixed(3)),
      id: String(session.id),
      paymentMethod: mobilePaymentMethod(method),
      powerKw,
      requestedPowerKw: Number(session.charger.configuredPowerLimitKw ?? session.charger.powerKw ?? 0),
      managedPower: this.energy?.manages(session.charger) ?? false,
      telemetrySource: process.env.OCPP_GATEWAY_URL ? "charging_gateway" : this.energy?.manages(session.charger) ? "gie_sandbox" : "charging_gateway_sandbox",
      simulatedSecondsOffset: 0,
      spendingLimit:
        session.spendingLimit === null ? null : Number(session.spendingLimit),
      startedAt: (session.startTime ?? session.requestedAt).toISOString(),
      stationId: String(session.charger.stationId),
      status,
      outcome: session.status.toLowerCase(),
      totalCost: breakdown?Number(breakdown.customer.total_amount):Number(
        (session.endTime
          ? Number(session.totalPrice)
          : energy * Number(session.pricePerKwhSnapshot) +
            Number(session.fixedFeeSnapshot)
        ).toFixed(2),
      ),
      transactionId:
        session.payments.find(p=>p.status==='APPROVED')?.code ?? session.commands.find((c) => c.type === "START_CHARGING")
          ?.correlationId ?? undefined,
    };
  }

  async startCharging(
    userId: string,
    dto: StartMobileChargingDto,
    headerIdempotencyKey?: string,
  ) {
    const user = await this.customer(userId);
    const idempotencyKey = this.requireIdempotency(
      headerIdempotencyKey,
      dto.idempotencyKey,
    );
    const existing = await this.prisma.chargingSession.findUnique({
      include: sessionRelations,
      where: {
        startIdempotencyKey: hashOpaqueToken(
          `start:${user.id}:${idempotencyKey}`,
        ),
      },
    });
    if (existing) {
      if (
        existing.clientId !== user.id ||
        existing.qrBindingId !== intId(dto.qrBindingId) ||
        existing.paymentIntentId !== bigId(dto.paymentIntentId)
      )
        throw new ConflictException("Chave já utilizada com outros parâmetros");
      return this.presentSession(existing);
    }

    const now = new Date();
    const [binding, intent, activeSession] = await Promise.all([
      this.prisma.qrBinding.findFirst({
        include: { charger: { include: chargerInclude } },
        where: { AND: [{ id: intId(dto.qrBindingId) }, activeQrWhere(now)] },
      }),
      this.prisma.paymentIntent.findFirst({
        include: { tariff: true },
        where: { clientId: user.id, id: bigId(dto.paymentIntentId) },
      }),
      this.prisma.chargingSession.findFirst({
        where: { clientId: user.id, status: { in: activeSessionStatuses } },
      }),
    ]);
    if (activeSession) {
      if (
        activeSession.startIdempotencyKey ===
          hashOpaqueToken(`start:${user.id}:${idempotencyKey}`) &&
        activeSession.paymentIntentId === bigId(dto.paymentIntentId) &&
        activeSession.qrBindingId === intId(dto.qrBindingId)
      )
        return this.presentSession(
          await this.fetchSession(activeSession.id, user.id),
        );
      throw new ConflictException("Você já possui uma recarga em andamento");
    }
    if (!binding)
      throw new BadRequestException("O vínculo do QR expirou ou foi revogado");
    if (!intent || intent.chargerId !== binding.chargerId) {
      throw new BadRequestException(
        "Pagamento e QR não pertencem ao mesmo carregador",
      );
    }
    if (intent.status !== PaymentIntentStatus.AUTHORIZED) {
      throw new BadRequestException("O pagamento ainda não foi autorizado");
    }
    if (
      chargerStatus(binding.charger) !== ChargerStatus.AVAILABLE ||
      binding.charger.administrativeStatus !==
        ChargerAdministrativeStatus.ENABLED
    ) {
      throw new ConflictException("Carregador indisponível");
    }

    if (intent.expiresAt <= now || intent.tariffLockedUntil <= now)
      throw new ConflictException("Autorização ou tarifa expirada");
    if (binding.charger.station.status !== "ACTIVE")
      throw new ConflictException("Eletroposto inativo");
    if (
      dto.spendingLimit != null &&
      Number(dto.spendingLimit) !== Number(intent.spendingLimit)
    )
      throw new ConflictException("Limite difere da autorização");
    let createdId: bigint;
    try {
      createdId = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
        const active = await tx.chargingSession.findFirst({
          where: { clientId: user.id, status: { in: activeSessionStatuses } },
        });
        if (active)
          throw new ConflictException(
            "Você já possui uma recarga em andamento",
          );
        const reserved = await tx.chargerLiveStatus.updateMany({
          data: { operationalStatus: "PREPARING" },
          where: {
            chargerId: binding.chargerId,
            operationalStatus: "AVAILABLE",
            charger: {
              administrativeStatus: "ENABLED",
              station: { status: "ACTIVE" },
            },
          },
        });
        if (reserved.count !== 1)
          throw new ConflictException("A vaga acabou de ser ocupada");
        const session = await tx.chargingSession.create({
          data: {
            chargerId: binding.chargerId,
            clientId: user.id,
            code: sessionCode("EMP"),
            meterStartKwh: binding.charger.liveStatus?.meterTotalKwh,
            paymentIntentId: intent.id,
            tariffId: intent.tariffId,
            sessionOrigin: "MOBILE_APP",
            billingMode:v1Enabled(binding.charger.stationId)?"POSTPAID":"PREPAID",
            preferredPaymentMethod: intent.method,
            basePricePerKwhSnapshot: intent.tariff.basePricePerKwh,
            pricePerKwhSnapshot: intent.tariff.basePricePerKwh,
            fixedFeeSnapshot: intent.tariff.fixedFee,
            qrBindingId: binding.id,
            spendingLimit: dto.spendingLimit ?? intent.spendingLimit,
            startIdempotencyKey: hashOpaqueToken(
              `start:${user.id}:${idempotencyKey}`,
            ),
            startTime: now,
            status: SessionStatus.START_REQUESTED,
            ...initialBilling(binding.charger.stationId,now,this.energy?.billingFacts()),
          },
        });
        await tx.chargingCommand.create({
          data: {
            chargerId: binding.chargerId,
            clientId: user.id,
            correlationId: hashOpaqueToken(
              `start:${user.id}:${idempotencyKey}`,
            ),
            requestPayload: {
              paymentIntentId: String(intent.id),
              qrBindingId: binding.id,
            },
            sessionId: session.id,
            status: ChargingCommandStatus.PENDING,
            timeoutAt: new Date(Date.now() + 30_000),
            type: ChargingCommandType.START_CHARGING,
          },
        });
        await tx.chargerLiveStatus.upsert({
          create: {
            chargerId: binding.chargerId,
            lastSeenAt: now,
            operationalStatus: ChargerOperationalStatus.PREPARING,
          },
          update: {
            lastSeenAt: now,
            operationalStatus: ChargerOperationalStatus.PREPARING,
          },
          where: { chargerId: binding.chargerId },
        });
        return session.id;
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        const replay = await this.prisma.chargingSession.findUnique({
          where: {
            startIdempotencyKey: hashOpaqueToken(
              `start:${user.id}:${idempotencyKey}`,
            ),
          },
          include: sessionRelations,
        });
        if (
          replay &&
          replay.paymentIntentId === bigId(dto.paymentIntentId) &&
          replay.qrBindingId === intId(dto.qrBindingId)
        )
          return this.presentSession(replay);
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "Já existe uma recarga ativa para este cliente ou carregador",
        );
      }
      throw error;
    }

    const command = await this.prisma.chargingCommand.findFirstOrThrow({
      where: { sessionId: createdId, type: ChargingCommandType.START_CHARGING },
    });
    try {
      const result = await this.charging.dispatch({
        chargerId: binding.chargerId,
        commandId: command.id,
        ocppIdentity: binding.charger.ocppIdentity,
        ocppVersion: binding.charger.ocppVersion,
        sessionId: createdId,
        type: "START",
      });
      if (!result.accepted) {
        throw new BadGatewayException(
          "O carregador recusou o início da recarga",
        );
      }
      await this.prisma.$transaction([
        this.prisma.chargingCommand.update({
          data: {
            processedAt: result.mode === "sandbox" ? new Date() : undefined,
            responsePayload: asJson(result),
            sentAt: new Date(),
            status:
              result.mode === "sandbox"
                ? ChargingCommandStatus.COMPLETED
                : ChargingCommandStatus.ACCEPTED,
          },
          where: { id: command.id },
        }),
        this.prisma.chargingSession.update({
          data: {
            status:
              result.mode === "sandbox"
                ? SessionStatus.ACTIVE
                : SessionStatus.STARTING,
          },
          where: { id: createdId },
        }),
        this.prisma.chargerLiveStatus.update({
          data: {
            currentPowerKw: this.energy?.manages(binding.charger) ? 0 : Number(binding.charger.powerKw) * 0.82,
            lastSeenAt: new Date(),
            operationalStatus: ChargerOperationalStatus.CHARGING,
          },
          where: { chargerId: binding.chargerId },
        }),
      ]);
    } catch (error) {
      await this.failStart(
        createdId,
        command.id,
        error instanceof BadGatewayException
          ? error.message
          : "Falha de comunicação com o carregador",
        userId,
      );
      throw error;
    }
    const created = this.presentSession(
      await this.fetchSession(createdId, user.id),
    );
    this.realtime.publish({
      customerId: userId,
      entityId: createdId,
      operational: true,
      topic: "session.created",
    });
    this.realtime.publish({
      entityId: binding.chargerId,
      topic: "charger.updated",
    });
    this.realtime.publish({
      entityId: "summary",
      operational: true,
      topic: "dashboard.updated",
    });
    return created;
  }

  private async failStart(
    sessionId: bigint,
    commandId: bigint,
    reason: string,
    customerId: string,
  ) {
    const session = await this.prisma.chargingSession.findUnique({
      where: { id: bigId(sessionId) },
    });
    if (!session) return;
    await this.prisma.$transaction([
      this.prisma.chargingCommand.update({
        data: {
          lastError: reason,
          status: ChargingCommandStatus.FAILED,
        },
        where: { id: commandId },
      }),
      this.prisma.chargingSession.update({
        data: { endTime: new Date(), status: SessionStatus.START_FAILED },
        where: { id: bigId(sessionId) },
      }),
      this.prisma.chargerLiveStatus.update({
        data: {
          currentPowerKw: 0,
          operationalStatus: ChargerOperationalStatus.AVAILABLE,
        },
        where: { chargerId: session.chargerId },
      }),
    ]);
    this.realtime.publish({
      customerId,
      entityId: sessionId,
      operational: true,
      topic: "session.updated",
    });
    this.realtime.publish({
      entityId: session.chargerId,
      topic: "charger.updated",
    });
    this.realtime.publish({
      entityId: "summary",
      operational: true,
      topic: "dashboard.updated",
    });
  }

  async activeSession(userId: string) {
    const user = await this.customer(userId);
    const session = await this.prisma.chargingSession.findFirst({
      include: sessionRelations,
      orderBy: { startTime: "desc" },
      where: { clientId: user.id, status: { in: activeSessionStatuses } },
    });
    return session ? this.presentSession(session) : null;
  }

  async sessionHistory(userId: string) {
    const user = await this.customer(userId);
    const sessions = await this.prisma.chargingSession.findMany({
      include: sessionRelations,
      orderBy: { startTime: "desc" },
      take: 100,
      where: { clientId: user.id, status: { notIn: activeSessionStatuses } },
    });
    return sessions.map((session) => this.presentSession(session));
  }

  async session(userId: string, sessionId: string) {
    const user = await this.customer(userId);
    return this.presentSession(await this.fetchSession(sessionId, user.id));
  }

  async stopCharging(
    userId: string,
    sessionId: string,
    headerIdempotencyKey?: string,
  ) {
    const user = await this.customer(userId);
    const key = hashOpaqueToken(
      `stop:${user.id}:${this.requireIdempotency(headerIdempotencyKey)}`,
    );
    await this.energy?.refresh();
    let session = await this.fetchSession(sessionId, user.id);
    if (session.stopIdempotencyKey && session.stopIdempotencyKey !== key)
      throw new ConflictException("Encerramento já solicitado com outra chave");
    if (session.endTime) {
      if(session.tariffVersion)return this.presentSession(session);
      if (session.stopIdempotencyKey !== key)
        throw new BadRequestException("Esta recarga já foi encerrada");
      if (session.status === SessionStatus.WAITING_PAYMENT)
        return this.settleStoppedSession(sessionId, user.id, key);
      return this.presentSession(session);
    }
    if (session.status !== SessionStatus.ACTIVE) {
      if (session.stopIdempotencyKey === key)
        return this.presentSession(session);
      throw new ConflictException("Aguarde o início da recarga");
    }
    const command = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.chargingSession.updateMany({
        where: {
          id: session.id,
          status: SessionStatus.ACTIVE,
          stopIdempotencyKey: null,
        },
        data: { status: SessionStatus.STOP_REQUESTED, stopIdempotencyKey: key },
      });
      if (claimed.count !== 1) return null;
      const previous = await tx.chargingCommand.findUnique({
        where: { correlationId: key },
      });
      if (previous && previous.sessionId !== session.id)
        throw new ConflictException("Chave já utilizada em outra sessão");
      return tx.chargingCommand.upsert({
        where: { correlationId: key },
        create: {
          chargerId: session.chargerId,
          sessionId: session.id,
          clientId: user.id,
          type: ChargingCommandType.STOP_CHARGING,
          correlationId: key,
          timeoutAt: new Date(Date.now() + 30000),
        },
        update: {
          status: ChargingCommandStatus.PENDING,
          lastError: null,
          timeoutAt: new Date(Date.now() + 30000),
        },
      });
    });
    if (!command)
      return this.presentSession(await this.fetchSession(sessionId, user.id));
    let result;
    try {
      result = await this.charging.dispatch({
        chargerId: session.chargerId,
        commandId: command.id,
        sessionId,
        ocppIdentity: session.charger.ocppIdentity,
        ocppVersion: session.charger.ocppVersion,
        type: "STOP",
      });
      if (!result.accepted)
        throw new BadGatewayException("O carregador recusou o encerramento");
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await tx.chargingCommand.update({
          where: { id: command.id },
          data: {
            status: ChargingCommandStatus.FAILED,
            lastError: (error instanceof Error
              ? error.message
              : "Falha no gateway"
            ).slice(0, 255),
          },
        });
        await tx.chargingSession.update({
          where: { id: session.id },
          data: { status: SessionStatus.ACTIVE, stopIdempotencyKey: null },
        });
      });
      throw error;
    }
    const endedAt = new Date();
    if (result.mode !== "sandbox") {
      await this.prisma.$transaction(async (tx) => {
        await tx.chargingCommand.update({
          where: { id: command.id },
          data: {
            status: ChargingCommandStatus.ACCEPTED,
            sentAt: endedAt,
            responsePayload: asJson(result),
          },
        });
        await tx.chargingSession.update({
          where: { id: session.id },
          data: { status: SessionStatus.STOPPING },
        });
      });
      return this.presentSession(await this.fetchSession(sessionId, user.id));
    }
    // The stop claim serializes with the sampler; reload the last committed ledger.
    session = await this.fetchSession(sessionId,user.id);
    const closingLedger=ledgerOf(session);
    if(closingLedger){
      const seconds=Math.min(15,Math.max(0,(endedAt.getTime()-Date.parse(closingLedger.last_at))/1000));
      const cumulative=new Prisma.Decimal(closingLedger.meter_energy_kwh).add(new Prisma.Decimal(session.charger.liveStatus?.currentPowerKw??0).mul(seconds).div(3600));
      session.billingSnapshot=asJson(recordEnergy(closingLedger,cumulative,endedAt,this.energy?.billingFacts()??closingLedger.facts)) as Prisma.JsonValue;
      session.energyKwh=cumulative.toDecimalPlaces(3);
    }
    const seconds = elapsedSeconds(
      session.startTime ?? session.requestedAt,
      endedAt,
    );
    const meterStart = Number(session.meterStartKwh ?? 0);
    const liveMeter = session.charger.liveStatus?.meterTotalKwh;
    const measured =
      liveMeter !== null &&
      liveMeter !== undefined &&
      Number(liveMeter) > meterStart
        ? Number(liveMeter) - meterStart
        : null;
    const effectivePower = Number(
      session.charger.liveStatus?.currentPowerKw ??
        Number(session.charger.powerKw) * 0.82,
    );
    const energy = Number(
      Math.max(0, this.energy?.manages(session.charger) ? Number(session.energyKwh) : measured ?? (effectivePower * seconds) / 3600).toFixed(3),
    );
    const v1=invoice(session);
    const calculated =
      energy * Number(session.pricePerKwhSnapshot) +
      Number(session.fixedFeeSnapshot);
    const amount = v1?Number(v1.customer.total_amount):Number(
      Math.max(
        0,
        session.spendingLimit === null
          ? calculated
          : Math.min(calculated, Number(session.spendingLimit)),
      ).toFixed(2),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.chargingSession.update({
        where: { id: session.id },
        data: {
          status: SessionStatus.WAITING_PAYMENT,
          ...(v1?{billingSnapshot:asJson({...ledgerOf(session)!,phase:'awaiting_disconnect',charge_completed_at:endedAt.toISOString()})}:{}),
          endTime: v1?new Date(Math.floor(endedAt.getTime()/1000)*1000):endedAt,
          durationSeconds: seconds,
          energyKwh: energy,
          meterEndKwh: meterStart + energy,
          totalPrice: amount,
        },
      });
      await tx.chargerLiveStatus.update({
        where: { chargerId: session.chargerId },
        data: {
          operationalStatus: v1?ChargerOperationalStatus.FINISHING:ChargerOperationalStatus.AVAILABLE,
          currentPowerKw: 0,
          meterTotalKwh: meterStart + energy,
          lastSeenAt: endedAt,
        },
      });
      await tx.chargingCommand.update({
        where: { id: command.id },
        data: {
          status: ChargingCommandStatus.COMPLETED,
          sentAt: endedAt,
          processedAt: endedAt,
          responsePayload: asJson(result),
        },
      });
      if(!v1) await tx.payment.upsert({
        where: { idempotencyKey: `settle-${key}` },
        create: {
          code: sessionCode("PAY"),
          sessionId: session.id,
          paymentIntentId: session.paymentIntentId,
          idempotencyKey: `settle-${key}`,
          method: session.paymentIntent?.method ?? PaymentMethod.SIMULATED,
          amount,
          currency: session.currency,
          status: PaymentStatus.PENDING,
          provider: session.paymentIntent?.provider,
        },
        update: {},
      });
    });
    this.realtime.publish({
      entityId: session.chargerId,
      topic: "charger.updated",
    });
    if(v1){this.realtime.publish({topic:'session.updated',entityId:session.id,customerId:user.id,operational:true});return this.presentSession(await this.fetchSession(sessionId,user.id));}
    return this.settleStoppedSession(sessionId, user.id, key);
  }

  private async settleStoppedSession(
    sessionId: string,
    customerId: number,
    key: string,
  ) {
    let session = await this.fetchSession(sessionId, customerId);
    if (!session.paymentIntent?.providerIntentId)
      throw new BadRequestException("Autorização de pagamento incompleta");
    const claimed = await this.prisma.chargingSession.updateMany({
      where: { id: session.id, status: SessionStatus.WAITING_PAYMENT },
      data: { status: SessionStatus.PAYMENT_CAPTURING },
    });
    if (claimed.count !== 1)
      return this.presentSession(
        await this.fetchSession(sessionId, customerId),
      );
    try {
      const settlement = await this.payments.settleIntent({
        amount: Number(session.totalPrice),
        externalId: session.paymentIntent.providerIntentId,
        method: mobilePaymentMethod(session.paymentIntent.method),
        provider: session.paymentIntent.provider ?? "",
      });
      const approved = settlement.status === "approved";
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { idempotencyKey: `settle-${key}` },
          data: {
            status: approved
              ? PaymentStatus.APPROVED
              : settlement.status === "rejected"
                ? PaymentStatus.REJECTED
                : PaymentStatus.PENDING,
            amountReceived: approved ? settlement.capturedAmount : null,
            provider: settlement.provider.toLowerCase(),
            providerPaymentId: settlement.externalPaymentId,
            paidAt: approved ? new Date() : null,
          },
        });
        await tx.chargingSession.update({
          where: { id: session.id },
          data: {
            status: approved
              ? SessionStatus.FINISHED
              : SessionStatus.WAITING_PAYMENT,
          },
        });
      });
    } catch (error) {
      await this.prisma.chargingSession.updateMany({
        where: { id: session.id, status: SessionStatus.PAYMENT_CAPTURING },
        data: { status: SessionStatus.WAITING_PAYMENT },
      });
      throw error;
    }
    session = await this.fetchSession(sessionId, customerId);
    this.realtime.publish({
      customerId,
      entityId: session.id,
      operational: true,
      topic: "session.updated",
    });
    if (session.payments[0])
      this.realtime.publish({
        customerId,
        entityId: session.payments[0].id,
        operational: true,
        topic: "payment.updated",
      });
    this.realtime.publish({
      entityId: "summary",
      operational: true,
      topic: "dashboard.updated",
    });
    return this.presentSession(session);
  }

  async processStripeWebhook(event: Stripe.Event) {
    if(await this.billing?.webhook(event))return {received:true};
    if (!event.type.startsWith("payment_intent.")) return { received: true };
    const object = await this.payments.retrieveIntent(
      (event.data.object as Stripe.PaymentIntent).id,
    );
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { provider: "stripe", providerIntentId: object.id },
    });
    if (!intent) return { received: true };
    const status =
      object.status === "succeeded" || object.status === "requires_capture"
        ? PaymentIntentStatus.AUTHORIZED
        : object.status === "canceled"
          ? PaymentIntentStatus.CANCELED
          : PaymentIntentStatus.REQUIRES_ACTION;
    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status,
        authorizedAt:
          status === PaymentIntentStatus.AUTHORIZED
            ? (intent.authorizedAt ?? new Date())
            : undefined,
        authorizedAmount: object.amount / 100,
      },
    });
    this.realtime.publish({
      customerId: intent.clientId,
      entityId: intent.id,
      operational: true,
      topic: "payment.updated",
    });
    return { received: true };
  }
}
