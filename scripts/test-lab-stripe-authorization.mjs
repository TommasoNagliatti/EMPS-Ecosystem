import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Test-key authorization only. Does not confirm a card, start energy or capture money.
const runtime = JSON.parse(readFileSync(new URL('../../EMPS_BACKUPS/emps-legacy-integration.runtime.json', import.meta.url), 'utf8'));
let token;
async function request(path, body, key) {
  const response = await fetch('http://127.0.0.1:3011' + path, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}
const login = await request('/auth/login', { email: runtime.adminEmail, password: runtime.adminPassword });
assert.equal(login.status, 200); token = login.data.accessToken;
let intentId;
try {
  const config = await request('/web-charge/qr/CH-26f5af4e137bbe735ed5');
  assert.equal(config.status, 200);
  assert.equal(config.data.cardPaymentProvider, 'stripe');
  assert.equal(config.data.paymentProvider, 'sandbox');
  assert.equal(config.data.physicalGateway, false);
  assert.match(config.data.stripePublishableKey, /^pk_test_/);
  const authenticatedConfig = await request('/web-charge/authorized-qr/CH-26f5af4e137bbe735ed5');
  assert.equal(authenticatedConfig.data.stripePublishableKey, config.data.stripePublishableKey);
  const key = randomUUID();
  const created = await request('/mobile/v1/payment-intents', { chargerId: '49', method: 'card', spendingLimit: 20 }, key);
  assert.ok(created.status < 300, `Create authorization failed: HTTP ${created.status}`);
  intentId = created.data.id;
  assert.equal(created.data.provider, 'stripe');
  assert.equal(created.data.sandbox, true);
  assert.equal(created.data.status, 'requires_action');
  assert.match(created.data.providerClientSecret, /^pi_.*_secret_/);
  const providerId = created.data.providerClientSecret.split('_secret_')[0];
  const provider = await fetch('https://api.stripe.com/v1/payment_intents/' + encodeURIComponent(providerId) +
    '?client_secret=' + encodeURIComponent(created.data.providerClientSecret), {
      headers: { Authorization: 'Bearer ' + config.data.stripePublishableKey },
    });
  assert.equal(provider.status, 200, 'The published test key must access the same Stripe account authorization');
  const providerIntent = await provider.json();
  assert.equal(providerIntent.livemode, false);
  assert.equal(providerIntent.amount, 2000);
  const replay = await request('/mobile/v1/payment-intents', { chargerId: '49', method: 'card', spendingLimit: 20 }, key);
  assert.equal(replay.data.id, intentId);
  assert.equal(replay.data.providerClientSecret, created.data.providerClientSecret);
  const read = await request('/mobile/v1/payment-intents/' + intentId);
  assert.equal(read.data.status, 'requires_action');
  console.log('PASS: public/authenticated WebCharge config, matching test keys, local API authorization and stable idempotent replay; no card confirmed or captured.');
} finally {
  if (intentId) {
    const canceled = await request('/web-charge/payment-intents/' + intentId + '/cancel', {});
    assert.equal(canceled.data.status, 'canceled');
    console.log('PASS: unused test authorization canceled.');
  }
}
