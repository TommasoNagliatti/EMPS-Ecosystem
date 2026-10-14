import { StationScoped } from './auth';
import {cashReturnFields,presentLifecycle} from './charge-lifecycle';
import { dashboardSummary } from './dashboard-summary';
import {
  activeSessionStatuses,
  chargerInclude,
  presentCharger,
  sessionInclude,
  presentAdminSession,
  stationScope,
} from "./persistence";
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { AuthRequest, JwtGuard, Roles, RolesGuard } from "./auth";
import { PrismaService } from "./prisma.service";

@StationScoped()
@UseGuards(JwtGuard, RolesGuard)
@Roles(Role.ADMIN, Role.OPERATOR)
@Controller("dashboard")
export class DashboardController {
  constructor(private prisma: PrismaService) {}
  @Get('panel')
  async panel(@Req() request: AuthRequest) {
    const scope = stationScope(request.user);
    const [chargerRows, sessionRows, paymentRows, alerts] = await Promise.all([
      this.prisma.charger.findMany({ where: { station: scope }, include: chargerInclude, orderBy: { location: 'asc' } }),
      this.prisma.chargingSession.findMany({
        where: { charger: { station: scope } },
        select: {
          id: true, clientId: true, chargerId: true, status: true, requestedAt: true, startTime: true, endTime: true,
          durationSeconds: true, energyKwh: true, totalPrice: true, billingSnapshot:true,
          client: { select: { id: true, name: true } },
          charger: { select: { id: true, name: true, stationId: true } },
        },
        orderBy: { startTime: 'desc' },
      }),
      this.prisma.payment.findMany({
        where: { session: { charger: { station: scope } } },
        select: { id: true, code: true, sessionId: true, status: true, method: true, amount: true, paidAt: true, createdAt: true, provider:true,idempotencyKey:true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.alert.findMany({
        where: { OR: [{ station: scope }, { charger: { station: scope } }] },
        include: { charger: true }, orderBy: { createdAt: 'desc' },
      }),
    ]);
    const snapshots=new Map(sessionRows.map(row=>[row.id,row.billingSnapshot]));
    const safePayments=paymentRows.map(({idempotencyKey,provider,...row})=>({...row,...cashReturnFields({...row,idempotencyKey,provider},snapshots.get(row.sessionId))}));
    const latestPayment = new Map<bigint, typeof safePayments[number]>();
    for (const payment of safePayments) if (!latestPayment.has(payment.sessionId)) latestPayment.set(payment.sessionId, payment);
    const sessions = sessionRows.map(({billingSnapshot,...row}) => ({ ...row, lifecycle:presentLifecycle(billingSnapshot),client: row.client ?? { id: null, name: 'Cliente avulso (caixa)' },
      startTime: row.startTime ?? row.requestedAt, stationId: row.charger.stationId,
      durationMinutes: row.durationSeconds === null ? null : Math.ceil(row.durationSeconds / 60),
      payment: latestPayment.get(row.id) ?? null,
    }));
    const byId = new Map(sessions.map(session => [session.id, session]));
    const payments = safePayments.map(row => ({ ...row, session: byId.get(row.sessionId) }));
    const activeByCharger = new Map<number, typeof sessions>();
    for (const session of sessions) if (activeSessionStatuses.includes(session.status)) {
      const active = activeByCharger.get(session.chargerId) ?? [];
      active.push(session); activeByCharger.set(session.chargerId, active);
    }
    const chargers = chargerRows.map(row => ({ ...presentCharger(row), sessions: activeByCharger.get(row.id) ?? [] }));
    // Keep the legacy summary formulas and ordering, without sending command/payment-intent trees.
    return { summary: dashboardSummary(chargers, sessions, payments, alerts.filter(alert => alert.status !== 'RESOLVED')),
      chargers, sessions: [...sessions].sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)), payments, alerts };
  }
  @Get("summary")
  async summary(@Req() request: AuthRequest) {
    const scope = stationScope(request.user);
    const chargerWhere = { station: scope };
    const sessionWhere = { charger: { station: scope } };
    const paymentWhere = { session: { charger: { station: scope } } };
    const alertWhere = {
      OR: [{ station: scope }, { charger: { station: scope } }],
      status: { not: "RESOLVED" as const },
    };
    const [chargerRows, sessionRows, paymentRows, alerts] = await Promise.all([
      this.prisma.charger.findMany({
        where: chargerWhere,
        include: chargerInclude,
      }),
      this.prisma.chargingSession.findMany({
        where: sessionWhere,
        include: sessionInclude,
        orderBy: { startTime: "desc" },
      }),
      this.prisma.payment.findMany({
        where: paymentWhere,
        include: { session: { include: sessionInclude } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.alert.findMany({
        where: alertWhere,
        include: { charger: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const chargers = chargerRows.map(presentCharger);
    const sessions = sessionRows.map(presentAdminSession);
    const payments = paymentRows.map((p) => ({
      ...p,
      ...cashReturnFields(p,p.session.billingSnapshot),
      session: presentAdminSession(p.session),
    }));
    return dashboardSummary(chargers, sessions, payments, alerts);
  }
}
