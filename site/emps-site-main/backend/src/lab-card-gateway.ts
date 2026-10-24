import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Stripe = require('stripe');
import { localLegacyIntegrationActive } from './local-legacy-integration';

/** Test-only card gateway for the isolated lab ledger. Never activates the real gateway. */
export class LabCardGateway {
  constructor(private readonly stripeFactory: (key: string) => Stripe = key => new Stripe(key, { maxNetworkRetries: 1, timeout: 15000 })) {}
  enabled() { return process.env.EMPS_LAB_STRIPE_TEST_ENABLED === 'true' && localLegacyIntegrationActive(); }
  private client() {
    const key = process.env.EMPS_LAB_STRIPE_SECRET_KEY ?? '';
    if (!this.enabled() || !/^(sk|rk)_test_/.test(key))
      throw new ServiceUnavailableException('Cartão Stripe de teste indisponível neste ambiente');
    return this.stripeFactory(key);
  }
  private cents(amount: Prisma.Decimal.Value) {
    const n = new Prisma.Decimal(amount).mul(100);
    if (!n.isInteger() || n.lt(0) || n.gt(99999999)) throw new ConflictException('Valor de cartão inválido');
    return n.toNumber();
  }
  async authorization(id: string, amount: Prisma.Decimal.Value, externalId?: string | null) {
    const stripe = this.client(), cents = this.cents(amount);
    const pi = externalId ? await stripe.paymentIntents.retrieve(externalId) : await stripe.paymentIntents.create({
      amount: cents, currency: 'brl', capture_method: 'manual', payment_method_types: ['card'],
      metadata: { emps_lab_intent_id: id, origin: 'SIMULATED', database_scope: 'emps_integration_test' },
    }, { idempotencyKey: `emps-lab-card-${id}` });
    if (pi.livemode || pi.currency !== 'brl' || pi.amount !== cents || pi.capture_method !== 'manual' ||
        pi.metadata.emps_lab_intent_id !== id || pi.metadata.database_scope !== 'emps_integration_test')
      throw new ConflictException('Autorização Stripe incompatível com a demonstração');
    return pi;
  }
  async capture(id: string, externalId: string, reserve: Prisma.Decimal.Value, amount: Prisma.Decimal.Value) {
    const pi = await this.authorization(id, reserve, externalId), cents = this.cents(amount);
    if (pi.status === 'succeeded') {
      if (pi.amount_received !== cents) throw new ConflictException('Captura divergente');
      return pi;
    }
    if (cents < 50) throw new ConflictException('Total inferior a R$ 0,50: cartão não capturado; acerto permanece pendente');
    if (pi.status !== 'requires_capture' || pi.amount_capturable < cents)
      throw new ConflictException('Reserva de cartão expirada ou insuficiente; pagamento pendente');
    const captured = await this.client().paymentIntents.capture(externalId, { amount_to_capture: cents }, { idempotencyKey: `emps-lab-capture-${id}` });
    if (captured.livemode || captured.id !== externalId || captured.status !== 'succeeded' || captured.amount_received !== cents)
      throw new ConflictException('Captura não confirmada pelo Stripe');
    return captured;
  }
  async cancel(id:string,externalId:string,reserve:Prisma.Decimal.Value) {
    const pi=await this.authorization(id,reserve,externalId);
    if(pi.status==='canceled')return;
    if(pi.status==='succeeded')throw new ConflictException('Pagamento já capturado');
    await this.client().paymentIntents.cancel(externalId,{}, {idempotencyKey:`emps-lab-cancel-${id}`});
  }
}
