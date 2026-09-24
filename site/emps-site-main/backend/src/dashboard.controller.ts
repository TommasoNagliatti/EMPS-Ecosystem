import {
  ChargerStatus,
  chargerInclude,
  presentCharger,
  sessionInclude,
  presentAdminSession,
  stationScope,
} from "./persistence";
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { PaymentStatus, Role, SessionStatus } from "@prisma/client";
import { AuthRequest, JwtGuard, Roles, RolesGuard } from "./auth";
import { PrismaService } from "./prisma.service";

const number = (value: unknown) => Number(value ?? 0);
const startOfDay = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const startOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

@UseGuards(JwtGuard, RolesGuard)
@Roles(Role.ADMIN, Role.OPERATOR)
@Controller("dashboard")
export class DashboardController {
  constructor(private prisma: PrismaService) {}
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
      session: presentAdminSession(p.session),
    }));
    const todaySessions = sessions.filter((s) => s.startTime >= startOfDay());
    const monthPayments = payments.filter(
      (p) =>
        (p.paidAt ?? p.createdAt) >= startOfMonth() && p.status === PaymentStatus.APPROVED,
    );
    const todayPayments = monthPayments.filter(
      (p) => (p.paidAt ?? p.createdAt) >= startOfDay(),
    );
    const finished = sessions.filter(
      (s) => s.status === SessionStatus.FINISHED,
    );
    const active = sessions.filter((s) => s.status === SessionStatus.ACTIVE);
    const revenueByDay = Array.from({ length: 7 }, (_, index) => {
      const day = new Date();
      day.setDate(day.getDate() - (6 - index));
      day.setHours(0, 0, 0, 0);
      const next = new Date(day);
      next.setDate(day.getDate() + 1);
      return {
        day: day.toLocaleDateString("pt-BR", { weekday: "short" }),
        revenue: payments
          .filter(
            (p) =>
              (p.paidAt ?? p.createdAt) >= day &&
              (p.paidAt ?? p.createdAt) < next &&
              p.status === PaymentStatus.APPROVED,
          )
          .reduce((sum, p) => sum + number(p.amount), 0),
      };
    });
    const energyByHour = Array.from({ length: 9 }, (_, index) => ({
      hour: `${6 + index * 2}h`,
      energy: finished
        .filter(
          (s) =>
            s.startTime.getHours() >= 6 + index * 2 &&
            s.startTime.getHours() < 8 + index * 2,
        )
        .reduce((sum, s) => sum + number(s.energyKwh), 0),
    }));
    const count = (status: string) =>
      chargers.filter((c) => c.status === status).length;
    const sessionsByCharger = new Map<string, number>();
    const sessionsByHour = new Map<number, number>();
    for (const session of sessions) {
      sessionsByCharger.set(
        session.charger.name,
        (sessionsByCharger.get(session.charger.name) ?? 0) + 1,
      );
      sessionsByHour.set(
        session.startTime.getHours(),
        (sessionsByHour.get(session.startTime.getHours()) ?? 0) + 1,
      );
    }
    const mostUsedCharger =
      [...sessionsByCharger.entries()].sort(
        (first, second) => second[1] - first[1],
      )[0]?.[0] ?? "Sem sessões";
    const peakHour = [...sessionsByHour.entries()].sort(
      (first, second) => second[1] - first[1],
    )[0]?.[0];
    const paymentMethodCounts = new Map<string, number>();
    for (const payment of payments) {
      paymentMethodCounts.set(
        payment.method,
        (paymentMethodCounts.get(payment.method) ?? 0) + 1,
      );
    }
    const mostUsedPaymentMethod =
      [...paymentMethodCounts.entries()].sort(
        (first, second) => second[1] - first[1],
      )[0]?.[0] ?? "Sem pagamentos";
    return {
      revenueToday: todayPayments.reduce((sum, p) => sum + number(p.amount), 0),
      revenueMonth: monthPayments.reduce((sum, p) => sum + number(p.amount), 0),
      energyTodayKwh: todaySessions.reduce(
        (sum, s) => sum + number(s.energyKwh),
        0,
      ),
      sessionsToday: todaySessions.length,
      activeSessions: active.length,
      availableChargers: count(ChargerStatus.AVAILABLE),
      occupancyRate: chargers.length
        ? Math.round((count(ChargerStatus.IN_USE) / chargers.length) * 100)
        : 0,
      averageTicket: finished.length
        ? finished.reduce((sum, s) => sum + number(s.totalPrice), 0) /
          finished.length
        : 0,
      chargerStatusCount: {
        available: count("AVAILABLE"),
        inUse: count("IN_USE"),
        offline: count("OFFLINE"),
        maintenance: count("MAINTENANCE"),
        critical: count("CRITICAL_ERROR"),
      },
      recentPayments: payments.slice(0, 6),
      activeSessionsList: active,
      alerts,
      revenueByDay,
      energyByHour,
      adminIndicators: {
        averageChargingTime: Math.round(
          finished.reduce((sum, s) => sum + number(s.durationMinutes), 0) /
            Math.max(finished.length, 1),
        ),
        averageEnergyPerSession:
          finished.reduce((sum, s) => sum + number(s.energyKwh), 0) /
          Math.max(finished.length, 1),
        mostUsedCharger,
        mostUsedPaymentMethod,
        peakHour:
          peakHour === undefined
            ? "Sem sessões"
            : `${String(peakHour).padStart(2, "0")}h–${String((peakHour + 1) % 24).padStart(2, "0")}h`,
      },
    };
  }
}
