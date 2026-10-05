import {
  ConflictException,
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import Stripe = require("stripe");
import {Prisma} from "@prisma/client";
import type { MobilePaymentMethod } from "./mobile.dtos";

export type GatewayPaymentStatus =
  | "authorized"
  | "requires_action"
  | "rejected";

export type GatewayPaymentIntent = {
  clientSecret?: string;
  externalId: string;
  provider: "SANDBOX" | "STRIPE";
  status: GatewayPaymentStatus;
};

export type GatewaySettlement = {
  capturedAmount: number;
  externalPaymentId: string;
  provider: "SANDBOX" | "STRIPE";
  status: "approved" | "pending" | "rejected";
};

type CreateGatewayIntentInput = {
  idempotencyKey: string;
  internalIntentId: string;
  method: MobilePaymentMethod;
  spendingLimit: number | null;
};

export function paymentCapabilities(){
  const mode=(process.env.PAYMENT_PROVIDER??'sandbox').toLowerCase();
  const demo=mode==='sandbox'||(process.env.ENABLE_DEMO_PAYMENTS==='true'&&process.env.NODE_ENV!=='production');
  const key=process.env.STRIPE_PUBLISHABLE_KEY;
  return {paymentProvider:mode,demoPayments:demo,stripePublishableKey:key?.startsWith('pk_test_')?key:undefined};
}

@Injectable()
export class PaymentGatewayService {
  private readonly mode = (
    process.env.PAYMENT_PROVIDER ?? "sandbox"
  ).toLowerCase();
  private readonly stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

  constructor() {
    if(this.mode==='stripe' && !/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY??'')) throw new Error('Stripe exige chave de teste');
  }
  async createSessionIntent(input:{amount:string;sessionId:string;internalIntentId:string;chargerId:string;stationId:string;externalId?:string}) {
    if(!this.stripe || !/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY??''))throw new ServiceUnavailableException('Stripe Sandbox não configurado');
    const cents=new Prisma.Decimal(input.amount).mul(100);
    if(cents.gt(0)&&cents.lt(50))throw new BadRequestException('O total desta recarga é inferior ao mínimo de R$ 0,50 para cartão Stripe. Solicite o acerto no caixa. Não é falta de saldo; o total oficial não foi alterado.');
    if(!cents.isInteger()||cents.lt(0)||cents.gt(99999999)||cents.isZero())throw new BadRequestException('Valor fora dos limites do cartão. O total oficial não foi alterado.');
    try {
      const pi=input.externalId?await this.stripe.paymentIntents.retrieve(input.externalId):await this.stripe.paymentIntents.create({amount:cents.toNumber(),currency:'brl',payment_method_types:['card'],metadata:{emps_session_id:input.sessionId,emps_payment_intent_id:input.internalIntentId,charger_id:input.chargerId,station_id:input.stationId}},{idempotencyKey:'emps-final-'+input.sessionId});
      if(pi.livemode||pi.amount!==cents.toNumber()||pi.currency!=='brl'||pi.metadata.emps_session_id!==input.sessionId||pi.status==='canceled')throw new ConflictException('Intent incompatível com a cobrança');
      return pi;
    }catch(error){if(error instanceof Stripe.errors.StripeError)throw new BadGatewayException('Stripe Sandbox indisponível');throw error;}
  }
  async cancelAuthorization(provider:string,externalId:string,internalId:string){
    if(provider==='sandbox')return;
    if(provider!=='stripe')throw new ConflictException('Provedor não permite cancelamento');
    const intent=await this.retrieveIntent(externalId);
    if(intent.livemode||intent.metadata.emps_payment_intent_id!==internalId)throw new ConflictException('Autorização incompatível');
    if(intent.status==='canceled')return;
    if(intent.status==='succeeded')throw new ConflictException('Pagamento já capturado');
    await this.stripe!.paymentIntents.cancel(intent.id,{}, {idempotencyKey:'emps-cancel-unused-'+internalId});
  }

  async retrieveIntent(id: string) {
    if (!this.stripe)
      throw new ServiceUnavailableException("Stripe não configurado");
    return this.stripe.paymentIntents.retrieve(id);
  }

  async assertAdmission(id: string, internalId: string, reserve: string) {
    const intent = await this.retrieveIntent(id);
    const cents = new Prisma.Decimal(reserve).mul(100);
    if (intent.livemode || intent.currency !== 'brl' || intent.capture_method !== 'manual' ||
        intent.metadata.emps_payment_intent_id !== internalId || intent.status !== 'requires_capture' ||
        !cents.isInteger() || cents.lt(50) || intent.amount_capturable < cents.toNumber()) {
      throw new BadRequestException('A reserva financeira ainda não foi aprovada ou expirou. Autorize novamente antes de iniciar.');
    }
  }

  // Return the captured hold, or release it before requesting a new final payment.
  async settleReservation(input: {externalId:string; internalIntentId:string; sessionId:string; amount:string}) {
    const intent = await this.retrieveIntent(input.externalId);
    if (intent.capture_method !== 'manual') return null;
    if (intent.livemode || intent.currency !== 'brl' || intent.metadata.emps_payment_intent_id !== input.internalIntentId)
      throw new ConflictException('Reserva incompatível com a sessão');
    const cents = new Prisma.Decimal(input.amount).mul(100);
    if (!cents.isInteger() || cents.isNegative()) throw new BadRequestException('Total inválido');
    if (intent.status === 'succeeded') {
      if (intent.amount_received !== cents.toNumber()) throw new ConflictException('Captura divergente do total oficial');
      return intent;
    }
    if (intent.status === 'requires_capture' && cents.gte(50) && cents.lte(intent.amount_capturable)) {
      await this.stripe!.paymentIntents.update(intent.id,{metadata:{emps_session_id:input.sessionId}}, {idempotencyKey:`emps-bind-${intent.id}-${input.sessionId}`});
      return this.stripe!.paymentIntents.capture(intent.id,{amount_to_capture:cents.toNumber()}, {idempotencyKey:`emps-reservation-capture-${input.sessionId}`});
    }
    if (intent.status !== 'canceled') {
      await this.stripe!.paymentIntents.cancel(intent.id,{}, {idempotencyKey:`emps-reservation-release-${input.sessionId}`});
    }
    return null;
  }

  async createIntent(
    input: CreateGatewayIntentInput,
  ): Promise<GatewayPaymentIntent> {
    if (this.mode === "sandbox" || (input.method!=="card" && paymentCapabilities().demoPayments)) {
      return {
        externalId: `sandbox_${input.internalIntentId}`,
        provider: "SANDBOX",
        status: "authorized",
      };
    }

    if (this.mode !== "stripe") {
      throw new ServiceUnavailableException(
        "Provedor de pagamento não configurado",
      );
    }
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        "STRIPE_SECRET_KEY não configurada",
      );
    }
    if (!input.spendingLimit) {
      throw new BadRequestException(
        "Defina um limite de gasto para autorizar um pagamento externo",
      );
    }

    try {
      if(input.method!=="card")throw new BadRequestException("Somente cartão Stripe Sandbox nesta etapa");
      const isPix = false;
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: Math.round(input.spendingLimit * 100),
          capture_method: isPix ? "automatic" : "manual",
          currency: "brl",
          metadata: { emps_payment_intent_id: input.internalIntentId },
          payment_method_types: [isPix ? "pix" : "card"],
        },
        { idempotencyKey: input.idempotencyKey },
      );

      return {
        clientSecret: intent.client_secret ?? undefined,
        externalId: intent.id,
        provider: "STRIPE",
        status:
          intent.status === "requires_capture" || intent.status === "succeeded"
            ? "authorized"
            : intent.status === "canceled"
              ? "rejected"
              : "requires_action",
      };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        throw new BadGatewayException(
          "O provedor de pagamento recusou a solicitação",
        );
      }
      throw error;
    }
  }

  async settleIntent(input: {
    amount: number;
    externalId: string;
    method: MobilePaymentMethod;
    provider: string;
  }): Promise<GatewaySettlement> {
    if (input.provider.toUpperCase() === "SANDBOX") {
      return {
        capturedAmount: input.amount,
        externalPaymentId: `sandbox_payment_${input.externalId}`,
        provider: "SANDBOX",
        status: "approved",
      };
    }
    if (!this.stripe || input.provider.toUpperCase() !== "STRIPE") {
      throw new ServiceUnavailableException(
        "Provedor externo indisponível para captura",
      );
    }

    try {
      let intent = await this.stripe.paymentIntents.retrieve(input.externalId, {
        expand: ["latest_charge"],
      });
      const amountInCents = new Prisma.Decimal(input.amount).mul(100).toNumber();
      if(intent.livemode||intent.currency!=='brl')throw new BadRequestException('Pagamento fora do Sandbox BRL');
      if(amountInCents===0&&input.method!=='pix'&&intent.capture_method==='manual'){
        if(intent.status==='requires_capture')intent=await this.stripe.paymentIntents.cancel(intent.id,{}, {idempotencyKey:'emps-zero-release-'+intent.id});
        if(intent.status!=='canceled')throw new ConflictException('Não foi possível liberar a autorização');
        return {capturedAmount:0,externalPaymentId:intent.id,provider:'STRIPE',status:'approved'};
      }
      if(!Number.isSafeInteger(amountInCents)||amountInCents<50)throw new BadRequestException("Valor abaixo do mínimo do cartão; total preservado");

      if (input.method === "pix") {
        if (intent.status !== "succeeded") {
          return {
            capturedAmount: 0,
            externalPaymentId: intent.id,
            provider: "STRIPE",
            status: intent.status === "canceled" ? "rejected" : "pending",
          };
        }
        const excess = Math.max(0, intent.amount_received - amountInCents);
        const latestCharge = intent.latest_charge;
        const chargeId =
          typeof latestCharge === "string" ? latestCharge : latestCharge?.id;
        if (excess > 0 && chargeId) {
          await this.stripe.refunds.create(
            { amount: excess, charge: chargeId },
            { idempotencyKey: `emps-refund-${intent.id}-${amountInCents}` },
          );
        }
      } else if (intent.status === "requires_capture") {
        if(amountInCents>intent.amount_capturable)throw new BadRequestException("Autorização insuficiente; pagamento não concluído");
        intent = await this.stripe.paymentIntents.capture(
          intent.id,
          {
            amount_to_capture: Math.min(
              amountInCents,
              intent.amount_capturable,
            ),
          },
          { idempotencyKey: `emps-capture-${intent.id}-${amountInCents}` },
        );
      }

      return {
        capturedAmount: intent.status === "succeeded" ? intent.amount_received / 100 : 0,
        externalPaymentId: intent.id,
        provider: "STRIPE",
        status:
          intent.status === "succeeded"
            ? "approved"
            : intent.status === "canceled"
              ? "rejected"
              : "pending",
      };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        throw new BadGatewayException(
          "Não foi possível concluir o pagamento no provedor",
        );
      }
      throw error;
    }
  }

  constructWebhookEvent(rawBody: Buffer, signature: string) {
    if (!this.stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      throw new ServiceUnavailableException("Webhook Stripe não configurado");
    }
    try { const event=this.stripe.webhooks.constructEvent(rawBody,signature,process.env.STRIPE_WEBHOOK_SECRET);
      if(event.livemode)throw new BadRequestException('Live Mode não permitido');return event;
    } catch {throw new BadRequestException('Assinatura Stripe inválida');}
  }
}
