import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PlatformStationsService } from '../src/platform-stations.service';
import { stationScope } from '../src/persistence';
import { physicalSourceWhere } from '../src/telemetry-domain';

function row(overrides: Record<string, unknown> = {}) {
  return { id: 10, adminId: 1, name: 'Test station', status: 'ACTIVE', reviewState: null, gieProvisioning: null, photos: [], _count: { chargers: 1 }, staff: [],
    admin: { name: 'Owner', email: 'owner@example.invalid' }, solarAssets: [], batteries: [], chargers: [], stationEnergyReadings: [], ...overrides };
}
test('station list preserves membership isolation and selects only the needed owner and physical data', async () => {
  let query: any;
  const user = { sub: '1', role: 'ADMIN', selectedStationId: 999 };
  const service = new PlatformStationsService({ station: { findMany: async (q: any) => { query = q; return [row()]; } } } as any, {} as any, {} as any);
  const result = await service.list(user);
  assert.deepEqual(query.where, stationScope({ ...user, selectedStationId: undefined, stationPermission: 'READ' }));
  assert.deepEqual(query.include.admin.select, { name: true, email: true });
  assert.deepEqual(query.include.stationEnergyReadings.where, { ...physicalSourceWhere, measurementQuality: 'GOOD', measuredAt: { lte: query.include.stationEnergyReadings.where.measuredAt.lte } });
  assert.ok(query.include.stationEnergyReadings.where.measuredAt.lte instanceof Date);
  assert.equal(query.include.stationEnergyReadings.take, 1);
  assert.equal(result[0].membershipRole, 'OWNER');
  assert.equal(result[0].reviewState, 'APPROVED');
  assert.equal(result[0].listSummary.solarCapacityKwp, null);
  assert.equal(result[0].listSummary.storageCapacityKwh, null);
  assert.equal(result[0].listSummary.telemetry, null);
  for (const key of ['admin', 'solarAssets', 'batteries', 'chargers', 'stationEnergyReadings']) assert.equal(key in result[0], false);
});
test('station list aggregates installed capacity, preserves zero readings and handles missing device state', async () => {
  const measuredAt = new Date();
  const service = new PlatformStationsService({ station: { findMany: async () => [row({ adminId: 2, staff: [{ staffRole: 'VIEWER' }], solarAssets: [{ installedKwp: '10.25' }, { installedKwp: '2.25' }], batteries: [{ capacityKwh: '30.00' }],
    chargers: [{ name: 'Alpha', serialNumber: '42', ocppIdentity: null, administrativeStatus: 'ENABLED', liveStatus: null }],
    stationEnergyReadings: [{ measuredAt, solarPowerKw: '0.00', batteryPowerKw: '-3.50', gridPowerKw: null, batteryStateOfChargePercent: '60.00' }] })] } } as any, {} as any, {} as any);
  const [result] = await service.list({ sub: '1' });
  assert.equal(result.membershipRole, 'VIEWER');
  assert.equal(result.listSummary.solarCapacityKwp, 12.5);
  assert.equal(result.listSummary.storageCapacityKwh, 30);
  assert.equal(result.listSummary.devices[0].operationalStatus, 'UNKNOWN');
  assert.deepEqual(result.listSummary.telemetry, { measuredAt, solarPowerKw: 0, batteryPowerKw: -3.5, gridPowerKw: null, batterySocPercent: 60 });
});
