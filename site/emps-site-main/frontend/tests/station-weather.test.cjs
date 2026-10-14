const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const modules = new Map();
function load(name) {
  const filename = path.resolve(__dirname, `../domain/${name}.ts`);
  if (modules.has(filename)) return modules.get(filename).exports;
  const compiled = new Module(filename, module);
  compiled.paths = module.paths;
  const baseRequire = compiled.require.bind(compiled);
  compiled.require = request => request === './station-monitoring' ? load('station-monitoring') : baseRequire(request);
  modules.set(filename, compiled);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return compiled.exports;
}
const m = load('station-weather');
const tz = 'America/Sao_Paulo';
const start = Date.parse('2026-10-09T03:00:00Z') / 1000;
function fixture() {
  return { current: { time: start + 36000, temperature_2m: 25, relative_humidity_2m: 79, wind_speed_10m: 6.5, weather_code: 51, is_day: 1 },
    daily: { time: [start, start + 86400], weather_code: [95, 3], temperature_2m_min: [18.8, 19.5], temperature_2m_max: [32.5, 28.8],
      sunrise: [start + 20000, start + 86400 + 20000], sunset: [start + 65000, start + 86400 + 65000],
      wind_speed_10m_max: [11.2, 18.4], relative_humidity_2m_mean: [84, 86] } };
}

test('location keys validate boundaries, preserve zero and avoid exact coordinates', () => {
  assert.equal(m.weatherLocationKey(-23.5645, -46.6523, tz), '-23.56,-46.65,America/Sao_Paulo');
  assert.equal(m.weatherLocationKey(0, 0, 'UTC'), '0.00,0.00,UTC');
  for (const [lat, lon] of [[null, 0], [0, ''], [91, 0], [0, -181], [Infinity, 0]]) assert.equal(m.weatherLocationKey(lat, lon, tz), '');
  assert.notEqual(m.weatherLocationKey(0, 0, tz), m.weatherLocationKey(0, 0, 'UTC'));
});
test('query requests five days, timezone, explicit units and needed metrics', () => {
  const query = m.weatherQuery(m.weatherLocationKey(0, 0, tz));
  assert.equal(query.get('forecast_days'), '5');
  assert.equal(query.get('timezone'), tz);
  assert.equal(query.get('timeformat'), 'unixtime');
  assert.equal(query.get('wind_speed_unit'), 'kmh');
  for (const name of ['sunrise', 'sunset', 'temperature_2m_min', 'temperature_2m_max', 'relative_humidity_2m_mean', 'wind_speed_10m_max']) assert.ok(query.get('daily').split(',').includes(name));
});
test('current and daily metrics remain distinct and timestamps use station day', () => {
  const result = m.parseWeather(fixture(), tz);
  assert.equal(result.time, (start + 36000) * 1000);
  assert.equal(result.days[0].day, '2026-10-09');
  assert.equal(result.days[1].day, '2026-10-10');
  assert.equal(result.days[0].sunrise, (start + 20000) * 1000);
  assert.equal(result.humidity, 79); assert.equal(result.days[0].humidity, 84);
  assert.equal(result.wind, 6.5); assert.equal(result.days[0].wind, 11.2);
  assert.equal(result.code, 51); assert.equal(result.days[0].code, 95);
});
test('partial responses keep absent data unknown instead of inventing zero', () => {
  const result = m.parseWeather({ current: { time: start }, daily: { time: [start] } }, tz);
  for (const key of ['temperature', 'humidity', 'wind', 'code']) assert.equal(result[key], null);
  for (const key of ['minimum', 'maximum', 'sunrise', 'sunset', 'humidity', 'wind', 'code']) assert.equal(result.days[0][key], null);
  assert.deepEqual(m.parseWeather({ current: { time: start } }, tz).days, []);
});
test('invalid current timestamps reject the response', () => {
  for (const time of [null, undefined, '', -1, Infinity, 9e15]) assert.throws(() => m.parseWeather({ current: { time } }, tz));
});
test('invalid ranges and weather metrics are excluded while known zero stays valid', () => {
  const body = fixture();
  Object.assign(body.current, { relative_humidity_2m: 101, wind_speed_10m: -1, weather_code: 900 });
  Object.assign(body.daily, { temperature_2m_min: [40, 0], temperature_2m_max: [30, 10], relative_humidity_2m_mean: [-2, 0], wind_speed_10m_max: [-1, 0], sunrise: [null, null] });
  const result = m.parseWeather(body, tz);
  for (const key of ['humidity', 'wind', 'code']) assert.equal(result[key], null);
  assert.equal(result.days[0].minimum, null); assert.equal(result.days[0].maximum, null);
  assert.equal(result.days[0].humidity, null); assert.equal(result.days[0].sunrise, null);
  assert.equal(result.days[1].minimum, 0); assert.equal(result.days[1].humidity, 0); assert.equal(result.days[1].wind, 0);
});
test('days are sorted, deduplicated, limited to five and exclude past or invalid times', () => {
  const body = fixture();
  body.daily = { time: [start - 86400, null, start + 86400, start, start, ...Array.from({ length: 7 }, (_, i) => start + (i + 2) * 86400)] };
  const result = m.parseWeather(body, tz);
  assert.equal(result.days.length, 5);
  assert.deepEqual(result.days.map(day => day.day), ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']);
});
test('condition labels distinguish cloud, fog, drizzle, rain, snow and storms', () => {
  assert.equal(m.weatherLabel(3), 'Nublado'); assert.equal(m.weatherLabel(51), 'Garoa');
  for (const [code, kind] of [[0, 'clear'], [2, 'partly'], [45, 'fog'], [63, 'rain'], [80, 'rain'], [71, 'snow'], [85, 'snow'], [95, 'storm'], [null, 'unknown']]) assert.equal(m.weatherKind(code), kind);
});
