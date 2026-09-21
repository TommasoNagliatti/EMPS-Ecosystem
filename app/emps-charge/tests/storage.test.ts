import assert from 'node:assert/strict';
import test from 'node:test';

import { createStorageKeys } from '../src/config/storage';

const secureStoreKeyPattern = /^[A-Za-z0-9._-]+$/;

for (const isDemoMode of [true, false]) {
  test(`gera chaves válidas para o SecureStore no modo ${isDemoMode ? 'demo' : 'real'}`, () => {
    const keys = createStorageKeys(isDemoMode);

    assert.match(keys.accessToken, secureStoreKeyPattern);
    assert.match(keys.refreshToken, secureStoreKeyPattern);
    assert.notEqual(keys.accessToken, keys.refreshToken);
  });
}
