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

test('cadastro transmite confirmação e aceite sem assumir consentimento',async()=>{
 let sent:unknown;
 globalThis.fetch=async(_url,init)=>{sent=JSON.parse(String(init?.body));return new Response('{}',{status:201})};
 await createClient().register('Pessoa Teste','p@example.invalid','senha1234','senha1234',false);
 assert.deepEqual(sent,{name:'Pessoa Teste',email:'p@example.invalid',password:'senha1234',passwordConfirmation:'senha1234',acceptTerms:false});
});
test('foto privada renova autorização e nunca envia token para destino arbitrário',async()=>{
 const calls:string[]=[];globalThis.fetch=async(url)=>{calls.push(String(url));return new Response('{}')};
 const api=createClient();
 const privateSource=await api.stationPhotoSource('/v2/station-photos/ab-cd?v=ab.image');
 assert.equal(privateSource.headers?.Authorization,'Bearer access-token');assert.equal(calls.length,1);
 const publicSource=await api.stationPhotoSource('/public/station-photos/ab-cd');assert.equal(publicSource.headers,undefined);assert.equal(calls.length,1);
 await assert.rejects(api.stationPhotoSource('https://example.invalid/capture'),/Foto inválida/);
});
