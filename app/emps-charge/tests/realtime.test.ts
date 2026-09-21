import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapRealtimeChangeToInvalidation,
  mergeRealtimeInvalidations,
  parseRealtimeChange,
} from '../src/services/realtime';

const baseEvent = {
  eventId: 'evt_001',
  entityId: 'entity_001',
  occurredAt: '2026-08-28T12:00:00.000Z',
  topic: 'session.updated',
};

test('valida o envelope realtime canônico', () => {
  assert.deepEqual(parseRealtimeChange({ ...baseEvent, customerId: 'customer_001' }), {
    ...baseEvent,
    customerId: 'customer_001',
  });
  assert.equal(parseRealtimeChange({ topic: 'session.updated' }), null);
  assert.equal(parseRealtimeChange({ ...baseEvent, eventId: '   ' }), null);
  assert.equal(parseRealtimeChange({ ...baseEvent, occurredAt: 'data-inválida' }), null);
  assert.equal(parseRealtimeChange({ ...baseEvent, customerId: '' }), null);
});

test('sessão e pagamento invalidam sessão ativa e histórico', () => {
  for (const topic of ['session.created', 'session.updated', 'payment.updated']) {
    assert.deepEqual(mapRealtimeChangeToInvalidation({ ...baseEvent, topic }), {
      chargerIds: [],
      refreshSessions: true,
      refreshHistory: true,
      refreshCachedEntities: false,
      stationIds: [],
    });
  }
});

test('carregador novo invalida também a consulta de estações', () => {
  assert.deepEqual(
    mapRealtimeChangeToInvalidation({
      ...baseEvent,
      entityId: 'charger_001',
      topic: 'charger.updated',
    }),
    {
      chargerIds: ['charger_001'],
      refreshSessions: false,
      refreshHistory: false,
      refreshCachedEntities: true,
      stationIds: [],
    },
  );
});

test('estação nova invalida também a consulta de estações', () => {
  assert.deepEqual(
    mapRealtimeChangeToInvalidation({
      ...baseEvent,
      entityId: 'station_001',
      topic: 'station.updated',
    }),
    {
      chargerIds: [],
      refreshSessions: false,
      refreshHistory: false,
      refreshCachedEntities: true,
      stationIds: ['station_001'],
    },
  );
});

test('dashboard, alerta, cliente e payload desconhecido usam invalidação conservadora', () => {
  for (const value of [
    { ...baseEvent, topic: 'dashboard.updated' },
    { ...baseEvent, topic: 'alert.updated' },
    { ...baseEvent, topic: 'customer.updated' },
    { unexpected: true },
  ]) {
    assert.deepEqual(mapRealtimeChangeToInvalidation(value), {
      chargerIds: [],
      refreshSessions: true,
      refreshHistory: true,
      refreshCachedEntities: true,
      stationIds: [],
    });
  }
});

test('agrupa rajadas sem perder carregadores, estações ou flags', () => {
  const merged = mergeRealtimeInvalidations(
    mapRealtimeChangeToInvalidation({
      ...baseEvent,
      entityId: 'charger_001',
      topic: 'charger.updated',
    }),
    mapRealtimeChangeToInvalidation({
      ...baseEvent,
      entityId: 'station_001',
      eventId: 'evt_002',
      topic: 'station.updated',
    }),
  );
  assert.deepEqual(merged, {
    chargerIds: ['charger_001'],
    refreshSessions: false,
    refreshHistory: false,
    refreshCachedEntities: true,
    stationIds: ['station_001'],
  });
});
