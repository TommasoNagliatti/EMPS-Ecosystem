import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiRequestError, createMobileApi } from '../src/services/mobile-api';

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createClient() {
  return createMobileApi({
    baseUrl: 'http://localhost:3001',
    getAccessToken: async () => 'access-token',
    getRefreshToken: async () => 'refresh-token',
    onAuthenticationLost: async () => undefined,
    onTokensChanged: async () => undefined,
  });
}

test('preserva ausência de sessão em respostas HTTP vazias ou envelopadas', async () => {
  const responses = [
    new Response(null, { status: 200 }),
    new Response(JSON.stringify({ data: null }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    }),
  ];
  globalThis.fetch = async () => responses.shift() as Response;

  const api = createClient();
  assert.equal(await api.activeSession(), null);
  assert.equal(await api.activeSession(), null);
});

test('trata 204 como operação sem conteúdo', async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.equal(await createClient().logout('refresh-token'), undefined);
});

test('rejeita JSON inválido em vez de criar um objeto fantasma', async () => {
  globalThis.fetch = async () =>
    new Response('{resposta-incompleta', {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  await assert.rejects(createClient().activeSession(), (error: unknown) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.code, 'INVALID_RESPONSE');
    return true;
  });
});
