import { COMMERCIAL_LAB_CHANNELS } from './lab-session-mapping';
import { chargerDemoEnabled, chargerDemoEnergy, withChargerModeLock } from './charger-demo-mode';
import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from './auth';
import { demoIntegrationActive, officialDemoRuntimeActive } from './official-demo-runtime';
import { LabMaqueteService } from './lab-maquete.service';
import { PlatformAccessService } from './platform-access.service';
import { PrismaService } from './prisma.service';
import { intId } from './persistence';
import { LabCardGateway } from './lab-card-gateway';
import { chargeActor, type ChargeSubject } from './charge-subject';
import { sandboxEnergyScenario } from './sandbox-energy-scenario';

type Tx = Prisma.TransactionClient;
type Method = 'pix' | 'card' | 'wallet';
type CashierMethod = 'cash' | 'pos';
type Session = Awaited<ReturnType<PrismaService['labChargeSession']['findUniqueOrThrow']>>;
type Receipt = Awaited<ReturnType<PrismaService['labChargeReceipt']['findUniqueOrThrow']>>;
const activeStatuses = ['STARTING', 'CHARGING', 'FINISHING'];
const SANDBOX_POWER_FACTOR = new Prisma.Decimal('0.82'); // Explicit hypothetical load factor, not metered output.
const AUTO_STOP_POLL_MS = 2_000;
const keyPattern = /^[A-Za-z0-9_-]{8,100}$/;
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only the audited clone or the admitted official demonstration uses the lab ledger. */
export function chargingSandboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EMPS_CHARGING_SANDBOX_ENABLED === 'true' && demoIntegrationActive(env) &&
    env.EMPS_MAQUETE_STATION_ID === '46' && !env.OCPP_GATEWAY_URL && !env.OCPP_GATEWAY_TOKEN &&
    (officialDemoRuntimeActive(env) || env.PAYMENT_PROVIDER === 'sandbox');
}

function methodOf(value: unknown): Method {
  if (value !== 'pix' && value !== 'card' && value !== 'wallet') throw new BadRequestException('Método sandbox inválido');
  return value;
}
function cashierMethodOf(value: unknown): CashierMethod {
  if (value !== 'cash' && value !== 'pos') throw new BadRequestException('Recebimento de caixa deve ser dinheiro ou maquininha externa');
  return value;
}
function isCashierMethod(value: string): value is CashierMethod { return value === 'cash' || value === 'pos'; }
function keyOf(value: unknown) {
  if (typeof value !== 'string' || !keyPattern.test(value)) throw new BadRequestException('Chave de idempotência inválida');
  return value;
}
function money(value: unknown): Prisma.Decimal {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 10_000 ||
      Math.abs(Math.round(value * 100) - value * 100) > 1e-7)
    throw new BadRequestException('Limite sandbox deve ser entre R$ 1,00 e R$ 10.000,00');
  return new Prisma.Decimal(value);
}

/** Explicit energy estimate; never represents measured charger consumption. */
export function estimateSandboxEnergy(startedAt: Date, at: Date, powerKw: Prisma.Decimal, pricePerKwh: Prisma.Decimal,
  fixedFee: Prisma.Decimal, spendingLimit: Prisma.Decimal) {
  const seconds = Math.max(0, (at.getTime() - startedAt.getTime()) / 1000);
  const rawEnergy = powerKw.mul(seconds).div(3600);
  const energyBudget = pricePerKwh.gt(0) ? Prisma.Decimal.max(0, spendingLimit.sub(fixedFee)).div(pricePerKwh) : rawEnergy;
  const energy = Prisma.Decimal.min(rawEnergy, energyBudget).toDecimalPlaces(3, Prisma.Decimal.ROUND_DOWN);
  const amount = Prisma.Decimal.min(spendingLimit, energy.mul(pricePerKwh).add(fixedFee)).toDecimalPlaces(2);
  return { energy, amount, seconds };
}

/** Durable deadline derived only from the locked tariff and simulated power recorded for this session. */
export function sandboxBudgetDeadline(startedAt: Date, powerKw: Prisma.Decimal, pricePerKwh: Prisma.Decimal,
  fixedFee: Prisma.Decimal, spendingLimit: Prisma.Decimal): Date {
  if (powerKw.lte(0) || pricePerKwh.lte(0) || spendingLimit.lte(fixedFee))
    throw new ConflictException('Parâmetros de limite SANDBOX inválidos');
  const milliseconds = spendingLimit.sub(fixedFee).div(pricePerKwh).div(powerKw).mul(3_600_000).ceil().toNumber();
  return new Date(startedAt.getTime() + Math.max(1, milliseconds));
}

@Injectable()
export class ChargingSandboxService implements OnModuleInit, OnModuleDestroy {
  private readonly cardGateway = new LabCardGateway();
  cardConfiguration() {
    const key = process.env.EMPS_LAB_STRIPE_PUBLISHABLE_KEY ?? '';
    return { cardPaymentProvider: this.cardGateway.enabled() ? 'stripe' : 'sandbox',
      stripePublishableKey: this.cardGateway.enabled() && /^pk_test_[A-Za-z0-9]+$/.test(key) ? key : undefined };
  }
  private readonly logger = new Logger(ChargingSandboxService.name);
  private autoStopTimer: ReturnType<typeof setInterval> | null = null;
  private autoStopRunning = false;
  constructor(private readonly db: PrismaService, private readonly access: PlatformAccessService,
    private readonly maquete: LabMaqueteService) {}

  onModuleInit() {
    if (!chargingSandboxEnabled()) return;
    this.autoStopTimer = setInterval(() => void this.autoStopDue().catch(error =>
      this.logger.warn(`Verificação de limite SANDBOX adiada: ${error instanceof Error ? error.message : String(error)}`)), AUTO_STOP_POLL_MS);
    this.autoStopTimer.unref();
    void this.autoStopDue().catch(error => this.logger.warn(`Verificação inicial SANDBOX adiada: ${error instanceof Error ? error.message : String(error)}`));
  }

  onModuleDestroy() {
    if (this.autoStopTimer) clearInterval(this.autoStopTimer);
    this.autoStopTimer = null;
  }

