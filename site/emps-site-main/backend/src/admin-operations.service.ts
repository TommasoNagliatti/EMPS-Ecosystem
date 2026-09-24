import {Prisma} from "@prisma/client";
import {initialBilling,invoice,ledgerOf,recordEnergy,calculateSession} from './tariff-engine';
import { bill } from './billing';
import { GieService } from './gie.service';
import {
  intId,
  bigId,
  chargerInclude,
  chargerStatus,
  ChargerStatus,
  currentTariff,
  activeSessionStatuses,
} from "./persistence";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  NotFoundException,
} from "@nestjs/common";
import {
  ChargerAdministrativeStatus,
  ChargerOperationalStatus,
  ChargingCommandStatus,
  ChargingCommandType,
  PaymentMethod,
  PaymentStatus,
  SessionStatus,
} from "@prisma/client";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { ChargingGatewayService } from "./charging-gateway.service";
import type {
  AdminChargerCommand,
  CashSettlementDto,
  ManualReleaseDto,
  PostpaidReleaseDto,
} from "./dtos";
import { PrismaService } from "./prisma.service";
import { RealtimeService } from "./realtime.service";
import { MobileService } from "./mobile.service";

function operationCode(prefix: "EMP" | "PAY") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

function commandType(command: AdminChargerCommand) {
  if (command === "encerrar_carga") return ChargingCommandType.STOP_CHARGING;
  if (command === "liberar_conector")
    return ChargingCommandType.UNLOCK_CONNECTOR;
  if (command === "executar_checklist")
    return ChargingCommandType.RUN_CHECKLIST;
  if (command === "agendar_teste") return ChargingCommandType.SCHEDULE_TEST;
  if (command === "reiniciar_equipamento") return ChargingCommandType.RESET;
  return ChargingCommandType.SYNC_STATUS;
}

function gatewayCommand(type: ChargingCommandType) {
  if (type === ChargingCommandType.STOP_CHARGING) return "STOP" as const;
  if (type === ChargingCommandType.UNLOCK_CONNECTOR) return "UNLOCK" as const;
  if (type === ChargingCommandType.RESET) return "RESET" as const;
  return "STATUS" as const;
}

