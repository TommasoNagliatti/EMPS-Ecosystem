const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function harness() {
  let state, cleanup, dependencies, pendingEffect;
  const requests = [];
  const react = {
    useState(initial) {
      if (state === undefined) state = initial;
      return [state, value => { state = value; }];
    },
    useEffect(callback, next) {
      if (!dependencies || next.some((value, i) => value !== dependencies[i])) {
        pendingEffect = () => { cleanup?.(); cleanup = callback(); dependencies = next; };
      }
    },
  };
  const api = { platform(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); } };
  const filename = path.resolve(__dirname, '../components/dashboard/use-station-history.ts');
  const compiled = new Module(filename, module);
  compiled.require = name => name === 'react' ? react : name === '@/services/emps-api' ? { api } : require(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return {
    render: (...args) => compiled.exports.useStationHistory(...args), requests,
    flush() { const effect = pendingEffect; pendingEffect = null; effect?.(); },
    dispose() { cleanup?.(); },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('changing date or refresh key hides old totals before the new effect starts', async () => {
  const h = harness();
  assert.equal(h.render('station-1', 1000, 2000, 0).loading, true);
  h.flush();
  const reading = { measuredAt: '2026-10-08T12:00:00Z', solarPowerKw: 10 };
  h.requests[0].resolve([reading]);
  await settle();
  assert.deepEqual(h.render('station-1', 1000, 2000, 0).rows, [reading]);
  assert.deepEqual(h.render('station-1', 3000, 4000, 0).rows, []);
  assert.equal(h.render('station-1', 3000, 4000, 0).loading, true);
  assert.deepEqual(h.render('station-1', 1000, 2000, 1).rows, []);
  h.dispose();
});
test('late response from a previous date cannot overwrite the current date', async () => {
  const h = harness();
  h.render('station-1', 1000, 2000, 0); h.flush();
  h.render('station-1', 3000, 4000, 0); h.flush();
  assert.equal(h.requests[0].options.signal.aborted, true);
  const current = { measuredAt: '2026-10-09T12:00:00Z', solarPowerKw: 2 };
  h.requests[1].resolve([current]); await settle();
  h.requests[0].resolve([{ measuredAt: '2026-10-08T12:00:00Z', solarPowerKw: 99 }]); await settle();
  assert.deepEqual(h.render('station-1', 3000, 4000, 0).rows, [current]);
  h.dispose();
});
