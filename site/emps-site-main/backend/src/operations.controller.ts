import { StationScoped } from './auth';
import {
  BadRequestException,
  Body,
  ConflictException,
  ForbiddenException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Prisma, Role, SessionStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import { AdminOperationsService } from "./admin-operations.service";
import { AuthRequest, JwtGuard, Roles, RolesGuard } from "./auth";
import {
  CashSettlementDto,
  ChargerCommandDto,
  CreateChargerDto,
  CreateClientDto,
  FinishChargingSessionDto,
  ManualReleaseDto,
  PostpaidReleaseDto,
  SimulatePaymentDto,
  StartChargingSessionDto,
  UpdateAlertStatusDto,
  UpdateChargerStatusDto,
  UpdateChargerDto,
  UpdateClientDto,
} from "./dtos";
import {
  intId,
  bigId,
  chargerInclude,
  clientSelect,
  presentClient,
  presentCharger,
  presentAdminSession,
  sessionInclude,
  stationScope,
  activeSessionStatuses,
} from "./persistence";
import { PrismaService } from "./prisma.service";
import { RealtimeService } from "./realtime.service";

@StationScoped()
@UseGuards(JwtGuard, RolesGuard)
@Roles(Role.ADMIN, Role.OPERATOR)
@Controller()
export class OperationsController {
  constructor(
    private prisma: PrismaService,
    private adminOperations: AdminOperationsService,
    private realtime: RealtimeService,
  ) {}
  private async requireCharger(request: AuthRequest, id: string) {
    const charger = await this.prisma.charger.findFirst({
      where: { id: intId(id), station: stationScope(request.user) },
      include: chargerInclude,
    });
    if (!charger)
      throw new NotFoundException("Carregador não encontrado para esta conta");
    return charger;
  }
  private async requireSession(request: AuthRequest, id: string) {
    const session = await this.prisma.chargingSession.findFirst({
      where: {
        id: bigId(id),
        charger: { station: stationScope(request.user) },
      },
      include: sessionInclude,
    });
    if (!session)
      throw new NotFoundException("Sessão não encontrada para esta conta");
    return session;
  }
  private async localClientIds(request: AuthRequest) {
    const events=await this.prisma.stationAuditEvent.findMany({where:{action:'walkin.created',station:stationScope(request.user)},select:{details:true}});
    return events.map(e=>Number((e.details as {clientId?:number}|null)?.clientId)).filter(Number.isSafeInteger);
  }
  private async requireEditableWalkin(request:AuthRequest,id:string){
    const u=await this.prisma.user.findUnique({where:{id:intId(id)}});
    if(!u || u.accountStatus!=='INACTIVE' || !u.email.endsWith('@emps.invalid') || !(await this.localClientIds(request)).includes(u.id))
      throw new ForbiddenException('A conta EMPS só pode ser alterada pelo próprio titular');
    if(await this.prisma.chargingSession.count({where:{clientId:u.id,charger:{station:{NOT:stationScope(request.user)}}}}))
      throw new ForbiddenException('Cliente possui histórico em outra estação');
  }
  @Get("clients")
  async clients(@Req() request: AuthRequest) {
    return (
      await this.prisma.user.findMany({
        where: { accountStatus: { not: "BLOCKED" }, OR:[{id:{in:await this.localClientIds(request)}},{sessions:{some:{charger:{station:stationScope(request.user)}}}}] },
        select: { ...clientSelect, sessions: {where:{charger:{station:stationScope(request.user)}}} },
        orderBy: { name: "asc" },
      })
    ).map((u) => ({ ...presentClient(u), sessions: u.sessions }));
  }
  @Get("clients/:id")
  async client(@Req() request: AuthRequest, @Param("id") id: string) {
    const u = await this.prisma.user.findFirst({
      where: {
        id: intId(id),
        OR:[{id:{in:await this.localClientIds(request)}},{sessions:{some:{charger:{station:stationScope(request.user)}}}}],
        accountStatus: { not: "BLOCKED" },
      },
      select: { ...clientSelect, sessions: {where:{charger:{station:stationScope(request.user)}}} },
    });
    if (!u) throw new NotFoundException("Cliente não encontrado");
    return { ...presentClient(u), sessions: u.sessions };
  }
  @Post("clients")
  async createClient(@Req() request:AuthRequest, @Body() dto: CreateClientDto) {
    const station=await this.prisma.station.findFirst({where:stationScope(request.user),select:{id:true}});
    if(!station)throw new ForbiddenException('Selecione uma estação autorizada');
    const user = await this.prisma.$transaction(async tx=>{const created=await tx.user.create({
      data: {
        name: dto.name,
        email: `walkin-${randomUUID()}@emps.invalid`,
        passwordHash: await bcrypt.hash(randomUUID(), 12),
        role: "CUSTOMER",
        accountStatus: "INACTIVE",
        vehicles: {
          create: {
            model: dto.vehicle,
            licensePlate: dto.plate.trim().toUpperCase(),
            isPrimary: true,
          },
        },
      },
      select: clientSelect,
    });await tx.stationAuditEvent.create({data:{stationId:station.id,actorId:intId(request.user.sub),action:'walkin.created',details:{clientId:created.id}}});return created;});
    this.realtime.publish({
      entityId: user.id,
      operational: true,
      topic: "customer.updated",
    });
    return presentClient(user);
  }
  @Patch("clients/:id")
  async updateClient(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: UpdateClientDto) {
    await this.client(request,id);
    await this.requireEditableWalkin(request,id);
    const user = await this.prisma.$transaction(async (tx) => {
      if (dto.vehicle !== undefined || dto.plate !== undefined) {
        const vehicle = await tx.userVehicle.findFirst({
          where: { userId: intId(id), status: "ACTIVE" },
          orderBy: { isPrimary: "desc" },
        });
        if (vehicle)
          await tx.userVehicle.update({
            where: { id: vehicle.id },
            data: {
              model: dto.vehicle,
              licensePlate: dto.plate?.trim().toUpperCase(),
            },
          });
        else {
          if (!dto.vehicle || !dto.plate)
            throw new BadRequestException("Informe veículo e placa");
          await tx.userVehicle.create({
            data: {
              userId: intId(id),
              model: dto.vehicle,
              licensePlate: dto.plate.trim().toUpperCase(),
              isPrimary: true,
            },
          });
        }
      }
      return tx.user.update({
        where: { id: intId(id) },
        data: { name: dto.name },
        select: clientSelect,
      });
    });
    this.realtime.publish({
      entityId: user.id,
      customerId: user.id,
      operational: true,
      topic: "customer.updated",
    });
    return presentClient(user);
  }
  @Delete("clients/:id")
  async deleteClient(@Req() request: AuthRequest, @Param("id") id: string) {
    const user = await this.client(request,id);
    await this.requireEditableWalkin(request,id);
    if (user.sessions.some((s) => activeSessionStatuses.includes(s.status)))
      throw new ConflictException("Cliente possui sessão em andamento");
    // Historical sessions/payments have RESTRICT FKs; disable instead of deleting them.
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: intId(id) },
        data: { accountStatus: "BLOCKED" },
      });
      await tx.refreshToken.updateMany({
        where: { userId: intId(id), revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.userVehicle.updateMany({
        where: { userId: intId(id) },
        data: { status: "INACTIVE" },
      });
    });
    this.realtime.publish({
      entityId: id,
      customerId: id,
      operational: true,
      topic: "customer.updated",
    });
    return user;
  }
  @Get("chargers")
  async chargers(@Req() request: AuthRequest) {
    const rows = await this.prisma.charger.findMany({
      where: { station: stationScope(request.user) },
      include: {
        ...chargerInclude,
        sessions: {
          where: { status: { in: activeSessionStatuses } },
          include: sessionInclude,
        },
      },
      orderBy: { location: "asc" },
    });
    return rows.map((c) => ({
      ...presentCharger(c),
      sessions: c.sessions.map(presentAdminSession),
    }));
  }
  @Get("chargers/:id")
  async charger(@Req() request: AuthRequest, @Param("id") id: string) {
    return presentCharger(await this.requireCharger(request, id));
  }
  @Post("chargers")
  createCharger(@Body() _dto: CreateChargerDto) {
    throw new BadRequestException(
      "Use o fluxo seguro de provisionamento de carregadores",
    );
  }
  @Patch("chargers/:id")
  @Roles(Role.ADMIN)
  async updateCharger(
    @Req() request: AuthRequest,
    @Param("id") id: string,
    @Body() dto: UpdateChargerDto,
  ) {
    const charger = await this.requireCharger(request, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.charger.update({
        where: { id: charger.id },
        data: {
          name: dto.name,
          location: dto.location,
          connectorType: dto.connectorType,
          powerKw: dto.powerKw,
          configuredPowerLimitKw: dto.powerKw,
        },
      });
      if (dto.pricePerKwh !== undefined) {
        await tx.tariff.updateMany({
          where: { chargerId: charger.id, status: "ACTIVE" },
          data: { status: "INACTIVE" },
        });
        await tx.tariff.create({
          data: {
            stationId: charger.stationId,
            chargerId: charger.id,
            name: "Tarifa do painel",
            basePricePerKwh: dto.pricePerKwh,
            validFrom: new Date(),
            status: "ACTIVE",
          },
        });
      }
      if (dto.temperature !== undefined)
        await tx.chargerLiveStatus.upsert({
          where: { chargerId: charger.id },
          create: { chargerId: charger.id, temperatureC: dto.temperature },
          update: { temperatureC: dto.temperature },
        });
    });
    if (dto.status)
      await this.updateChargerStatus(request, id, { status: dto.status });
    this.publishChargerChange(id);
    return this.charger(request, id);
  }
  @Patch("chargers/:id/status")
  async updateChargerStatus(
    @Req() request: AuthRequest,
    @Param("id") id: string,
    @Body() dto: UpdateChargerStatusDto,
  ) {
    await this.requireCharger(request, id);
    if (
      await this.prisma.chargingSession.count({
        where: { chargerId: intId(id), status: { in: activeSessionStatuses } },
      })
    )
      throw new ConflictException("Encerre a sessão antes de alterar o estado");
    if (dto.status === "IN_USE")
      throw new BadRequestException(
        "Inicie uma sessão para ocupar o carregador",
      );
    const state =
      dto.status === "AVAILABLE"
        ? "AVAILABLE"
        : dto.status === "CRITICAL_ERROR"
          ? "FAULTED"
          : dto.status === "MAINTENANCE"
            ? "UNAVAILABLE"
            : "OFFLINE";
    await this.prisma.charger.update({
      where: { id: intId(id) },
      data: {
        administrativeStatus:
          dto.status === "MAINTENANCE" ? "MAINTENANCE" : "ENABLED",
        liveStatus: {
          upsert: {
            create: { operationalStatus: state },
            update: { operationalStatus: state, currentPowerKw: 0 },
          },
        },
      },
    });
    this.publishChargerChange(id);
    return this.charger(request, id);
  }
  @Post("chargers/:id/commands")
  async command(
    @Req() request: AuthRequest,
    @Param("id") id: string,
    @Body() dto: ChargerCommandDto,
  ) {
    await this.requireCharger(request, id);
    return this.adminOperations.sendCommand(id, dto.command);
  }
  @Post("chargers/:id/manual-release")
  async manualRelease(
    @Req() request: AuthRequest,
    @Param("id") id: string,
    @Body() dto: ManualReleaseDto,
  ) {
    await this.requireCharger(request, id);
    return this.adminOperations.manualRelease(id, dto);
  }
  @Post("chargers/:id/postpaid-sessions")
  async postpaidSession(
    @Req() request: AuthRequest,
    @Param("id") id: string,
    @Body() dto: PostpaidReleaseDto,
  ) {
    await this.requireCharger(request, id);
    return this.adminOperations.startPostpaid(id, dto);
  }
  @Delete("chargers/:id")
  @Roles(Role.ADMIN)
  async deleteCharger(@Req() request: AuthRequest, @Param("id") id: string) {
    await this.requireCharger(request, id);
    if (
      await this.prisma.chargingSession.count({
        where: { chargerId: intId(id), status: { in: activeSessionStatuses } },
      })
    )
      throw new ConflictException("Carregador possui sessão ativa");
    const row = await this.prisma.charger.update({
      where: { id: intId(id) },
      data: {
        administrativeStatus: "DISABLED",
        qrBindings: {
          updateMany: {
            where: { isActive: true },
            data: { isActive: false, revokedAt: new Date() },
          },
        },
      },
      include: chargerInclude,
    });
    this.publishChargerChange(id);
    return presentCharger(row);
  }
  @Get("charging-sessions")
  async sessions(
    @Req() request: AuthRequest,
    @Query("status") status?: SessionStatus,
    @Query('q') query?: string,
  ) {
    if (status && !Object.values(SessionStatus).includes(status))
      throw new BadRequestException("Estado de sessão inválido");
    const rows = await this.prisma.chargingSession.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(query?.trim() ? {OR:[
          ...(/^\d{1,19}$/.test(query.trim()) ? [{id:bigId(query.trim())}] : []),
          ...(!/^\d+$/.test(query.trim()) ? [{code:{contains:query.trim()}}, {client:{name:{contains:query.trim()}}},
          {charger:{name:{contains:query.trim()}}}] : []),
        ]} : {}),
        charger: { station: stationScope(request.user) },
      },
      include: sessionInclude,
      orderBy: [{ requestedAt: "desc" }, {id:'desc'}],
    });
    return rows.map(presentAdminSession);
  }
  @Get("charging-sessions/:id")
  async session(@Req() request: AuthRequest, @Param("id") id: string) {
    return presentAdminSession(await this.requireSession(request, id));
  }
  @Post("charging-sessions/start")
  async start(
    @Req() request: AuthRequest,
    @Body() dto: StartChargingSessionDto,
  ) {
    await this.requireCharger(request, dto.chargerId);
    await this.client(request, dto.clientId);
    const result = await this.adminOperations.startCustomerSession(
      dto.chargerId,
      intId(dto.clientId),
    );
    return this.session(request, String(result.id));
  }
  @Post("charging-sessions/:id/finish")
  async finish(
    @Req() request: AuthRequest,
    @Param("id") id: string,
    @Body() _dto: FinishChargingSessionDto,
  ) {
    const session = await this.requireSession(request, id);
    if (session.status !== "ACTIVE")
      throw new BadRequestException("Sessão ativa não encontrada");
    await this.adminOperations.sendCommand(
      String(session.chargerId),
      "encerrar_carga",
    );
    if (!process.env.OCPP_GATEWAY_URL && !session.paymentIntentId)
      await this.simulate(request, { sessionId: id, method: "SIMULATED" });
    return this.session(request, id);
  }
  @Post("charging-sessions/:id/cancel")
  async cancel(@Req() request: AuthRequest, @Param("id") id: string) {
    const session = await this.requireSession(request, id);
    if (session.status !== "ACTIVE")
      throw new BadRequestException("Sessão ativa não encontrada");
    await this.adminOperations.sendCommand(
      String(session.chargerId),
      "encerrar_carga",
    );
    if (!process.env.OCPP_GATEWAY_URL)
      await this.prisma.chargingSession.update({
        where: { id: session.id },
        data: { status: "CANCELED" },
      });
    this.publishChargerChange(session.chargerId);
    return this.session(request, id);
  }
  @Get("charging-sessions/:id/quote")
  async quote(@Req() request: AuthRequest, @Param('id') id: string) {
    await this.requireSession(request, id); return this.adminOperations.cashQuote(id);
  }
  @Post("charging-sessions/:id/settle-cash")
  async settleCash(
    @Req() request: AuthRequest,
    @Param("id") id: string,
    @Body() dto: CashSettlementDto,
  ) {
    await this.requireSession(request, id);
    return this.adminOperations.settleCash(id, dto);
  }
  @Get("payments")
  async payments(@Req() request: AuthRequest, @Query('q') query?: string) {
    const rows = await this.prisma.payment.findMany({
      where: { session: { charger: { station: stationScope(request.user) } },
        ...(query?.trim() ? {OR:[
          ...(/^\d{1,19}$/.test(query.trim()) ? [{id:bigId(query.trim())},{sessionId:bigId(query.trim())}] : []),
          ...(!/^\d+$/.test(query.trim()) ? [{code:{contains:query.trim()}}, {session:{client:{name:{contains:query.trim()}}}},
          {session:{charger:{name:{contains:query.trim()}}}}] : []),
        ]} : {}),
      },
      include: { session: { include: sessionInclude } },
      orderBy: [{ createdAt: "desc" }, {id:'desc'}],
    });
    return rows.map((p) => ({ ...p, session: presentAdminSession(p.session) }));
  }
  @Get("payments/:id")
  async payment(@Req() request: AuthRequest, @Param("id") id: string) {
    const row = await this.prisma.payment.findFirst({
      where: {
        id: bigId(id),
        session: { charger: { station: stationScope(request.user) } },
      },
      include: { session: { include: sessionInclude } },
    });
    if (!row) throw new NotFoundException("Pagamento não encontrado");
    return { ...row, session: presentAdminSession(row.session) };
  }
  @Post("payments/simulate")
  async simulate(@Req() request: AuthRequest, @Body() dto: SimulatePaymentDto) {
    if ((process.env.PAYMENT_PROVIDER ?? "sandbox").toLowerCase() !== "sandbox")
      throw new BadRequestException("Simulação disponível apenas em sandbox");
    const session = await this.requireSession(request, dto.sessionId);
    if (!session.endTime)
      throw new BadRequestException("Finalize a sessão antes do pagamento");
    const alreadyPaid = session.payments.find(
      (payment) => payment.status === "APPROVED",
    );
    if (alreadyPaid) return alreadyPaid;
    const key = `admin-settle-${session.id}`;
    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.upsert({
        where: { idempotencyKey: key },
        create: {
          idempotencyKey: key,
          code: `PAY-${randomUUID()}`,
          sessionId: session.id,
          method: dto.method ?? "SIMULATED",
          amount: session.totalPrice,
          status: "APPROVED",
          provider: "sandbox",
          paidAt: new Date(),
        },
        update: { status: "APPROVED", paidAt: new Date(), provider: "sandbox" },
      });
      await tx.chargingSession.update({
        where: { id: session.id },
        data: { status: "FINISHED" },
      });
      return p;
    });
    this.realtime.publish({
      customerId: session.clientId ?? undefined,
      entityId: payment.id,
      operational: true,
      topic: "payment.updated",
    });
    return payment;
  }
  @Post("payments/:id/approve")
  async approvePayment(@Req() request: AuthRequest, @Param("id") id: string) {
    await this.payment(request, id);
    return this.adminOperations.approvePayment(id);
  }
  @Get("alerts")
  alerts(@Req() request: AuthRequest) {
    return this.prisma.alert.findMany({
      where: {
        OR: [
          { station: stationScope(request.user) },
          { charger: { station: stationScope(request.user) } },
        ],
      },
      include: { charger: true },
      orderBy: { createdAt: "desc" },
    });
  }
  @Patch("alerts/:id/status")
  async updateAlert(
    @Req() request: AuthRequest,
    @Param("id") id: string,
    @Body() dto: UpdateAlertStatusDto,
  ) {
    const row = await this.prisma.alert.findFirst({
      where: {
        id: bigId(id),
        OR: [
          { station: stationScope(request.user) },
          { charger: { station: stationScope(request.user) } },
        ],
      },
    });
    if (!row) throw new NotFoundException("Alerta não encontrado");
    const alert = await this.prisma.alert.update({
      where: { id: row.id },
      data: {
        status: dto.status,
        resolvedAt: dto.status === "RESOLVED" ? new Date() : null,
        resolvedByUserId:
          dto.status === "RESOLVED" ? intId(request.user.sub) : null,
      },
    });
    this.realtime.publish({
      entityId: alert.id,
      operational: true,
      topic: "alert.updated",
    });
    return alert;
  }
  private publishChargerChange(chargerId: string | number) {
    this.realtime.publish({ entityId: chargerId, topic: "charger.updated" });
    this.realtime.publish({
      entityId: "summary",
      operational: true,
      topic: "dashboard.updated",
    });
  }
}
