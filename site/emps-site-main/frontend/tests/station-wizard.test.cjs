const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const cache = new Map();
function load(file) {
  const filename = path.resolve(__dirname, '../components/stations', file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const child = new Module(filename, module);
  child.filename = filename;
  child.paths = Module._nodeModulePaths(path.dirname(filename));
  const normalRequire = child.require.bind(child);
  child.require = name => {
    if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name === '@/services/emps-api') return { api: {}, empsApiUrl: 'http://localhost:3001' };
    if (name === '@/components/shell/AppShell') return { AppShell: ({ children }) => React.createElement('main', null, children) };
    if (name === '@/components/theme/ThemeProvider') return { useTheme: () => ({ theme: 'dark', setTheme() {} }) };
    if (name === 'next/link') return ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children);
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), name);
      for (const extension of ['.ts', '.tsx']) if (fs.existsSync(base + extension)) return load(path.relative(path.resolve(__dirname, '../components/stations'), base + extension));
    }
    return normalRequire(name);
  };
  cache.set(filename, child);
  child._compile(compiled, filename);
  return child.exports;
}

const { emptyDraft, draftFrom } = load('station-types.ts');
const { wizardSteps, newCharger, newBattery, newSolar, hasPosition, positionFromMapsLink, validateWizardDraft, wizardPayload, photoIssue } = load('station-wizard-model.ts');
const { persistWizardDraft } = load('station-wizard-save.ts');
function complete() {
  return { ...emptyDraft(), name: 'Estacao de teste', postalCode: '01001000', street: 'Rua de teste', city: 'Sao Paulo', state: 'SP', latitude: 0, longitude: 0,
    powerLimitKw: 22, chargers: [{ ...newCharger(1, 'TEST-1'), powerKw: 7.4 }] };
}
function station(draft = complete(), extras = {}) {
  return { ...draft, id: '7', photos: [], status: 'PENDING', reviewState: 'DRAFT', membershipRole: 'OWNER', technicalReviewRequired: false,
    amenities: draft.amenities.map(amenityName => ({ amenityName })), ...extras };
}

test('wizard has three steps and never invents power or storage values', () => {
  assert.deepEqual(wizardSteps, ['Localização', 'Equipamentos', 'Finalização']);
  assert.equal(newCharger(1, 'TEST').powerKw, undefined);
  assert.equal(newCharger(1, 'TEST').pricePerKwh, undefined);
  assert.equal(newCharger(1, 'TEST').administrativeStatus, 'PENDING');
  assert.equal(newBattery(1).capacityKwh, undefined);
  assert.equal(newBattery(1).maxChargeKw, undefined);
  assert.equal(newSolar(1).installedKwp, undefined);
});

test('position accepts zero but rejects missing, nonnumeric and out-of-range coordinates', () => {
  assert.equal(hasPosition({ latitude: 0, longitude: 0 }), true);
  for (const value of [{ latitude: 0 }, { latitude: '', longitude: '' }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: NaN, longitude: 0 }]) assert.equal(hasPosition(value), false);
});

test('long Maps links resolve locally without trusting unrelated or shortened hosts', () => {
  const expected = { latitude: -23.55, longitude: -46.63 };
  for (const link of ['https://www.google.com/maps/@-23.55,-46.63,17z', 'https://maps.google.com/?q=-23.55,-46.63', 'https://www.google.com.br/maps/search/?api=1&query=-23.55,-46.63', 'https://www.google.com/maps/place/Test/data=!3d-23.55!4d-46.63']) assert.deepEqual(positionFromMapsLink(link), expected);
  for (const link of ['https://maps.app.goo.gl/example', 'https://www.google.com.evil.test/maps/@0,0,1z', 'javascript:alert(1)', 'https://www.google.com/maps/@91,0,1z', 'https://www.google.com/maps/search/?q=some+address']) assert.equal(positionFromMapsLink(link), null);
});

test('drafts allow incomplete addresses but supplied data must be valid', () => {
  assert.equal(validateWizardDraft({ ...emptyDraft(), name: '' }), null);
  assert.equal(validateWizardDraft({ ...emptyDraft(), postalCode: '123' }).path, 'postalCode');
  assert.equal(validateWizardDraft({ ...emptyDraft(), state: 'S' }).path, 'state');
  assert.equal(validateWizardDraft({ ...emptyDraft(), timezone: 'bad/timezone' }).path, 'position');
  assert.equal(validateWizardDraft({ ...emptyDraft(), countryCode: '' }).path, 'position');
});

