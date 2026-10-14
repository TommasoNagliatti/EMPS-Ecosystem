const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../domain/station-monitoring.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiled = new Module(filename, module);
compiled._compile(source, filename);
const m = compiled.exports;
const tz = 'America/Sao_Paulo';
const day = '2026-10-08';
const origin = m.midnight(day, tz);
function row(minutes, power, extra = {}) { return { measuredAt: new Date(origin + minutes * 60000).toISOString(), solarPowerKw: power, measurementQuality: 'GOOD', ...extra }; }

test('null, empty, and invalid numbers remain unknown, not zero', () => {
  for (const value of [null, undefined, '', false, 'invalid', Infinity]) assert.equal(m.numeric(value), null);
  assert.equal(m.numeric('0'), 0);
  assert.equal(m.numeric('1.25'), 1.25);
});
test('calendar windows use the station timezone, including UTC boundary', () => {
  assert.equal(new Date(origin).toISOString(), '2026-10-08T03:00:00.000Z');
  assert.equal(m.localDay(new Date('2026-10-09T02:30:00Z'), tz), day);
  const week = m.dateWindow(day, 'week', tz);
  assert.equal(week.first, '2026-10-05');
  assert.equal(week.end, '2026-10-12');
  assert.equal(m.dateWindow('2026-12-31', 'month', tz).end, '2027-01-01');
  assert.equal(m.dateWindow(day, 'year', tz).first, '2026-01-01');
});
test('DST windows do not assume every local day has 24 hours', () => {
  const spring = m.dateWindow('2026-03-08', 'day', 'America/New_York');
  assert.equal((spring.to - spring.from) / 3600000, 23);
});
test('readings sort, deduplicate, preserve missing fields and reject bad quality', () => {
  const points = m.normalizeReadings([row(15, '2'), row(0, null), row(15, '2'), row(30, 20, { measurementQuality: 'BAD' }), row(45, -1)], tz, origin);
  assert.equal(points.length, 4);
  assert.deepEqual(points.map(p => p.solar), [null, 2, null, null]);
  assert.equal(points[1].soc, null);
  assert.equal(points[1].importTariff, null);
});
test('separate charge and discharge fields take precedence over signed power', () => {
  const [point] = m.normalizeReadings([row(0, 0, { batteryChargePowerKw: '8', batteryDischargePowerKw: '2', batteryPowerKw: 99, batteryStateOfChargePercent: 101 })], tz, origin);
  assert.equal(point.battery, -6);
  assert.equal(point.soc, null);
});
test('integration covers only contiguous intervals with two known endpoints', () => {
  const points = m.normalizeReadings([row(0, 4), row(15, 4), row(60, 4), row(75, 4)], tz, origin);
  assert.deepEqual(m.integrate(points, 'solar'), { value: 2, hours: .5 });
  assert.equal(m.withGaps(points).length, 5);
  assert.equal(m.integrate([points[0]], 'solar').value, null);
});
test('known zero consumption is not confused with missing telemetry', () => {
  const points = m.normalizeReadings([row(0, 0), row(15, 0)], tz, origin);
  assert.equal(m.summarize(points).solar, 0);
  assert.equal(m.summarize(points).charger, null);
});
test('energy import/export and battery directions remain separate', () => {
  const points = m.normalizeReadings([row(0, 0, { gridPowerKw: -4, batteryPowerKw: -2 }), row(15, 0, { gridPowerKw: -4, batteryPowerKw: -2 })], tz, origin);
  const totals = m.summarize(points);
  assert.equal(totals.imported, 0); assert.equal(totals.exported, 1); assert.equal(totals.charge, .5);
  assert.deepEqual(m.batteryBands(points), [{ start: 0, end: 15, charging: true }]);
});
test('source keys prevent mixing physical, imported and simulated streams', () => {
  assert.notEqual(m.sourceKey({ sourceId: 'a', provenance: 'MEASURED' }), m.sourceKey({ sourceId: 'a', provenance: 'SIMULATED' }));
  assert.notEqual(m.sourceKey({ sourceId: 'a', provenance: 'MEASURED' }), m.sourceKey({ sourceId: 'b', provenance: 'MEASURED' }));
});

test('operational history excludes simulation without certifying other records as measured', () => {
  const measured = row(0, 2, { provenance: 'MEASURED' });
  const imported = row(15, 3, { provenance: 'IMPORTED' });
  const unknown = row(30, null);
  const simulated = [row(45, 80, { provenance: 'SIMULATED' }), row(60, 90, { source: { id: 'sim', kind: 'SIMULATED' } }), row(75, 100, { readingSource: 'SIMULATOR' })];
  assert.deepEqual([measured, imported, unknown, ...simulated].filter(m.isNonSimulatedReading), [measured, imported, unknown]);
  assert.equal(unknown.provenance, undefined);
  assert.equal(m.summarize(m.normalizeReadings(simulated.filter(m.isNonSimulatedReading), tz, origin)).solar, null);
});
test('visual example is deterministic, covers a full day and stays within SOC bounds', () => {
  const points = m.demoReadings(day, tz);
  assert.equal(points.length, 289); assert.equal(points[0].x, 0); assert.equal(points.at(-1).x, 1440);
  assert.ok(points.every(p => p.soc >= 0 && p.soc <= 100));
  assert.deepEqual(points, m.demoReadings(day, tz));
  assert.equal(m.dailyEnergy(points).length, 1);
  assert.equal(m.dailyEnergy(points)[0].solar, m.summarize(points).solar);
});