  private assert(stationId: string | number) {
    if (!chargingSandboxEnabled()) throw new ServiceUnavailableException('Recarga SANDBOX disponível apenas na cópia local 3308');
    if (![13, 46, 47].includes(intId(stationId))) throw new ForbiddenException('Recarga SANDBOX restrita às instalações locais autorizadas');
  }
  private async station(user: Pick<AuthUser, 'sub'>, stationId: string | number,
    tx: Tx | PrismaService = this.db, permission: 'MANAGE' | 'OPERATE' = 'MANAGE') {
    this.assert(stationId);
    const station = await this.access.require(user, stationId, permission, tx as Tx);
    await this.profile(tx, intId(stationId), station);
    return station;
  }
  private async profile(tx: Tx | PrismaService, stationId: number, station: {visibility: string; reviewState: string | null} | null) {
    this.assert(stationId);
    const binding = await tx.gieStationBinding.findUnique({ where: { stationId } });
    const valid = stationId === 47
      ? station?.visibility === 'PRIVATE' && station.reviewState === 'DRAFT' && binding?.profile === 'CASA' && binding.gieStationId === 'DEMO_CASA_001'
      : stationId === 46
      ? station?.visibility === 'PRIVATE' && station.reviewState === 'DRAFT' && binding?.profile === 'POSTO'
      : !!station && binding?.profile === 'COMMERCIAL' && binding.gieStationId === 'Commercial_HighAutonomy_V2';
    if (!valid || binding?.origin !== 'SIMULATED')
      throw new ConflictException('Vínculo demonstrativo local inválido; SANDBOX bloqueado');
  }
  private async charger(tx: Tx | PrismaService, chargerId: number, expectedStation?: number) {
    const charger = await tx.charger.findUnique({ where: { id: chargerId }, include: { liveStatus: true } });
    const buildingIds: Record<number, string> = {49:'EMPS-DEV-23C65707-945',50:'123456789',51:'DEMO-1790042650540'};
    const building = charger?.stationId === 13 && buildingIds[chargerId] === charger.ocppIdentity;
    const residence = charger?.stationId === 47 && chargerId === 78 && charger.administrativeStatus === 'PENDING' && charger.ocppIdentity === 'SIMULATED_DEMO_CASA_001_EVSE_01';
    const evse = residence ? 'EV1' as const : building ? ({49:'EV1',50:'EV2',51:'EV3'} as const)[chargerId as 49|50|51]
      : chargerId === 76 ? 'EV1' as const : chargerId === 77 ? 'EV2' as const : null;
    const sourceId = chargerId === 76 ? 'EVSE_01' : chargerId === 77 ? 'EVSE_02' : null;
    if (!charger || (expectedStation !== undefined && charger.stationId !== expectedStation) || !evse ||
        (!building && !residence && (charger.stationId !== 46 || charger.administrativeStatus !== 'PENDING' ||
          charger.ocppIdentity !== `SIMULATED_DEMO_POSTO_24H_001_${sourceId}`)))
      throw new ConflictException('Carregador fora do vínculo demonstrativo protegido');
    return { charger, evse };
  }
  private async tariff(tx: Tx | PrismaService, chargerId: number, now: Date) {
    const { charger } = await this.charger(tx, chargerId);
    const tariff = await tx.tariff.findFirst({ where: { stationId: charger.stationId, chargerId, status: 'ACTIVE',
      ...(charger.stationId === 46 ? {name: 'SANDBOX - Posto 24h'} : charger.stationId === 47 ? {name: 'SANDBOX - Residencia - visitante'} : {}),
      validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
      orderBy: { id: 'desc' } });
    if (!tariff || tariff.basePricePerKwh.lte(0) || tariff.fixedFee.lt(0))
      throw new ConflictException('Tarifa local SANDBOX ausente ou inválida');
    return tariff;
  }
  private async qr(tx: Tx | PrismaService, chargerId: number, now: Date) {
    return tx.qrBinding.findFirst({ where: { chargerId, isActive: true, revokedAt: null,
      validFrom: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: { id: 'desc' } });
  }
  private sessionView(session: NonNullable<Session>, intent: {paymentMethod:string;cardProvider?:string;pricePerKwh:Prisma.Decimal;fixedFee:Prisma.Decimal;spendingLimit:Prisma.Decimal},
    at = new Date(), paid = false, receipt: Receipt | null = null) {
    const charging = activeStatuses.includes(session.status);
    const deadline = session.autoStopAt ?? sandboxBudgetDeadline(session.startedAt, session.simulatedPowerKw,
      intent.pricePerKwh, intent.fixedFee, intent.spendingLimit);
    const displayAt = new Date(Math.min(at.getTime(), deadline.getTime()));
    const estimate = charging ? estimateSandboxEnergy(session.startedAt, displayAt, session.simulatedPowerKw,
      intent.pricePerKwh, intent.fixedFee, intent.spendingLimit) : null;
    const cashier = isCashierMethod(intent.paymentMethod);
    if (cashier && !receipt) throw new ConflictException('Recibo confirmado de caixa ausente');
    const consumed = estimate?.amount ?? session.totalAmount;
    const remaining = cashier ? Prisma.Decimal.max(0, receipt!.amountReceived.sub(consumed)).toDecimalPlaces(2) : null;
    const status = session.status === 'CHARGING' ? 'charging' : session.status === 'STARTING' ? 'starting' :
      session.status === 'FINISHING' ? 'stopping' : 'completed';
    return { id: session.id, stationId: session.stationId, chargerId: session.chargerId, evse: session.evse,
      status, outcome: status === 'completed' && paid ? 'finished' : status === 'charging' ? 'active' : 'pending',
      energyKwh: Number(estimate?.energy ?? session.energyKwh), totalCost: Number(consumed),
      powerKw: charging ? Number(session.simulatedPowerKw) : 0,
      simulatedPowerKw: Number(session.simulatedPowerKw),
      durationSeconds: Math.max(0, Math.floor(((session.endedAt ?? displayAt).getTime() - session.startedAt.getTime()) / 1000)),
      simulatedSecondsOffset: 0, spendingLimit: Number(intent.spendingLimit),
      telemetrySource: 'charging_sandbox_estimate' as const, sandbox: true,
      paymentMethod: intent.paymentMethod as Method | CashierMethod,
      paymentStatus: cashier ? 'received' as const : paid ? 'approved' as const : status === 'completed' ? 'pending' as const : 'authorized' as const,
      startedAt: session.startedAt.toISOString(), endedAt: session.endedAt?.toISOString() ?? null,
      provenance: 'SANDBOX_ESTIMATE' as const, paymentProvider: intent.cardProvider === 'stripe_test' ? 'stripe_test' as const : 'sandbox' as const, physicalMeter: false,
      cashier, receiptSource: cashier ? 'OPERATOR_CONFIRMED' as const : null,
      amountReceived: cashier ? Number(receipt!.amountReceived) : null,
      consumedAmount: cashier ? Number(consumed) : null,
      remainingCredit: cashier ? Number(remaining) : null,
      estimatedKwhAtStart: cashier ? Number(intent.spendingLimit.sub(intent.fixedFee).div(intent.pricePerKwh)
        .toDecimalPlaces(3, Prisma.Decimal.ROUND_DOWN)) : null,
      pricePerKwh: cashier ? Number(intent.pricePerKwh) : null,
      autoStopAt: deadline.toISOString(),
      returnStatus: cashier ? receipt!.returnStatus as 'NONE' | 'PENDING' : null };
  }
  async state(user: Pick<AuthUser, 'sub'>, stationId: string | number) {
    await this.station(user, stationId, this.db, 'OPERATE');
    await this.autoStopDue();
    const [chargers, recent, active] = await Promise.all([
      this.db.charger.findMany({ where: { stationId: intId(stationId) }, include: { liveStatus: true }, orderBy: { id: 'asc' } }),
      this.db.labChargeSession.findMany({ where: { stationId: intId(stationId) }, orderBy: { requestedAt: 'desc' }, take: 20 }),
      this.db.labChargeSession.findMany({ where: { stationId: intId(stationId), status: { in: activeStatuses } } }),
    ]);
    const sessions = [...active, ...recent.filter(s => !active.some(a => a.id === s.id))]
      .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
    const [intents, payments, receipts] = await Promise.all([
      this.db.labChargeIntent.findMany({ where: { id: { in: sessions.map(s => s.intentId) } } }),
      this.db.labChargePayment.findMany({ where: { sessionId: { in: sessions.map(s => s.id) } } }),
      this.db.labChargeReceipt.findMany({ where: { intentId: { in: sessions.map(s => s.intentId) } } }),
    ]);
    const intentById = new Map(intents.map(i => [i.id, i]));
    const paidIds = new Set(payments.filter(p => p.status === 'APPROVED').map(p => p.sessionId));
    const receiptByIntent = new Map(receipts.map(r => [r.intentId, r]));
    const views = sessions.map(s => { const i = intentById.get(s.intentId); return i ? this.sessionView(s, i, new Date(), paidIds.has(s.id), receiptByIntent.get(s.intentId)) : null; }).filter(v => v !== null);
    const cards = await Promise.all(chargers.map(async charger => {
      const { evse } = await this.charger(this.db, charger.id);
      const recent = sessions.find(s => s.chargerId === charger.id);
      const current = views.find(v => v?.id === recent?.id) ?? null;
      const running = recent && activeStatuses.includes(recent.status);
      const tariff = await this.tariff(this.db, charger.id, new Date());
      return { chargerId: charger.id, evse, physicalStatus: charger.liveStatus?.operationalStatus ?? 'UNKNOWN',
        sandboxStatus: running ? recent.status : recent ? 'FINISHED' : 'AVAILABLE',
        pricePerKwh: Number(tariff.basePricePerKwh), fixedFee: Number(tariff.fixedFee),
        simulatedPowerKw: running ? Number(recent.simulatedPowerKw) : null,
        estimatedEnergyKwh: running ? current?.energyKwh ?? null : null,
        estimatedCost: running ? current?.totalCost ?? null : null,
        provenance: 'SANDBOX_ESTIMATE' as const, session: current };
    }));
    const energyConfig = await this.db.station.findUniqueOrThrow({
      where: { id: intId(stationId) }, include: { solarAssets: true },
    });
    const provisioning = energyConfig.gieProvisioning as { grid?: { importKw?: number; exportKw?: number } } | null;
    const grid = provisioning?.grid;
    const evKw = cards.reduce((sum, card) => sum + (card.sandboxStatus === 'CHARGING' &&
      card.session?.status === 'charging' ? card.simulatedPowerKw ?? 0 : 0), 0);
    const normalScenario = chargerDemoEnabled(intId(stationId)) ? {...chargerDemoEnergy(new Date(),evKw), displayMapping:Object.fromEntries(Object.entries(COMMERCIAL_LAB_CHANNELS).map(([ev,m])=>[ev,chargers.find(c=>c.publicCode===m.publicCode)?.id ?? null]))} : intId(stationId) === 13 ? {
      version: 'BUILDING_CHARGING_CIRCUIT_SANDBOX_V1', provenance: 'SIMULATED' as const,
      at: new Date().toISOString(),
      assumption: 'Circuito de recarga SANDBOX: fornecimento hipotético pela rede. Solar, bateria e consumo do prédio fora deste circuito; não são medições nem totais da instalação.',
      solarPowerKw: 0, gridPowerKw: evKw, buildingPowerKw: 0, chargerPowerKw: evKw,
      batteryPowerKw: 0, balanceResidualKw: 0,
    } : grid?.importKw !== undefined && grid.exportKw !== undefined
      ? sandboxEnergyScenario(new Date(), { timezone: energyConfig.timezone,
        solarKwp: energyConfig.solarAssets.reduce((sum, asset) => sum + Number(asset.installedKwp), 0),
        inverterKw: energyConfig.solarAssets.reduce((sum, asset) => sum + Number(asset.acPowerKw ?? 0), 0),
        gridImportKw: Number(grid.importKw), gridExportKw: Number(grid.exportKw) }, evKw) : null;
    return { mode: 'SANDBOX' as const, stationId: intId(stationId), chargers: cards, sessions: views, normalScenario };
  }
  async qrForManager(user: Pick<AuthUser, 'sub'>, stationId: string | number, chargerId: string | number) {
    await this.station(user, stationId, this.db, 'OPERATE');
    const id = intId(chargerId);
    await this.charger(this.db, id, intId(stationId));
    const binding = await this.qr(this.db, id, new Date());
    if (!binding) throw new NotFoundException('QR SANDBOX não cadastrado');
    return { mode: 'SANDBOX' as const, stationId: intId(stationId), chargerId: id, qrBindingId: binding.id,
      code: binding.code, publicToken: binding.publicToken, authenticatedOnly: true };
  }
  async createIntent(user: Pick<AuthUser, 'sub'>, stationId: string | number, chargerId: string | number,
    methodInput: unknown, limitInput: unknown, keyInput: unknown, permission: 'MANAGE' | 'OPERATE' = 'MANAGE') {
    if (intId(stationId) !== 46) throw new ForbiddenException('Nesta instalação use o caixa SANDBOX do Site');
    const method = methodOf(methodInput), limit = money(limitInput), key = keyOf(keyInput), id = intId(chargerId), now = new Date();
    await this.station(user, stationId, this.db, permission);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM chargers WHERE id=${id} FOR UPDATE`;
      await this.station(user, stationId, tx, permission);
      await this.charger(tx, id, intId(stationId));
      const existing = await tx.labChargeIntent.findUnique({ where: { actorUserId_idempotencyKey: { actorUserId: intId(user.sub), idempotencyKey: key } } });
      if (existing) {
        if (existing.chargerId !== id || existing.paymentMethod !== method || !existing.spendingLimit.eq(limit))
          throw new ConflictException('Chave de autorização já usada com outros parâmetros');
        return existing;
      }
      const tariff = await this.tariff(tx, id, now);
      const qr = await this.qr(tx, id, now);
      if (!qr) throw new ConflictException('QR SANDBOX ausente');
      if (limit.lt(tariff.fixedFee.add('1'))) throw new BadRequestException('Limite insuficiente para a tarifa sandbox');
      return tx.labChargeIntent.create({ data: { id: randomUUID(), stationId: intId(stationId), chargerId: id,
        actorUserId: intId(user.sub), qrBindingId: qr.id, paymentMethod: method, spendingLimit: limit, cardProvider: method === 'card' && this.cardGateway.enabled() ? 'stripe_test' : 'sandbox',
        tariffId: tariff.id, pricePerKwh: tariff.basePricePerKwh, fixedFee: tariff.fixedFee,
        status: 'AUTHORIZED', idempotencyKey: key, expiresAt: new Date(now.getTime() + 15 * 60_000) } });
    });
  }
  async start(user: Pick<AuthUser, 'sub'>, stationId: string | number, chargerId: string | number,
    method: unknown, spendingLimit: unknown, keyInput: unknown) {
    const key = keyOf(keyInput), id = intId(chargerId);
    const intentKey = `i_${createHash('sha256').update(key).digest('hex')}`;
    const intent = await this.createIntent(user, stationId, id, method, spendingLimit, intentKey);
    return this.startFromIntent(user, stationId, intent.id, key);
  }
  async startCashier(user: Pick<AuthUser, 'sub'>, stationId: string | number, chargerId: string | number,
    methodInput: unknown, amountInput: unknown, confirmedInput: unknown, keyInput: unknown) {
    const method = cashierMethodOf(methodInput), amount = money(amountInput), key = keyOf(keyInput);
    if (confirmedInput !== true) throw new BadRequestException('Confirme o valor já recebido no caixa antes de iniciar');
    const id = intId(chargerId), actorUserId = intId(user.sub), now = new Date();
    const intentKey = `i_${createHash('sha256').update(key).digest('hex')}`;
    await this.station(user, stationId, this.db, 'OPERATE');
    const result = await withChargerModeLock(intId(stationId),()=>this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM chargers WHERE id=${id} FOR UPDATE`;
      await this.station(user, stationId, tx, 'OPERATE');
      const { charger, evse } = await this.charger(tx, id, intId(stationId));
      const existing = await tx.labChargeSession.findUnique({ where: { actorUserId_startKey: { actorUserId, startKey: key } } });
      if (existing) {
        const [intent, receipt] = await Promise.all([
          tx.labChargeIntent.findUniqueOrThrow({ where: { id: existing.intentId } }),
          tx.labChargeReceipt.findUnique({ where: { intentId: existing.intentId } }),
        ]);
        if (existing.chargerId !== id || intent.paymentMethod !== method || !intent.spendingLimit.eq(amount) ||
            !receipt || receipt.actorUserId !== actorUserId || !receipt.amountReceived.eq(amount))
          throw new ConflictException('Chave de caixa já utilizada com outros parâmetros');
        return { session: existing, intent, receipt };
      }
      await this.maquete.assertChargerStartMode(intId(stationId));
      const priorIntent = await tx.labChargeIntent.findUnique({ where: { actorUserId_idempotencyKey: { actorUserId, idempotencyKey: intentKey } } });
      if (priorIntent) throw new ConflictException('Chave de caixa já utilizada com outra autorização');
      const active = await tx.labChargeSession.findFirst({ where: { chargerId: id, status: { in: activeStatuses } } });
      if (active) throw new ConflictException('Recarga SANDBOX já em andamento neste carregador');
      // In cashier mode the actor is the attendant, not the driver. The charger
      // lock above allows separate customer sessions on EV1 and EV2. Personal
      // Web/App starts retain their single-active-session rule below.
      const [tariff, qr] = await Promise.all([this.tariff(tx, id, now), this.qr(tx, id, now)]);
      if (!qr) throw new ConflictException('QR SANDBOX ausente');
      if (amount.lt(tariff.fixedFee.add('1'))) throw new BadRequestException('Valor recebido insuficiente para a tarifa sandbox');
      const power = Prisma.Decimal.min(charger.configuredPowerLimitKw ?? charger.powerKw ?? 0, charger.powerKw ?? 0)
        .mul(SANDBOX_POWER_FACTOR).toDecimalPlaces(3);
      if (power.lte(0)) throw new ConflictException('Potência nominal do simulador ausente');
      const autoStopAt = sandboxBudgetDeadline(now, power, tariff.basePricePerKwh, tariff.fixedFee, amount);
      const intent = await tx.labChargeIntent.create({ data: { id: randomUUID(), stationId: intId(stationId), chargerId: id,
        actorUserId, qrBindingId: qr.id, paymentMethod: method, spendingLimit: amount,
        tariffId: tariff.id, pricePerKwh: tariff.basePricePerKwh, fixedFee: tariff.fixedFee,
        status: 'AUTHORIZED', idempotencyKey: intentKey, expiresAt: new Date(now.getTime() + 15 * 60_000) } });
      const receipt = await tx.labChargeReceipt.create({ data: { id: randomUUID(), intentId: intent.id,
        stationId: intId(stationId), chargerId: id, actorUserId, method, amountReceived: amount,
        confirmationSource: 'OPERATOR_CONFIRMED', confirmedAt: now, returnStatus: 'NONE' } });
      const session = await tx.labChargeSession.create({ data: { id: randomUUID(), intentId: intent.id, stationId: intId(stationId),
        chargerId: id, actorUserId, qrBindingId: qr.id, evse, status: 'CHARGING', startKey: key,
        meterSource: 'SANDBOX_ESTIMATE', simulatedPowerKw: power, startedAt: now, autoStopAt } });
      return { session, intent, receipt };
    }));
    let deviceMirror = 'UNAVAILABLE';
    if (result.session.stationId === 46 && result.session.status === 'CHARGING') {
      try {
        const mirror = await this.maquete.issue(user as AuthUser, '46',
          { evse: result.session.evse as 'EV1' | 'EV2', enabled: true, requestId: result.session.id }, 'CHARGING_SESSION');
        deviceMirror = mirror.command.status;
      } catch { /* Prepaid software charging is independent of ESP32 connectivity. */ }
    }
    return { ...this.sessionView(result.session, result.intent, new Date(), false, result.receipt), deviceMirror };
  }
  async startFromIntent(user: Pick<AuthUser, 'sub'>, stationId: string | number, intentId: string, keyInput: unknown,
    qrBindingId?: number, permission: 'MANAGE' | 'OPERATE' = 'MANAGE', spendingLimit?: number | null) {
    const key = keyOf(keyInput), now = new Date();
    await this.station(user, stationId, this.db, permission);
    const intent = await this.db.labChargeIntent.findUnique({ where: { id: intentId } });
    if (!intent || intent.stationId !== intId(stationId) || intent.actorUserId !== intId(user.sub)) throw new NotFoundException('Autorização sandbox não encontrada');
    if (isCashierMethod(intent.paymentMethod)) throw new ForbiddenException('Recibo de caixa somente pelo fluxo confirmado do Site');
    if (qrBindingId !== undefined && qrBindingId !== intent.qrBindingId) throw new ConflictException('QR e autorização não correspondem');
    if (spendingLimit != null && !intent.spendingLimit.eq(spendingLimit)) throw new ConflictException('Limite difere da autorização sandbox');
    const session = await withChargerModeLock(intId(stationId),()=>this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM chargers WHERE id=${intent.chargerId} FOR UPDATE`;
      await this.station(user, stationId, tx, permission);
      const { charger, evse } = await this.charger(tx, intent.chargerId, intId(stationId));
      const existing = await tx.labChargeSession.findUnique({ where: { actorUserId_startKey: { actorUserId: intId(user.sub), startKey: key } } });
      if (existing) {
        if (existing.intentId !== intent.id) throw new ConflictException('Chave de início já utilizada');
        return existing;
      }
      await this.maquete.assertChargerStartMode(intId(stationId));
      await this.admitCard(intent);
      const active = await tx.labChargeSession.findFirst({ where: { chargerId: charger.id, status: { in: activeStatuses } } });
      if (active) throw new ConflictException('Recarga SANDBOX já em andamento neste carregador');
      const own = await tx.labChargeSession.findFirst({ where: { actorUserId: intId(user.sub), status: { in: activeStatuses } } });
      if (own) throw new ConflictException('Esta conta já possui uma recarga SANDBOX em andamento');
      if (intent.status !== 'AUTHORIZED' || intent.expiresAt <= now) throw new ConflictException('Autorização sandbox expirada');
      const currentQr = await this.qr(tx, charger.id, now);
      if (!currentQr || currentQr.id !== intent.qrBindingId) throw new ConflictException('QR sandbox expirado');
      const power = Prisma.Decimal.min(charger.configuredPowerLimitKw ?? charger.powerKw ?? 0, charger.powerKw ?? 0)
        .mul(SANDBOX_POWER_FACTOR).toDecimalPlaces(3);
      if (power.lte(0)) throw new ConflictException('Potência nominal do simulador ausente');
      const autoStopAt = sandboxBudgetDeadline(now, power, intent.pricePerKwh, intent.fixedFee, intent.spendingLimit);
      return tx.labChargeSession.create({ data: { id: randomUUID(), intentId: intent.id, stationId: intId(stationId),
        chargerId: charger.id, actorUserId: intId(user.sub), qrBindingId: intent.qrBindingId,
        evse, status: 'CHARGING', startKey: key, meterSource: 'SANDBOX_ESTIMATE',
        simulatedPowerKw: power, startedAt: now, autoStopAt } });
    }));
    let deviceMirror = 'UNAVAILABLE';
    if (session.stationId === 46 && session.status === 'CHARGING') {
      try {
        const mirror = await this.maquete.issue(user as AuthUser, '46',
          { evse: session.evse as 'EV1' | 'EV2', enabled: true, requestId: session.id }, 'CHARGING_SESSION');
        deviceMirror = mirror.command.status;
      } catch { /* A software sandbox charge cannot depend on ESP32 connectivity. */ }
    }
    return { ...(session.status === 'FINISHED' ? await this.session(user, session.id, permission)
      : this.sessionView(session, intent)), deviceMirror };
  }
  private async closeSession(sessionId: string, key: string, now: Date,
    automatic: boolean, user?: Pick<AuthUser, 'sub'>, permission: 'MANAGE' | 'OPERATE' = 'OPERATE', publicSubject?: ChargeSubject) {
    const current = await this.db.labChargeSession.findUnique({ where: { id: sessionId } });
    if (!current || ![13, 46, 47].includes(current.stationId)) throw new NotFoundException('Sessão sandbox não encontrada');
    this.assert(current.stationId);
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM chargers WHERE id=${current.chargerId} FOR UPDATE`;
      if (automatic) {
        await this.profile(tx, current.stationId, await tx.station.findUnique({where:{id:current.stationId}}));
      } else if (publicSubject) {
        await this.publicIntent(publicSubject, current.intentId, tx);
      } else {
        await this.station(user!, current.stationId, tx, permission);
      }
      await this.charger(tx, current.chargerId, current.stationId);
      const session = await tx.labChargeSession.findUniqueOrThrow({ where: { id: sessionId } });
      const intent = await tx.labChargeIntent.findUniqueOrThrow({ where: { id: session.intentId } });
      const cashier = isCashierMethod(intent.paymentMethod);
      if (!automatic && !publicSubject && session.actorUserId !== intId(user!.sub) && !cashier)
        throw new NotFoundException('Sessão sandbox não encontrada');
      const receipt = cashier ? await tx.labChargeReceipt.findUnique({ where: { intentId: intent.id } }) : null;
      if (cashier && (!receipt || receipt.stationId !== session.stationId || receipt.chargerId !== session.chargerId ||
          receipt.actorUserId !== session.actorUserId || !receipt.amountReceived.eq(intent.spendingLimit)))
        throw new ConflictException('Recibo de caixa divergente da sessão');
      if (session.status === 'FINISHED') {
        if (!automatic && !cashier && session.stopKey !== key && !session.stopKey?.startsWith('auto_budget_'))
          throw new ConflictException('Sessão concluída por outro pedido de parada');
        const payment=await tx.labChargePayment.findUnique({where:{sessionId:session.id}});
        return { session, intent, receipt, paid: payment?.status==='APPROVED', changed: false };
      }
      if (session.status !== 'CHARGING') throw new ConflictException('Sessão sandbox não está carregando');
      const deadline = session.autoStopAt ?? sandboxBudgetDeadline(session.startedAt, session.simulatedPowerKw,
        intent.pricePerKwh, intent.fixedFee, intent.spendingLimit);
      const endedAt = new Date(Math.min(now.getTime(), deadline.getTime()));
      const estimate = estimateSandboxEnergy(session.startedAt, endedAt, session.simulatedPowerKw,
        intent.pricePerKwh, intent.fixedFee, intent.spendingLimit);
      const closed = await tx.labChargeSession.update({ where: { id: session.id }, data: { status: 'FINISHED',
        stopKey: key, energyKwh: estimate.energy, totalAmount: estimate.amount, endedAt, autoStopAt: deadline } });
      let closedReceipt = receipt;
      if (cashier) {
        const unusedBalance = Prisma.Decimal.max(0, receipt!.amountReceived.sub(estimate.amount)).toDecimalPlaces(2);
        closedReceipt = await tx.labChargeReceipt.update({ where: { id: receipt!.id }, data: {
          consumedAmount: estimate.amount, unusedBalance, closedAt: now,
          returnStatus: unusedBalance.gt(0) ? 'PENDING' : 'NONE' } });
      } else if (intent.cardProvider !== 'stripe_test') {
        await tx.labChargePayment.create({ data: { id: randomUUID(), sessionId: session.id, provider: 'sandbox',
          method: intent.paymentMethod, status: 'APPROVED', amount: estimate.amount, paidAt: now } });
      }
      return { session: closed, intent, receipt: closedReceipt, paid: !cashier && intent.cardProvider !== 'stripe_test', changed: true };
    });
    if(result.intent.cardProvider==='stripe_test' && !result.paid){
      try {
        await this.settleCard(result.intent,result.session);result.paid=true;
      } catch { this.logger.warn('Captura de cartão de teste pendente; sessão encerrada sem confirmar pagamento'); }
    }
    let deviceMirror = 'UNAVAILABLE';
    if (result.changed && result.session.stationId === 46) {
      try {
        const mirror = await this.maquete.stopCompletedSandboxSession(result.session.id);
        deviceMirror = mirror.command.status;
      } catch (error) {
        this.logger.warn(`Parada da maquete pendente para sessão SANDBOX ${result.session.id}: ${
          error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { ...this.sessionView(result.session, result.intent, now, result.paid, result.receipt), deviceMirror };
  }
  async stop(user: Pick<AuthUser, 'sub'>, stationId: string | number, sessionId: string, keyInput: unknown,
    permission: 'MANAGE' | 'OPERATE' = 'MANAGE', allowCashier = false) {
    const key = keyOf(keyInput);
    await this.station(user, stationId, this.db, permission);
    if (!sessionPattern.test(sessionId)) throw new BadRequestException('Sessão sandbox inválida');
    const scopedSession = await this.db.labChargeSession.findUnique({where:{id:sessionId}});
    if (!scopedSession || scopedSession.stationId !== intId(stationId)) throw new NotFoundException('Sessão sandbox não encontrada');
    if (!allowCashier) {
      const session = scopedSession;
      const intent = await this.db.labChargeIntent.findUniqueOrThrow({ where: { id: session.intentId } });
      if (isCashierMethod(intent.paymentMethod)) throw new NotFoundException('Sessão de caixa disponível apenas no Site');
    }
    const result = await this.closeSession(sessionId, key, new Date(), false, user, permission);
    return result.cashier ? result : { ...await this.session(user, sessionId, permission), deviceMirror: result.deviceMirror };
  }
  async autoStopDue() {
    if (!chargingSandboxEnabled() || this.autoStopRunning) return 0;
    this.autoStopRunning = true;
    let closed = 0;
    try {
      const now = new Date();
      const active = await this.db.labChargeSession.findMany({ where: { stationId: {in:[13,46,47]}, status: 'CHARGING' }, take: 20 });
      for (const session of active) {
        const intent = await this.db.labChargeIntent.findUniqueOrThrow({ where: { id: session.intentId } });
        const deadline = session.autoStopAt ?? sandboxBudgetDeadline(session.startedAt, session.simulatedPowerKw,
          intent.pricePerKwh, intent.fixedFee, intent.spendingLimit);
        if (session.autoStopAt === null)
          await this.db.labChargeSession.updateMany({ where: { id: session.id, autoStopAt: null }, data: { autoStopAt: deadline } });
        if (deadline > now) continue;
        const key = `auto_budget_${createHash('sha256').update(session.id).digest('hex')}`;
        const result = await this.closeSession(session.id, key, now, true);
        if (result.status === 'completed') closed++;
      }
    } finally {
      this.autoStopRunning = false;
    }
    return closed;
  }
  async session(user: Pick<AuthUser, 'sub'>, sessionId: string, permission: 'MANAGE' | 'OPERATE' = 'MANAGE') {
    await this.station(user, '46', this.db, permission);
    if (!sessionPattern.test(sessionId)) throw new BadRequestException('Sessão sandbox inválida');
    const session = await this.db.labChargeSession.findUnique({ where: { id: sessionId } });
    if (!session || session.actorUserId !== intId(user.sub) || session.stationId !== 46) throw new NotFoundException('Sessão sandbox não encontrada');
    const [intent, paid, receipt] = await Promise.all([this.db.labChargeIntent.findUniqueOrThrow({ where: { id: session.intentId } }),
      this.db.labChargePayment.findUnique({ where: { sessionId } }),
      this.db.labChargeReceipt.findUnique({ where: { intentId: session.intentId } })]);
    if (isCashierMethod(intent.paymentMethod)) throw new NotFoundException('Sessão de caixa disponível apenas no Site');
    const view = this.sessionView(session, intent, new Date(), paid?.status === 'APPROVED', receipt);
    // The receipt is backed by the persisted lab payment. Unused authorization
    // was never captured: it is not a debt or an external refund transaction.
    const released = Prisma.Decimal.max(0, intent.spendingLimit.sub(paid?.amount ?? 0)).toDecimalPlaces(2);
    return { ...view, receipt: paid?.status === 'APPROVED' && session.status === 'FINISHED' ? {
      amountPaid: paid.amount.toFixed(2), provider: paid.provider, sandbox: true,
      transactionId: paid.id, method: intent.paymentMethod,
      effectiveRate: intent.pricePerKwh.toFixed(2), energyAmount: Prisma.Decimal.max(0, paid.amount.sub(intent.fixedFee)).toFixed(2),
      fixedFee: intent.fixedFee.toFixed(2), overstayFee: '0.00',
      disposition: { authorizedAmount: intent.spendingLimit.toFixed(2), consumedAmount: paid.amount.toFixed(2),
        capturedAmount: paid.amount.toFixed(2), releasedAmount: released.toFixed(2),
        refundDueAmount: '0.00', refundedAmount: '0.00', refundStatus: 'NOT_REQUIRED' },
    } : undefined };
  }
  async intentForActor(user: Pick<AuthUser, 'sub'>, intentId: string) {
    await this.station(user, '46', this.db, 'OPERATE');
    if (!sessionPattern.test(intentId)) throw new BadRequestException('Autorização sandbox inválida');
    const intent = await this.db.labChargeIntent.findUnique({ where: { id: intentId } });
    if (!intent || intent.actorUserId !== intId(user.sub) || intent.stationId !== 46)
      throw new NotFoundException('Autorização sandbox não encontrada');
    if (isCashierMethod(intent.paymentMethod)) throw new NotFoundException('Autorização de caixa disponível apenas no Site');
    return { ...await this.cardAuthorization(intent),
      stationId: 46, chargerId: intent.chargerId, provenance: 'SANDBOX_ESTIMATE' as const };
  }
  async activeForActor(user: Pick<AuthUser, 'sub'>) {
    await this.station(user, '46', this.db, 'OPERATE');
    const sessions = await this.db.labChargeSession.findMany({ where: { actorUserId: intId(user.sub), stationId: 46,
      status: { in: activeStatuses } }, orderBy: { requestedAt: 'desc' } });
    for (const session of sessions) {
      const intent = await this.db.labChargeIntent.findUniqueOrThrow({ where: { id: session.intentId } });
      if (!isCashierMethod(intent.paymentMethod)) return this.session(user, session.id, 'OPERATE');
    }
    return null;
  }
  async historyForActor(user: Pick<AuthUser, 'sub'>) {
    await this.station(user, '46', this.db, 'OPERATE');
    const sessions = await this.db.labChargeSession.findMany({ where: { actorUserId: intId(user.sub), stationId: 46,
      status: { notIn: activeStatuses } }, orderBy: { requestedAt: 'desc' }, take: 50 });
    const intents = await this.db.labChargeIntent.findMany({ where: { id: { in: sessions.map(s => s.intentId) } } });
    const intentById = new Map(intents.map(i => [i.id, i]));
    const payments = await this.db.labChargePayment.findMany({ where: { sessionId: { in: sessions.map(s => s.id) }, status: 'APPROVED' } });
    const paidIds = new Set(payments.map(p => p.sessionId));
    return sessions.map(s => { const i = intentById.get(s.intentId); return i && !isCashierMethod(i.paymentMethod)
      ? this.sessionView(s, i, new Date(), paidIds.has(s.id)) : null; })
      .filter(v => v !== null);
  }
  async resolveQrForActor(user: Pick<AuthUser, 'sub'>, token: string) {
    if (!chargingSandboxEnabled()) return null;
    const now = new Date();
    const binding = await this.db.qrBinding.findFirst({ where: { chargerId: { in: [76, 77] },
      OR: [{ publicToken: token }, { code: token }, { charger: { publicCode: token } }],
      isActive: true, revokedAt: null, validFrom: { lte: now },
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] } });
    if (!binding) return null;
    await this.station(user, '46', this.db, 'OPERATE');
    const { charger } = await this.charger(this.db, binding.chargerId);
    const tariff = await this.tariff(this.db, charger.id, now);
    return { binding, charger, tariff };
  }
  /** Customer reads use the same QR/access checks as START, without changing physical status. */
  async mobileAccess(chargerId: number, userId?: string) {
    if (!chargingSandboxEnabled() || ![49, 50, 51, 76, 77].includes(chargerId)) return null;
    const binding = await this.qr(this.db, chargerId, new Date());
    if (!binding) return null;
    if ([49, 50, 51].includes(chargerId)) {
      await this.publicBuilding(chargerId);
      return binding;
    }
    if (!userId) return null;
    await this.station({sub:userId}, 46, this.db, 'OPERATE');
    await this.charger(this.db, chargerId, 46);
    return binding;
  }
  async mobileAvailability(chargerId: number) {
    const {charger} = await this.charger(this.db, chargerId);
    await this.autoStopDue();
    const occupied = await this.db.labChargeSession.findFirst({where:{chargerId,status:{in:activeStatuses}}});
    let reason: string | null = occupied ? 'Recarga SANDBOX em andamento nesta vaga.' : null;
    if (!reason) {
      try { await this.maquete.assertChargerStartMode(charger.stationId); }
      catch { reason = 'Início bloqueado em cenas ou GIE indisponível. Selecione Demonstração de carregadores.'; }
    }
    return {mode:'SANDBOX' as const, status:occupied ? 'IN_USE' as const : reason ? 'BLOCKED' as const : 'AVAILABLE' as const,
      canStart:!reason, reason, physicalMeasurement:false as const};
  }
  async billingForActor(user: Pick<AuthUser, 'sub'>, sessionId: string) {
    const view = await this.session(user, sessionId, 'OPERATE');
    const session = await this.db.labChargeSession.findUniqueOrThrow({ where: { id: sessionId } });
    const intent = await this.db.labChargeIntent.findUniqueOrThrow({ where: { id: session.intentId } });
    const energy = new Prisma.Decimal(view.energyKwh), total = new Prisma.Decimal(view.totalCost);
    const energyAmount = Prisma.Decimal.max(0, total.sub(intent.fixedFee)).toDecimalPlaces(2);
    return { sessionId, status: session.status.toLowerCase(), frozen: session.status === 'FINISHED',
      disconnectedAt: session.endedAt?.toISOString() ?? null, lifecycle: null,
      breakdown: { customer: { energy_kwh: energy.toFixed(3), energy_amount: energyAmount.toFixed(2),
        overstay_fee: '0.00', total_amount: total.toFixed(2), effective_energy_rate_per_kwh: intent.pricePerKwh.toFixed(4) },
        intervals: [], overstay: null, tariff_version: 'LAB_SANDBOX_V1' },
      provider: 'sandbox' as const, paymentRequired: false, provenance: 'SANDBOX_ESTIMATE' as const };
  }

  /** Public customer path is limited to the audited local building, never Posto/private fixtures. */
  async publicQr(token: string) {
    if (!chargingSandboxEnabled()) return null;
    const now = new Date();
    const binding = await this.db.qrBinding.findFirst({where:{chargerId:{in:[49,50,51]},
      isActive:true,revokedAt:null,validFrom:{lte:now},
      AND:[{OR:[{expiresAt:null},{expiresAt:{gt:now}}]}],
      OR:[{publicToken:token},{code:token},{charger:{publicCode:token}}]}});
    if (!binding) return null;
    await this.publicBuilding(binding.chargerId);
    return binding;
  }
  private async publicBuilding(chargerId:number, tx:Tx|PrismaService=this.db) {
    this.assert(13);
    const {charger}=await this.charger(tx,chargerId,13);
    const station=await tx.station.findUnique({where:{id:13}});
    await this.profile(tx,13,station);
    if (station?.visibility!=='PUBLIC') throw new ForbiddenException('Demonstração pública indisponível');
    return charger;
  }
  async isPublicIntent(id:string) {
    return chargingSandboxEnabled() && (await this.db.labChargeIntent.findUnique({where:{id}}))?.stationId===13;
  }
  async isPublicSession(id:string) {
    return chargingSandboxEnabled() && (await this.db.labChargeSession.findUnique({where:{id}}))?.stationId===13;
  }
  private async publicIdentity(subject:ChargeSubject, chargerId:number) {
    const actor=await chargeActor(this.db,subject);
    if(actor.guestId && actor.chargerId!==chargerId) throw new ForbiddenException('Visitante vinculado a outro carregador');
    return actor;
  }
  async publicIntent(subject:ChargeSubject,id:string,tx:Tx|PrismaService=this.db) {
    const intent=await tx.labChargeIntent.findUnique({where:{id}});
    if(!intent || intent.stationId!==13 || isCashierMethod(intent.paymentMethod)) throw new NotFoundException('Autorização SANDBOX não encontrada');
    await this.publicBuilding(intent.chargerId,tx);
    const actor=await this.publicIdentity(subject,intent.chargerId);
    if(actor.guestId ? intent.guestId!==actor.guestId : intent.actorUserId!==actor.id || intent.guestId!==null)
      throw new NotFoundException('Autorização SANDBOX não encontrada');
    return intent;
  }
  async publicCreate(subject:ChargeSubject,chargerId:number,methodInput:unknown,limitInput:unknown,keyInput:unknown) {
    const method=methodOf(methodInput),limit=money(limitInput),key=keyOf(keyInput),now=new Date();
    await this.publicBuilding(chargerId);
    const actor=await this.publicIdentity(subject,chargerId);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM chargers WHERE id=${chargerId} FOR UPDATE`;
      await this.publicBuilding(chargerId,tx);
      const existing=await tx.labChargeIntent.findFirst({where:{actorUserId:actor.id,guestId:actor.guestId,idempotencyKey:key}});
      if(existing){if(existing.chargerId!==chargerId||existing.paymentMethod!==method||!existing.spendingLimit.eq(limit))throw new ConflictException('Chave usada com outros parâmetros');return existing;}
      const tariff=await this.tariff(tx,chargerId,now),qr=await this.qr(tx,chargerId,now);
      if(!qr||limit.lt(tariff.fixedFee.add(1)))throw new ConflictException('QR ou limite inválido');
      return tx.labChargeIntent.create({data:{id:randomUUID(),stationId:13,chargerId,actorUserId:actor.id,guestId:actor.guestId,
        qrBindingId:qr.id,paymentMethod:method,spendingLimit:limit,cardProvider:method==='card'&&this.cardGateway.enabled()?'stripe_test':'sandbox',tariffId:tariff.id,pricePerKwh:tariff.basePricePerKwh,
        fixedFee:tariff.fixedFee,status:'AUTHORIZED',idempotencyKey:key,expiresAt:new Date(now.getTime()+15*60000)}});
    });
  }
  async publicStart(subject:ChargeSubject,id:string,keyInput:unknown,qrId:number,limit?:number|null) {
    const key=keyOf(keyInput),now=new Date();
    const intent=await this.publicIntent(subject,id);
    if(intent.qrBindingId!==qrId||(limit!=null&&!intent.spendingLimit.eq(limit)))throw new ConflictException('QR/limite divergente');
    const session=await withChargerModeLock(13,()=>this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM chargers WHERE id=${intent.chargerId} FOR UPDATE`;
      await this.publicIntent(subject,id,tx);
      const existing=await tx.labChargeSession.findUnique({where:{intentId:id}});
      if(existing){if(existing.startKey!==key)throw new ConflictException('Autorização já utilizada');return existing;}
      await this.maquete.assertChargerStartMode(13);
      await this.admitCard(intent);
      if(intent.status!=='AUTHORIZED'||intent.expiresAt<=now)throw new ConflictException('Autorização expirada');
      const qr=await this.qr(tx,intent.chargerId,now);
      if(qr?.id!==qrId)throw new ConflictException('QR expirado');
      if(await tx.labChargeSession.findFirst({where:{chargerId:intent.chargerId,status:{in:activeStatuses}}}))throw new ConflictException('Carregador em uso');
      const {charger,evse}=await this.charger(tx,intent.chargerId,13);
      const power=Prisma.Decimal.min(charger.configuredPowerLimitKw??charger.powerKw??0,charger.powerKw??0).mul(SANDBOX_POWER_FACTOR).toDecimalPlaces(3);
      const deadline=sandboxBudgetDeadline(now,power,intent.pricePerKwh,intent.fixedFee,intent.spendingLimit);
      return tx.labChargeSession.create({data:{id:randomUUID(),intentId:id,stationId:13,chargerId:charger.id,actorUserId:intent.actorUserId,
        qrBindingId:qrId,evse,status:'CHARGING',startKey:key,meterSource:'SANDBOX_ESTIMATE',simulatedPowerKw:power,startedAt:now,autoStopAt:deadline}});
    }));
    return this.publicSession(subject,session.id);
  }
  async publicSession(subject:ChargeSubject,id:string) {
    const session=await this.db.labChargeSession.findUnique({where:{id}});
    if(!session||session.stationId!==13)throw new NotFoundException('Sessão SANDBOX não encontrada');
    const intent=await this.publicIntent(subject,session.intentId);
    const paid=await this.db.labChargePayment.findUnique({where:{sessionId:id}});
    return {...this.sessionView(session,intent,new Date(),paid?.status==='APPROVED'),receipt:paid?.status==='APPROVED'?{
      amountPaid:paid.amount.toFixed(2),transactionId:paid.id,provider:paid.provider,sandbox:true,method:intent.paymentMethod,
      effectiveRate:intent.pricePerKwh.toFixed(2),energyAmount:Prisma.Decimal.max(0,paid.amount.sub(intent.fixedFee)).toFixed(2),fixedFee:intent.fixedFee.toFixed(2),overstayFee:'0.00',
    }:undefined};
  }
  async publicStop(subject:ChargeSubject,id:string,key:unknown) {
    await this.publicSession(subject,id);
    await this.closeSession(id,keyOf(key),new Date(),false,undefined,'OPERATE',subject);
    return this.publicSession(subject,id);
  }
  async publicActive(subject:ChargeSubject) {
    if(!chargingSandboxEnabled())return null;
    const actor=await chargeActor(this.db,subject);
    const intents=await this.db.labChargeIntent.findMany({where:{stationId:13,actorUserId:actor.id,guestId:actor.guestId,paymentMethod:{in:['pix','card','wallet']}}});
    const s=await this.db.labChargeSession.findFirst({where:{intentId:{in:intents.map(i=>i.id)},status:{in:activeStatuses}}});
    return s?this.publicSession(subject,s.id):null;
  }
  async publicCancel(subject:ChargeSubject,id:string) {
    const intent=await this.publicIntent(subject,id);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM chargers WHERE id=${intent.chargerId} FOR UPDATE`;
      await this.publicIntent(subject,id,tx);
      if(await tx.labChargeSession.findUnique({where:{intentId:id}}))throw new ConflictException('Autorização já utilizada');
      if(intent.cardProvider==='stripe_test'&&intent.cardIntentId)await this.cardGateway.cancel(intent.id,intent.cardIntentId,intent.spendingLimit);
      await tx.labChargeIntent.update({where:{id},data:{status:'CANCELED'}});
      return {status:'canceled'};
    });
  }
  async cardAuthorization(intent:Awaited<ReturnType<PrismaService['labChargeIntent']['findUniqueOrThrow']>>) {
    if(intent.cardProvider!=='stripe_test')return {id:intent.id,method:intent.paymentMethod,provider:'sandbox',sandbox:true,status:intent.status==='AUTHORIZED'&&intent.expiresAt>new Date()?'authorized':'rejected'};
    const pi=await this.cardGateway.authorization(intent.id,intent.spendingLimit,intent.cardIntentId);
    if(!intent.cardIntentId)await this.db.labChargeIntent.update({where:{id:intent.id},data:{cardIntentId:pi.id}});
    return {id:intent.id,method:intent.paymentMethod,provider:'stripe',sandbox:true,
      status:intent.status==='CANCELED'||intent.expiresAt<=new Date()?'rejected':pi.status==='requires_capture'?'authorized':pi.status==='canceled'?'rejected':'requires_action',
      providerClientSecret:pi.client_secret??undefined};
  }
  private async admitCard(intent:Awaited<ReturnType<PrismaService['labChargeIntent']['findUniqueOrThrow']>>) {
    if(intent.cardProvider!=='stripe_test')return;
    if(!intent.cardIntentId)throw new ConflictException('Confirme o cartão antes de iniciar');
    const pi=await this.cardGateway.authorization(intent.id,intent.spendingLimit,intent.cardIntentId);
    if(pi.status!=='requires_capture')throw new ConflictException('Reserva do cartão não confirmada');
  }
  private async settleCard(intent:Awaited<ReturnType<PrismaService['labChargeIntent']['findUniqueOrThrow']>>,session:NonNullable<Session>) {
    if(!intent.cardIntentId)throw new ConflictException('Cartão sem autorização');
    const pi=await this.cardGateway.capture(intent.id,intent.cardIntentId,intent.spendingLimit,session.totalAmount);
    if(pi.status!=='succeeded')throw new ConflictException('Cartão ainda não capturado');
    await this.db.labChargePayment.upsert({where:{sessionId:session.id},create:{id:randomUUID(),sessionId:session.id,provider:'stripe_test',method:'card',status:'APPROVED',amount:session.totalAmount,paidAt:new Date()},update:{status:'APPROVED',amount:session.totalAmount,paidAt:new Date()}});
  }

}
