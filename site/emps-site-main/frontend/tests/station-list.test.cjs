const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../components/stations/station-list-model.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const modelModule = new Module(filename, module);
modelModule._compile(compiled, filename);
const { stationStatus, stationKind, stationMetric, createdThisMonth, matchesStation, emptySearch, emptyAdvanced } = modelModule.exports;
const now = new Date('2026-10-08T12:00:00Z');
const device = (operationalStatus, administrativeStatus = 'ENABLED') => ({ name: 'Charger Alpha', serialNumber: 'SN-42', ocppIdentity: 'OCPP-42', operationalStatus, administrativeStatus });
function station(overrides = {}) {
  return { id: '1', name: 'Estacao Sao Jose', street: 'Avenida Brasil', addressNumber: '10', neighborhood: 'Centro', city: 'Sao Paulo', state: 'SP', status: 'ACTIVE', reviewState: 'APPROVED', membershipRole: 'OWNER', powerLimitKw: 22,
    listSummary: { ownerName: 'Example Owner', contactEmail: 'owner@example.invalid', devices: [device('UNKNOWN')], solarCapacityKwp: 10, storageCapacityKwh: 30, telemetry: null }, ...overrides };
}
const matches = (row, search = {}, filters = {}, favorites = []) => matchesStation(row, { ...emptySearch, ...search }, { ...emptyAdvanced, ...filters }, favorites);

test('operational tabs do not infer running from an active registration alone', () => {
  assert.equal(stationStatus(station()), 'waiting');
  for (const state of ['AVAILABLE', 'PREPARING', 'CHARGING', 'SUSPENDED', 'FINISHING', 'RESERVED']) {
    const row = station(); row.listSummary.devices = [device(state)];
    assert.equal(stationStatus(row), 'running');
  }
});
test('fault, offline, construction and review follow the EMPS state hierarchy', () => {
  assert.equal(stationStatus(station({ status: 'MAINTENANCE' })), 'fault');
  assert.equal(stationStatus(station({ status: 'INACTIVE' })), 'offline');
  assert.equal(stationStatus(station({ reviewState: 'SUSPENDED' })), 'offline');
  assert.equal(stationStatus(station({ reviewState: 'DRAFT' })), 'constructing');
  assert.equal(stationStatus(station({ reviewState: 'CHANGES_REQUESTED' })), 'constructing');
  assert.equal(stationStatus(station({ reviewState: 'PENDING_REVIEW' })), 'waiting');
  const row = station(); row.listSummary.devices = [device('AVAILABLE'), device('FAULTED')];
  assert.equal(stationStatus(row), 'fault');
  row.listSummary.devices = [device('OFFLINE'), device('UNAVAILABLE')];
  assert.equal(stationStatus(row), 'offline');
  row.listSummary.devices = [device('AVAILABLE', 'DISABLED')];
  assert.equal(stationStatus(row), 'waiting');
  row.listSummary.devices = [device('AVAILABLE', 'MAINTENANCE')];
  assert.equal(stationStatus(row), 'fault');
});
test('search combines names, device identities, address and owner email', () => {
  const row = station({ name: 'Esta\u00e7\u00e3o S\u00e3o Jos\u00e9' });
  assert.equal(matches(row, { name: 'sao jose', address: 'centro', email: 'OWNER@' }), true);
  assert.equal(matches(row, { name: 'sn-42' }), true);
  assert.equal(matches(row, { name: 'ocpp-42' }), true);
  assert.equal(matches(row, { name: 'alpha', address: 'missing' }), false);
});
test('advanced filters distinguish owner, shared stations, favorites, type and power range', () => {
  const row = station();
  assert.equal(matches(row, {}, { kind: 'hybrid', owner: 'owner@example.invalid', minPower: '20', maxPower: '23', source: 'managed', starred: true }, ['1']), true);
  for (const filter of [{ kind: 'solar' }, { source: 'shared' }, { owner: 'missing' }, { minPower: '23' }, { maxPower: '21' }, { starred: true }]) assert.equal(matches(row, {}, filter), false);
  assert.equal(matches(station({ membershipRole: 'VIEWER' }), {}, { source: 'shared' }), true);
  assert.equal(matches(station({ powerLimitKw: null }), {}, { minPower: '0' }), false);
  row.listSummary.storageCapacityKwh = null; assert.equal(stationKind(row), 'solar');
  row.listSummary.solarCapacityKwp = null; assert.equal(stationKind(row), 'charging');
  row.listSummary.storageCapacityKwh = 30; assert.equal(stationKind(row), 'storage');
});
test('new this month respects the station timezone at month boundaries', () => {
  assert.equal(createdThisMonth(station({ createdAt: '2026-10-01T01:00:00Z', timezone: 'America/Sao_Paulo' }), now), false);
  assert.equal(createdThisMonth(station({ createdAt: '2026-10-01T03:00:00Z', timezone: 'America/Sao_Paulo' }), now), true);
  assert.equal(createdThisMonth(station({ createdAt: 'invalid' }), now), false);
});
test('metrics require a recent reading and never turn installed capacity into generated power', () => {
  const row = station();
  assert.equal(stationMetric(row, 'solarCapacity', now), 10);
  assert.equal(stationMetric(row, 'storageCapacity', now), 30);
  assert.equal(stationMetric(row, 'solarPower', now), null);
  row.listSummary.telemetry = { measuredAt: '2026-10-08T11:59:00Z', solarPowerKw: 0, batteryPowerKw: -3, gridPowerKw: 8, batterySocPercent: 60 };
  assert.equal(stationMetric(row, 'solarPower', now), 0);
  assert.equal(stationMetric(row, 'batteryPower', now), -3);
  assert.equal(stationMetric(row, 'batterySoc', now), 60);
  assert.equal(stationMetric(row, 'chargedTotal', now), null);
  for (const measuredAt of ['2026-10-08T11:44:59Z', '2026-10-08T12:00:01Z', 'invalid']) {
    row.listSummary.telemetry.measuredAt = measuredAt;
    assert.equal(stationMetric(row, 'solarPower', now), null);
  }
});