@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly charging: ChargingGatewayService,
    private readonly realtime: RealtimeService,
    private readonly mobile: MobileService,
    @Optional() private readonly energy?: GieService,
  ) {}

  async sendCommand(chargerIdInput: string, requested: AdminChargerCommand) {
    const chargerId = intId(chargerIdInput);
    const charger = await this.prisma.charger.findUnique({
      include: {
        ...chargerInclude,
        sessions: {
          include: { client: { select: { id: true } } },
          orderBy: { startTime: "desc" },
          take: 1,
          where: { status: SessionStatus.ACTIVE },
        },
      },
      where: { id: chargerId },
    });
    if (!charger) throw new NotFoundException("Carregador não encontrado");
    const mobileSession = charger.sessions[0];
    if (
      requested === "encerrar_carga" &&
      mobileSession?.paymentIntentId &&
      mobileSession.clientId
    ) {
      const session = await this.mobile.stopCharging(
        String(mobileSession.clientId),
        String(mobileSession.id),
        `admin-stop-${mobileSession.id}`,
      );
      return {
        chargerId,
        command: requested,
        processedAt: new Date(),
        status: session.status === "completed" ? "COMPLETED" : "ACCEPTED",
      };
    }

    if (requested === "solicitar_manutencao") {
      if (charger.sessions.length > 0) {
        throw new ConflictException(
          "Encerre a recarga ativa antes de solicitar manutenção",
        );
      }
      const processedAt = new Date();
      const [, , alert] = await this.prisma.$transaction([
        this.prisma.charger.update({
          data: {
            administrativeStatus: ChargerAdministrativeStatus.MAINTENANCE,
          },
          where: { id: chargerId },
        }),
        this.prisma.chargerLiveStatus.upsert({
          create: {
            chargerId,
            currentPowerKw: 0,
            operationalStatus: ChargerOperationalStatus.UNAVAILABLE,
          },
          update: {
            currentPowerKw: 0,
            operationalStatus: ChargerOperationalStatus.UNAVAILABLE,
          },
          where: { chargerId },
        }),
        this.prisma.alert.create({
          data: {
            chargerId,
            alertType: "maintenance",
            alertSource: "EMPS",
            description: `Manutenção solicitada para ${charger.name} pelo painel administrativo.`,
            severity: "MEDIUM",
            title: "Manutenção solicitada",
          },
        }),
      ]);
      this.realtime.publish({ entityId: chargerId, topic: "charger.updated" });
      this.realtime.publish({
        entityId: alert.id,
        operational: true,
        topic: "alert.updated",
      });
      this.realtime.publish({
        entityId: "summary",
        operational: true,
        topic: "dashboard.updated",
      });
      return {
        chargerId,
        command: requested,
        processedAt,
        status: "COMPLETED",
      };
    }

    const type = commandType(requested);
    const activeSession = charger.sessions[0];
    if (type === ChargingCommandType.STOP_CHARGING && !activeSession) {
      throw new BadRequestException(
        "Não existe recarga ativa neste carregador",
      );
    }
    const command = await this.prisma.chargingCommand.create({
      data: {
        chargerId,
        correlationId: `admin-${requested}-${Date.now()}-${randomBytes(3).toString("hex")}`,
        requestPayload: { command: requested, source: "admin-dashboard" },
        sessionId: activeSession?.id,
        status: ChargingCommandStatus.PENDING,
        timeoutAt: new Date(Date.now() + 30_000),
        type,
      },
    });
    let result;
    try {
      result = await this.charging.dispatch({
        chargerId,
        commandId: command.id,
        ocppIdentity: charger.ocppIdentity,
        ocppVersion: charger.ocppVersion,
        sessionId: activeSession?.id,
        type: gatewayCommand(type),
      });
    } catch (error) {
      await this.prisma.chargingCommand.update({
        data: {
          lastError:
            error instanceof Error ? error.message : "Falha no gateway OCPP",
          status: ChargingCommandStatus.FAILED,
        },
        where: { id: command.id },
      });
      throw error;
    }
    if (!result.accepted) {
      await this.prisma.chargingCommand.update({
        data: {
          lastError: result.message ?? "Comando recusado",
          responsePayload: result,
          status: ChargingCommandStatus.REJECTED,
        },
        where: { id: command.id },
      });
      throw new BadGatewayException("O equipamento recusou o comando");
    }

    const processedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.chargingCommand.update({
        data: {
          processedAt: result.mode === "sandbox" ? processedAt : undefined,
          responsePayload: result,
          sentAt: processedAt,
          status:
            result.mode === "sandbox"
              ? ChargingCommandStatus.COMPLETED
              : ChargingCommandStatus.ACCEPTED,
        },
        where: { id: command.id },
      });

      if (requested === "sincronizar_status") {
        await tx.chargerLiveStatus.upsert({
          create: { chargerId, lastSeenAt: processedAt },
          update: { lastSeenAt: processedAt },
          where: { chargerId },
        });
      }
      if (requested === "encerrar_carga" && activeSession) {
        if (result.mode !== "sandbox") {
          await tx.chargingSession.update({
            where: { id: activeSession.id },
            data: { status: SessionStatus.STOPPING },
          });
          return;
        }
        if(activeSession.tariffVersion){
          await tx.$queryRaw`SELECT charger_id FROM charger_live_status WHERE charger_id=${chargerId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM charging_sessions WHERE id=${activeSession.id} FOR UPDATE`;
          const current=await tx.chargingSession.findUniqueOrThrow({where:{id:activeSession.id}});
          if(current.endTime)return;
          const live=await tx.chargerLiveStatus.findUniqueOrThrow({where:{chargerId}}),l=ledgerOf(current)!;
          const elapsed=Math.min(15,Math.max(0,(processedAt.getTime()-Date.parse(l.last_at))/1000));
          const kwh=new Prisma.Decimal(l.meter_energy_kwh).add(new Prisma.Decimal(live.currentPowerKw??0).mul(elapsed).div(3600));
          const next=recordEnergy(l,kwh,processedAt,this.energy?.billingFacts()??l.facts);next.phase='awaiting_disconnect';next.charge_completed_at=processedAt.toISOString();
          const breakdown=calculateSession(String(current.id),next.intervals,processedAt.toISOString());
          await tx.chargingSession.update({where:{id:current.id},data:{status:'WAITING_PAYMENT',endTime:new Date(Math.floor(processedAt.getTime()/1000)*1000),durationSeconds:Math.max(0,Math.floor((processedAt.getTime()-(current.startTime??current.requestedAt).getTime())/1000)),energyKwh:kwh.toDecimalPlaces(3),meterEndKwh:new Prisma.Decimal(current.meterStartKwh??0).add(kwh),totalPrice:breakdown.customer.total_amount,billingSnapshot:JSON.parse(JSON.stringify(next))}});
          await tx.chargerLiveStatus.update({where:{chargerId},data:{currentPowerKw:0,operationalStatus:'FINISHING',lastSeenAt:processedAt}});
          return;
        }
        const seconds = Math.max(
          0,
          Math.round(
            (processedAt.getTime() -
              (
                activeSession.startTime ?? activeSession.requestedAt
              ).getTime()) /
              1_000,
          ),
        );
        const energyKwh = Number(charger.powerKw) * (seconds / 3_600);
        const totalPrice = Number(
          Math.min(
            activeSession.spendingLimit === null
              ? Infinity
              : Number(activeSession.spendingLimit),
            energyKwh * Number(activeSession.pricePerKwhSnapshot) +
              Number(activeSession.fixedFeeSnapshot),
          ).toFixed(2),
        );
        await tx.chargingSession.update({
          data: {
            durationSeconds: seconds,
            endTime: processedAt,
            energyKwh,
            status: SessionStatus.WAITING_PAYMENT,
            totalPrice,
          },
          where: { id: activeSession.id },
        });
        await tx.payment.upsert({
          create: {
            idempotencyKey: `admin-settle-${activeSession.id}`,
            amount: totalPrice,
            code: operationCode("PAY"),
            method: PaymentMethod.SIMULATED,
            provider: "ADMIN",
            sessionId: activeSession.id,
            status: PaymentStatus.PENDING,
          },
          update: { amount: totalPrice, status: PaymentStatus.PENDING },
          where: { idempotencyKey: `admin-settle-${activeSession.id}` },
        });
        await tx.chargerLiveStatus.upsert({
          create: {
            chargerId,
            currentPowerKw: 0,
            lastSeenAt: processedAt,
            operationalStatus: ChargerOperationalStatus.AVAILABLE,
          },
          update: {
            currentPowerKw: 0,
            lastSeenAt: processedAt,
            operationalStatus: ChargerOperationalStatus.AVAILABLE,
          },
          where: { chargerId },
        });
      }
    });
    this.realtime.publish({ entityId: chargerId, topic: "charger.updated" });
    if (requested === "encerrar_carga" && activeSession) {
      this.realtime.publish({
        customerId: activeSession.client?.id ?? undefined,
        entityId: activeSession.id,
        operational: true,
        topic: "session.updated",
      });
      const payment = await this.prisma.payment.findFirst({
        where: { sessionId: activeSession.id },
      });
      if (payment) {
        this.realtime.publish({
          customerId: activeSession.client?.id ?? undefined,
          entityId: payment.id,
          operational: true,
          topic: "payment.updated",
        });
      }
    }
    this.realtime.publish({
      entityId: "summary",
      operational: true,
      topic: "dashboard.updated",
    });
    return {
      chargerId,
      command: requested,
      processedAt,
      status: result.mode === "sandbox" ? "COMPLETED" : "ACCEPTED",
    };
  }

  private async startCashSession(
    chargerIdInput: string,
    _requestedTariff: number,
    prepaidAmount: number | null,
    customerId: number | null = null,
  ) {
    const chargerId = intId(chargerIdInput);
    const charger = await this.prisma.charger.findUnique({
      include: chargerInclude,
      where: { id: chargerId },
    });
    if (!charger) throw new NotFoundException("Carregador não encontrado");
    if (
      chargerStatus(charger) !== ChargerStatus.AVAILABLE ||
      charger.administrativeStatus !== ChargerAdministrativeStatus.ENABLED
    ) {
      throw new ConflictException("Carregador indisponível para liberação");
    }
    const tariff = Number(currentTariff(charger).basePricePerKwh);
    const startedAt = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      if (customerId !== null) {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${customerId} FOR UPDATE`;
        if (
          await tx.chargingSession.findFirst({
            where: {
              clientId: customerId,
              status: { in: activeSessionStatuses },
            },
          })
        )
          throw new ConflictException("Cliente já possui sessão em andamento");
      }
      const reserved = await tx.chargerLiveStatus.updateMany({
        data: { operationalStatus: "PREPARING" },
        where: {
          chargerId,
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
          chargerId,
          clientId: customerId,
          code: operationCode("EMP"),
          meterStartKwh: charger.liveStatus?.meterTotalKwh,
          pricePerKwhSnapshot: tariff,
          basePricePerKwhSnapshot: tariff,
          tariffId: currentTariff(charger).id,
          fixedFeeSnapshot: currentTariff(charger).fixedFee,
          sessionOrigin: "ADMIN_SITE",
          preferredPaymentMethod: "CASH",
          billingMode: prepaidAmount === null ? "POSTPAID" : "PREPAID",
          spendingLimit: prepaidAmount,
          startTime: startedAt,
          status: SessionStatus.START_REQUESTED,
          ...(prepaidAmount===null?initialBilling(charger.stationId,startedAt,this.energy?.billingFacts()):{}),
        },
      });
      if (prepaidAmount !== null) {
        await tx.payment.create({
          data: {
            amount: prepaidAmount,
            amountReceived: prepaidAmount,
            idempotencyKey: `cash-settle-${session.id}`,
            code: operationCode("PAY"),
            method: PaymentMethod.CASH,
            paidAt: startedAt,
            provider: "CASH_REGISTER",
            sessionId: session.id,
            status: PaymentStatus.APPROVED,
          },
        });
      }
      const command = await tx.chargingCommand.create({
        data: {
          chargerId,
          clientId: null,
          correlationId: `cash-start-${session.id}`,
          requestPayload: { prepaidAmount, tariff },
          sessionId: session.id,
          status: ChargingCommandStatus.PENDING,
          timeoutAt: new Date(Date.now() + 30_000),
          type: ChargingCommandType.START_CHARGING,
        },
      });
      await tx.chargerLiveStatus.upsert({
        create: {
          chargerId,
          lastSeenAt: startedAt,
          operationalStatus: ChargerOperationalStatus.PREPARING,
        },
        update: {
          lastSeenAt: startedAt,
          operationalStatus: ChargerOperationalStatus.PREPARING,
        },
        where: { chargerId },
      });
      return { command, session };
    });

    try {
      const result = await this.charging.dispatch({
        chargerId,
        commandId: created.command.id,
        ocppIdentity: charger.ocppIdentity,
        ocppVersion: charger.ocppVersion,
        sessionId: created.session.id,
        type: "START",
      });
      if (!result.accepted)
        throw new BadGatewayException("O carregador recusou a liberação");
      await this.prisma.$transaction([
        this.prisma.chargingCommand.update({
          data: {
            processedAt: result.mode === "sandbox" ? new Date() : undefined,
            responsePayload: result,
            sentAt: new Date(),
            status:
              result.mode === "sandbox"
                ? ChargingCommandStatus.COMPLETED
                : ChargingCommandStatus.ACCEPTED,
          },
          where: { id: created.command.id },
        }),
        this.prisma.chargingSession.update({
          data: {
            status:
              result.mode === "sandbox"
                ? SessionStatus.ACTIVE
                : SessionStatus.STARTING,
          },
          where: { id: created.session.id },
        }),
        this.prisma.chargerLiveStatus.update({
          data: {
            currentPowerKw: this.energy?.manages(charger) ? 0 : Number(charger.powerKw) * 0.82,
            lastSeenAt: new Date(),
            operationalStatus: ChargerOperationalStatus.CHARGING,
          },
          where: { chargerId },
        }),
      ]);
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await tx.chargingCommand.update({
          data: {
            lastError:
              error instanceof Error ? error.message : "Falha no gateway OCPP",
            status: ChargingCommandStatus.FAILED,
          },
          where: { id: created.command.id },
        });
        await tx.chargingSession.update({
          data: { endTime: new Date(), status: SessionStatus.CANCELED },
          where: { id: created.session.id },
        });
        await tx.payment.updateMany({
          data: { status: PaymentStatus.REJECTED },
          where: { sessionId: created.session.id },
        });
        await tx.chargerLiveStatus.update({
          data: {
            currentPowerKw: 0,
            operationalStatus: ChargerOperationalStatus.AVAILABLE,
          },
          where: { chargerId },
        });
      });
      this.realtime.publish({
        entityId: created.session.id,
        operational: true,
        topic: "session.updated",
      });
      this.realtime.publish({ entityId: chargerId, topic: "charger.updated" });
      this.realtime.publish({
        entityId: "summary",
        operational: true,
        topic: "dashboard.updated",
      });
      throw error;
    }
    this.realtime.publish({
      entityId: created.session.id,
      operational: true,
      topic: "session.created",
    });
    this.realtime.publish({ entityId: chargerId, topic: "charger.updated" });
    if (prepaidAmount !== null) {
      const payment = await this.prisma.payment.findFirst({
        where: { sessionId: created.session.id },
      });
      if (payment) {
        this.realtime.publish({
          entityId: payment.id,
          operational: true,
          topic: "payment.updated",
        });
      }
    }
    this.realtime.publish({
      entityId: "summary",
      operational: true,
      topic: "dashboard.updated",
    });
    return { session: created.session, startedAt };
  }

  async manualRelease(chargerId: string, dto: ManualReleaseDto) {
    const { session, startedAt } = await this.startCashSession(
      chargerId,
      dto.tarifaKwh,
      dto.valorRecebido,
    );
    return {
      carregadorId: chargerId,
      chargerStatus: "IN_USE",
      energiaLiberadaKwh: Number(
        (
          Math.max(0, dto.valorRecebido - Number(session.fixedFeeSnapshot)) /
          Number(session.pricePerKwhSnapshot)
        ).toFixed(3),
      ),
      liberacaoId: session.id,
      processedAt: startedAt,
      sessaoId: session.id,
      valorRecebido: dto.valorRecebido,
    };
  }

  async startCustomerSession(chargerId: string, customerId: number) {
    const result = await this.startCashSession(chargerId, 0, null, customerId);
    return result.session;
  }

  async startPostpaid(chargerId: string, dto: PostpaidReleaseDto) {
    const { session, startedAt } = await this.startCashSession(
      chargerId,
      dto.tarifaKwh,
      null,
    );
    return {
      carregadorId: chargerId,
      chargerStatus: "IN_USE",
      liberacaoId: session.id,
      sessaoId: session.id,
      startedAt,
      tarifaKwh: Number(session.pricePerKwhSnapshot),
    };
  }

  async cashQuote(sessionIdInput: string) {
    await this.energy?.refresh();
    const session = await this.prisma.chargingSession.findUnique({where:{id:bigId(sessionIdInput)},include:{charger:{include:chargerInclude}}});
    if(!session || session.status !== SessionStatus.ACTIVE) throw new BadRequestException('Sessão ativa não encontrada');
    const seconds=Math.max(0,(Date.now()-(session.startTime ?? session.requestedAt).getTime())/1000);
    const energy=this.energy?.manages(session.charger) ? Number(session.energyKwh) : Math.max(Number(session.energyKwh),Number(session.charger.liveStatus?.currentPowerKw ?? 0)*seconds/3600);
    const v1=invoice(session);
    const composition=v1?{energyKwh:Number(v1.customer.energy_kwh),pricePerKwh:Number(v1.customer.effective_energy_rate_per_kwh),fixedFee:0,energyAmount:Number(v1.customer.energy_amount),overstayFee:Number(v1.customer.overstay_fee),total:Number(v1.customer.total_amount)}:bill(energy,session.pricePerKwhSnapshot,session.fixedFeeSnapshot,session.spendingLimit);
    const payload=Buffer.from(JSON.stringify({sessionId:String(session.id),energy:composition.energyKwh,total:composition.total,snapshot:session.tariffVersion?session.billingSnapshot:undefined,expires:Date.now()+120000})).toString('base64url');
    const signature=createHmac('sha256',process.env.JWT_SECRET ?? 'emps-development-only-secret-change-before-deploying').update(payload).digest('base64url');
    return {...composition,sessionId:String(session.id),elapsedMinutes:Math.ceil(seconds/60),quoteToken:payload+'.'+signature,expiresAt:new Date(Date.now()+120000).toISOString(),source:'backend',simulated:!process.env.OCPP_GATEWAY_URL};
  }

  async settleCash(sessionIdInput: string, dto: CashSettlementDto) {
    const sessionId=bigId(sessionIdInput);
    const resultFor = async () => {
      const s=await this.prisma.chargingSession.findUniqueOrThrow({where:{id:sessionId}});
      const p=await this.prisma.payment.findUniqueOrThrow({where:{idempotencyKey:`cash-settle-${sessionId}`}});
      return {carregadorId:s.chargerId,chargerStatus:'AVAILABLE',energiaConsumidaKwh:Number(s.energyKwh),processedAt:s.endTime,
        sessaoId:sessionId,troco:Number(p.changeAmount ?? 0),valorCobrado:Number(p.amount),valorRecebido:Number(p.amountReceived ?? p.amount)};
    };
    const session=await this.prisma.chargingSession.findUnique({where:{id:sessionId},include:{charger:{include:chargerInclude},paymentIntent:true}});
    if(!session)throw new BadRequestException('Sessão não encontrada');
    if(session.status===SessionStatus.FINISHED)return resultFor();
    if(session.status===SessionStatus.WAITING_PAYMENT){
      const frozen=ledgerOf(session),total=invoice(session)?.customer.total_amount;
      if(frozen?.phase!=='frozen'||!session.disconnectedAt||!total||new Prisma.Decimal(total).lte(0)||new Prisma.Decimal(total).gte(.5)||session.paymentIntent?.providerIntentId?.startsWith('pi_'))throw new ConflictException('Acerto pendente exige cobrança congelada abaixo de R$ 0,50 sem cobrança Stripe iniciada');
      if(dto.valorCobrado!==Number(total)||dto.valorRecebido<Number(total))throw new BadRequestException('Confira o valor congelado e o valor recebido');
      await this.prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM charging_sessions WHERE id=${sessionId} FOR UPDATE`;
        const current=await tx.chargingSession.findUniqueOrThrow({where:{id:sessionId},include:{paymentIntent:true,payments:true}});
        if(current.status==='FINISHED')return;
        if(current.status!=='WAITING_PAYMENT'||current.paymentIntent?.providerIntentId?.startsWith('pi_')||current.payments.some(p=>p.status==='APPROVED'))throw new ConflictException('Pagamento mudou de estado; atualize');
        await tx.payment.create({data:{code:'CASH-'+randomBytes(12).toString('hex'),sessionId,paymentIntentId:current.paymentIntentId,method:'CASH',provider:'cash',status:'APPROVED',amount:total,amountReceived:dto.valorRecebido,changeAmount:new Prisma.Decimal(dto.valorRecebido).sub(total),paidAt:new Date(),idempotencyKey:`cash-settle-${sessionId}`}});
        await tx.chargingSession.update({where:{id:sessionId},data:{status:'FINISHED'}});
      });
      this.realtime.publish({topic:'session.updated',entityId:sessionId,operational:true,customerId:session.clientId??undefined});
      this.realtime.publish({topic:'payment.updated',entityId:sessionId,operational:true,customerId:session.clientId??undefined});
      return resultFor();
    }
    if(session.status!==SessionStatus.ACTIVE)throw new ConflictException('Encerramento já em andamento');
    let energy=dto.energiaConsumidaKwh;
    let quotedSnapshot:unknown;
    if(session.tariffVersion&&!dto.quoteToken)throw new BadRequestException("Atualize a cotação oficial antes de receber");
    if(dto.quoteToken){
      const [payload,sig]=dto.quoteToken.split('.');
      const expected=createHmac('sha256',process.env.JWT_SECRET ?? 'emps-development-only-secret-change-before-deploying').update(payload ?? '').digest('base64url');
      if(!sig || sig.length!==expected.length || !timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))throw new BadRequestException('Cotação inválida; atualize o acerto');
      let q;try{q=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{throw new BadRequestException('Cotação inválida');}
      if(q.sessionId!==String(sessionId)||q.expires<Date.now())throw new BadRequestException('Cotação expirada; atualize o acerto');
      energy=q.energy;quotedSnapshot=q.snapshot;
    }
    const quoteLedger=session.tariffVersion?ledgerOf({...session,billingSnapshot:quotedSnapshot}):null;
    const v1=quoteLedger?calculateSession(String(session.id),quoteLedger.intervals):null;
    const composition=v1?{energyKwh:Number(v1.customer.energy_kwh),total:Number(v1.customer.total_amount)}:bill(energy,session.pricePerKwhSnapshot,session.fixedFeeSnapshot,session.spendingLimit);
    const authoritativeAmount=composition.total;
    if(authoritativeAmount!==dto.valorCobrado)throw new BadRequestException(`O total inclui energia e taxa fixa: R$ ${authoritativeAmount.toFixed(2)}. Atualize o acerto.`);
    if(dto.valorRecebido<authoritativeAmount)throw new BadRequestException('O valor recebido é menor que o total da sessão');
    const command=await this.prisma.$transaction(async tx=>{
      const claim=await tx.chargingSession.updateMany({where:{id:sessionId,status:'ACTIVE'},data:{status:'STOP_REQUESTED'}});
      if(claim.count!==1)throw new ConflictException('Encerramento já em andamento');
      return tx.chargingCommand.upsert({where:{correlationId:`cash-stop-${sessionId}`},create:{chargerId:session.chargerId,clientId:session.clientId,sessionId,correlationId:`cash-stop-${sessionId}`,type:'STOP_CHARGING'},update:{status:'PENDING'}});
    });
    let dispatched;
    try {
      dispatched=await this.charging.dispatch({chargerId:session.chargerId,commandId:command.id,ocppIdentity:session.charger.ocppIdentity,ocppVersion:session.charger.ocppVersion,sessionId,type:'STOP'});
      if(!dispatched.accepted)throw new BadGatewayException('O gateway recusou o encerramento');
    } catch(error){
      await this.prisma.$transaction([this.prisma.chargingSession.update({where:{id:sessionId},data:{status:'ACTIVE'}}),this.prisma.chargingCommand.update({where:{id:command.id},data:{status:'FAILED'}})]);throw error;
    }
    const now=new Date();
    if(dispatched.mode!=='sandbox'){
      await this.prisma.$transaction([this.prisma.chargingSession.update({where:{id:sessionId},data:{status:'STOPPING'}}),this.prisma.chargingCommand.update({where:{id:command.id},data:{status:'ACCEPTED',sentAt:now}})]);
      throw new ConflictException('Comando aceito; aguarde confirmação física antes de receber');
    }
    await this.prisma.$transaction(async tx=>{
      await tx.chargingSession.update({where:{id:sessionId},data:{...(quoteLedger?{disconnectedAt:now,billingSnapshot:JSON.parse(JSON.stringify({...quoteLedger,phase:'frozen',charge_completed_at:now.toISOString(),disconnection_source:'cashier_confirmed_logical_sandbox',breakdown:calculateSession(String(sessionId),quoteLedger.intervals,now.toISOString(),now.toISOString())}))}:{}),status:'FINISHED',energyKwh:composition.energyKwh,totalPrice:authoritativeAmount,endTime:quoteLedger?new Date(Math.floor(now.getTime()/1000)*1000):now,durationSeconds:Math.max(0,Math.floor((now.getTime()-(session.startTime ?? session.requestedAt).getTime())/1000))}});
      await tx.payment.upsert({where:{idempotencyKey:`cash-settle-${sessionId}`},create:{idempotencyKey:`cash-settle-${sessionId}`,sessionId,code:operationCode('PAY'),method:'CASH',provider:'CASH_REGISTER',amount:authoritativeAmount,amountReceived:dto.valorRecebido,changeAmount:Number((dto.valorRecebido-authoritativeAmount).toFixed(2)),status:'APPROVED',paidAt:now},update:{amount:authoritativeAmount,amountReceived:dto.valorRecebido,changeAmount:Number((dto.valorRecebido-authoritativeAmount).toFixed(2)),status:'APPROVED',paidAt:now}});
      await tx.chargingCommand.update({where:{id:command.id},data:{status:'COMPLETED',processedAt:now,sentAt:now}});
      await tx.chargerLiveStatus.update({where:{chargerId:session.chargerId},data:{operationalStatus:'AVAILABLE',currentPowerKw:0,lastSeenAt:now,meterTotalKwh:Number(session.meterStartKwh ?? 0)+composition.energyKwh}});
    });
    this.realtime.publish({topic:'session.updated',entityId:sessionId,operational:true,customerId:session.clientId ?? undefined});
    this.realtime.publish({topic:'charger.updated',entityId:session.chargerId});
    this.realtime.publish({topic:'dashboard.updated',entityId:'summary',operational:true});
    return resultFor();
  }

  async approvePayment(paymentIdInput: string) {
    const paymentId = bigId(paymentIdInput);
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException("Pagamento não encontrado");
    if (payment.status === PaymentStatus.REJECTED) {
      throw new BadRequestException(
        "Pagamento rejeitado não pode ser aprovado manualmente",
      );
    }
    if (payment.status === PaymentStatus.APPROVED) return payment;
    if(payment.provider?.toLowerCase()==='stripe')throw new BadRequestException('Pagamento Stripe exige confirmação assinada do provedor');
    const paidAt = new Date();
    const approved = await this.prisma.$transaction(async (tx) => {
      const approved = await tx.payment.update({
        data: { paidAt, status: PaymentStatus.APPROVED },
        where: { id: paymentId },
      });
      await tx.chargingSession.updateMany({
        data: { status: SessionStatus.FINISHED },
        where: { id: payment.sessionId, status: SessionStatus.WAITING_PAYMENT },
      });
      return approved;
    });
    const owner = await this.prisma.chargingSession.findUnique({
      select: { client: { select: { id: true } } },
      where: { id: payment.sessionId },
    });
    const customerId = owner?.client?.id ?? undefined;
    this.realtime.publish({
      customerId,
      entityId: paymentId,
      operational: true,
      topic: "payment.updated",
    });
    this.realtime.publish({
      customerId,
      entityId: payment.sessionId,
      operational: true,
      topic: "session.updated",
    });
    this.realtime.publish({
      entityId: "summary",
      operational: true,
      topic: "dashboard.updated",
    });
    return approved;
  }
}
