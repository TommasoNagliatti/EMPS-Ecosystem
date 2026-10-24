import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { JwtGuard, RolesGuard, type AuthRequest } from '../src/auth';
import { DashboardController } from '../src/dashboard.controller';
import { dashboardSummary } from '../src/dashboard-summary';
import { PrismaService } from '../src/prisma.service';
import { stationScope } from '../src/persistence';

const request = { user: { sub: '7', email: 'fixture@example.invalid', role: Role.ADMIN, selectedStationId: 13, stationPermission: 'READ' }, headers: {} } as AuthRequest;
function fixture() {
  const now = new Date(); now.setHours(10, 0, 0, 0);
  const older = new Date(now); older.setDate(older.getDate() - 40);
  const charger = { id: 1, name: 'Fixture charger', stationId: 13, administrativeStatus: 'ENABLED', location: 'A', liveStatus: { operationalStatus: 'CHARGING' }, tariffs: [], station: { id: 13, name: 'Fixture', tariffs: [], amenities: [] } };
  const client = { id: 2, name: 'Fixture client', vehicles: [], phone: null };
  const sessions = [
    { id: 2n, clientId: null, client: null, chargerId: 1, charger, status: 'ACTIVE', requestedAt: now, startTime: null, endTime: null, durationSeconds: null, energyKwh: 1, totalPrice: 2, payments: [], commands: [{ payload: 'NOT_FOR_PANEL' }] },
    { id: 1n, clientId: 2, client, chargerId: 1, charger, status: 'FINISHED', requestedAt: older, startTime: older, endTime: now, durationSeconds: 121, energyKwh: 4, totalPrice: 8, payments: [], commands: [{ payload: 'NOT_FOR_PANEL' }] },
  ];
  const payments = [{ id: 1n, code: 'FIXTURE-PAY-1', sessionId: 1n, session: sessions[1], status: 'APPROVED', method: 'PIX', amount: 8, createdAt: now, paidAt: now, idempotencyKey: 'NOT_FOR_PANEL' }];
  sessions[1].payments = payments as never;
  const alerts = [{ id: 1n, status: 'OPEN', charger }, { id: 2n, status: 'RESOLVED', charger }];
  const calls: { model: string; args: any }[] = [];
  function select(row: any, fields: any): any { return Object.fromEntries(Object.entries(fields).filter(([, value]) => value).map(([key, value]) => [key, value === true || row[key] == null ? row[key] : select(row[key], (value as any).select)])); }
  const repo = (model: string, rows: any[]) => ({ findMany: async (args: any) => { calls.push({ model, args }); const matching = model === 'alert' && args.where.status ? rows.filter(row => row.status !== 'RESOLVED') : rows; return args.select ? matching.map(row => select(row, args.select)) : matching; } });
  const prisma = { charger: repo('charger', [charger]), chargingSession: repo('session', sessions), payment: repo('payment', payments), alert: repo('alert', alerts) } as unknown as PrismaService;
  return { controller: new DashboardController(prisma), calls };
}

test('consolidated panel has the same authentication and station-scope guards', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, DashboardController), [JwtGuard, RolesGuard]);
  assert.equal(Reflect.getMetadata('emps:station-scoped', DashboardController), true);
  assert.equal(Reflect.getMetadata(PATH_METADATA, DashboardController.prototype.panel), 'panel');
});

test('panel uses four read-only queries, all intersecting the authorized station scope', async () => {
  const { controller, calls } = fixture();
  await controller.panel(request);
  const scope = stationScope(request.user);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.find(c => c.model === 'charger')?.args.where, { station: scope });
  assert.deepEqual(calls.find(c => c.model === 'session')?.args.where, { charger: { station: scope } });
  assert.deepEqual(calls.find(c => c.model === 'payment')?.args.where, { session: { charger: { station: scope } } });
  assert.deepEqual(calls.find(c => c.model === 'alert')?.args.where, { OR: [{ station: scope }, { charger: { station: scope } }] });
  const sessionQuery = calls.find(c => c.model === 'session')!.args;
  assert.equal(sessionQuery.select.commands, undefined);
  assert.equal(sessionQuery.select.paymentIntent, undefined);
  assert.equal(sessionQuery.select.reservation, undefined);
  assert.equal(sessionQuery.take, undefined);
});

test('lean panel preserves summary indicators, guest sessions, active chargers, and resolved alarms', async () => {
  const { controller } = fixture();
  const old = await controller.summary(request);
  const panel = await controller.panel(request);
  const metrics = (value: typeof old | typeof panel.summary) => {
    const { recentPayments, activeSessionsList, alerts, ...rest } = value;
    return rest;
  };
  assert.deepEqual(metrics(panel.summary), metrics(old));
  assert.equal(panel.sessions[0].client.name, 'Cliente avulso (caixa)');
  assert.equal(panel.sessions[1].durationMinutes, 3);
  assert.equal(panel.sessions[1].payment?.status, 'APPROVED');
  assert.equal(panel.chargers[0].sessions[0].id, 2n);
  assert.equal(panel.alerts.length, 2);
  assert.equal(panel.summary.alerts.length, 1);
  assert.equal(panel.payments[0].session?.client.name, 'Fixture client');
  assert.equal(panel.payments[0].code, 'FIXTURE-PAY-1');
  assert.ok(!JSON.stringify(panel, (_, v) => typeof v === 'bigint' ? String(v) : v).includes('NOT_FOR_PANEL'));
});

test('empty panel summary remains finite and includes all existing metric keys', () => {
  const empty = dashboardSummary([], [], [], []);
  assert.equal(empty.occupancyRate, 0);
  assert.equal(empty.averageTicket, 0);
  assert.equal(empty.adminIndicators.averageChargingTime, 0);
  assert.equal(empty.revenueByDay.length, 7);
  assert.equal(empty.energyByHour.length, 9);
});
