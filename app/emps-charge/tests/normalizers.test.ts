import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeChargingSession,
  normalizeChargingSessions,
} from '../src/domain/normalizers';

const cachedSession = {
  chargerId: 'charger_001',
  id: 'session_001',
  paymentMethod: 'card',
  startedAt: '2026-08-29T00:00:00.000Z',
  stationId: 'station_001',
  status: 'charging',
};

test('migra sessão antiga sem telemetria para valores seguros', () => {
  assert.deepEqual(normalizeChargingSession(cachedSession), {
    ...cachedSession,
    durationSeconds: 0,
    energyKwh: 0,
    powerKw: 0,
    simulatedSecondsOffset: 0,
    spendingLimit: null,
    totalCost: 0,
  });
});

test('descarta sessões persistidas sem identidade válida', () => {
  assert.equal(normalizeChargingSession({ ...cachedSession, chargerId: '' }), null);
  assert.deepEqual(
    normalizeChargingSessions([cachedSession, { unexpected: true }]),
    [normalizeChargingSession(cachedSession)],
  );
});