test('daily energy splits a short interval at local midnight without double counting', () => {
  const points = m.normalizeReadings([row(1435, 6), row(1445, 6)], tz, origin);
  const daily = m.dailyEnergy(points, tz);
  assert.equal(daily.length, 2);
  assert.equal(daily[0].day, day);
  assert.equal(daily[0].solar, .5);
  assert.equal(daily[1].day, '2026-10-09');
  assert.equal(daily[1].solar, .5);
  assert.equal(daily.reduce((total, item) => total + item.solar, 0), m.summarize(points).solar);
  assert.equal(m.dailyEnergy(m.normalizeReadings([row(1420, 6), row(1450, 6)], tz, origin), tz).length, 0);
});

test('energy charts keep every calendar day and preserve missing days as null', () => {
  const range = m.dateWindow(day, 'week', tz);
  const buckets = m.energyBuckets(m.normalizeReadings([row(0, 4), row(15, 4)], tz, origin), range, 'week', tz);
  assert.equal(buckets.length, 7);
  assert.equal(buckets[0].day, '2026-10-05');
  assert.equal(buckets[3].solar, 1);
  assert.equal(buckets[0].solar, null);
  assert.equal(buckets[3].load, null);
  assert.equal(buckets[6].day, '2026-10-11');
});

test('hour buckets split boundary intervals and conserve energy', () => {
  const points = m.normalizeReadings([row(55, 6), row(65, 6)], tz, origin);
  const buckets = m.energyBuckets(points, m.dateWindow(day, 'day', tz), 'day', tz);
  assert.equal(buckets.length, 24);
  assert.equal(buckets[0].solar, .5);
  assert.equal(buckets[1].solar, .5);
  assert.equal(buckets[2].solar, null);
  assert.equal(buckets.reduce((n, bucket) => n + (bucket.solar ?? 0), 0), m.summarize(points).solar);
});

test('year view uses twelve months including months without readings', () => {
  const buckets = m.energyBuckets(m.demoReadings(day, tz), m.dateWindow(day, 'year', tz), 'year', tz);
  assert.equal(buckets.length, 12);
  assert.equal(buckets[0].label, '01');
  assert.equal(buckets[9].label, '10');
  assert.ok(buckets[9].solar > 0);
  assert.equal(buckets[10].solar, null);
});

test('buckets retain zero, skip long gaps and separate import/export', () => {
  const points = m.normalizeReadings([row(0, 0, { gridPowerKw: -4 }), row(15, 0, { gridPowerKw: -4 }), row(90, 20)], tz, origin);
  const buckets = m.energyBuckets(points, m.dateWindow(day, 'day', tz), 'day', tz);
  assert.equal(buckets[0].solar, 0);
  assert.equal(buckets[0].exported, 1);
  assert.equal(buckets[0].imported, 0);
  assert.equal(buckets[1].solar, null);
});

test('period aggregation clips outside readings and includes the closing boundary only once', () => {
  const range = m.dateWindow(day, 'day', tz);
  const points = m.normalizeReadings([row(-5, 6), row(5, 6), row(1435, 6), row(1445, 6)], tz, origin);
  const buckets = m.energyBuckets(points, range, 'day', tz);
  assert.equal(buckets[0].solar, .5);
  assert.equal(buckets[23].solar, .5);
  assert.equal(buckets.reduce((sum, item) => sum + (item.solar ?? 0), 0), 1);
});

test('DST hour bins follow elapsed time without overflowing the local day', () => {
  const range = m.dateWindow('2026-03-08', 'day', 'America/New_York');
  const buckets = m.energyBuckets([], range, 'day', 'America/New_York');
  assert.equal(buckets.length, 23);
  assert.equal(buckets.at(-1).end, range.to);
  assert.equal(buckets.some(bucket => bucket.label === '02:00'), false);
});

test('generation comparison aligns calendar slots without inventing a previous value', () => {
  const current = m.energyBuckets(m.demoReadings(day, tz), m.dateWindow(day, 'year', tz), 'year', tz);
  const previousRange = m.previousMonitoringWindow(day, 'year', tz);
  assert.equal(previousRange.first, '2025-01-01');
  const previous = m.energyBuckets([], previousRange, 'year', tz);
  const result = m.compareGeneration(current, previous);
  assert.equal(result.length, 12);
  assert.equal(result[9].current, current[9].solar);
  assert.equal(result[9].previous, null);
  assert.equal(m.previousMonitoringWindow('2026-03-31', 'month', tz).first, '2026-02-01');
});
