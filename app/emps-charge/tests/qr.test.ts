import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEmpsQr } from '../src/utils/qr';

test('resolve um código curto de vaga', () => {
  assert.deepEqual(resolveEmpsQr('EMPS-PAULISTA-A01'), { ok: true, chargerId: 'chg_001' });
});

test('resolve um Universal Link HTTPS confiável', () => {
  assert.deepEqual(resolveEmpsQr('https://app.emps.com.br/c/paulista-a01-demo'), {
    ok: true,
    chargerId: 'chg_001',
  });
});

test('resolve um deep link interno do aplicativo', () => {
  assert.deepEqual(resolveEmpsQr('emps://charger/chg_001'), {
    ok: true,
    chargerId: 'chg_001',
  });
});

test('rejeita domínio parecido, mas não autorizado', () => {
  const result = resolveEmpsQr('https://app.emps.com.br.golpe.example/c/paulista-a01-demo');
  assert.equal(result.ok, false);
});

test('rejeita link HTTP mesmo no domínio correto', () => {
  const result = resolveEmpsQr('http://app.emps.com.br/c/paulista-a01-demo');
  assert.equal(result.ok, false);
});

test('explica que o QR do Expo não identifica um carregador', () => {
  const result = resolveEmpsQr('exp://192.168.0.10:8081');
  assert.deepEqual(result, {
    ok: false,
    message:
      'Esse é o QR do Expo, usado apenas para abrir o aplicativo. Escaneie o QR EMPS da vaga.',
  });
});

test('rejeita código desconhecido', () => {
  const result = resolveEmpsQr('EMPS-NAO-EXISTE');
  assert.equal(result.ok, false);
});