test('submission preserves the backend minimum instead of hiding missing requirements', () => {
  assert.equal(validateWizardDraft(complete(), true), null);
  for (const key of ['name', 'street', 'city', 'state', 'postalCode']) assert.equal(validateWizardDraft({ ...complete(), [key]: '' }, true).step, 0);
  assert.equal(validateWizardDraft({ ...complete(), latitude: undefined }, true).path, 'position');
  assert.equal(validateWizardDraft({ ...complete(), powerLimitKw: undefined }, true).path, 'powerLimitKw');
  assert.equal(validateWizardDraft({ ...complete(), chargers: [] }, true).path, 'chargers');
  assert.equal(validateWizardDraft({ ...complete(), chargers: [{ ...complete().chargers[0], administrativeStatus: 'DISABLED' }] }, true).path, 'chargers');
});

test('optional equipment still requires valid technical data when included', () => {
  assert.equal(validateWizardDraft({ ...complete(), batteries: [newBattery(1)] }).path, 'batteries.0');
  const battery = { ...newBattery(1), capacityKwh: 20, maxChargeKw: 5, maxDischargeKw: 5 };
  assert.equal(validateWizardDraft({ ...complete(), batteries: [battery] }), null);
  assert.equal(validateWizardDraft({ ...complete(), batteries: [{ ...battery, minSocPercent: 95, maxSocPercent: 10 }] }).path, 'batteries.0');
  assert.equal(validateWizardDraft({ ...complete(), solarAssets: [newSolar(1)] }).path, 'solarAssets.0');
  assert.equal(validateWizardDraft({ ...complete(), solarAssets: [{ ...newSolar(1), installedKwp: 10 }] }), null);
  assert.equal(validateWizardDraft({ ...complete(), chargers: [{ ...newCharger(1, 'TEST'), powerKw: -1 }] }).path, 'chargers.0');
});

test('availability accepts overnight hours and catches empty or invalid schedules', () => {
  assert.equal(validateWizardDraft({ ...complete(), availability: { alwaysOpen: false, windows: [{ day: 1, start: '19:00', end: '07:00' }] } }, true), null);
  assert.equal(validateWizardDraft({ ...complete(), availability: { alwaysOpen: false, windows: [] } }, true).path, 'availability');
  assert.equal(validateWizardDraft({ ...complete(), availability: { alwaysOpen: true, windows: [{ day: 9, start: '25:00', end: '00:00' }] } }).path, 'availability');
});

test('active edits send only changed fields and preserve collapsed integration metadata', () => {
  const source = station(complete(), { status: 'ACTIVE', chargers: [{ ...complete().chargers[0], id: 4, serialNumber: 'SN-1', firmwareVersion: '1.2', manufacturer: 'Test', tariffs: [] }] });
  const baseline = draftFrom(source);
  assert.deepEqual(wizardPayload({ ...baseline, name: 'Outro nome' }, baseline, true), { name: 'Outro nome' });
  assert.equal(wizardPayload(baseline, baseline, true).chargers, undefined);
  assert.equal(baseline.chargers[0].serialNumber, 'SN-1');
  assert.equal(baseline.chargers[0].firmwareVersion, '1.2');
});

test('photo checks use the existing formats and eight megabyte limit', () => {
  assert.equal(photoIssue({ type: 'image/png', size: 8 * 1024 * 1024 }), null);
  assert.ok(photoIssue({ type: 'image/png', size: 8 * 1024 * 1024 + 1 }));
  assert.ok(photoIssue({ type: 'image/svg+xml', size: 1 }));
});

test('save pipeline finishes photos before PATCH, then submits and reloads the result', async () => {
  const calls = [], acknowledged = [];
  const row = station();
  const photo = new File(['image fixture'], 'fixture.png', { type: 'image/png' });
  const result = await persistWizardDraft({ stationId: '7', station: null, draft: complete(), photos: { 0: photo }, submit: true,
    request: async (url, init = {}) => { calls.push([url, init.method ?? 'GET', init.body]); return row; },
    onPhotoSaved: position => acknowledged.push(position) });
  assert.deepEqual(calls.map(([url, method]) => [url, method]), [['/v2/stations/7/photos', 'POST'], ['/v2/stations/7', 'PATCH'], ['/v2/stations/7/submit', 'POST'], ['/v2/stations/7', 'GET']]);
  assert.deepEqual(acknowledged, [0]);
  assert.equal(calls[0][2].get('position'), '0');
  assert.deepEqual(JSON.parse(calls[1][2]), complete());
  assert.equal(result, row);
});

