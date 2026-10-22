import assert from 'node:assert/strict';
import { test } from 'node:test';
import Stripe = require('stripe');
import { LabCardGateway } from '../src/lab-card-gateway';

test('isolated test card gateway validates authorization, capture and replay', async () => {
  const original = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: 'development', EMPS_LOCAL_LEGACY_INTEGRATION: 'true', EMPS_REMOTE_DEVELOPMENT: 'false',
    EMPS_PHYSICAL_COMMANDS_ENABLED: 'false', EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED: 'false',
    PAYMENT_PROVIDER: 'sandbox', HOST: '127.0.0.1', DEMO_HISTORY_TEST_DATABASE: 'emps_integration_test',
    OCPP_GATEWAY_URL: '', OCPP_GATEWAY_TOKEN: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '',
    DATABASE_URL: 'mysql://emps_integration_app:unit-test@127.0.0.1:3308/emps_integration_test',
    EMPS_LAB_STRIPE_TEST_ENABLED: 'true', EMPS_LAB_STRIPE_SECRET_KEY: 'sk_test_unit_test',
  });
  const intent = { id: 'pi_test', livemode: false, currency: 'brl', amount: 2000,
    capture_method: 'manual', metadata: { emps_lab_intent_id: 'local-id', database_scope: 'emps_integration_test' },
    status: 'requires_capture', amount_capturable: 2000, amount_received: 0 };
  let captures = 0;
  const gateway = new LabCardGateway(() => ({ paymentIntents: {
    retrieve: async () => ({ ...intent }),
    create: async (_data: unknown, options: {idempotencyKey: string}) => {
      assert.equal(options.idempotencyKey, 'emps-lab-card-local-id'); return { ...intent };
    },
    capture: async (_id: string, data: {amount_to_capture: number}, options: {idempotencyKey: string}) => {
      captures++; assert.equal(options.idempotencyKey, 'emps-lab-capture-local-id');
      return { ...intent, status: 'succeeded', amount_received: data.amount_to_capture };
    },
  } } as unknown as Stripe));
  try {
    assert.equal((await gateway.authorization('local-id', '20')).id, 'pi_test');
    await assert.rejects(gateway.authorization('other-id', '20', 'pi_test'));
    await assert.rejects(gateway.authorization('local-id', '21', 'pi_test'));
    intent.livemode = true;
    await assert.rejects(gateway.authorization('local-id', '20', 'pi_test'));
    intent.livemode = false;
    await assert.rejects(gateway.capture('local-id', 'pi_test', '20', '0.49'));
    await assert.rejects(gateway.capture('local-id', 'pi_test', '20', '21'));
    assert.equal(captures, 0);
    assert.equal((await gateway.capture('local-id', 'pi_test', '20', '5')).amount_received, 500);
    intent.status = 'succeeded'; intent.amount_received = 500;
    await gateway.capture('local-id', 'pi_test', '20', '5');
    assert.equal(captures, 1);
    await assert.rejects(gateway.capture('local-id', 'pi_test', '20', '6'));
    process.env.EMPS_LAB_STRIPE_SECRET_KEY = 'sk_live_rejected';
    await assert.rejects(gateway.authorization('local-id', '20'));
    process.env.DATABASE_URL = 'mysql://emps_integration_app:unit-test@127.0.0.1:3306/emps_db';
    assert.equal(gateway.enabled(), false);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
