import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MobileService } from '../src/mobile.service';

test('authenticated local sandbox QR keeps missing coordinates missing and physical charger offline', async () => {
  const saved = { ...process.env };
  const now = new Date(), earlier = new Date(now.getTime() - 1000);
  const station = { id: 46, name: 'Posto 24h', street: 'Rua Teste', addressNumber: '1', complement: null,
    neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', latitude: null, longitude: null,
    amenities: [], chargers: [], photos: [], featured: false, openingHours: null, description: null,
    visibility: 'PRIVATE', timezone: 'America/Sao_Paulo', availability: null };
  const binding = { id: 69, publicToken: 'test-token', code: 'LAB46-EV1-test', isActive: true,
    revokedAt: null, validFrom: earlier, expiresAt: null };
  const charger = { id: 76, stationId: 46, name: 'EVSE 01', location: 'EV1', connectorType: 'TYPE_2',
    powerKw: new Prisma.Decimal('22'), publicCode: 'LAB46-EV1', administrativeStatus: 'PENDING',
    updatedAt: now, qrBindings: [binding], liveStatus: { operationalStatus: 'OFFLINE', updatedAt: now },
    tariffs: [{ id: 53, status: 'ACTIVE', validFrom: earlier, validUntil: null, basePricePerKwh: new Prisma.Decimal('2') }],
    station: { tariffs: [] } };
  const db = { station: { findUniqueOrThrow: async () => station }, charger: { findUniqueOrThrow: async () => charger } };
  const sandbox = { publicQr: async () => null, cardConfiguration: () => ({cardAvailable:false}), resolveQrForActor: async () => ({ binding, charger, tariff: charger.tariffs[0] }) };
  try {
    Object.assign(process.env, { NODE_ENV: 'development', EMPS_CHARGING_SANDBOX_ENABLED: 'true',
      EMPS_LOCAL_LEGACY_INTEGRATION: 'true', EMPS_REMOTE_DEVELOPMENT: 'false',
      EMPS_PHYSICAL_COMMANDS_ENABLED: 'false', EMPS_EXTERNAL_PAYMENT_SIDE_EFFECTS_ENABLED: 'false',
      PAYMENT_PROVIDER: 'sandbox', HOST: '127.0.0.1', DEMO_HISTORY_TEST_DATABASE: 'emps_integration_test',
      DATABASE_URL: 'mysql://emps_integration_app:local-test@127.0.0.1:3308/emps_integration_test',
      EMPS_MAQUETE_STATION_ID: '46' });
    delete process.env.OCPP_GATEWAY_URL;
    delete process.env.OCPP_GATEWAY_TOKEN;
    const mobile = new MobileService(db as never, {} as never, {} as never, {} as never,
      {} as never, undefined, undefined, sandbox as never);
    const resolved = await mobile.resolveQr(binding.code, '64');
    assert.equal(resolved.station.coordinates, null);
    assert.equal(resolved.station.coordinatesUnavailable, true);
    assert.equal(resolved.charger.status, 'offline');
    assert.equal(resolved.charger.sandboxAvailable, true);
    assert.equal(resolved.physicalGateway, false);
    assert.equal(resolved.mode, 'SANDBOX');
    assert.throws(() => (mobile as unknown as {presentStation:(value:unknown)=>unknown}).presentStation(station), BadRequestException);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
