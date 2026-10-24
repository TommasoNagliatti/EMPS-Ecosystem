const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(file) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = new Module(filename, module);
  compiled.paths = module.paths;
  const original = compiled.require.bind(compiled);
  compiled.require = request => request.endsWith('.module.css') ? new Proxy({}, { get: (_, key) => String(key) })
    : request === '@/domain/station-monitoring' ? load('domain/station-monitoring.ts')
    : request === '@/components/ui/Popover' ? load('components/ui/Popover.tsx') : original(request);
  cache.set(filename, compiled);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return compiled.exports;
}
const m = load('domain/station-monitoring.ts');
const { DateControl } = load('components/dashboard/DateControl.tsx');
const tz = 'America/Sao_Paulo';

test('calendar input accepts only real four-digit dates and rejects empty or normalized invalid dates', () => {
  for (const day of ['', '2026-2-01', '2026-02-30', '2025-02-29', '2026-13-01', '0001-01-01']) assert.equal(m.isCalendarDay(day), false);
  for (const day of ['2024-02-29', '2026-10-08', '1000-01-01']) assert.equal(m.isCalendarDay(day), true);
});
test('arrows move by selected day or week and respect the current period', () => {
  assert.equal(m.moveMonitoringDay('2026-10-08', 'day', -1, '2026-10-09'), '2026-10-07');
  assert.equal(m.moveMonitoringDay('2026-10-08', 'week', -1, '2026-10-09'), '2026-10-01');
  assert.equal(m.moveMonitoringDay('2026-10-01', 'week', 1, '2026-10-09'), '2026-10-08');
});
test('month and year navigation clamps month ends and leap dates', () => {
  assert.equal(m.moveMonitoringDay('2026-03-31', 'month', -1, '2026-10-09'), '2026-02-28');
  assert.equal(m.moveMonitoringDay('2024-01-31', 'month', 1, '2026-10-09'), '2024-02-29');
  assert.equal(m.moveMonitoringDay('2024-02-29', 'year', 1, '2026-10-09'), '2025-02-28');
  assert.equal(m.moveMonitoringDay('2025-12-31', 'month', 1, '2026-10-09'), '2026-01-31');
});
test('next permits the incomplete current period without accepting future periods', () => {
  assert.equal(m.moveMonitoringDay('2026-09-30', 'month', 1, '2026-10-09'), '2026-10-09');
  assert.equal(m.moveMonitoringDay('2025-12-31', 'year', 1, '2026-10-09'), '2026-10-09');
  for (const period of ['day', 'week', 'month', 'year']) assert.equal(m.moveMonitoringDay('2026-10-09', period, 1, '2026-10-09'), null);
  assert.equal(m.moveMonitoringDay('2026-10-10', 'day', -1, '2026-10-09'), null);
});
test('calendar navigation rejects invalid dates and cannot go before its input minimum', () => {
  assert.equal(m.moveMonitoringDay('2026-02-30', 'day', -1, '2026-10-09'), null);
  assert.equal(m.moveMonitoringDay('1000-01-01', 'day', -1, '2026-10-09'), null);
});
test('shared control renders calendar, two period arrows and the selected period menu trigger', () => {
  const html = renderToStaticMarkup(React.createElement(DateControl, { day: '2026-10-08', period: 'month', timezone: tz, label: 'Visão geral', onDay() {}, onPeriod() {} }));
  assert.match(html, /type="date"/);
  assert.match(html, /value="2026-10-08"/);
  assert.match(html, /aria-label="Visão geral: período anterior"/);
  assert.match(html, /aria-label="Visão geral: próximo período"/);
  assert.match(html, /aria-label="Visão geral: período"/);
  assert.match(html, /<span>Mês<\/span>/);
  assert.match(html, /aria-haspopup="dialog"/);
});
test('overview, chart and consumption render the same state with distinct accessible labels', () => {
  const date = m.localDay(new Date(), tz);
  for (const label of ['Visão geral', 'Histórico', 'Consumo']) {
    const html = renderToStaticMarkup(React.createElement(DateControl, { day: date, period: 'day', timezone: tz, label, onDay() {}, onPeriod() {} }));
    assert.ok(html.includes(`aria-label="${label}: data"`));
    assert.ok(html.includes(`max="${date}"`));
    assert.match(html, new RegExp(`aria-label="${label}: próximo período"[^>]*disabled=""`));
  }
});
test('manual input and calendar change apply only valid non-future dates', () => {
  const calls = [];
  const tree = DateControl({ day: '2026-10-08', period: 'day', timezone: tz, label: 'Visão geral', onDay: value => calls.push(value), onPeriod() {} });
  const input = tree.props.children[0].props.children[1];
  input.props.onInput({ currentTarget: { value: '2024-02-29' } });
  input.props.onChange({ target: { value: '2025-09-30' } });
  for (const value of ['', '2025-02-29', '9999-01-01']) input.props.onInput({ currentTarget: { value } });
  assert.deepEqual(calls, ['2024-02-29', '2025-09-30']);
});
