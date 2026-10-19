const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');

function load(relative, mocks = {}, cache = new Map()) {
  let filename = path.resolve(root, relative);
  if (!path.extname(filename)) filename += fs.existsSync(`${filename}.ts`) ? '.ts' : '.tsx';
  if (cache.has(filename)) return cache.get(filename).exports;
  const child = new Module(filename, module);
  child.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, child);
  const original = child.require.bind(child);
  child.require = specifier => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier.endsWith('.css')) return { __esModule: true, default: {} };
    if (specifier.startsWith('@/')) return load(specifier.slice(2), mocks, cache);
    return original(specifier);
  };
  child._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return child.exports;
}

const domain = load('domain/maquete-lab.ts');
const baseDevice = {
  available: true, bound: true, stationId: 46, deviceId: 'maquete-01', connectionSource: 'SIMULATOR', connected: true,
  lastHeartbeatAt: '2026-10-18T12:00:00Z',
  evses: {
    EV1: { state: 'AVAILABLE', relayActive: false, pendingCommandId: null, lastCommandId: null, lastCommandStatus: null, lastAckAt: null },
    EV2: { state: 'AVAILABLE', relayActive: false, pendingCommandId: null, lastCommandId: null, lastCommandStatus: null, lastAckAt: null },
  },
  gie: { valid: true, scenarioAt: '2025-12-31T12:00:00Z', gridKw: 8, solarKw: 3, bat01Soc: 45, bat02Soc: 65 },
};
const command = { id: 'cmd-1', evse: 'EV1', enabled: true, status: 'PENDING', expiresAt: new Date(Date.now() + 60_000).toISOString() };

test('EV1 and EV2 are independent; offline is not a hardware fault or an active relay', () => {
  const charging = { ...baseDevice, evses: { ...baseDevice.evses,
    EV1: { ...baseDevice.evses.EV1, state: 'CHARGING', relayActive: true } } };
  assert.deepEqual(domain.labEvsePresentation(charging, 'EV1', true), {
    label: 'Recarga USB de teste autorizada', canStart: false, canStop: true, relay: 'Relé ativo · nível baixo',
  });
  assert.equal(domain.labEvsePresentation(charging, 'EV2', true).canStart, true);
  for (const offline of [{ ...charging, connected: false }, charging]) {
    const result = domain.labEvsePresentation(offline, 'EV1', offline.connected ? false : true);
    assert.equal(result.canStart, false);
    assert.equal(result.canStop, true);
    assert.match(result.label, /Sem conexão/);
    assert.doesNotMatch(result.label, /Falha|Quebrado/);
  }
  const fault = { ...baseDevice, evses: { ...baseDevice.evses,
    EV1: { ...baseDevice.evses.EV1, state: 'FAULT' } } };
  assert.match(domain.labEvsePresentation(fault, 'EV1', true).label, /Falha reportada/);
  assert.equal(domain.labEvsePresentation(fault, 'EV2', true).canStart, true);
});

test('a queued command is not called confirmed until its matching ACK and relay state arrive', () => {
  assert.match(domain.labCommandFeedback(baseDevice, command, true), /Aguardando confirmação/);
  const pending = { ...baseDevice, evses: { ...baseDevice.evses, EV1: {
    ...baseDevice.evses.EV1, state: 'PENDING', pendingCommandId: 'cmd-1', lastCommandId: 'cmd-1', lastCommandStatus: 'DELIVERED',
  } } };
  assert.match(domain.labCommandFeedback(pending, command, true), /aguardando ACK/);
  const acked = { ...baseDevice, evses: { ...baseDevice.evses, EV1: {
    ...baseDevice.evses.EV1, state: 'CHARGING', relayActive: true, lastCommandId: 'cmd-1', lastCommandStatus: 'ACKED',
  } } };
  assert.match(domain.labCommandFeedback(acked, command, true), /EV1=1 confirmado/);
  assert.match(domain.labCommandFeedback(acked, command, true), /simulador local \(sem GPIO\)/);
  assert.match(domain.labCommandFeedback({ ...acked, connectionSource: 'FIRMWARE' }, command, true), /firmware ESP32 \(nível lógico do GPIO\)/);
  assert.match(domain.labCommandFeedback({ ...acked, evses: { ...acked.evses, EV1: { ...acked.evses.EV1, relayActive: false } } }, command, true), /estado do relé não corresponde/);
  assert.match(domain.labCommandFeedback({ ...acked, connected: false }, command, true), /ainda não confirmado/);
  assert.match(domain.labCommandFeedback({ ...acked, connected: false }, { ...command, enabled: false }, true), /autorização revogada/);
  assert.match(domain.labCommandFeedback({ ...acked, evses: { ...acked.evses, EV1: { ...acked.evses.EV1, lastCommandStatus: 'EXPIRED' } } }, command, true), /expirado/);
  assert.equal(domain.labCommandAwaiting(pending, command, 'EV1', Date.now()), true);
  assert.equal(domain.labCommandAwaiting(pending, command, 'EV2', Date.now()), false);
  assert.equal(domain.labCommandAwaiting(acked, command, 'EV1', Date.now()), false);
});

test('device panel stays scoped to the bound station and shows read-only diagnostics', () => {
  let index = 0;
  const values = [baseDevice, Date.now(), Date.now(), ''];
  const hooks = { ...React, useState: initial => [values[index++] ?? (typeof initial === 'function' ? initial() : initial), () => {}],
    useEffect: () => {} };
  const { MaqueteLabControls } = load('components/chargers/MaqueteLabControls.tsx', {
    react: hooks, '@/services/emps-api': { api: { platform: async (url, init) => {
      return baseDevice;
    } } },
  });
  const html = renderToStaticMarkup(React.createElement(MaqueteLabControls, { stationId: '46' }));
  assert.match(html, /maquete-01 · vinculada à instalação 46/);
  assert.match(html, /Simulador local/);
  assert.match(html, /diagnóstico local/);
  assert.match(html, /Versão não informada/);
  assert.match(html, /Último contato/);
  assert.doesNotMatch(html, /<button|Iniciar teste|Parar EV2/);
  index = 0;
  assert.equal(MaqueteLabControls({ stationId: '13' }), null);
  index = 0;
  const firmware = renderToStaticMarkup(React.createElement(MaqueteLabControls, { stationId: '46' }));
  assert.doesNotMatch(firmware, /Comandos EV1\/EV2/);
});

test('the existing charger card reserves Quebrado for an actual error, not offline', () => {
  const { chargerVisualStates } = load('components/chargers/charger-visual-state.ts');
  assert.equal(chargerVisualStates.offline.label, 'Sem conexão');
  assert.equal(chargerVisualStates.erro.label, 'Quebrado');
});
