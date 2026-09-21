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
    if(!cents.isInteger()||cents.lt(50)||cents.gt(99999999))throw new BadRequestException('Valor fora dos limites do cartão. O total oficial não foi alterado.');
    try {
      const pi=input.externalId?await this.stripe.paymentIntents.retrieve(input.externalId):await this.stripe.paymentIntents.create({amount:cents.toNumber(),currency:'brl',payment_method_types:['card'],metadata:{emps_session_id:input.sessionId,emps_payment_intent_id:input.internalIntentId,charger_id:input.chargerId,station_id:input.stationId}},{idempotencyKey:'emps-final-'+input.sessionId});
      if(pi.livemode||pi.amount!==cents.toNumber()||pi.currency!=='brl'||pi.metadata.emps_session_id!==input.sessionId||pi.status==='canceled')throw new ConflictException('Intent incompatível com a cobrança');
      return pi;
    }catch(error){if(error instanceof Stripe.errors.StripeError)throw new BadGatewayException('Stripe Sandbox indisponível');throw error;}
  }
  async retrieveIntent(id: string) {
    if (!this.stripe)
      throw new ServiceUnavailableException("Stripe não configurado");
    return this.stripe.paymentIntents.retrieve(id);
  }

  async createIntent(
    input: CreateGatewayIntentInput,
  ): Promise<GatewayPaymentIntent> {
    if (this.mode === "sandbox") {
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
