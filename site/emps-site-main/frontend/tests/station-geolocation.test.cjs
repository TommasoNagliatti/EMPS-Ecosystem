const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function load(filename) {
  const child = new Module(filename, module);
  child.filename = filename;
  child.paths = Module._nodeModulePaths(path.dirname(filename));
  const normalRequire = child.require.bind(child);
  child.require = name => name.startsWith('.') ? load(path.resolve(path.dirname(filename), `${name}.ts`)) : normalRequire(name);
  child._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  return child.exports;
}
const { createStationGeolocation, locationFailureMessages } = load(path.resolve(__dirname, '../components/stations/station-geolocation.ts'));

function harness() {
  const requests = [], positions = [], failures = [], pending = [];
  const controller = createStationGeolocation({
    onPosition: point => positions.push(point), onFailure: failure => failures.push(failure), onPending: value => pending.push(value),
  });
  const geolocation = { getCurrentPosition(success, error, options) { requests.push({ success, error, options }); } };
  return { controller, geolocation, requests, positions, failures, pending, start() { controller.locate({ geolocation, secureContext: true }); } };
}
const point = (latitude = 0, longitude = 0) => ({ coords: { latitude, longitude } });

test('location uses standard accuracy, a recent cache and a longer browser timeout', () => {
  const h = harness(); h.start();
  assert.deepEqual(h.requests[0].options, { enableHighAccuracy: false, timeout: 20_000, maximumAge: 60_000 });
  h.requests[0].success(point());
  assert.deepEqual(h.positions, [{ latitude: 0, longitude: 0 }]);
  assert.deepEqual(h.pending, [true, false]);
  assert.deepEqual(h.failures, [null]);
  h.controller.dispose();
});

for (const [code, expected] of [[1, 'permission-denied'], [2, 'unavailable'], [3, 'timeout'], [99, 'unavailable']]) {
  test(`location error ${code} has an actionable message and never invents a position`, () => {
    const h = harness(); h.start(); h.requests[0].error({ code });
    assert.equal(h.failures.at(-1), expected);
    assert.ok(locationFailureMessages[expected].includes('mapa'));
    assert.deepEqual(h.positions, []);
    assert.deepEqual(h.pending, [true, false]);
    assert.equal(h.requests.length, 1);
    h.controller.dispose();
  });
}

test('insecure or unsupported browsers finish without requesting location', () => {
  const h = harness();
  h.controller.locate({ geolocation: h.geolocation, secureContext: false });
  assert.equal(h.failures.at(-1), 'insecure');
  h.controller.locate({ secureContext: true });
  assert.equal(h.failures.at(-1), 'unsupported');
  assert.deepEqual(h.requests, []); assert.deepEqual(h.pending, []);
  h.controller.dispose();
});

test('invalid and nonnumeric browser positions are rejected without changing the draft', () => {
  for (const coords of [point(91, 0), point(0, -181), point(NaN, 0), point(0, Infinity), point('0', 0)]) {
    const h = harness(); h.start(); h.requests[0].success(coords);
    assert.deepEqual(h.positions, []); assert.equal(h.failures.at(-1), 'unavailable');
    h.controller.dispose();
  }
});

test('synchronous browser exceptions release loading and preserve error meaning', () => {
  for (const name of ['SecurityError', 'NotAllowedError', 'Error']) {
    const h = harness(); const error = new Error('Provider failed'); error.name = name;
    h.controller.locate({ secureContext: true, geolocation: { getCurrentPosition() { throw error; } } });
    assert.deepEqual(h.pending, [true, false]);
    assert.equal(h.failures.at(-1), name === 'Error' ? 'unavailable' : 'permission-denied');
    h.controller.dispose();
  }
});

test('duplicate clicks do not create concurrent requests', () => {
  const h = harness(); h.start(); h.start();
  assert.equal(h.requests.length, 1); assert.deepEqual(h.pending, [true]);
  h.controller.dispose();
});

test('cancel and manual selection ignore late success and failure callbacks', () => {
  const h = harness(); h.start(); h.controller.cancel();
  h.requests[0].success(point()); h.requests[0].error({ code: 1 });
  assert.deepEqual(h.positions, []); assert.deepEqual(h.failures, [null]);
  assert.deepEqual(h.pending, [true, false]);
  h.controller.dispose();
});

test('retry accepts only the latest result and does not let an old error stop it', () => {
  const h = harness(); h.start(); h.controller.cancel(); h.start();
  h.requests[0].error({ code: 1 }); h.requests[0].success(point(1, 1));
  assert.deepEqual(h.pending, [true, false, true]);
  h.requests[1].success(point(2, 2));
  assert.deepEqual(h.positions, [{ latitude: 2, longitude: 2 }]);
  assert.deepEqual(h.pending, [true, false, true, false]);
  h.controller.dispose();
});

test('unmount disposal never notifies React or accepts callbacks again', () => {
  const h = harness(); h.start(); h.controller.dispose(); h.controller.dispose(); h.start();
  h.requests[0].success(point()); h.requests[0].error({ code: 2 });
  assert.deepEqual(h.pending, [true]); assert.deepEqual(h.positions, []);
  assert.deepEqual(h.failures, [null]); assert.equal(h.requests.length, 1);
});

test('a silent browser is bounded by the UI deadline and late callbacks stay ignored', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); h.start(); t.mock.timers.tick(29_999);
  assert.deepEqual(h.pending, [true]);
  t.mock.timers.tick(1);
  assert.deepEqual(h.pending, [true, false]); assert.equal(h.failures.at(-1), 'timeout');
  h.requests[0].success(point()); assert.deepEqual(h.positions, []);
  h.controller.dispose();
});

test('cancel clears the UI deadline and leaves the form editable', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); h.start(); h.controller.cancel(); t.mock.timers.tick(30_000);
  assert.deepEqual(h.pending, [true, false]); assert.deepEqual(h.failures, [null]);
  h.controller.dispose();
});

test('a completed request cannot deliver twice or later show a timeout', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); h.start(); h.requests[0].success(point());
  h.requests[0].success(point(1, 1)); h.requests[0].error({ code: 3 }); t.mock.timers.tick(30_000);
  assert.deepEqual(h.positions, [{ latitude: 0, longitude: 0 }]);
  assert.deepEqual(h.failures, [null]); assert.deepEqual(h.pending, [true, false]);
  h.controller.dispose();
});
