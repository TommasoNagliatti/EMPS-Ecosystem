import assert from 'node:assert/strict';
import test from 'node:test';

import { parseEmpsQrPublicToken, resolveEmpsQr } from '../src/utils/qr';

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

test('recognizes approved HTTPS preview and official QR domains without trusting lookalikes', () => {
  const code='CH-f2f059af5117b95fb970';
  for(const host of ['preview.emps-charge.tech','emps-charge.tech','www.emps-charge.tech'])
    assert.deepEqual(parseEmpsQrPublicToken(`https://${host}/charge/${code}`),{ok:true,publicToken:code});
  for(const link of [`http://preview.emps-charge.tech/charge/${code}`,
    `https://preview.emps-charge.tech.evil.invalid/charge/${code}`,
    `https://user:pass@preview.emps-charge.tech/charge/${code}`])
    assert.equal(parseEmpsQrPublicToken(link).ok,false);
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

test('development QR accepts only configured local API host and Web Charge path', () => {
  const old=process.env.EXPO_PUBLIC_EMPS_API_URL;
  process.env.EXPO_PUBLIC_EMPS_API_URL='http://192.168.15.4:3011';
  try {
    assert.equal(resolveEmpsQr('http://192.168.15.4:3010/charge/paulista-a01-demo').ok,true);
    assert.equal(resolveEmpsQr('http://192.168.15.5:3010/charge/paulista-a01-demo').ok,false);
    assert.equal(resolveEmpsQr('http://192.168.15.4:3010/other/paulista-a01-demo').ok,false);
  } finally { if(old===undefined)delete process.env.EXPO_PUBLIC_EMPS_API_URL;else process.env.EXPO_PUBLIC_EMPS_API_URL=old; }
});