test('failed photos stop submission and remain available for retry', async () => {
  const calls = [], acknowledged = [];
  await assert.rejects(persistWizardDraft({ stationId: '7', station: null, draft: complete(), photos: { 0: new File(['fixture'], 'test.png', { type: 'image/png' }) }, submit: true,
    request: async url => { calls.push(url); throw new Error('Upload failed'); }, onPhotoSaved: position => acknowledged.push(position) }), /Upload failed/);
  assert.deepEqual(calls, ['/v2/stations/7/photos']);
  assert.deepEqual(acknowledged, []);
});

test('failed PATCH never sends a station for review', async () => {
  const calls = [];
  await assert.rejects(persistWizardDraft({ stationId: '7', station: null, draft: complete(), photos: {}, submit: true,
    request: async (url, init) => { calls.push([url, init.method]); throw new Error('Invalid configuration'); }, onPhotoSaved: () => {} }), /Invalid configuration/);
  assert.deepEqual(calls, [['/v2/stations/7', 'PATCH']]);
});

test('new form renders three navigation actions without the old progress or six tabs', () => {
  const { StationWizard } = load('StationWizard.tsx');
  const markup = renderToStaticMarkup(React.createElement(StationWizard));
  assert.equal((markup.match(/class="stepNumber"/g) ?? []).length, 3);
  assert.ok(!markup.includes('<progress'));
  assert.ok(!markup.includes('Salvar rascunho / alterações'));
  assert.ok(markup.includes('Nome da instalação'));
  assert.ok(markup.includes('Posição e região'));
  assert.ok(markup.includes('Mapa da instalação'));
  assert.ok(markup.includes('Localização do eletroposto'));
});

const { mapPosition, pickedPosition, createStationLocationMap, stationMapStyle } = load('station-location-map.ts');

function mapHarness(position = null, disabled = false, theme = 'dark') {
  const points = [], statuses = [], markers = [];
  let map;
  class FakeMap {
    constructor(options) { this.options = options; this.events = {}; this.zoom = options.zoom; this.center = { lng: options.center[0], lat: options.center[1] }; this.touchZoomRotate = { disableRotation() {} }; map = this; }
    addControl() {}
    on(name, callback) { this.events[name] = callback; }
    getZoom() { return this.zoom; }
    getCenter() { return this.center; }
    jumpTo(options) { this.center = { lng: options.center[0], lat: options.center[1] }; this.zoom = options.zoom; this.jumped = true; }
    resize() { this.resized = true; }
    setStyle(style) { this.styles = [...(this.styles ?? []), style]; }
    remove() { this.removed = (this.removed ?? 0) + 1; }
  }
  class FakeMarker {
    constructor(options) { this.options = options; this.events = {}; markers.push(this); }
    getElement() { return { setAttribute() {} }; }
    on(name, callback) { this.events[name] = callback; }
    setLngLat(pair) { this.point = { lng: pair[0], lat: pair[1] }; return this; }
    addTo() { return this; }
    getLngLat() { return this.point; }
    setDraggable(value) { this.draggable = value; }
    remove() { this.removed = true; }
  }
  const controller = createStationLocationMap({ Map: FakeMap, Marker: FakeMarker, NavigationControl: class {}, AttributionControl: class {} }, {},
    { position, disabled, theme, onPosition: point => points.push(point), onStatus: status => statuses.push(status) });
  return { controller, map, markers, points, statuses };
}

test('map uses the app provider, accepts zero and never assigns the overview as station position', () => {
  assert.equal(stationMapStyle, 'https://tiles.openfreemap.org/styles/liberty');
  assert.deepEqual(mapPosition(0, 0), { latitude: 0, longitude: 0 });
  assert.equal(mapPosition(undefined, undefined), null);
  assert.equal(mapPosition('0', 0), null);
  assert.equal(mapPosition(91, 0), null);
  const h = mapHarness();
  assert.equal(h.markers.length, 0);
  assert.deepEqual(h.points, []);
  assert.equal(h.map.options.scrollZoom, true);
  assert.equal(h.map.options.cooperativeGestures, false);
  assert.deepEqual(pickedPosition(190, -23.12345678), { longitude: -170, latitude: -23.123457 });
  assert.equal(pickedPosition(Infinity, 0), null);
});

test('map click, drag and center selection update draft coordinates without saving or camera jumps', () => {
  const h = mapHarness();
  h.map.events.click({ lngLat: { lng: -46.63, lat: -23.55 } });
  assert.deepEqual(h.points[0], { longitude: -46.63, latitude: -23.55 });
  h.controller.update(h.points[0], false);
  assert.equal(h.map.jumped, undefined);
  h.markers[0].setLngLat([-46.64, -23.56]);
  h.markers[0].events.dragend();
  assert.deepEqual(h.points[1], { longitude: -46.64, latitude: -23.56 });
  h.controller.selectCenter();
  assert.equal(h.points.length, 3);
});

