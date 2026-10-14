type Session = { status: string; startTime: Date; energyKwh: unknown; totalPrice: unknown; durationMinutes: unknown; charger: { name: string } };
type Payment = { status: string; paidAt: Date | null; createdAt: Date; amount: unknown; method: string;cashReturnedAmount?:string;cashReturnedAt?:string|null };
const number = (value: unknown) => Number(value ?? 0);

export function dashboardSummary<C extends { status: string }, S extends Session, P extends Payment, A>(
  chargers: C[], sessions: S[], payments: P[], alerts: A[], now = new Date(),
) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const month = new Date(today); month.setDate(1);
  const todaySessions = sessions.filter(s => s.startTime >= today);
  const monthPayments = payments.filter(p => (p.paidAt ?? p.createdAt) >= month && p.status === 'APPROVED');
  const todayPayments = monthPayments.filter(p => (p.paidAt ?? p.createdAt) >= today);
  const returned=(from:Date,to:Date)=>payments.filter(p=>p.status==='APPROVED'&&p.cashReturnedAt&&new Date(p.cashReturnedAt)>=from&&new Date(p.cashReturnedAt)<=to).reduce((sum,p)=>sum+number(p.cashReturnedAmount),0);
  const finished = sessions.filter(s => s.status === 'FINISHED');
  const active = sessions.filter(s => s.status === 'ACTIVE');
  const revenueByDay = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today); day.setDate(day.getDate() - (6 - index));
    const next = new Date(day); next.setDate(day.getDate() + 1);
    return { day: day.toLocaleDateString('pt-BR', { weekday: 'short' }), revenue: payments
      .filter(p => (p.paidAt ?? p.createdAt) >= day && (p.paidAt ?? p.createdAt) < next && p.status === 'APPROVED')
      .reduce((sum, p) => sum + number(p.amount), 0)-returned(day,new Date(Math.min(next.getTime()-1,now.getTime()))) };
  });
  const energyByHour = Array.from({ length: 9 }, (_, index) => ({ hour: `${6 + index * 2}h`, energy: finished
    .filter(s => s.startTime.getHours() >= 6 + index * 2 && s.startTime.getHours() < 8 + index * 2)
    .reduce((sum, s) => sum + number(s.energyKwh), 0) }));
  const count = (status: string) => chargers.filter(c => c.status === status).length;
  const sessionsByCharger = new Map<string, number>(), sessionsByHour = new Map<number, number>();
  for (const session of sessions) {
    sessionsByCharger.set(session.charger.name, (sessionsByCharger.get(session.charger.name) ?? 0) + 1);
    sessionsByHour.set(session.startTime.getHours(), (sessionsByHour.get(session.startTime.getHours()) ?? 0) + 1);
  }
  const mostUsedCharger = [...sessionsByCharger.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Sem sessões';
  const peakHour = [...sessionsByHour.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const paymentMethodCounts = new Map<string, number>();
  for (const payment of payments) paymentMethodCounts.set(payment.method, (paymentMethodCounts.get(payment.method) ?? 0) + 1);
  const mostUsedPaymentMethod = [...paymentMethodCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Sem pagamentos';
  return {
    revenueToday: todayPayments.reduce((sum, p) => sum + number(p.amount), 0)-returned(today,now),
    revenueMonth: monthPayments.reduce((sum, p) => sum + number(p.amount), 0)-returned(month,now),
    energyTodayKwh: todaySessions.reduce((sum, s) => sum + number(s.energyKwh), 0),
    sessionsToday: todaySessions.length, activeSessions: active.length, availableChargers: count('AVAILABLE'),
    occupancyRate: chargers.length ? Math.round(count('IN_USE') / chargers.length * 100) : 0,
    averageTicket: finished.length ? finished.reduce((sum, s) => sum + number(s.totalPrice), 0) / finished.length : 0,
    chargerStatusCount: { available: count('AVAILABLE'), inUse: count('IN_USE'), offline: count('OFFLINE'), maintenance: count('MAINTENANCE'), critical: count('CRITICAL_ERROR') },
    recentPayments: payments.slice(0, 6), activeSessionsList: active, alerts, revenueByDay, energyByHour,
    adminIndicators: {
      averageChargingTime: Math.round(finished.reduce((sum, s) => sum + number(s.durationMinutes), 0) / Math.max(finished.length, 1)),
      averageEnergyPerSession: finished.reduce((sum, s) => sum + number(s.energyKwh), 0) / Math.max(finished.length, 1),
      mostUsedCharger, mostUsedPaymentMethod,
      peakHour: peakHour === undefined ? 'Sem sessões' : `${String(peakHour).padStart(2, '0')}h–${String((peakHour + 1) % 24).padStart(2, '0')}h`,
    },
  };
}