test('wheel zoom needs no modifier and remains available for read-only maps in both themes', () => {
  for (const theme of ['light', 'dark']) {
    const h = mapHarness(null, true, theme);
    assert.equal(h.map.options.scrollZoom, true);
    assert.equal(h.map.options.cooperativeGestures, false);
    h.controller.selectCenter();
    assert.deepEqual(h.points, []);
    h.controller.destroy();
  }
});

test('center selection uses the current camera, preserving its zoom and normalizing coordinates', () => {
  const h = mapHarness();
  h.map.jumpTo({ center: [190, -23.12345678], zoom: 10 });
  h.controller.selectCenter();
  assert.deepEqual(h.points, [{ longitude: -170, latitude: -23.123457 }]);
  assert.equal(h.map.getZoom(), 10);
  assert.equal(h.markers.length, 1);
  h.controller.update(h.points[0], false);
  assert.equal(h.map.getZoom(), 10);
  h.controller.destroy();
});

test('external position changes synchronize the pin and clearing position removes it', () => {
  const h = mapHarness();
  h.controller.update({ latitude: 0, longitude: 0 }, false);
  assert.deepEqual(h.map.center, { lng: 0, lat: 0 });
  assert.equal(h.map.zoom, 15);
  assert.deepEqual(h.points, []);
  h.controller.update(null, false);
  assert.equal(h.markers[0].removed, true);
});

test('read-only, load failure, resize and disposal do not permit location mutations', () => {
  const h = mapHarness({ latitude: 0, longitude: 0 }, true);
  h.map.events.click({ lngLat: { lng: 1, lat: 1 } });
  h.controller.selectCenter();
  assert.equal(h.points.length, 0);
  h.map.events.error(); h.map.events.load(); h.map.events.error();
  assert.deepEqual(h.statuses, ['error', 'ready', 'partial']);
  h.controller.update({ latitude: 0, longitude: 0 }, false);
  assert.equal(h.markers[0].draggable, true);
  h.controller.resize(); assert.equal(h.map.resized, true);
  h.controller.destroy(); h.controller.destroy();
  assert.equal(h.map.removed, 1);
  h.map.events.click({ lngLat: { lng: 1, lat: 1 } });
  assert.equal(h.points.length, 0);
});

test('map starts dark and changing theme preserves the pin, coordinates and camera', () => {
  const h = mapHarness({ latitude: -23.55, longitude: -46.63 });
  assert.equal(h.map.options.style, 'https://tiles.openfreemap.org/styles/dark');
  const center = { ...h.map.center }, zoom = h.map.zoom;
  h.controller.setTheme('light');
  h.map.events['style.load']();
  assert.deepEqual(h.map.styles, [stationMapStyle]);
  assert.deepEqual(h.statuses, ['loading', 'ready']);
  assert.deepEqual(h.map.center, center);
  assert.equal(h.map.zoom, zoom);
  assert.equal(h.map.jumped, undefined);
  assert.equal(h.markers.length, 1);
  assert.equal(h.markers[0].removed, undefined);
  assert.deepEqual(h.points, []);
  h.controller.setTheme('light');
  assert.equal(h.map.styles.length, 1);
  h.controller.setTheme('dark');
  assert.equal(h.map.styles[1], 'https://tiles.openfreemap.org/styles/dark');
});

test('theme changes never enable read-only selection or recreate a disposed map', () => {
  const h = mapHarness({ latitude: 0, longitude: 0 }, true, 'light');
  assert.equal(h.map.options.style, stationMapStyle);
  h.controller.setTheme('dark');
  h.controller.selectCenter();
  assert.deepEqual(h.points, []);
  h.controller.destroy();
  h.controller.setTheme('light');
  h.map.events['style.load']();
  assert.equal(h.map.styles.length, 1);
  assert.deepEqual(h.statuses, ['loading']);
});

test('a style-switch failure surfaces an error without clearing the position', () => {
  const h = mapHarness({ latitude: 0, longitude: 0 });
  h.map.setStyle = () => { throw new Error('Unavailable'); };
  h.controller.setTheme('light');
  assert.deepEqual(h.statuses, ['loading', 'error']);
  assert.equal(h.markers[0].removed, undefined);
  assert.deepEqual(h.points, []);
});
